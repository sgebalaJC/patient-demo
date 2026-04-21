#!/bin/bash
# Deploy one or more new Cloud Functions and grant `allUsers` invoker access,
# working around an org policy `iam.allowedPolicyMemberDomains` that commonly
# blocks public IAM bindings on HIPAA-hardened GCP orgs.
#
# Why this exists:
#   Cloud Functions Gen 2 (Cloud Run) requires `allUsers` on the run.invoker
#   role for HTTPS / callable functions to be reachable from outside the
#   project. Workspace-tied orgs (the HIPAA-hardened default) restrict IAM
#   members to the Workspace domain, which blocks `allUsers`. Manually
#   lifting/restoring the policy per deploy is tedious and error-prone, so
#   this script does the dance:
#
#     1. Verify active gcloud account matches REQUIRED_ACCOUNT (only the
#        Workspace Organization Policy Admin can mutate the policy).
#     2. Deploy the function(s) — IAM step inside `firebase deploy` will fail
#        but the function code lands on Cloud Run.
#     3. Apply a project-level override that allows all members.
#     4. Retry `add-iam-policy-binding allUsers` per function until it sticks
#        (org-policy propagation can take 30-90 seconds).
#     5. Delete the project override so the inherited org policy snaps back.
#     6. Curl-probe each function — expects 401 (auth required) for callables
#        and 400/405 (bad request) for HTTPS endpoints; anything 403 means
#        the IAM didn't actually take effect.
#
# Usage:
#   ./scripts/deploy-fn-with-iam.sh <fnName1> [fnName2 ...]
#
# Per-fork setup: edit PROJECT, REGION, REQUIRED_ACCOUNT below.
#
# Notes:
#   - Use this ONLY for newly-created functions or after the function name
#     changes. Updates to existing functions don't touch IAM.
#   - The Cloud Run service name is the function name lowercased, hence the
#     `tr A-Z a-z` below.
#   - If the org policy doesn't apply to your project (no
#     allowedPolicyMemberDomains override), the regular `firebase deploy`
#     works — this script is a no-op safety net in that case.

set -euo pipefail

# --- per-fork configuration ----------------------------------------------
PROJECT="${FIREBASE_PROJECT:-patient-demo-project}"
REGION="${FIREBASE_REGION:-us-west1}"
REQUIRED_ACCOUNT="${FIREBASE_ADMIN_ACCOUNT:-}"  # leave empty to skip account check
# -------------------------------------------------------------------------

POLICY_FILE="${TMPDIR:-/tmp}/allow-all-members.yaml"

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <functionName> [functionName ...]" >&2
  exit 64
fi

cd "$(dirname "$0")/.."

if [ -n "${REQUIRED_ACCOUNT}" ]; then
  active=$(gcloud config get-value account 2>/dev/null || true)
  if [ "$active" != "$REQUIRED_ACCOUNT" ]; then
    echo "Active gcloud account is '$active' — switching to $REQUIRED_ACCOUNT"
    gcloud config set account "$REQUIRED_ACCOUNT" >/dev/null
  fi
fi

# 1. Deploy
fn_args=()
for fn in "$@"; do fn_args+=("functions:${fn}"); done
target=$(IFS=,; echo "${fn_args[*]}")
echo "=== Deploying ${target} ==="
# Tolerate the IAM-set failure — function still creates.
firebase deploy --only "${target}" --project "${PROJECT}" || \
  echo "(deploy reported errors — likely IAM-set; continuing)"

# 2. Lift the policy at project level.
cat > "${POLICY_FILE}" <<EOF
constraint: constraints/iam.allowedPolicyMemberDomains
listPolicy:
  allValues: ALLOW
EOF
echo "=== Lifting org policy override on ${PROJECT} ==="
gcloud resource-manager org-policies set-policy "${POLICY_FILE}" --project="${PROJECT}" >/dev/null

# 3. Grant invoker, retry until propagation lets it stick.
for fn in "$@"; do
  svc=$(echo "$fn" | tr '[:upper:]' '[:lower:]')
  echo "=== Granting allUsers run.invoker on ${svc} ==="
  attempts=0
  until gcloud run services add-iam-policy-binding "${svc}" \
        --region="${REGION}" \
        --member=allUsers \
        --role=roles/run.invoker \
        --project="${PROJECT}" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ ${attempts} -ge 12 ]; then
      echo "FAILED to grant allUsers on ${svc} after ${attempts} attempts" >&2
      gcloud resource-manager org-policies delete iam.allowedPolicyMemberDomains \
        --project="${PROJECT}" >/dev/null 2>&1 || true
      exit 1
    fi
    echo "  retry ${attempts} (policy propagation) at $(date +%H:%M:%S)"
    sleep 30
  done
  echo "  granted ${svc}"
done

# 4. Restore the inherited policy.
echo "=== Restoring inherited org policy ==="
gcloud resource-manager org-policies delete iam.allowedPolicyMemberDomains \
  --project="${PROJECT}" >/dev/null

# 5. Probe.
echo "=== Verifying reachability ==="
for fn in "$@"; do
  url="https://${REGION}-${PROJECT}.cloudfunctions.net/${fn}"
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d '{"data":{}}' "${url}")
  case "${code}" in
    401|400|405) echo "  ${fn}: ${code} (reachable)" ;;
    403)         echo "  ${fn}: 403 — IAM still blocked, policy may need more propagation" >&2 ;;
    *)           echo "  ${fn}: ${code}" ;;
  esac
done

echo "=== Done ==="
