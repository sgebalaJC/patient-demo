import {spawnSync, type SpawnSyncOptions} from "node:child_process";

export class CommandError extends Error {
  constructor(
    public readonly cmd: string,
    public readonly args: readonly string[],
    public readonly exitCode: number | null,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    const head = `${cmd} ${args.join(" ")}`;
    super(`command failed (exit ${exitCode}): ${head}\n${stderr.trim()}`);
    this.name = "CommandError";
  }
}

export interface RunOptions {
  cwd?: string;
  /** When true, stdout is captured + returned instead of inherited. stderr is always captured. */
  capture?: boolean;
  /** Extra env vars merged on top of process.env. */
  env?: Record<string, string>;
  /** Don't throw on non-zero exit; return the result. */
  allowFail?: boolean;
  /** Pipe data to stdin. */
  input?: string;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Run a command with argv as an array — never as an interpolated string.
 * Memory: "spawnSync(cmd, argv) only; path.resolve does not stop shell injection."
 */
export function run(cmd: string, args: readonly string[], opts: RunOptions = {}): RunResult {
  const spawnOpts: SpawnSyncOptions = {
    cwd: opts.cwd,
    env: opts.env ? {...process.env, ...opts.env} : process.env,
    encoding: "utf8",
    stdio: opts.input
      ? ["pipe", opts.capture ? "pipe" : "inherit", "pipe"]
      : ["ignore", opts.capture ? "pipe" : "inherit", "pipe"],
    input: opts.input,
    maxBuffer: 50 * 1024 * 1024,
  };
  const result = spawnSync(cmd, [...args], spawnOpts);
  const stdout = (result.stdout as unknown as string | undefined) ?? "";
  const stderr = (result.stderr as unknown as string | undefined) ?? "";
  if (!opts.allowFail && (result.status === null || result.status !== 0)) {
    throw new CommandError(cmd, args, result.status, stdout, stderr);
  }
  return {stdout, stderr, exitCode: result.status};
}

/** Convenience: run + return trimmed stdout, throw on failure. */
export function runCapture(cmd: string, args: readonly string[], opts: RunOptions = {}): string {
  return run(cmd, args, {...opts, capture: true}).stdout.trim();
}

/** Returns true iff the binary is on PATH. */
export function which(bin: string): boolean {
  const r = run("which", [bin], {capture: true, allowFail: true});
  return r.exitCode === 0 && r.stdout.trim().length > 0;
}
