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

/**
 * Field-length caps for every text input the wizard collects. The wizard's
 * `renderForkConfigTs` blob inlines these values verbatim into the operator's
 * downloaded fork.config.ts, so unbounded input would let a malicious super
 * admin bloat the emitted TS file. Mirrors the project-wide `FIELD_LIMITS`
 * pattern from web/src/lib/validation.ts.
 */
export const WIZARD_FIELD_LIMITS = {
  appName: 60,
  practiceName: 80,
  shortName: 40,
  legalEntity: 120,
  smsSenderName: 40,
  supportEmail: 120,
  fromEmail: 120,
  phone: 30,
  fax: 30,
  domain: 120,
  url: 200,
  street: 120,
  city: 60,
  state: 30,
  zip: 12,
  hoursDay: 60,
  hoursTime: 60,
  logoPath: 200,
  logoAlt: 80,
  agentName: 40,
  agentTagline: 120,
  agentPronouns: 30,
  vmName: 60,
  vmZone: 30,
  vmProject: 30,
  ip: 45, // long enough for IPv6
} as const;

/** Numeric clamps. */
export const WIZARD_NUMERIC_LIMITS = {
  appointmentDurationMin: 5,
  appointmentDurationMax: 480,
} as const;

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
