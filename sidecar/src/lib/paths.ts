/** Filesystem paths for the OpenClaw installation. */

export const STATE_DIR = process.env.OPENCLAW_STATE_DIR || "/root/.openclaw";
export const WORKSPACE = `${STATE_DIR}/workspace`;
/** Read-only library of every shipped skill — populated by deploy.sh. The
 *  active `workspace/skills/` directory is mutated at runtime by the
 *  skill-sync endpoint based on which integrations are connected. */
export const SKILLS_SOURCE = `${WORKSPACE}/skills-source`;
/** Skill → integration mapping manifest, also shipped by deploy.sh.
 *  When the sidecar installs/uninstalls a skill on integration connect/
 *  disconnect it looks up which skill ids belong to the integration. */
export const SKILLS_MANIFEST = `${WORKSPACE}/skills.manifest.json`;
export const CONFIG_PATH = `${STATE_DIR}/openclaw.json`;
export const BACKUP_DIR = process.env.BACKUP_DIR || "/root/.openclaw-backups";
export const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || "18789");
export const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
