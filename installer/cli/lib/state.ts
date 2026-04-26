import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
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

export function saveState(targetDir: string, state: InstallerState): void {
  const p = statePath(targetDir);
  mkdirSync(dirname(p), {recursive: true});
  state.updatedAt = new Date().toISOString();
  writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
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
