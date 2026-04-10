/** Filesystem paths for the OpenClaw installation. */

export const STATE_DIR = process.env.OPENCLAW_STATE_DIR || "/root/.openclaw";
export const WORKSPACE = `${STATE_DIR}/workspace`;
export const CONFIG_PATH = `${STATE_DIR}/openclaw.json`;
export const BACKUP_DIR = process.env.BACKUP_DIR || "/root/.openclaw-backups";
export const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || "18789");
export const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
