import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {dirname, join} from "node:path";
import {InstallerStateSchema, type InstallerState} from "./types.ts";

const STATE_FILE = ".installer-state.json";

export function statePath(targetDir: string): string {
  return join(targetDir, STATE_FILE);
}

export function loadState(targetDir: string): InstallerState | null {
  const p = statePath(targetDir);
  if (!existsSync(p)) return null;
  const raw = JSON.parse(readFileSync(p, "utf8"));
  return InstallerStateSchema.parse(raw);
}

/**
 * Atomic write: render to a sibling tempfile, then rename over the target.
 * `rename(2)` on the same filesystem is atomic on POSIX, so a SIGINT or
 * crash mid-write either leaves the previous state.json intact OR replaces
 * it wholesale — never a half-written JSON that would fail Zod parse on the
 * next resume. Tempfile name uses a random suffix to avoid collisions when
 * two installer processes happen to overlap.
 */
export function saveState(targetDir: string, state: InstallerState): void {
  const p = statePath(targetDir);
  mkdirSync(dirname(p), {recursive: true});
  state.updatedAt = new Date().toISOString();
  const tmp = `${p}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, p);
}

export function newState(): InstallerState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    inputs: {},
    artifacts: {createdSecrets: []},
    completedSteps: [],
    startedAt: now,
    updatedAt: now,
  };
}

export function markCompleted(state: InstallerState, stepId: string): void {
  if (!state.completedSteps.includes(stepId)) state.completedSteps.push(stepId);
}
