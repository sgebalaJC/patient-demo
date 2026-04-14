#!/usr/bin/env bun
/**
 * Infra build — compose the authoritative OpenClaw config.
 *
 * Reads:
 *   - infra/openclaw.base.json      shared gateway/channels/plugins/memory
 *   - infra/agents/*.json           one profile per agent; merged into agents.list
 *
 * Writes:
 *   - openclaw/openclaw.json         rendered config, repo mirror of what
 *                                    lives on the host VM at /root/.openclaw/.
 *
 * Run:    bun run infra/build.ts
 * Deploy: infra/deploy.sh
 */

import {readFileSync, writeFileSync, readdirSync} from "node:fs";
import {resolve, join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const BASE_FILE = join(HERE, "openclaw.base.json");
const AGENTS_DIR = join(HERE, "agents");
const OUT_FILE = join(REPO, "openclaw", "openclaw.json");

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Source wins on leaf values; objects deep-merge; arrays are replaced. */
function deepMerge<T>(target: T, source: unknown): T {
  if (!isPlainObject(source)) return source as T;
  if (!isPlainObject(target)) return source as T;
  const out: Record<string, unknown> = {...target};
  for (const [k, v] of Object.entries(source)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

function main(): void {
  const base = readJson<Record<string, any>>(BASE_FILE);

  const agents = readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({file: f, profile: readJson<Record<string, any>>(join(AGENTS_DIR, f))}));

  const byId = new Map<string, any>();
  for (const {file, profile} of agents) {
    if (!profile.id || typeof profile.id !== "string") {
      throw new Error(`${file}: profile must have "id" (string)`);
    }
    if (byId.has(profile.id)) {
      throw new Error(`${file}: duplicate agent id "${profile.id}"`);
    }
    byId.set(profile.id, profile);
  }

  // "main" is the default agent — place it first.
  const ordered: any[] = [];
  if (byId.has("main")) ordered.push(byId.get("main"));
  for (const [id, p] of byId) if (id !== "main") ordered.push(p);

  const rendered = deepMerge(base, {agents: {list: ordered}});

  writeFileSync(OUT_FILE, JSON.stringify(rendered, null, 2) + "\n");
  console.log(`[infra] wrote ${OUT_FILE}`);
  console.log(`[infra] agents: ${ordered.map((a) => `${a.id} (${a.params?.think ?? "–"})`).join(", ")}`);
}

main();
