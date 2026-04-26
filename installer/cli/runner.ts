import {existsSync, mkdirSync} from "node:fs";
import {resolve} from "node:path";
import pc from "picocolors";
import {createLogger} from "./lib/log.ts";
import {loadState, newState, markCompleted, saveState} from "./lib/state.ts";
import type {InstallerState, Step} from "./lib/types.ts";
import {STEPS} from "./steps/index.ts";

interface RunnerOptions {
  /** Target dir override (skips the implicit "use existing state" lookup). */
  targetDir?: string;
  /** Only run a single step by id, then exit. */
  only?: string;
  /** Re-run the named step even if completed. */
  rerun?: string;
}

function findStateDir(initial?: string): string | null {
  if (initial && existsSync(`${resolve(initial)}/.installer-state.json`)) return resolve(initial);
  // Allow running from inside the target dir.
  if (existsSync(`${process.cwd()}/.installer-state.json`)) return process.cwd();
  return null;
}

export async function runInstaller(opts: RunnerOptions = {}): Promise<void> {
  const log = createLogger();

  const stateDir = findStateDir(opts.targetDir);
  let state: InstallerState;

  if (stateDir) {
    state = loadState(stateDir)!;
    log.info(`Resuming installer in ${stateDir} (${state.completedSteps.length}/${STEPS.length} steps complete).`);
  } else {
    state = newState();
    // Pre-seed targetDir from --target so collect-inputs prefills it instead of re-asking.
    if (opts.targetDir) state.inputs.targetDir = resolve(opts.targetDir);
    log.info("Starting a fresh installer run.");
  }

  for (const step of STEPS) {
    const should = decideRun(step, state, opts);
    if (!should) continue;

    log.step(`▸ ${pc.bold(step.title)} (${step.id})`);
    try {
      await step.run({
        state,
        log,
        save: async () => {
          if (state.inputs.targetDir) {
            mkdirSync(state.inputs.targetDir, {recursive: true});
            saveState(state.inputs.targetDir, state);
          }
        },
      });
    } catch (err) {
      log.error(`Step ${step.id} failed: ${(err as Error).message}`);
      // Try to persist partial state so the next run can resume.
      if (state.inputs.targetDir && existsSync(state.inputs.targetDir)) {
        saveState(state.inputs.targetDir, state);
        log.info(`State persisted to ${state.inputs.targetDir}/.installer-state.json — re-run to retry.`);
      }
      throw err;
    }

    markCompleted(state, step.id);
    if (state.inputs.targetDir && existsSync(state.inputs.targetDir)) {
      saveState(state.inputs.targetDir, state);
    }

    if (opts.only && opts.only === step.id) {
      log.info(`--only ${opts.only}: stopping after this step.`);
      return;
    }
  }

  log.success("All installer steps completed.");
}

function decideRun(step: Step, state: InstallerState, opts: RunnerOptions): boolean {
  if (opts.only && opts.only !== step.id) return false;
  if (opts.rerun && opts.rerun === step.id) return true;
  if (state.completedSteps.includes(step.id) && step.idempotent) return false;
  return true;
}
