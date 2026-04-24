import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "fs";
import { join } from "path";
import { SKILLS_MANIFEST, SKILLS_SOURCE, WORKSPACE } from "../lib/paths.js";

// Skills live alongside the rest of the OpenClaw workspace so Aurelia's
// runtime + this sidecar see the same directory. Honor OPENCLAW_STATE_DIR
// rather than hardcoding /root — when the agent runs as a non-root user
// (e.g. /home/openclaw/.openclaw), skills must follow.
const WORKSPACE_SKILLS = join(WORKSPACE, "skills");

if (!existsSync(WORKSPACE_SKILLS)) {
  mkdirSync(WORKSPACE_SKILLS, { recursive: true });
}

// ── id / integrationId validators ─────────────────────────────────────
const ID_RE = /^[A-Za-z0-9_-]+$/;
const isValidId = (id: string): boolean => ID_RE.test(id);

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

/**
 * Parse the YAML frontmatter of a SKILL.md to pull `name` and `description`.
 * Hand-rolled — frontmatter is tiny + flat, not worth a yaml dep.
 */
function readFrontmatter(path: string): { name?: string; description?: string } {
  try {
    const content = readFileSync(path, "utf-8");
    if (!content.startsWith("---")) return {};
    const end = content.indexOf("\n---", 3);
    if (end === -1) return {};
    const block = content.slice(3, end);
    const out: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const m = line.match(/^([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * GET /skills — list installed skills.
 *
 * Skills are deployed to disk by `sidecar/deploy.sh`, not registered through
 * the UI. This endpoint enumerates `/root/.openclaw/workspace/skills/` and
 * reads each SKILL.md's frontmatter (name + description). No registry file,
 * no shell-out — robust against the compiled-binary `find` quirks that broke
 * the previous `/files`-based listing.
 */
export function handleListSkills(): Response {
  if (!existsSync(WORKSPACE_SKILLS)) {
    return Response.json({ skills: [] });
  }
  try {
    const skills: SkillInfo[] = [];
    for (const entry of readdirSync(WORKSPACE_SKILLS)) {
      const dir = join(WORKSPACE_SKILLS, entry);
      const skillFile = join(dir, "SKILL.md");
      if (!statSync(dir).isDirectory()) continue;
      if (!existsSync(skillFile)) continue;
      const fm = readFrontmatter(skillFile);
      skills.push({
        id: entry,
        name: fm.name || entry,
        description: fm.description || "",
      });
    }
    skills.sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ skills });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** GET /skills/:id — return the full SKILL.md body for one installed skill. */
export function handleReadSkill(id: string): Response {
  if (!isValidId(id)) {
    return Response.json({ error: "Invalid skill id" }, { status: 400 });
  }
  const path = join(WORKSPACE_SKILLS, id, "SKILL.md");
  if (!existsSync(path)) {
    return Response.json({ error: "Skill not found" }, { status: 404 });
  }
  try {
    return Response.json({ id, content: readFileSync(path, "utf-8") });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

// ── install / uninstall / sync ────────────────────────────────────────
//
// Integration-bundled skills live in two places on the host:
//  - SKILLS_SOURCE (workspace/skills-source/) — read-only library,
//    populated by `sidecar/deploy.sh` for every skill in the repo.
//  - WORKSPACE_SKILLS (workspace/skills/)     — active set the agent
//    actually sees. Written only in response to a connect/disconnect.
//
// Non-integration skills (admin-tasks, scheduling, secure-messaging, …)
// are deployed directly into workspace/skills and never touched here.

function readManifest(): Record<string, string[]> {
  if (!existsSync(SKILLS_MANIFEST)) return {};
  try {
    const raw = JSON.parse(readFileSync(SKILLS_MANIFEST, "utf-8"));
    const integs = raw?.integrations;
    if (!integs || typeof integs !== "object") return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(integs)) {
      if (Array.isArray(v) && v.every((s) => typeof s === "string" && isValidId(s))) {
        out[k] = v as string[];
      }
    }
    return out;
  } catch {
    return {};
  }
}

function installSkillImpl(id: string): { installed: boolean; reason?: string } {
  const src = join(SKILLS_SOURCE, id);
  const dst = join(WORKSPACE_SKILLS, id);
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    return { installed: false, reason: "source_missing" };
  }
  mkdirSync(WORKSPACE_SKILLS, { recursive: true });
  // Remove any stale copy first so nested files deleted upstream don't
  // linger. cpSync overlays but won't prune removed entries.
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  return { installed: true };
}

function uninstallSkillImpl(id: string): { removed: boolean } {
  const dst = join(WORKSPACE_SKILLS, id);
  if (!existsSync(dst)) return { removed: false };
  rmSync(dst, { recursive: true, force: true });
  return { removed: true };
}

/**
 * POST /skills/sync
 * Body: { integrationId: string, enabled: boolean }
 *
 * Looks up the skill ids bundled with `integrationId` in the manifest
 * and either installs (copies from skills-source → skills) or removes
 * them, atomically for the integration as a whole.
 *
 * Idempotent: installing a skill that's already present just overwrites
 * with the current source; uninstalling one that's already gone returns
 * removed=false. No error either way.
 */
export async function handleSkillSync(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { integrationId?: string; enabled?: boolean };
    const integrationId = body?.integrationId;
    const enabled = body?.enabled;
    if (!integrationId || !isValidId(integrationId)) {
      return Response.json({ error: "integrationId required" }, { status: 400 });
    }
    if (typeof enabled !== "boolean") {
      return Response.json({ error: "enabled (boolean) required" }, { status: 400 });
    }
    const manifest = readManifest();
    const skillIds = manifest[integrationId] ?? [];
    if (skillIds.length === 0) {
      // No skills bundled with this integration — e.g. Slack. Not an error.
      return Response.json({ integrationId, enabled, skills: [], noop: true });
    }
    const results = skillIds.map((id) => ({
      id,
      ...(enabled ? installSkillImpl(id) : uninstallSkillImpl(id)),
    }));
    return Response.json({ integrationId, enabled, skills: results });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
