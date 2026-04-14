/**
 * Branding configuration for Cloud Functions — edit per fork.
 *
 * Kept separate from the web and mobile configs because Cloud Functions cannot
 * import from the web workspace. Values must be manually kept in sync with:
 * - web/src/config/branding.ts
 * - mobile/lib/config/branding.dart
 *
 * These strings are embedded in SMS templates, email bodies, and admin
 * notifications, so changing them without redeploying functions will leave
 * stale references in outbound messages.
 */
export const FUNCTIONS_BRANDING = {
  /** Short marketing name used in SMS bodies */
  shortName: 'Acme',
  /** Full legal/display name */
  practiceName: 'Acme Primary Care',
  /** Legal entity for legal/audit text */
  legalEntity: 'Acme Primary Care, LLC',
  /** Name used to sign admin system messages */
  adminSignatureName: 'Acme Admin System',
  /** Patient portal URL for email links */
  portalUrl: 'https://demo.aureliamd.com',
  /**
   * Additional origins allowed by the CORS allow-list. Include the App
   * Hosting default URL so the portal still works when accessed directly,
   * plus any staging or preview URLs.
   */
  additionalOrigins: [
    'https://web-patient-demo--patient-demo-project.us-central1.hosted.app',
    'https://patient-demo-project.web.app',
    'https://patient-demo-project.firebaseapp.com',
  ] as string[],
  /** Platform vendor (you) — billed on Stripe statements for the practice subscription */
  platformVendor: {
    name: 'Patient Portal Inc.',
    supportEmail: 'billing@patientportal.example',
    billingDescriptor: 'PATIENT PORTAL',
  },
} as const;
