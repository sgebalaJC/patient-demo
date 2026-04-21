import { createHash } from "crypto";

/**
 * Replace a secret value with a stable fingerprint:
 *   "<redacted:sha256:abc123def456>"
 * The first 12 hex chars of sha256(value) are enough to detect rotation
 * (different value → different fingerprint → diff visible in PR) without
 * leaking the original. 12 hex = 48 bits of collision resistance, fine for
 * change-detection over a small population of secrets.
 */
function fingerprint(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 12);
  return `<redacted:sha256:${hash}>`;
}

/**
 * Glob-like dotted path matcher. Supports `*` for a single path segment.
 */
function pathMatches(pattern: string, path: string): boolean {
  const pSegs = pattern.split(".");
  const aSegs = path.split(".");
  if (pSegs.length !== aSegs.length) return false;
  return pSegs.every((seg, i) => seg === "*" || seg === aSegs[i]);
}

const SECRET_PATH_PATTERNS = [
  "gateway.auth.token",
  "channels.*.accounts.*.botToken",
  "channels.*.accounts.*.appToken",
  "channels.*.accounts.*.userToken",
  "channels.*.accounts.*.signingSecret",
  "channels.*.accounts.*.clientSecret",
  "channels.*.accounts.*.refreshToken",
  "channels.*.accounts.*.accessToken",
  "channels.*.webhookSecret",
  "channels.*.accounts.*.webhookSecret",
  "plugins.*.config.*.token",
  "plugins.*.config.*.apiKey",
  "plugins.*.config.*.clientSecret",
  "plugins.*.config.*.privateKey",
  "plugins.*.config.*.refreshToken",
  "plugins.*.config.*.accessToken",
  "auth.*.token",
  "auth.*.apiKey",
  "auth.*.clientSecret",
  "profiles.*.access",
  "profiles.*.refresh",
  "profiles.*.idToken",
  "profiles.*.id_token",
];

const SECRET_SHAPE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "slack-bot", re: /^xoxb-[A-Za-z0-9-]{10,}/ },
  { name: "slack-app", re: /^xapp-[A-Za-z0-9-]{10,}/ },
  { name: "slack-user", re: /^xoxp-[A-Za-z0-9-]{10,}/ },
  { name: "github-pat", re: /^github_pat_[A-Za-z0-9_]{20,}/ },
  { name: "github-classic", re: /^ghp_[A-Za-z0-9]{20,}/ },
  { name: "github-oauth", re: /^gho_[A-Za-z0-9]{20,}/ },
  { name: "google-oauth", re: /^ya29\.[A-Za-z0-9_-]{20,}/ },
  { name: "jwt", re: /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/ },
  { name: "twilio-auth", re: /^SK[a-f0-9]{32}/ },
];

export interface RedactionStats {
  byAllowlist: number;
  byShape: { name: string; count: number }[];
  unredactedShapeMatches: string[];
}

export function redactJson(root: unknown): RedactionStats {
  const stats: RedactionStats = {
    byAllowlist: 0,
    byShape: SECRET_SHAPE_PATTERNS.map((p) => ({ name: p.name, count: 0 })),
    unredactedShapeMatches: [],
  };

  function visit(node: any, path: string): void {
    if (node === null || typeof node !== "object") return;

    for (const key of Object.keys(node)) {
      const childPath = path ? `${path}.${key}` : key;
      const value = node[key];

      if (typeof value === "string") {
        const allowlisted = SECRET_PATH_PATTERNS.some((p) => pathMatches(p, childPath));
        if (allowlisted) {
          if (value.length > 0) {
            node[key] = fingerprint(value);
            stats.byAllowlist++;
          }
          continue;
        }

        for (let i = 0; i < SECRET_SHAPE_PATTERNS.length; i++) {
          if (SECRET_SHAPE_PATTERNS[i].re.test(value)) {
            node[key] = fingerprint(value);
            stats.byShape[i].count++;
            stats.unredactedShapeMatches.push(`${childPath} (${SECRET_SHAPE_PATTERNS[i].name})`);
            break;
          }
        }
        continue;
      }

      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          visit(value[i], `${childPath}.${i}`);
        }
        continue;
      }

      if (typeof value === "object") {
        visit(value, childPath);
      }
    }
  }

  visit(root, "");
  return stats;
}
