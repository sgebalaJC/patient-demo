import {gcloud, gcloudJson, exists} from "../lib/gcloud.ts";
import {run} from "../lib/exec.ts";
import type {Step} from "../lib/types.ts";

/**
 * HIPAA 6-year audit retention — set up a Cloud Logging sink that streams
 * every `[AUDIT]` log entry into a per-fork GCS bucket with a 7-year
 * retention policy + lifecycle (Standard → Coldline @ 90 days → Archive @
 * 1 year). 6 years is the HIPAA minimum (45 CFR §164.530(j)(2)); +1 year
 * buffers against clock skew + grace periods.
 *
 * Layout:
 *   gs://<project>-audit-archive/                 ← log sink destination
 *     <date>/<service>/...                        ← Cloud Logging's auto layout
 *
 * The sink filters on `jsonPayload.audit=true` which the `logAuditEvent`
 * Cloud Function tags every entry with (see functions/src/index.ts).
 *
 * After this runs, queries for compliance proof go through GCS — exportable
 * via `gcloud storage cp -r gs://<project>-audit-archive/<dates> ./`.
 */

const RETENTION_YEARS = 7;
const RETENTION_SECONDS = RETENTION_YEARS * 365 * 24 * 3600;
const SINK_NAME = "audit-archive-sink";
const SINK_FILTER = 'jsonPayload.audit=true OR labels.audit=true';

interface SinkDescribe {
  name: string;
  destination: string;
  filter?: string;
  writerIdentity?: string;
}

export const auditRetentionStep: Step = {
  id: "08b-audit-retention",
  title: "HIPAA: audit-log GCS sink + 7-year retention",
  idempotent: true,
  async run({state, log}) {
    const {projectId, region} = state.inputs;
    if (!projectId || !region) throw new Error("prerequisites missing");
    const bucket = `${projectId}-audit-archive`;

    // 1. Create the archive bucket if absent.
    const bucketExists = exists(["storage", "buckets", "describe", `gs://${bucket}`, `--project=${projectId}`]);
    if (!bucketExists) {
      const sp = log.spinner(`Creating gs://${bucket} (uniform-bucket-level-access)`);
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
    } else {
      log.info(`gs://${bucket} already exists.`);
    }

    // 2. Lock retention policy. Once locked it cannot be reduced — protects
    //    against an admin accidentally (or maliciously) shortening it.
    //    We DON'T lock automatically (leaves room for the operator to fix
    //    a typo'd retention duration on day 1); the docs surface the lock
    //    command as a phase-2 hardening step.
    try {
      gcloud([
        "storage",
        "buckets",
        "update",
        `gs://${bucket}`,
        `--retention-period=${RETENTION_SECONDS}s`,
        `--project=${projectId}`,
      ]);
      log.info(`Set ${RETENTION_YEARS}-year retention policy on gs://${bucket}.`);
    } catch (err) {
      log.warn(`Could not set retention period (may already be set): ${(err as Error).message.split("\n")[0]}`);
    }

    // 3. Lifecycle — move objects to colder storage classes over time to
    //    cut costs without losing access. JSON config piped via stdin.
    const lifecycle = JSON.stringify({
      lifecycle: {
        rule: [
          {
            action: {type: "SetStorageClass", storageClass: "COLDLINE"},
            condition: {age: 90}, // days
          },
          {
            action: {type: "SetStorageClass", storageClass: "ARCHIVE"},
            condition: {age: 365}, // days
          },
        ],
      },
    });
    try {
      run(
        "gcloud",
        ["storage", "buckets", "update", `gs://${bucket}`, "--lifecycle-file=/dev/stdin", `--project=${projectId}`],
        {input: lifecycle, capture: true},
      );
      log.info("Set lifecycle policy: Standard → Coldline @ 90 days → Archive @ 1 year.");
    } catch (err) {
      log.warn(`Lifecycle policy update failed: ${(err as Error).message.split("\n")[0]}`);
    }

    // 4. Create or update the Cloud Logging sink.
    const sinkDestination = `storage.googleapis.com/${bucket}`;
    let sink: SinkDescribe | null = null;
    try {
      sink = gcloudJson<SinkDescribe>(["logging", "sinks", "describe", SINK_NAME, `--project=${projectId}`]);
    } catch {
      /* not found */
    }

    if (!sink) {
      const sp = log.spinner(`Creating logging sink ${SINK_NAME} → gs://${bucket}`);
      try {
        gcloud([
          "logging",
          "sinks",
          "create",
          SINK_NAME,
          sinkDestination,
          `--log-filter=${SINK_FILTER}`,
          `--project=${projectId}`,
          // --use-partitioned-tables only applies to BigQuery sinks; not used here.
        ]);
        sp.stop(`Sink created.`);
      } catch (err) {
        sp.fail();
        throw err;
      }
      sink = gcloudJson<SinkDescribe>(["logging", "sinks", "describe", SINK_NAME, `--project=${projectId}`]);
    } else {
      // Ensure filter + destination match the latest spec (idempotent update).
      if (sink.filter !== SINK_FILTER || sink.destination !== sinkDestination) {
        log.info(`Updating sink ${SINK_NAME} (filter or destination drift detected).`);
        try {
          gcloud([
            "logging",
            "sinks",
            "update",
            SINK_NAME,
            sinkDestination,
            `--log-filter=${SINK_FILTER}`,
            `--project=${projectId}`,
          ]);
        } catch (err) {
          log.warn(`Sink update returned non-zero: ${(err as Error).message.split("\n")[0]}`);
        }
      }
    }

    // 5. Grant the sink's writer identity bucket-write access.
    const writerIdentity = sink?.writerIdentity;
    if (writerIdentity) {
      try {
        gcloud([
          "storage",
          "buckets",
          "add-iam-policy-binding",
          `gs://${bucket}`,
          `--member=${writerIdentity}`,
          "--role=roles/storage.objectCreator",
          `--project=${projectId}`,
        ], {capture: true});
        log.info(`Granted sink writer ${writerIdentity} → roles/storage.objectCreator on gs://${bucket}.`);
      } catch (err) {
        log.warn(`Sink writer IAM binding failed: ${(err as Error).message.split("\n")[0]}`);
      }
    } else {
      log.warn("Sink describe returned no writerIdentity; bucket-write IAM not bound. Manually grant via Console.");
    }

    log.success(
      [
        `HIPAA audit archive ready.`,
        `Bucket:    gs://${bucket} (retention ${RETENTION_YEARS}y, lifecycle Standard→Coldline@90d→Archive@1y)`,
        `Sink:      ${SINK_NAME} filtering \`${SINK_FILTER}\``,
        `Phase-2:   lock the retention policy with \`gcloud storage buckets update gs://${bucket} --lock-retention-period --project=${projectId}\` once you're confident in the duration.`,
      ].join("\n   "),
    );
  },
};
