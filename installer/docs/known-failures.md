# Known failures + remediations

## Step 13 — App Hosting backend create requires browser-gated OAuth (current behavior)

**Status (2026-04-26):** step 13 now opens Firebase Console in the operator's browser and prompts them to create the backend interactively (~2 min). After that, `--rerun 13-apphosting-backend` picks up the existing backend and captures its URL. Honest about the limitation; no fake automation.

**Why no fully-headless path:**
- App Hosting requires a Developer Connect `gitRepositoryLinks/{name}` resource.
- Developer Connect's `connections create github` requires `--github-config-authorizer-credential-oauth-token-secret-version` upfront.
- The only way to mint that OAuth token is a browser-based authorize URL flow exposed by Cloud Build's `connections create github` (NOT Developer Connect's).
- Cloud Build's connection format isn't accepted by App Hosting REST.
- `firebase apphosting:backends:create` interactive CLI handles the whole dance under the hood via firebase-tools' OAuth session, but doesn't expose `--repository` / `--git-branch` flags even on v15.15.0 — so it can't be driven non-interactively.

**Real fix would need:** either firebase-tools v16+ (when/if it adds `--repository` + `--git-branch` flags), or a Google service publishing a CLI-friendly OAuth-token mint endpoint for Developer Connect.

---

## Step 13 — historical: Cloud Build connection rejected by App Hosting (now fixed by removing the Cloud Build path)

**Symptom:** `POST firebaseapphosting.googleapis.com/v1/.../backends` returns HTTP 400:

```
Violation in CreateBackendRequest.backend.codebase.repository: must conform to
projects/{project}/locations/{location}/connections/{connection}/gitRepositoryLinks/{gitRepositoryLink}
```

**Cause:** Step 13 currently creates a **Cloud Build** GitHub connection
(`gcloud builds connections create github`) and references its `repositories/{name}`
resource. App Hosting requires a **Developer Connect** connection
(`gcloud developer-connect connections create github`) and its
`gitRepositoryLinks/{name}` resource. Different services, different OAuth tokens.

**Workaround for now:** create the backend manually in Firebase Console once:
Firebase Console → App Hosting → Add backend → connect GitHub repo (uses the
Firebase App Hosting GitHub App that's already installed on your account).

**Real fix:** rewrite step 13 to use Developer Connect:

1. `gcloud services enable developerconnect.googleapis.com`
2. `gcloud developer-connect connections create CONN --github-config-app=FIREBASE --github-config-app-installation-id=<id> --github-config-authorizer-credential-oauth-token-secret-version=<secret>` — but the OAuth token still has to be generated via a browser flow (no fully-headless path)
3. `gcloud developer-connect connections git-repository-links create LINK --connection=CONN --remote-uri=https://github.com/<owner>/<repo>.git`
4. POST to App Hosting REST with `repository: projects/.../connections/CONN/gitRepositoryLinks/LINK`

The `firebase apphosting:backends:create` CLI handles all of this interactively
but doesn't expose `--git-branch` / `--repository` flags even on v15.15.0.
