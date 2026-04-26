import {existsSync, mkdirSync, readdirSync, statSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {run, which} from "../lib/exec.ts";
import type {Step} from "../lib/types.ts";

/** rsync excludes — paths matched relative to the repo root. */
const EXCLUDES = [
  ".installer-state.json",
  ".git",
  "node_modules",
  ".firebase",
  "web/dist",
  "web/.vite",
  "functions/lib",
  "functions/src/_fork.config.ts",
  "openclaw/openclaw.json",
  "*.local",
  "*.log",
  "firebase-debug*.log",
  ".DS_Store",
  "sidecar/patient-sidecar",
  "mobile/build",
  "mobile/.dart_tool",
  // Ourselves — the new fork doesn't need a copy of the installer.
  "installer",
];

function repoRoot(): string {
  // installer/cli/steps/02-copy-template.ts → ../../../
  return resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
}

export const copyTemplateStep: Step = {
  id: "02-copy-template",
  title: "Copy template into target dir",
  idempotent: true,
  async run({state, log}) {
    const inputs = state.inputs;
    if (!inputs.targetDir) throw new Error("targetDir missing — run collect-inputs first");
    const target = resolve(inputs.targetDir);
    const source = repoRoot();

    mkdirSync(target, {recursive: true});

    // Idempotency guard: if target already has core files (firebase.json,
    // web/, functions/) we assume the copy ran before and skip.
    const looksPopulated =
      existsSync(`${target}/firebase.json`) &&
      existsSync(`${target}/web`) &&
      existsSync(`${target}/functions`);
    if (looksPopulated && state.completedSteps.includes("02-copy-template")) {
      log.info(`Target ${target} already populated; skipping rsync.`);
      return;
    }

    if (!which("rsync")) {
      throw new Error("rsync not on PATH — install it (`brew install rsync` on macOS).");
    }

    // -a = archive (recursive + perms + times); -q = quiet (the clack
    // spinner covers progress UI). Avoid --info=* — Apple's bundled rsync
    // 2.6.9 on macOS doesn't recognise it.
    const args: string[] = ["-aq"];
    for (const e of EXCLUDES) args.push(`--exclude=${e}`);
    args.push(`${source}/`, `${target}/`);

    const spinner = log.spinner(`Copying template ${source} → ${target}`);
    try {
      run("rsync", args, {capture: true});
      const fileCount = readdirSync(target).filter((f) => statSync(`${target}/${f}`).isFile()).length;
      spinner.stop(`Copied template into ${target} (${fileCount} root-level files).`);
    } catch (err) {
      spinner.fail("rsync failed");
      throw err;
    }
  },
};
