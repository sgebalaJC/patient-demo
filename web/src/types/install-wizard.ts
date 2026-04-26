/**
 * State of the post-deploy install wizard at /admin/install. Persisted in
 * Firestore at `system/installWizard` so the operator can resume across
 * sessions / devices without re-entering everything.
 *
 * The CLI portion of the installer (installer/cli/*) seeds the practice
 * skeleton; this wizard fills in branding, contact, address, and binds
 * the OpenClaw VM. Integrations (Slack, Stripe, Workspace, EHRs) are
 * intentionally out of scope here — they live in /admin/integrations.
 */
export interface InstallWizardState {
  /** Last-completed step id; omitted on a fresh wizard (jump to step 0). */
  lastCompletedStep?: string;
  /** When set, the wizard's "Confirm" step has been signed off; future visits act as "edit". */
  installComplete?: boolean;

  identity?: {
    appName: string;
    practiceName: string;
    shortName: string;
    legalEntity: string;
    smsSenderName: string;
  };

  contact?: {
    supportEmail: string;
    fromEmail: string;
    supportPhone: string | null;
    supportFax: string | null;
    portalUrl: string;
    domain: string;
  };

  address?: {
    street: string;
    city: string;
    state: string;
    zip: string;
    full: string;
    mapsQuery: string;
    hours: { day: string; time: string }[];
  };

  practice?: {
    practiceType: 'concierge' | 'standard';
    defaultAppointmentDuration: number;
  };

  branding?: {
    /** Colors are applied live via system/branding doc; logos saved as Storage URLs. */
    colors: {
      primary: string;
      secondary: string;
      accent: string;
    };
    logos: {
      full: string;
      fullDark: string;
      icon: string;
      alt: string;
    };
  };

  agents?: {
    admin: { name: string; tagline: string; pronouns: string };
    patient: { name: string; tagline: string; pronouns: string };
  };

  /** OpenClaw VM bind step — captured from CLI step 09 output (operator pastes). */
  openclaw?: {
    vmName: string;
    vmZone: string;
    vmProject: string;
    vmInternalIp: string;
    vmExternalIp: string;
    /** Last successful gateway ping; falsy until connectivity verified. */
    lastPingAt?: string;
  };
}

export const WIZARD_STEPS = [
  'identity',
  'contact',
  'address',
  'practice',
  'branding',
  'agents',
  'openclaw',
  'confirm',
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number];
