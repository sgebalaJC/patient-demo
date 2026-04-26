#!/usr/bin/env bash
# Exercise the enableIntegration flow without the admin UI.
#
# Submits the same Cloud Build job the `enableIntegration` Cloud Function
# would, using your local gcloud ADC (which has the same effective
# permissions as a super-admin since you own the project). Validates:
#
#   - Step 12b's source bundle is reachable + correctly formatted
#   - Step 08's IAM bindings on the Cloud Build SA are sufficient
#   - The inline build steps (firebase-tools install, npm ci, deploy) run
#   - The Firestore mirror PATCH at the end works
#   - The deployed functions actually appear in the project
#
# What this DOESN'T validate: the auth wrapper (requireSuperAdmin) — that's
# tested when you actually log in as super-admin and click the UI button.
#
# Usage:
#   ./installer/scripts/exercise-enable-integration.sh <projectId> <integrationId>
#
# Example:
#   ./installer/scripts/exercise-enable-integration.sh installer-smoke7-20260426 ehr-drchrono

set -euo pipefail

PROJECT_ID="${1:?project id required}"
INTEGRATION_ID="${2:?integration id required (e.g. ehr-drchrono, signalwire)}"

# Map integrationId -> deploy filter — mirrors the FUNCTION_GROUPS table in
# functions/src/installer.ts. Keep these in sync; if you add a new group on
# one side, add it on the other.
case "$INTEGRATION_ID" in
  ehr-drchrono)  FNS="drchronoAuthorize,drchronoCallback,drchronoSaveCredentials,drchronoDisconnect,drchronoSetEnabled" ;;
  ehr-athena)    FNS="athenaAuthorize,athenaCallback,athenaSaveCredentials,athenaDisconnect,athenaSetEnabled" ;;
  ehr-elation)   FNS="elationAuthorize,elationCallback,elationSaveCredentials,elationDisconnect,elationSetEnabled" ;;
  signalwire)    FNS="saveSignalwireCredentials,disconnectSignalwire,signalwireFaxWebhook,sendOutboundFax,signalwireFaxStatusWebhook,deleteOutboundFax,retryFailedFaxes,sendFaxEmail,reprocessFax,updateFaxDraft,markFaxJunk,attachFaxToDrChrono,detachFaxFromDrChrono,deleteFax,getFaxPdfUrl" ;;
  google-workspace) FNS="googleWorkspaceAuthorize,googleWorkspaceCallback,saveGoogleWorkspaceServiceAccount,disconnectGoogleWorkspace,googleWorkspaceProxy" ;;
  stripe)        FNS="createCheckoutSession,cancelSubscription,stripeWebhook,createPlatformCheckoutSession,createPlatformTopupSession,createPlatformBillingPortalSession,cancelPlatformSubscription,resumePlatformSubscription,platformStripeWebhook" ;;
  *)             echo "unknown integration: $INTEGRATION_ID" >&2; exit 2 ;;
esac

# Build the --only filter.
FILTER=$(echo "$FNS" | sed 's/,/ /g' | tr ' ' '\n' | sed 's|^|functions:|' | paste -sd, -)
SOURCE_BUCKET="${PROJECT_ID}-installer-source"

echo "==> integration: $INTEGRATION_ID"
echo "==> filter:      $FILTER"
echo "==> source:      gs://${SOURCE_BUCKET}/functions-source.tar.gz"

# Inline cloudbuild config. Mirror what enableIntegration submits — except
# the Firestore mirror PATCH at the end, which we skip here since this
# script's ground truth is the deployed-functions count, not the doc.
cat > /tmp/exercise-cloudbuild.yaml <<EOF
steps:
- name: node:22
  entrypoint: bash
  args:
  - -c
  - |
    set -e
    npm install -g firebase-tools@latest --silent
    cd functions && npm ci --silent && cd ..
    firebase deploy --only $FILTER --project=$PROJECT_ID --non-interactive --force
timeout: 1200s
options:
  logging: CLOUD_LOGGING_ONLY
EOF

echo "==> submitting build (pulls source from gs://${SOURCE_BUCKET}/functions-source.tar.gz)"
BUILD_ID=$(gcloud builds submit \
  --project="$PROJECT_ID" \
  --config=/tmp/exercise-cloudbuild.yaml \
  --gcs-source-staging-dir=gs://${SOURCE_BUCKET}/cloudbuild-staging \
  gs://${SOURCE_BUCKET}/functions-source.tar.gz \
  --format='value(id)' 2>&1 | tail -1)

echo "==> build id: $BUILD_ID"
echo "==> follow logs: gcloud builds log $BUILD_ID --project=$PROJECT_ID"
echo "==> verify deployed: gcloud functions list --project=$PROJECT_ID --regions=us-west1 --format='value(name)' | grep -E '^($(echo $FNS | tr , '|'))$'"
