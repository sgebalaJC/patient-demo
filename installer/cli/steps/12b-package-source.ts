import {existsSync, writeFileSync, unlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve, join} from "node:path";
import {gcloud, exists} from "../lib/gcloud.ts";
import {run, runCapture} from "../lib/exec.ts";
import type {Step} from "../lib/types.ts";

/**
 * Package the fork's `functions/` source into a versioned tarball + push to
 * GCS. The in-app `enableIntegration` callable pulls from the *latest*
 * pointer (`functions-source.tar.gz`); versioned copies under
 * `versions/<version>/` exist for rollback + drift inspection.
 *
 * Layout in `gs://<project>-installer-source/`:
 *   functions-source.tar.gz             ← latest pointer (overwritten each run)
 *   version.json                        ← latest version metadata (overwritten)
 *   versions/<version>/functions-source.tar.gz   ← immutable historical copy
 *   versions/<version>/version.json
 *
 * Version format: `<ISO-no-colons>-<git-short-sha>`, e.g.
 *   2026-04-26T22-30-00Z-4f5208e
 *
 * Why versioning matters: future maintainer-side tool will diff each fork's
 * `version.json` to decide which forks need updating, push fresh tarballs
 * to those forks' buckets, and re-trigger enableIntegration() for any
 * integrations recorded in `installed-integrations/*`.
 */
export const packageSourceStep: Step = {
  id: "12b-package-source",
  title: "Package functions/ source for in-app deploy",
  idempotent: true,
  async run({state, log}) {
    const {projectId, region, targetDir} = state.inputs;
    if (!projectId || !region || !targetDir) throw new Error("prerequisites missing");
    const cwd = resolve(targetDir);
    if (!existsSync(resolve(cwd, "functions"))) {
      throw new Error(`functions/ not found in ${cwd}`);
    }

    const bucket = `${projectId}-installer-source`;
    const bucketExists = exists(["storage", "buckets", "describe", `gs://${bucket}`, `--project=${projectId}`]);
    if (!bucketExists) {
      const sp = log.spinner(`Creating gs://${bucket}`);
      try {
        gcloud([
          "storage",
          "buckets",
          "create",
          `gs://${bucket}`,
          `--location=${region}`,
          "--uniform-bucket-level-access",
          `--project=${projectId}`,
        ]);
        sp.stop(`Created gs://${bucket}.`);
      } catch (err) {
        sp.fail();
        throw err;
      }
    }

    // Object versioning: keeps prior `latest` pointers around as noncurrent
    // versions so a poisoned overwrite is recoverable. Cheap (~one tarball
    // per push to main) and lets ops audit the bundle history.
    try {
      gcloud(
        ["storage", "buckets", "update", `gs://${bucket}`, "--versioning", `--project=${projectId}`],
        {capture: true},
      );
    } catch (err) {
      log.warn(`enabling versioning on gs://${bucket} returned non-zero: ${(err as Error).message.split("\n")[0]}`);
    }

    // Bucket-scoped IAM: Cloud Build SA needs write so the in-app deploy
    // path AND the push-on-main refresh trigger can replace the bundle.
    // Project-level granting in step 08 is `objectViewer` only — we tighten
    // write to this bucket explicitly so a project Editor cannot swap the
    // tarball without also touching this binding. Use objectCreator (NOT
    // objectAdmin): the SA only needs to upload new bundles, not delete
    // historical versions. objectAdmin would let the SA wipe the immutable
    // versions/<version>/ history that the rollback story relies on.
    const projectNumber = state.artifacts.projectNumber;
    if (projectNumber) {
      const cloudBuildSA = `${projectNumber}@cloudbuild.gserviceaccount.com`;
      for (const role of ["roles/storage.objectCreator", "roles/storage.objectViewer"]) {
        try {
          gcloud(
            [
              "storage",
              "buckets",
              "add-iam-policy-binding",
              `gs://${bucket}`,
              `--member=serviceAccount:${cloudBuildSA}`,
              `--role=${role}`,
              `--project=${projectId}`,
            ],
            {capture: true},
          );
          log.info(`Granted ${role} on gs://${bucket} → Cloud Build SA`);
        } catch (err) {
          log.warn(`bucket IAM grant ${role} for Cloud Build SA returned non-zero: ${(err as Error).message.split("\n")[0]}`);
        }
      }
    }

    // 1. Compute version tag. Keep millisecond precision in the timestamp
    //    so two runs in the same second don't produce the same version
    //    (which would silently overwrite the immutable historical copy
    //    in versions/<version>/...).
    let gitSha = "unknown";
    try {
      gitSha = runCapture("git", ["rev-parse", "--short", "HEAD"], {cwd}).slice(0, 12);
    } catch {
      log.warn("git rev-parse failed in target dir; using 'unknown' for sha.");
    }
    // 2026-04-26T22-30-00-123Z-<sha> (ms preserved, only `:` and `.` swapped).
    const isoNow = new Date().toISOString().replace(/[:.]/g, "-");
    const version = `${isoNow}-${gitSha}`;
    state.artifacts.installerSourceVersion = version;

    // 2. tar + gzip the functions tree.
    const tarball = resolve(cwd, ".installer-functions-source.tar.gz");
    const sp = log.spinner(`Packaging functions/ source (version ${version})`);
    try {
      run(
        "tar",
        [
          "--exclude=node_modules",
          "--exclude=lib",
          "--exclude=*.log",
          "-czf",
          tarball,
          "functions",
          "firebase.json",
          ".firebaserc",
        ],
        {cwd, capture: true},
      );
      sp.stop(`Packaged → ${tarball}`);
    } catch (err) {
      sp.fail();
      throw err;
    }

    // 3. Write version.json metadata.
    const versionMeta = {
      version,
      gitSha,
      generatedAt: new Date().toISOString(),
      generatedBy: "patient-installer",
      projectId,
      // Pointer paths so a maintainer's update script can reconstruct URIs.
      latestPointer: `gs://${bucket}/functions-source.tar.gz`,
      versionedPointer: `gs://${bucket}/versions/${version}/functions-source.tar.gz`,
    };
    const metaPath = join(tmpdir(), `installer-version-${version}.json`);
    writeFileSync(metaPath, JSON.stringify(versionMeta, null, 2) + "\n");

    // 4. Upload — both versioned (immutable) and latest pointer (mutable).
    const versionedTarball = `gs://${bucket}/versions/${version}/functions-source.tar.gz`;
    const versionedMeta = `gs://${bucket}/versions/${version}/version.json`;
    const latestTarball = `gs://${bucket}/functions-source.tar.gz`;
    const latestMeta = `gs://${bucket}/version.json`;

    const sp2 = log.spinner(`Uploading source bundle (versioned + latest pointer)`);
    try {
      gcloud(["storage", "cp", tarball, versionedTarball, `--project=${projectId}`]);
      gcloud(["storage", "cp", metaPath, versionedMeta, `--project=${projectId}`]);
      gcloud(["storage", "cp", tarball, latestTarball, `--project=${projectId}`]);
      gcloud(["storage", "cp", metaPath, latestMeta, `--project=${projectId}`]);
      sp2.stop(`Uploaded → ${latestTarball} (version ${version})`);
    } catch (err) {
      sp2.fail();
      throw err;
    }

    // Cleanup local tarball + meta — bucket is the source of truth.
    try {
      unlinkSync(tarball);
      unlinkSync(metaPath);
    } catch {
      /* ignore */
    }

    state.artifacts.installerSourceUri = latestTarball;
    state.artifacts.installerSourceBucket = bucket;
    log.info(
      [
        "In-app `enableIntegration` callable can now deploy from this bundle.",
        `Version: ${version}`,
        `Versioned copy: ${versionedTarball} (immutable; safe for rollback / cross-fork update tooling)`,
      ].join("\n   "),
    );
  },
};
