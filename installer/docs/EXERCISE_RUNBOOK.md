# Phase F — Live exercise runbook

End-to-end shakedown of `installer/`. Reveals the gaps between "compiles
fine" and "actually provisions a working fork."

This is run **with the user at the keyboard** because it spends real money
(GCP project + GCE VM + outbound API calls). Each step is checkable, and
every error caught here gets folded back into the installer code so the
next exercise is shorter.

## Pre-flight (operator's machine)

- [ ] `gcloud auth login` and `gcloud auth application-default login` are current
  - Verify: `gcloud config list account --format='value(core.account)'`
- [ ] `firebase login` is current — `firebase projects:list` returns without prompting
- [ ] `bun --version` ≥ 1.0
- [ ] `gh auth status` is clean (only if you want a GitHub repo created automatically)
- [ ] Billing account id is at hand: `gcloud beta billing accounts list`
- [ ] No GCP org policies blocking the run:
  - `iam.allowedPolicyMemberDomains` — if set, super-admin invites + IAM bindings need domain users
  - `compute.requireOsLogin` — flips SSH semantics; `gcloud compute ssh` still works
  - `compute.skipDefaultNetworkCreation` — installer assumes default VPC; if true, switch to a custom VPC

## Run

Pick a throwaway practice name + project id:

```bash
PROJECT_ID="installer-smoke-$(date +%Y%m%d)"
TARGET_DIR="$HOME/Projects/BLASKO/$PROJECT_ID"

cd ~/Projects/patient/installer
bun run cli/create-fork.ts --target "$TARGET_DIR"
```

Walk the prompts. Defaults are sensible — you mostly just confirm.

### Stopwatch each step

Note wall-clock per step. Anything > 3 min wall-clock is a candidate for
parallelism or async polling. Expected (verified across smokes #2–4):

| step                   | expected | flag if           | notes |
| ---------------------- | -------- | ----------------- | ----- |
| 01 collect-inputs      | 1–2 min  | (interactive)     | skipped on resume / pre-seeded state |
| 02 copy-template       | < 30 s   | > 1 min           | rsync (Apple's old rsync is fine) |
| 03 git-init            | 5–10 s   | > 30 s            | adds gh repo + push if --github specified |
| 04 gcp-project         | 15–30 s  | > 60 s            | first project hits "wait for billing API" |
| 05 enable-apis         | 60–180 s | > 240 s           | 21 APIs in 2 chunks (gcloud caps at 20/call) + service-agent provision |
| 06 firebase-init       | 30–90 s  | > 120 s           | adds Firebase, creates Firestore + Web app |
| 07 secrets             | 30–60 s  | > 90 s            | 18 secrets — most are placeholders |
| 08 iam                 | 15–30 s  | > 60 s            | compute SA self tokenCreator + openclaw-vm SA |
| 09 openclaw-vm         | < 5 s    | (skipped)         | provision=false → no-op |
| 10 fork-config         | < 5 s    | > 30 s            | writes skeleton + mobile mirror |
| 11 openclaw-tokens     | 5–15 s   | > 30 s            | placeholder substitution only when no VM |
| 12 deploy-first        | 3–5 min (core only) / 8–15 min (full) | > 20 min | **first-time Eventarc IAM propagation forces 1–2 retries; that's expected**. With `inputs.enabledIntegrations: []` (default), only ~25 `core` functions deploy → 3-5 min. Add `["stripe"]`, `["ehr-drchrono"]`, etc. to opt-in additional groups. |
| 13 apphosting-backend  | 1–3 min  | > 5 min           | Skipped if `provisionApphosting: false`. **Currently broken** — uses Cloud Build connection but App Hosting needs Developer Connect. See `installer/docs/known-failures.md`. |
| 14 print-next-steps    | < 1 s    | n/a               | |

Total budget: ~12–18 min for a fork *without* OpenClaw, ~18–25 min with.

## Known transient failures (auto-handled)

- **Step 12, partial trigger deploy**: on a brand-new project, Eventarc/Pub-Sub
  service agents take 1–3 minutes to propagate IAM after the explicit
  `gcloud beta services identity create` in step 05. `firebase deploy` exits 0
  even when individual triggers fail, so step 12 scrapes stdout for
  `failed to create function X` and retries up to 2 times (60s + 90s waits).
  This is the **most common observed failure**; the retry path is the happy path
  on cold projects.

- **Step 12, "Quota Exceeded" while creating function X**: Cloud Functions API
  rate limit. `firebase deploy` itself retries internally; usually self-heals.

## Checkpoints

After the CLI exits, before going to the wizard:

- [ ] `.installer-state.json` written to `$TARGET_DIR` and shows `completedSteps` covering 01–13 (12 may be partial)
- [ ] `$TARGET_DIR` has `firebase.json`, `web/`, `functions/`, `infra/.openclaw-host.json`, generated `fork.config.ts`, `.firebaserc`
- [ ] `gcloud compute instances list --project=$PROJECT_ID` shows `openclaw` in `us-central1-a`, status `RUNNING`
- [ ] `gcloud secrets list --project=$PROJECT_ID` shows: `VITE_FIREBASE_API_KEY`, `openclaw_gateway_token`, `sidecar_api_key`, `signalwire_auth_token`, `SIDECAR_URL`
- [ ] `gcloud storage ls gs://$PROJECT_ID-openclaw-config/` shows `openclaw.json`
- [ ] `gcloud functions list --project=$PROJECT_ID --regions=us-west1` shows `sidecarproxy` and the rest
- [ ] `firebase apphosting:backends:list --project=$PROJECT_ID` — backend present (or gate this with the manual create command from step 13's output)

## App Hosting backend (manual, interactive)

The CLI prints the exact command. Paste it, link the GitHub repo when
prompted, and copy the resulting URL into `$TARGET_DIR/.installer-state.json`
under `artifacts.apphostingUrl`.

## Bootstrap + wizard

- [ ] Open the App Hosting URL → `/auth` → `BootstrapAdminForm` claims your super-admin email
- [ ] After sign-in, hit `/admin/install`
- [ ] Walk all 8 steps; on the OpenClaw step paste the VM IPs from `.installer-state.json` and click "Sync agent workspace + ping gateway" — must turn green
- [ ] Confirm step → "Mark install complete" + "Download fork.config.ts"
  - Overwrite `$TARGET_DIR/fork.config.ts` with the downloaded file, commit, push
  - App Hosting redeploys automatically once the GitHub link is wired

## Acceptance checklist

- [ ] Patient can sign up at `/auth` (toggle `system/settings.registrationEnabled` first if needed) and reach `/dashboard`
- [ ] `/admin/agent` loads — chat with Sunny in simulation mode (toggle `system/settings.simulationMode` from `/admin/settings` first)
- [ ] Aurelia loads in `/support` widget
- [ ] `gcloud functions logs read sidecarproxy --project=$PROJECT_ID --limit=20` shows the `/healthz` ping from the wizard with HTTP 200
- [ ] `openclaw config validate` over SSH returns 0:
  ```bash
  gcloud compute ssh openclaw --zone=us-central1-a --project=$PROJECT_ID --command='openclaw config validate'
  ```

## Capture

For every error caught:

1. Append to `installer/docs/known-failures.md` (create if missing) with the exact `gcloud` error, the step id, and the auto-detect/remediation we'd add.
2. If it's a code bug, fix in `installer/cli/steps/<id>.ts` and re-run only that step: `bun run cli/create-fork.ts --target "$TARGET_DIR" --rerun <id>`.

A 5-minute Loom of the wizard surface area helps catch UX rough edges that
I'll miss writing the code.

## Teardown

```bash
gcloud projects delete "$PROJECT_ID"
# 30-day soft-delete window — easy to undo if you need to re-poke at state.
```

Local `$TARGET_DIR` stays around for diffing against the next exercise pass.

## Done when

- A second back-to-back run on a different project id needs **zero**
  CLI edits and **zero** manual `gcloud` calls outside the installer
  (App Hosting backend create excepted, since GH linkage is interactive).
