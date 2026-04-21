import { existsSync } from "fs";
import { STATE_DIR } from "../lib/paths.js";

/**
 * Allowlist of paths under STATE_DIR to include in the config snapshot.
 * Anything not listed is excluded — small, deliberate snapshot (no vector
 * DB, no chat sessions, no credentials).
 */
const SNAPSHOT_INCLUDES = [
  "openclaw.json",
  "openclaw.json.bak",
  "openclaw.json.bak.1",
  "openclaw.json.bak.2",
  "openclaw.json.bak.3",
  "openclaw.json.bak.4",
  "agents/main/agent",
  "agents/patient-support/agent",
  "cron",
  "flows",
  "extensions",
  "qqbot",
  "exec-approvals.json",
  "update-check.json",
];

/**
 * GET /snapshot/openclaw — stream a tar.gz of allowlisted config paths.
 * Caller (Cloud Run Job) extracts, redacts secrets, commits to git.
 */
export async function handleSnapshot(): Promise<Response> {
  const existing = SNAPSHOT_INCLUDES.filter((p) => existsSync(`${STATE_DIR}/${p}`));
  if (existing.length === 0) {
    return Response.json({ error: "No snapshot paths exist" }, { status: 500 });
  }

  const TAR_EXCLUDES = ["*.sqlite", "*.sqlite-shm", "*.sqlite-wal", "*.db", "node_modules"];

  try {
    const excludeArgs = TAR_EXCLUDES.flatMap((p) => ["--exclude", p]);
    const proc = Bun.spawn(
      ["tar", "czf", "-", "-C", STATE_DIR, ...excludeArgs, ...existing],
      { stdout: "pipe", stderr: "pipe" },
    );

    return new Response(proc.stdout, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="openclaw-snapshot-${new Date().toISOString().slice(0, 10)}.tar.gz"`,
      },
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
