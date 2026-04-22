# Security concerns

Open items we've consciously deferred. Each entry: what the risk is, why we're accepting it for now, and what moves us off it.

## Long-lived SA key on the sidecar VPS

**What.** `/root/.openclaw/credentials/google-sa-key.json` on `5.78.123.70` holds a JSON key for `firebase-adminsdk-fbsvc@patient-demo-project.iam.gserviceaccount.com`. The SA has Firebase Admin SDK privileges (full Firestore R/W, custom token signing) plus `roles/secretmanager.secretAccessor`.

**Risk.** If the key is exfiltrated — via VPS root compromise, unsecured disk backup, decommissioning without scrub, accidental archive — the attacker gets tenant-wide read/write on Firestore (patient PHI, tokens, integrations), the ability to sign custom auth tokens as any user, and read access to every secret in Secret Manager. Blast radius is total. Keys have no expiry, so a leak is valid until we rotate or delete.

**Why accepted.** Pre-launch demo, single super admin, SSH is keyed (no password auth). VPS compromise probability in the near term is low.

**Move-off triggers.**
- Before onboarding a real practice with PHI — rotate quarterly as standing policy (HIPAA norm).
- If anyone else gets SSH access to the VPS.
- On any suspected breach — immediate rotation + delete old key.

**Rotation recipe.** One command to list keys, one to delete the old one after the new one is in place:
```
gcloud iam service-accounts keys list \
  --iam-account=firebase-adminsdk-fbsvc@patient-demo-project.iam.gserviceaccount.com
gcloud iam service-accounts keys create /tmp/new-key.json \
  --iam-account=firebase-adminsdk-fbsvc@patient-demo-project.iam.gserviceaccount.com
scp -i ~/.ssh/kitt-hetzner /tmp/new-key.json \
  root@5.78.123.70:/root/.openclaw/credentials/google-sa-key.json
ssh -i ~/.ssh/kitt-hetzner root@5.78.123.70 "systemctl restart patient-sidecar"
gcloud iam service-accounts keys delete <OLD_KEY_ID> \
  --iam-account=firebase-adminsdk-fbsvc@patient-demo-project.iam.gserviceaccount.com
rm /tmp/new-key.json
```

**Permanent fix.** Workload Identity Federation — the VPS authenticates to GCP via short-lived tokens from a configured trust relationship, no key on disk. ~30–60 min setup, makes rotation a non-issue. Worth doing before production.
