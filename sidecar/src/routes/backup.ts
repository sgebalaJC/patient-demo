import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from "fs";
import { $ } from "bun";
import { STATE_DIR, BACKUP_DIR } from "../lib/paths.js";
import { stop, start } from "../lib/process.js";

// Ensure backup directory exists
if (!existsSync(BACKUP_DIR)) {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

/** POST /backup/create — create a tar.gz of the OpenClaw state directory */
export async function handleCreate(): Promise<Response> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const name = `backup-${timestamp}.tar.gz`;
  const archivePath = `${BACKUP_DIR}/${name}`;

  try {
    await $`tar czf ${archivePath} -C ${STATE_DIR}/.. .openclaw/`.quiet();
    const stat = statSync(archivePath);
    return Response.json({
      ok: true,
      name,
      sizeMb: Math.round(stat.size / 1024 / 1024 * 100) / 100,
      createdAt: stat.birthtime.toISOString(),
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** GET /backup/list — list available backups */
export function handleList(): Response {
  try {
    if (!existsSync(BACKUP_DIR)) {
      return Response.json({ backups: [] });
    }

    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith(".tar.gz"))
      .sort()
      .reverse();

    const backups = files.map((name) => {
      const stat = statSync(`${BACKUP_DIR}/${name}`);
      return {
        name,
        sizeMb: Math.round(stat.size / 1024 / 1024 * 100) / 100,
        createdAt: stat.birthtime.toISOString(),
      };
    });

    return Response.json({ backups });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** POST /backup/restore — stop gateway, restore from archive, restart */
export async function handleRestore(request: Request): Promise<Response> {
  const body = (await request.json()) as { name: string };
  if (!body.name) {
    return Response.json({ error: "name required" }, { status: 400 });
  }

  const archivePath = `${BACKUP_DIR}/${body.name}`;
  if (!existsSync(archivePath) || body.name.includes("..")) {
    return Response.json({ error: "Backup not found" }, { status: 404 });
  }

  try {
    // Safety: create auto-backup before restoring
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const safetyName = `pre-restore-${timestamp}.tar.gz`;
    await $`tar czf ${BACKUP_DIR}/${safetyName} -C ${STATE_DIR}/.. .openclaw/`.quiet();

    // Stop gateway
    await stop();

    // Restore: extract over state directory
    await $`tar xzf ${archivePath} -C ${STATE_DIR}/..`.quiet();

    // Start gateway
    await start();

    return Response.json({ ok: true, safetyBackup: safetyName });
  } catch (err) {
    // Try to restart gateway even on failure
    try { await start(); } catch { /* best effort */ }
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** GET /backup/:name/download — download a backup archive */
export function handleDownload(name: string): Response {
  if (name.includes("..") || !name.endsWith(".tar.gz")) {
    return Response.json({ error: "Invalid backup name" }, { status: 400 });
  }

  const archivePath = `${BACKUP_DIR}/${name}`;
  if (!existsSync(archivePath)) {
    return Response.json({ error: "Backup not found" }, { status: 404 });
  }

  const file = Bun.file(archivePath);
  return new Response(file, {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

/** DELETE /backup/:name — delete a backup archive */
export function handleDelete(name: string): Response {
  if (name.includes("..") || !name.endsWith(".tar.gz")) {
    return Response.json({ error: "Invalid backup name" }, { status: 400 });
  }

  const archivePath = `${BACKUP_DIR}/${name}`;
  if (!existsSync(archivePath)) {
    return Response.json({ error: "Backup not found" }, { status: 404 });
  }

  try {
    rmSync(archivePath);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
