/**
 * fork.config.ts — single source of truth for per-fork values.
 *
 * THE ONE FILE FORKS EDIT.
 *
 * Consumed by:
 *  - web/src/config/branding.ts      (direct import; Vite bundles it)
 *  - functions/src/branding.ts       (via `functions/src/_fork.config.ts`,
 *                                     auto-copied by the functions prebuild
 *                                     hook — see functions/package.json)
 *  - firestore.rules / storage.rules (super-admin email must be edited in the
 *                                     rules files too — rules can't import TS)
 *
 * Shape groups fields so consumers can destructure what they need without
 * pulling in unrelated values. Mobile Flutter config is out of scope here —
 * keep mobile/lib/config/branding.dart in sync manually.
 */

export interface ForkConfig {
  /** Identity — shown in UI, emails, SMS, legal text. */
  readonly identity: {
    /** App/product display name, e.g. "Aurelia MD". */
    readonly appName: string;
    /** Full legal/display name of the practice. */
    readonly practiceName: string;
    /** Short marketing name, used in SMS bodies and email subjects. */
    readonly shortName: string;
    /** Legal entity for terms/privacy pages. */
    readonly legalEntity: string;
    /** Sender prefix for outbound SMS. */
    readonly smsSenderName: string;
    /** Signature on admin system-generated messages. */
    readonly adminSignatureName: string;
  };

  /** Contact — public phone, fax, email addresses. */
  readonly contact: {
    readonly supportEmail: string;
    /** Transactional email sender, shown to patients in "check spam" copy. */
    readonly fromEmail: string;
    readonly supportPhone: string | null;
    readonly fax: string | null;
  };

  /** URLs — customer-facing portal + CORS origins. */
  readonly urls: {
    /** Full https URL of the patient portal (used in email links). */
    readonly portalUrl: string;
    /** Customer-facing domain without protocol (used in footer copy). */
    readonly domain: string;
    /** Extra origins to allow in the Cloud Functions CORS allow-list. */
    readonly additionalOrigins: readonly string[];
  };

  /** Physical address and hours for the Contact page. */
  readonly address: {
    readonly street: string;
    readonly city: string;
    readonly state: string;
    readonly zip: string;
    readonly full: string;
    readonly mapsQuery: string;
  };

  readonly hours: readonly { readonly day: string; readonly time: string }[];

  /** Default appointment duration in minutes. */
  readonly defaultAppointmentDuration: number;

  /** Logo asset paths served from web/public/branding/. */
  readonly logos: {
    readonly full: string;
    readonly fullDark: string;
    readonly icon: string;
    readonly alt: string;
  };

  /** Brand color palette (hex). */
  readonly colors: {
    readonly primary: string;
    readonly secondary: string;
    readonly accent: string;
  };

  /** AI agent identities hosted via sidecar + OpenClaw. */
  readonly agents: {
    readonly admin: { readonly name: string; readonly tagline: string };
    readonly patient: { readonly name: string; readonly tagline: string };
  };

  /** Platform vendor — the entity the practice pays to run the system. */
  readonly platformVendor: {
    readonly name: string;
    readonly supportEmail: string;
    readonly billingDescriptor: string;
  };

  /**
   * Super-admin allowlist. Email-gated, not role-gated — super admins need
   * no users/{uid} doc. Hardcoded per fork. Must also be copied into
   * firestore.rules and storage.rules (rules can't import TS).
   */
  readonly superAdmin: {
    readonly email: string;
  };

  /** Global size/length limits. */
  readonly limits: {
    /**
     * Ceiling on any free-text field written by a client. Enforced loudly
     * in both web validation (Zod) and Cloud Functions (throws
     * invalid-argument) so oversized strings never reach Firestore.
     */
    readonly maxFieldChars: number;
  };

  /**
   * True when this fork is the public shared demo (not a real customer
   * deployment). Hides admin features that don't make sense in a shared
   * demo (Subscriptions, Platform Billing) from non-super-admins.
   */
  readonly isDemo: boolean;
}

export const FORK_CONFIG: ForkConfig = {
  identity: {
    appName: 'Aurelia MD',
    practiceName: 'Aurelia MD',
    shortName: 'Aurelia MD',
    legalEntity: 'Aurelia Primary Care',
    smsSenderName: 'Aurelia',
    adminSignatureName: 'Aurelia Admin System',
  },
  contact: {
    supportEmail: 'support@aureliamd.com',
    fromEmail: 'noreply@aureliamd.com',
    supportPhone: null,
    fax: null,
  },
  urls: {
    portalUrl: 'https://demo.aureliamd.com',
    domain: 'demo.aureliamd.com',
    additionalOrigins: [
      'https://demo.aureliamd.com',
    ],
  },
  address: {
    street: '500 Main Street',
    city: 'Palo Alto',
    state: 'CA',
    zip: '94301',
    full: '500 Main Street, Palo Alto, CA 94301',
    mapsQuery: '500+Main+Street+Palo+Alto+CA+94301',
  },
  hours: [
    { day: 'Monday – Friday', time: '9:00 AM – 5:00 PM' },
    { day: 'Saturday – Sunday', time: 'Closed' },
  ],
  defaultAppointmentDuration: 20,
  logos: {
    full: '/branding/aurelia-logo-silhouette.png',
    fullDark: '/branding/aurelia-logo-silhouette.png',
    icon: '/branding/aurelia-logo-silhouette.png',
    alt: 'Aurelia MD',
  },
  colors: {
    primary: '#fcbb00',
    secondary: '#374058',
    accent: '#c8973a',
  },
  agents: {
    admin: {
      name: 'Aurelia',
      tagline: 'Your practice management assistant',
    },
    patient: {
      name: 'Sunny',
      tagline: 'Here to help with your questions',
    },
  },
  platformVendor: {
    name: 'Patient Portal Inc.',
    supportEmail: 'billing@patientportal.example',
    billingDescriptor: 'PATIENT PORTAL',
  },
  superAdmin: {
    email: 'stanislaw.gebala@gmail.com',
  },
  limits: {
    maxFieldChars: 250,
  },
  isDemo: true,
};
