import {readFileSync, writeFileSync} from "node:fs";
import {resolve} from "node:path";
import type {Step} from "../lib/types.ts";

/**
 * Rewrite the hardcoded super-admin email allowlist in the four sync points
 * (functions/src/superAdmins.ts, web/src/lib/roles.ts, firestore.rules,
 * storage.rules) to the operator's `inputs.adminEmail` so the new fork's
 * super-admin is the practice owner — not the template's maintainer.
 *
 * Runs after `10-fork-config` (which already baked the email into
 * fork.config.ts) and before `12b-package-source` so the source tarball
 * `enableIntegration` later deploys carries the correct allowlist.
 *
 * Idempotent: matches the literal `'stanislaw.gebala@gmail.com'` (a
 * deliberate template constant) and replaces it. Re-running with the same
 * email is a no-op; running with a different email rewrites again.
 */
const TEMPLATE_EMAIL = "stanislaw.gebala@gmail.com";

interface RewriteTarget {
  path: string;
  /** What to look for. Each pattern must appear at least once or step throws. */
  patterns: string[];
}

export const rewriteSuperAdminStep: Step = {
  id: "10b-rewrite-superadmin",
  title: "Rewrite super-admin email in source files",
  idempotent: true,
  async run({state, log}) {
    const {targetDir, superAdminEmail} = state.inputs;
    if (!targetDir || !superAdminEmail) throw new Error("inputs missing");

    if (superAdminEmail === TEMPLATE_EMAIL) {
      log.info("superAdminEmail equals template default; skipping rewrite.");
      return;
    }

    const targets: RewriteTarget[] = [
      {
        path: resolve(targetDir, "functions/src/superAdmins.ts"),
        patterns: [`'${TEMPLATE_EMAIL}'`],
      },
      {
        path: resolve(targetDir, "web/src/lib/roles.ts"),
        patterns: [`'${TEMPLATE_EMAIL}'`],
      },
      {
        path: resolve(targetDir, "firestore.rules"),
        patterns: [`'${TEMPLATE_EMAIL}'`],
      },
      {
        path: resolve(targetDir, "storage.rules"),
        patterns: [`'${TEMPLATE_EMAIL}'`],
      },
    ];

    for (const t of targets) {
      let src: string;
      try {
        src = readFileSync(t.path, "utf8");
      } catch (err) {
        throw new Error(`could not read ${t.path}: ${(err as Error).message}`);
      }
      let updated = src;
      for (const p of t.patterns) {
        if (!updated.includes(p) && !updated.includes(`'${superAdminEmail}'`)) {
          throw new Error(`pattern ${p} not found in ${t.path} — file may have drifted from template`);
        }
        updated = updated.split(p).join(`'${superAdminEmail}'`);
      }
      if (updated !== src) {
        writeFileSync(t.path, updated);
        log.success(`Rewrote super-admin in ${t.path}`);
      } else {
        log.info(`Already current: ${t.path}`);
      }
    }
  },
};
