# Heads-up: sim mode is going optional

A separate workstream is making **simulation mode** a build-time-optional
module so installer-emitted forks ship zero sim code. Demo project will
keep it; real practice forks will not include it at all.

## What this means for the installer

- Plan to set `INCLUDE_SIM_MODE=false` (or simply omit it — `false` is the
  default) in every fork the installer emits. No installer UI needed; it's
  not a per-customer choice.
- Wire the env var into the three places forks consume env:
  - `web/apphosting.yaml` (App Hosting env block)
  - `functions/` build env (Cloud Build / `firebase functions:config` or
    `process.env` at build time — TBD by the sim-detach work)
  - `sidecar` deploy env (`/root/sidecar.env` or equivalent)
- When `false`, the `simulation/*` Firestore collections will never be
  seeded, the Settings → "Simulation mode" toggle is hidden, and sim
  modules tree-shake out of all three bundles.

## What you do NOT need to do

- Don't strip sim files from the emitted fork's source tree — the build
  flag handles it. Source stays identical across forks; behavior diverges
  at build time. Keeps merges from upstream painless.
- Don't add a sim-related question to the installer wizard. The default
  (`false`) is correct for every customer.

## Coordination

- The flag name will be `INCLUDE_SIM_MODE`. If that changes, this note
  will be updated.
- If the installer needs to seed any sim-flag-aware setting in Firestore
  during bootstrap, check `system/settings.simulationMode` — it should
  remain absent (or explicitly `false`) on installer-emitted forks.
- Demo fork (`patient-demo-project`) is the only place the flag is `true`.

## Owner

Sim-detach work is being driven by the other Claude instance on this
repo. Ping the human (Stan) if there's a conflict between the installer
and the detach work.
