# Simulation middleware

One switch that flips every external integration (DrChrono, faxes, SMS,
Workspace, …) between "real" and a seeded sandbox. UI, Cloud Functions,
and Aurelia all see the same data.

## The switch

Single flag, read from one Firestore doc:

```
system/settings.simulationMode: boolean
```

Super-admins toggle it from **Admin → Settings → Simulation mode**.
Per-session UI toggle (`sessionStorage.simulationMode`) is a dev
nicety — lets a single browser flip without affecting the agent.
Aurelia has no session; when the global flag is on, she always sims.

## Where the router lives

```
Browser UI  →  sidecarProxy CF  ─┐
Aurelia     ─────────────────────┤
                                 ▼
                    sidecar /admin-api/*
                                 │
                    [isSimulationOn() — 3-line check,
                     10s cached read of settings doc]
                      │                    │
                 sim  ▼                    ▼  real
          Firestore simulation/*        real integration
          (sidecar/src/sim/)            (DrChrono API, SignalWire, …)
```

Every caller funnels into the same `/admin-api/*` routes on the
sidecar. The sim check at the top of each route fans out to a
sandbox reader; falls through to the existing real path when off.

Why the sidecar and not Cloud Functions?

- Aurelia's CLI already hits the sidecar. Putting the router there
  keeps her consistent without CLI changes.
- Sim logic lives **once**. No duplicate simulators across
  CF and sidecar.

## Layout

```
sidecar/src/
  sim/
    index.ts        # isSimulationOn() with TTL cache
    drchrono.ts athena.ts elation.ts ecw.ts nextgen.ts tebra.ts
    greenway.ts pfusion.ts cerner.ts epic.ts
    faxes.ts messaging.ts workspace.ts
  routes/admin-api.ts    # each case branches on isSimulationOn()
  routes/faxes-real.ts   # real-mode fax reads + PATCH + native send
  lib/signalwire.ts      # native SignalWire submission (GCS merge + LaML POST)

functions/src/simulation/
  index.ts          # exports seed/clear callables only
  seed.ts           # seedSimulationData, clearSimulationData
  simulators/
    faxes.ts        # pdf-lib synthetic PDFs + seedFaxes()
    messaging.ts    # recordSimSms (Twilio intercept) + seedSms
    workspace.ts    # recordSimEmail (Gmail intercept) + seedWorkspace

web/src/
  lib/integrations/
    index.ts        # one import surface (drchrono, faxes, sms)
    drchrono.ts faxes.ts sms.ts   # one-liner sidecar façades
  hooks/
    useIntegrationCollection.ts   # live Firestore sub with sim-path fork
```

## Sandbox data

Lives at `simulation/*` in Firestore:

```
simulation/drchrono/patients/{id}
simulation/drchrono/appointments/{id}
simulation/drchrono/refills/{id}
simulation/faxes/inbound/{faxSid}
simulation/faxes/outbound/{faxSid}
```

Seeded once by the `seedSimulationData` super-admin-only Cloud
Function. Run from **Admin → Settings → Seed demo data**. Document
shapes match the real collections exactly, so subscriptions can swap
collection paths transparently.

Firestore rules: admins can `read` `simulation/*`; writes are
server-only (all mutations route through sim routes or seed).

## Adding a new domain

Checklist (all files small, steps are mechanical):

1. **Sidecar sim module** — `sidecar/src/sim/<domain>.ts`
   exports handlers that mirror the real API shape.
2. **Wire the routes** — in
   `sidecar/src/routes/admin-api.ts`, add (or amend) the `<domain>`
   case. Start with:
   ```ts
   if (await isSimulationOn()) return sim<Domain>(method, path, url.searchParams);
   ```
   Fall through to the real implementation below.
3. **Seed samples** — extend `functions/src/simulation/seed.ts` so
   `seedSimulationData` populates `simulation/<domain>/*`.
4. **UI façade** — add `web/src/lib/integrations/<domain>.ts` with
   one-liner methods that call the sidecar (via the existing
   `sidecar` client). No sim branching in the UI — the sidecar
   decides.
5. **Live subscriptions** (if any) — Firestore real-time listeners
   can't route through a callable. In the subscribing component:
   ```ts
   const { enabled: simulated } = useSimulationMode();
   const path = simulated ? 'simulation/<domain>/…' : '<real-collection>';
   ```
   This is the one documented exception to the "UI doesn't know
   about sim" rule. Keep it to the subscription line only.

## Aurelia consistency

Aurelia runs on the customer VPS and calls
`admin-api GET /drchrono/patients` (and similar) via CLI. Those HTTP
calls land on the same `/admin-api/*` routes the UI uses, so they
get the same sim branch automatically. No CLI changes, no separate
sim code for the agent.

## Turning it off

Set `system/settings.simulationMode: false`. Every sim check
short-circuits; real integrations resume. 10-second TTL cache means
the switch takes ≤10s to propagate to in-flight sidecar processes.

## Detaching from a customer fork

For a real deployment that should never see sim code:

```bash
rm -rf sidecar/src/sim/
rm -rf functions/src/simulation/
rm -rf web/src/lib/integrations/
```

Then:

- Remove the `isSimulationOn()` branches at the top of each
  `<domain>` case in `sidecar/src/routes/admin-api.ts`.
- Remove the `useIntegrationCollection` calls in subscribing
  components (AdminFaxesPage, AdminSendFaxPage, AdminSmsPage,
  AdminFaxesHubPage) or have the hook always return the real path.
- Revert UI call sites from `lib/integrations/<domain>` imports
  back to direct `sidecar.xxx()` calls. (The façades are thin, so
  this is a find-and-replace.)
- Remove `recordSimSms` / `recordSimEmail` short-circuit blocks in
  `functions/src/reminders.ts`, `functions/src/index.ts` (welcome SMS,
  phone OTPs, appointment status), `functions/src/gmail-workspace.ts`,
  and `functions/src/email.ts`.
- Delete the `simulationMode` field from `system/settings` and any
  seeded `simulation/*` docs + Storage PDFs.
- Drop `seedSimulationData` + `clearSimulationData` from
  `functions/src/index.ts` exports.

## Current coverage

| Domain         | UI façade | Sidecar sim | Seed | Aurelia | CF interception |
|----------------|:--:|:--:|:--:|:--:|:--:|
| DrChrono       | ✓  | ✓ (R+W) | ✓ | ✓ | n/a |
| Athena         | —  | ✓ (R)   | — | ✓ | n/a |
| Elation        | —  | ✓ (R)   | — | ✓ | n/a |
| eCW            | —  | ✓ (R, FHIR) | — | ✓ | n/a |
| NextGen        | —  | ✓ (R)   | — | ✓ | n/a |
| Tebra          | —  | ✓ (R)   | — | ✓ | n/a |
| Greenway       | —  | ✓ (R)   | — | ✓ | n/a |
| Practice Fusion| —  | ✓ (R)   | — | ✓ | n/a |
| Cerner         | —  | ✓ (R, FHIR) | — | ✓ | n/a |
| Epic           | —  | ✓ (R, FHIR) | — | ✓ | n/a |
| Faxes — inbound | ✓ | ✓ (sim+real reads/PATCH) | ✓ | ✓ | n/a |
| Faxes — outbound| ✓ | ✓ (sim+real reads) / sim-only send | ✓ | ✓ | n/a |
| SMS            | ✓  | ✓  | ✓  | ✓ | ✓ (reminders, welcome, phone OTP verify + login, appointment status) |
| Gmail          | —  | ✓ (sim-only) | ✓ | ✓ | ✓ (`gmail-workspace.sendEmail`) |
| Calendar       | —  | ✓ (sim-only) | ✓ | ✓ | n/a |
| Transactional email (SMTP/nodemailer) | n/a | n/a | n/a | n/a | ✓ (`email.sendEmail` — welcome, refill status, appointment confirmation) |

All EHRs read from the shared `simulation/drchrono/patients` pool,
transformed to each vendor's native patient shape. Seeding DrChrono
patients seeds every EHR at once.

**CF interception** means Cloud Functions that originate outbound calls
(SMS via Twilio, email via SMTP/Gmail) read `system/settings.simulationMode`
and route to the simulator instead of the provider. Use
`recordSimSms()` (`simulation/simulators/messaging.ts`) for SMS and
`recordSimEmail()` (`simulation/simulators/workspace.ts`) for email —
both fire-and-forget, tolerate write failures, and never disrupt the
real flow.

Real-path fax routes on the sidecar return 501 today — the real path
still lives in the `sendOutboundFax` / `signalwireFaxWebhook` Cloud
Functions. When those migrate to the sidecar, no UI changes are
needed; the `isSimulationOn` check will just start falling through
to the real path instead of 501-ing.
