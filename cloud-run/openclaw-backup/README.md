# openclaw-backup

Nightly Cloud Run Job that snapshots the OpenClaw workspace on the sidecar
host, redacts secrets, and commits the result to a GitHub backup branch.

Triggered by a Cloud Scheduler HTTP job (default: `0 3 * * *` UTC). The job
pulls via the sidecar's `/snapshot` endpoint and pushes into `GITHUB_REPO`
on `GITHUB_BRANCH`.

Deploy / refresh with `./deploy.sh` — see the header of that script for the
required env vars (`PROJECT`, `SIDECAR_URL`, `GITHUB_REPO`) and the two
Secret Manager secrets it expects (`openclaw-backup-github-pat`,
`openclaw-backup-sidecar-api-key`).
