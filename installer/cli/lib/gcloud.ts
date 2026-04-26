import {run, runCapture, type RunResult} from "./exec.ts";

/**
 * Wrapper around `gcloud` that:
 *  - never interpolates user input into a shell string (argv-only)
 *  - pins --project where applicable
 *  - returns parsed JSON when `format=json` is requested
 */
export interface GcloudOpts {
  project?: string;
  /** When true, returns parsed JSON; caller must pass `--format=json` themselves OR set jsonFormat. */
  json?: boolean;
  /** When true, automatically appends --format=json. */
  jsonFormat?: boolean;
  /** Don't throw on non-zero exit — return the raw result. */
  allowFail?: boolean;
  capture?: boolean;
  input?: string;
}

export function gcloud(args: readonly string[], opts: GcloudOpts = {}): RunResult {
  const finalArgs: string[] = [...args];
  if (opts.project && !finalArgs.includes("--project")) {
    finalArgs.push(`--project=${opts.project}`);
  }
  if (opts.jsonFormat && !finalArgs.some((a) => a.startsWith("--format"))) {
    finalArgs.push("--format=json");
  }
  return run("gcloud", finalArgs, {
    capture: opts.capture ?? opts.json ?? opts.jsonFormat,
    allowFail: opts.allowFail,
    input: opts.input,
  });
}

export function gcloudJson<T = unknown>(args: readonly string[], opts: Omit<GcloudOpts, "json" | "jsonFormat"> = {}): T {
  const r = gcloud(args, {...opts, jsonFormat: true});
  return JSON.parse(r.stdout) as T;
}

export function gcloudText(args: readonly string[], opts: Omit<GcloudOpts, "capture"> = {}): string {
  return gcloud(args, {...opts, capture: true}).stdout.trim();
}

export function firebase(args: readonly string[], opts: GcloudOpts = {}): RunResult {
  const finalArgs: string[] = [...args];
  if (opts.project && !finalArgs.includes("--project")) {
    finalArgs.push(`--project=${opts.project}`);
  }
  return run("firebase", finalArgs, {
    capture: opts.capture,
    allowFail: opts.allowFail,
    input: opts.input,
  });
}

export function firebaseText(args: readonly string[], opts: Omit<GcloudOpts, "capture"> = {}): string {
  return firebase(args, {...opts, capture: true}).stdout.trim();
}

/** Idempotency helper — true if `gcloud` describes the resource without 404. */
export function exists(args: readonly string[], opts: GcloudOpts = {}): boolean {
  const r = gcloud(args, {...opts, allowFail: true, capture: true});
  return r.exitCode === 0;
}

/** Quick auth check — throws with a friendly message if no ADC / no active account. */
export function assertAuthed(): void {
  const account = runCapture("gcloud", ["config", "list", "account", "--format=value(core.account)"], {allowFail: true});
  if (!account) {
    throw new Error(
      "gcloud has no active account. Run `gcloud auth login` and `gcloud auth application-default login`, then re-run the installer.",
    );
  }
}
