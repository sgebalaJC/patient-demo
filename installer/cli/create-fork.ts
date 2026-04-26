#!/usr/bin/env bun
/**
 * patient-installer entry point.
 *
 * Usage:
 *   bun run installer/cli/create-fork.ts
 *   bun run installer/cli/create-fork.ts --target /path/to/new-fork
 *   bun run installer/cli/create-fork.ts --only 04-gcp-project
 *   bun run installer/cli/create-fork.ts --rerun 09-openclaw-vm
 *
 * The installer is resumable: state lives in `<targetDir>/.installer-state.json`
 * and each step is idempotent. If a step fails, fix the underlying issue and
 * re-run — the runner picks up where it left off.
 */

import {parseArgs} from "node:util";
import {runInstaller} from "./runner.ts";

const {values} = parseArgs({
  options: {
    target: {type: "string"},
    only: {type: "string"},
    rerun: {type: "string"},
    help: {type: "boolean", short: "h"},
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(`patient-installer

Usage:
  bun run installer/cli/create-fork.ts [--target DIR] [--only STEP_ID] [--rerun STEP_ID]

Options:
  --target DIR     Resume an installer state in DIR (defaults to a new run, or cwd if it has state).
  --only STEP_ID   Run only the named step then exit.
  --rerun STEP_ID  Force the named step to run even if previously completed.
  -h, --help       Show this help.
`);
  process.exit(0);
}

await runInstaller({
  targetDir: values.target,
  only: values.only,
  rerun: values.rerun,
});
