/**
 * OpenClaw config backup — Cloud Run Job.
 *
 * Nightly: pull a snapshot of allowlisted /root/.openclaw paths from the sidecar,
 * redact known secret fields with sha256 fingerprints, commit any drift to a
 * backup branch in the repo under BACKUP_PATH. Point is versioned config
 * history: what changed, when, which secrets rotated (fingerprint deltas),
 * without ever committing actual secret values.
 *
 * Env vars (all required unless defaulted):
 *   SIDECAR_URL          e.g. http://<vm-ip>:8081
 *   SIDECAR_API_KEY      bearer token
 *   GITHUB_PAT           fine-grained PAT, contents:write on target repo
 *   GITHUB_REPO          owner/name (per-fork)
 *   GITHUB_BRANCH        default main
 *   BACKUP_PATH          default backup/openclaw
 *   COMMIT_AUTHOR_NAME   default OpenClaw Backup Bot
 *   COMMIT_AUTHOR_EMAIL  default openclaw-backup@example.com
 */

import { mkdtemp, rm, mkdir, readdir, stat, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, relative } from "path";
import { execFileSync, spawnSync } from "child_process";
import { createWriteStream } from "fs";
import { redactJson, type RedactionStats } from "./redact.js";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const SIDECAR_URL = env("SIDECAR_URL");
const SIDECAR_API_KEY = env("SIDECAR_API_KEY");
const GITHUB_PAT = env("GITHUB_PAT");
const GITHUB_REPO = env("GITHUB_REPO");
const GITHUB_BRANCH = env("GITHUB_BRANCH", "main");
const BACKUP_PATH = env("BACKUP_PATH", "backup/openclaw");
const COMMIT_AUTHOR_NAME = env("COMMIT_AUTHOR_NAME", "OpenClaw Backup Bot");
const COMMIT_AUTHOR_EMAIL = env("COMMIT_AUTHOR_EMAIL", "openclaw-backup@example.com");

function git(args: string[], cwd: string): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function downloadSnapshot(destPath: string): Promise<void> {
  const res = await fetch(`${SIDECAR_URL}/snapshot/openclaw`, {
    headers: { Authorization: `Bearer ${SIDECAR_API_KEY}` },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Sidecar snapshot failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  const out = createWriteStream(destPath);
  const reader = res.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out.write(value);
  }
  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.on("error", reject);
  });
}

async function extractTar(tarPath: string, destDir: string): Promise<void> {
  execFileSync("tar", ["xzf", tarPath, "-C", destDir], { stdio: "inherit" });
}

async function walkAndRedact(rootDir: string): Promise<{
  filesScanned: number;
  filesRedacted: number;
  totals: RedactionStats;
}> {
  const totals: RedactionStats = {
    byAllowlist: 0,
    byShape: [],
    unredactedShapeMatches: [],
  };
  let filesScanned = 0;
  let filesRedacted = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir);
    for (const name of entries) {
      const full = join(dir, name);
      const s = await stat(full);
      if (s.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!s.isFile()) continue;
      if (!/\.json$/i.test(name)) continue;

      filesScanned++;
      let raw: string;
      try {
        raw = await readFile(full, "utf-8");
      } catch {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      const stats = redactJson(parsed);
      const touched =
        stats.byAllowlist > 0 || stats.byShape.some((s) => s.count > 0);
      if (!touched) continue;

      filesRedacted++;
      totals.byAllowlist += stats.byAllowlist;
      for (const s of stats.byShape) {
        const existing = totals.byShape.find((t) => t.name === s.name);
        if (existing) existing.count += s.count;
        else totals.byShape.push({ ...s });
      }
      for (const m of stats.unredactedShapeMatches) {
        if (!totals.unredactedShapeMatches.includes(m)) {
          totals.unredactedShapeMatches.push(m);
        }
      }
      await writeFile(full, JSON.stringify(parsed, null, 2) + "\n");
    }
  }

  await walk(rootDir);
  return { filesScanned, filesRedacted, totals };
}

function buildCommitMessage(
  changedFiles: string[],
  redactStats: { filesScanned: number; filesRedacted: number; totals: RedactionStats },
): string {
  const date = new Date().toISOString().slice(0, 10);
  const subject = `chore(openclaw-backup): nightly snapshot ${date}`;

  const lines: string[] = [subject, ""];
  lines.push(`${changedFiles.length} file(s) changed:`);
  for (const f of changedFiles.slice(0, 30)) {
    lines.push(`  - ${f}`);
  }
  if (changedFiles.length > 30) {
    lines.push(`  ... and ${changedFiles.length - 30} more`);
  }
  lines.push("");
  lines.push(
    `Redaction: ${redactStats.totals.byAllowlist} allowlisted, ${redactStats.filesRedacted}/${redactStats.filesScanned} files touched.`,
  );
  const shapeNonZero = redactStats.totals.byShape.filter((s) => s.count > 0);
  if (shapeNonZero.length > 0) {
    lines.push(
      `Shape-matched (fallback): ${shapeNonZero.map((s) => `${s.name}=${s.count}`).join(", ")}`,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  console.log(`[openclaw-backup] starting; repo=${GITHUB_REPO} branch=${GITHUB_BRANCH} path=${BACKUP_PATH}`);

  const work = await mkdtemp(join(tmpdir(), "openclaw-backup-"));
  const tarPath = join(work, "snapshot.tar.gz");
  const repoDir = join(work, "repo");

  try {
    console.log("[openclaw-backup] downloading snapshot from sidecar");
    await downloadSnapshot(tarPath);

    console.log(`[openclaw-backup] cloning ${GITHUB_REPO}`);
    execFileSync(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "-b",
        GITHUB_BRANCH,
        `https://x-access-token:${GITHUB_PAT}@github.com/${GITHUB_REPO}.git`,
        repoDir,
      ],
      { stdio: "inherit", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );

    const backupDir = join(repoDir, BACKUP_PATH);
    await rm(backupDir, { recursive: true, force: true });
    await mkdir(backupDir, { recursive: true });

    console.log(`[openclaw-backup] extracting snapshot into ${backupDir}`);
    await extractTar(tarPath, backupDir);

    console.log("[openclaw-backup] redacting secrets");
    const redactStats = await walkAndRedact(backupDir);
    console.log(
      `[openclaw-backup] redacted: ${redactStats.totals.byAllowlist} allowlisted across ${redactStats.filesRedacted}/${redactStats.filesScanned} json files`,
    );

    git(["config", "user.name", COMMIT_AUTHOR_NAME], repoDir);
    git(["config", "user.email", COMMIT_AUTHOR_EMAIL], repoDir);
    git(["add", BACKUP_PATH], repoDir);

    const status = git(["status", "--porcelain"], repoDir).trim();
    if (!status) {
      console.log("[openclaw-backup] no drift; nothing to commit");
      return;
    }

    const changedFiles = status
      .split("\n")
      .map((l) => l.slice(3))
      .filter(Boolean)
      .map((p) => relative(BACKUP_PATH, p) || p);

    const message = buildCommitMessage(changedFiles, redactStats);
    git(["commit", "-m", message], repoDir);
    git(["push", "origin", GITHUB_BRANCH], repoDir);

    console.log(`[openclaw-backup] pushed: ${changedFiles.length} file(s) changed`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[openclaw-backup] FAILED:", err);
  process.exit(1);
});
