/**
 * Function-group mapping — names every Cloud Function in `functions/src/`
 * and groups them so the installer can deploy a subset.
 *
 * `core` is the always-on minimum: a fork can't operate without it (auth,
 * users, appointments, refills triggers, sidecar proxy, bootstrap).
 *
 * Integration groups (`google-workspace`, `signalwire`, `stripe`, `pa`,
 * `ehr-<id>`) are lazy-deployed: skipped at install time, deployed when
 * the admin enables the integration in `/admin/integrations`.
 *
 * Sync rule: when adding a new Cloud Function to `functions/src/`, also add
 * its export name to the relevant group below. A small CI check that diffs
 * `grep -E "^export const \\w+ = (onCall|onRequest|onSchedule|onDocument)"`
 * against this list would catch drift.
 */

export type GroupId =
  | "core"
  | "google-workspace"
  | "signalwire"
  | "stripe"
  | "pa"
  | "backup"
  | "simulation"
  | `ehr-${string}`;

export const FUNCTION_GROUPS: Record<GroupId, readonly string[]> = {
  // ── Always deploy (~25) ─────────────────────────────────────────────────
  // Auth, users, appointments, refills, intake, faxes from sidecar, bootstrap,
  // sidecar proxy, installer wizard support. Without these the fork can't
  // bootstrap a super-admin or serve the patient portal.
  core: [
    // Users + auth + audit
    "updateUserAuth",
    "setUserPassword",
    "logAuditEvent",
    "createUserWithAuth",
    "deleteAccount",
    "exportPatientData",
    "impersonateUser",
    "onBootstrapRequestCreated",

    // Appointments
    "onAppointmentWrite",
    "syncCalendarChanges",
    "getAvailableSlots",
    "validateAppointmentSlot",
    "cleanupCancelledAppointments",

    // Phone OTP (used by both bootstrap and ongoing phone-link sign-in)
    "sendPhoneVerificationCode",
    "verifyPhoneCode",
    "sendPhoneLoginCode",
    "verifyPhoneLogin",

    // Notifications + refill triggers
    "onNotificationCreated",
    "onRefillStatusChanged",

    // Reminders (cron — no harm running on fresh project; idempotent)
    "calendarReminderScheduler",
    "morningReminderScheduler",
    "trimAgentChat",

    // File serve + client error telemetry
    "serveFile",
    "logClientError",

    // Sidecar proxy + installer wizard agent sync
    "sidecarProxy",
    "installerSyncAgentWorkspace",
    // Admin-UI deploy controls — must ship in `core` so a fresh fork can
    // deploy any other group from the integrations panel.
    "enableIntegration",
    "getDeployBuildStatus",
    "getIntegrationFunctionStatus",
    // Sweeper that reconciles `installed-integrations` docs whose Cloud Build
    // never reported a terminal status. Cron — runs every 10 minutes.
    "reconcileStuckIntegrationDeploys",
  ],

  // ── Backup cron (~1) — separate so a fork can opt out ──────────────────
  backup: ["dailySidecarBackup"],

  // ── Google Workspace integration (~5) ──────────────────────────────────
  "google-workspace": [
    "googleWorkspaceAuthorize",
    "googleWorkspaceCallback",
    "saveGoogleWorkspaceServiceAccount",
    "disconnectGoogleWorkspace",
    "googleWorkspaceProxy",
  ],

  // ── SignalWire SMS + fax (~15) ─────────────────────────────────────────
  signalwire: [
    "saveSignalwireCredentials",
    "disconnectSignalwire",
    "signalwireFaxWebhook",
    "sendOutboundFax",
    "signalwireFaxStatusWebhook",
    "deleteOutboundFax",
    "retryFailedFaxes",
    "sendFaxEmail",
    "reprocessFax",
    "updateFaxDraft",
    "markFaxJunk",
    "attachFaxToDrChrono",
    "detachFaxFromDrChrono",
    "deleteFax",
    "getFaxPdfUrl",
  ],

  // ── Stripe (patient + platform) (~9) ───────────────────────────────────
  stripe: [
    "createCheckoutSession",
    "cancelSubscription",
    "stripeWebhook",
    "createPlatformCheckoutSession",
    "createPlatformTopupSession",
    "createPlatformBillingPortalSession",
    "cancelPlatformSubscription",
    "resumePlatformSubscription",
    "platformStripeWebhook",
  ],

  // ── Prior Auth (~9) — bound to drchrono today ──────────────────────────
  pa: [
    "createPriorAuth",
    "updatePriorAuthStatus",
    "submitPolicyReview",
    "runChartGapCheck",
    "policyFetcherCron",
    "triggerPolicyRefresh",
    "onPriorAuthWrite",
    "paFollowupCron",
    "extractTopPayers",
    "seedPaData",
  ],

  // ── Simulation (gated by INCLUDE_SIM_MODE) (~2) ────────────────────────
  simulation: ["seedSimulationData", "clearSimulationData"],

  // ── EHR groups — 5 functions each, 10 EHRs ─────────────────────────────
  "ehr-drchrono": ehrCallables("drchrono"),
  "ehr-athena": ehrCallables("athena"),
  "ehr-elation": ehrCallables("elation"),
  "ehr-ecw": ehrCallables("ecw"),
  "ehr-nextgen": ehrCallables("nextgen"),
  "ehr-tebra": ehrCallables("tebra"),
  "ehr-greenway": ehrCallables("greenway"),
  "ehr-pfusion": ehrCallables("pfusion"),
  "ehr-cerner": ehrCallables("cerner"),
  "ehr-epic": ehrCallables("epic"),
};

/** Standard 5-callable shape every EHR ships: authorize, callback, save, disconnect, setEnabled. */
function ehrCallables(id: string): string[] {
  // Each EHR file (e.g. drchrono.ts) exports these names with the prefix
  // matching the file name. Keep this in sync if a new EHR adds extra fns.
  return [
    `${id}Authorize`,
    `${id}Callback`,
    `${id}SaveCredentials`,
    `${id}Disconnect`,
    `${id}SetEnabled`,
  ];
}

/**
 * Build a Firebase deploy `--only` filter from a list of group ids. Always
 * includes `core` (and `simulation` when INCLUDE_SIM_MODE is set on the
 * fork). Returns an array of `functions:NAME` tokens ready to comma-join.
 */
export function deployFilterFor(groups: readonly GroupId[]): string[] {
  const set = new Set<string>(FUNCTION_GROUPS.core);
  for (const g of groups) {
    if (g === "core") continue;
    const fns = FUNCTION_GROUPS[g];
    if (fns) for (const fn of fns) set.add(fn);
  }
  return [...set].map((fn) => `functions:${fn}`);
}

/** Every recognised group id, useful for input validation. */
export const ALL_GROUP_IDS: readonly GroupId[] = Object.keys(FUNCTION_GROUPS) as GroupId[];
