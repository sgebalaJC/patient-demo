#!/usr/bin/env bash
set -euo pipefail

# Deploy/refresh the openclaw-backup Cloud Run Job and its nightly scheduler.
# Idempotent: re-running rebuilds the image and updates the job in place.
#
# Per-fork env vars — must export at least PROJECT, SIDECAR_URL, GITHUB_REPO.
# Prerequisites (one-time per fork):
#   1. Secret Manager secrets exist:
#        openclaw-backup-github-pat
#        openclaw-backup-sidecar-api-key
#   2. Compute SA has Secret Manager Secret Accessor on both secrets.
#   3. Cloud Run, Cloud Scheduler, Artifact Registry APIs enabled.

PROJECT="${PROJECT:?set PROJECT=your-firebase-project}"
REGION="${REGION:-us-central1}"
JOB_NAME="${JOB_NAME:-openclaw-backup}"
SCHEDULER_NAME="${SCHEDULER_NAME:-openclaw-backup-nightly}"
SCHEDULE_CRON="${SCHEDULE_CRON:-0 3 * * *}"
SIDECAR_URL="${SIDECAR_URL:?set SIDECAR_URL=http://<vm-ip>:8081}"
GITHUB_REPO="${GITHUB_REPO:?set GITHUB_REPO=owner/repo}"
GITHUB_BRANCH="${GITHUB_BRANCH:-main}"

REPO="${REPO:-cloud-run-source-deploy}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/${JOB_NAME}:latest"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Ensuring Artifact Registry repo exists"
gcloud artifacts repositories describe "$REPO" \
  --project="$PROJECT" --location="$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$REPO" \
       --project="$PROJECT" --location="$REGION" --repository-format=docker

echo "==> Building image with Cloud Build"
gcloud builds submit "$SCRIPT_DIR" \
  --project="$PROJECT" --tag="$IMAGE"

echo "==> Resolving compute service account"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "    SA: $SA"

echo "==> Creating/updating Cloud Run Job"
COMMON_ARGS=(
  --project="$PROJECT"
  --region="$REGION"
  --image="$IMAGE"
  --service-account="$SA"
  --max-retries=1
  --task-timeout=600s
  --memory=512Mi
  --cpu=1
  --set-env-vars="SIDECAR_URL=${SIDECAR_URL},GITHUB_REPO=${GITHUB_REPO},GITHUB_BRANCH=${GITHUB_BRANCH}"
  --set-secrets="GITHUB_PAT=openclaw-backup-github-pat:latest,SIDECAR_API_KEY=openclaw-backup-sidecar-api-key:latest"
)

if gcloud run jobs describe "$JOB_NAME" \
     --project="$PROJECT" --region="$REGION" >/dev/null 2>&1; then
  gcloud run jobs update "$JOB_NAME" "${COMMON_ARGS[@]}"
else
  gcloud run jobs create "$JOB_NAME" "${COMMON_ARGS[@]}"
fi

echo "==> Granting Scheduler invoker role on the job"
gcloud run jobs add-iam-policy-binding "$JOB_NAME" \
  --project="$PROJECT" --region="$REGION" \
  --member="serviceAccount:${SA}" \
  --role="roles/run.invoker" >/dev/null

echo "==> Creating/updating Cloud Scheduler trigger"
JOB_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB_NAME}:run"

SCHEDULER_ARGS=(
  --project="$PROJECT"
  --location="$REGION"
  --schedule="$SCHEDULE_CRON"
  --time-zone="Etc/UTC"
  --uri="$JOB_URI"
  --http-method=POST
  --oauth-service-account-email="$SA"
  --oauth-token-scope="https://www.googleapis.com/auth/cloud-platform"
)

if gcloud scheduler jobs describe "$SCHEDULER_NAME" \
     --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$SCHEDULER_NAME" "${SCHEDULER_ARGS[@]}"
else
  gcloud scheduler jobs create http "$SCHEDULER_NAME" "${SCHEDULER_ARGS[@]}"
fi

echo
echo "==> Done."
echo "    Trigger now:    gcloud run jobs execute $JOB_NAME --project=$PROJECT --region=$REGION"
echo "    Tail logs:      gcloud beta run jobs logs tail $JOB_NAME --project=$PROJECT --region=$REGION"
echo "    Scheduler:      gcloud scheduler jobs run $SCHEDULER_NAME --project=$PROJECT --location=$REGION"
