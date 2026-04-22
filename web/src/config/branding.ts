/**
 * Branding configuration — single source of truth for per-customer customization.
 *
 * Fork this repository per customer and edit this file to rebrand:
 * - Practice name, legal entity, domain, contact info
 * - Logo paths (drop files into web/public/branding/)
 * - Primary/secondary/accent colors
 * - AI agent names and taglines
 *
 * A matching config exists at mobile/lib/config/branding.dart — keep them in sync.
 */

export interface BrandingAgent {
  /** Display name of the agent, e.g. "Aurelia", "Sunny", "Admin Assistant" */
  name: string;
  /** One-line description shown in UI, e.g. "Your practice management assistant" */
  tagline: string;
}

export interface BrandingPlatformVendor {
  /** Legal name of the platform vendor (you) that bills the practice */
  name: string;
  /** Support email for platform billing questions */
  supportEmail: string;
  /** Short descriptor shown on the practice's credit card statement */
  billingDescriptor: string;
}

export interface BrandingColors {
  /** Primary brand color in hex, e.g. "#8B1A2B" */
  primary: string;
  /** Secondary brand color in hex, e.g. "#C5993E" */
  secondary: string;
  /** Accent color for highlights */
  accent: string;
}

export interface BrandingLogos {
  /** Path to full logo used in headers (light background), e.g. "/branding/logo.svg" */
  full: string;
  /** Path to full logo used on dark backgrounds */
  fullDark: string;
  /** Icon-only version for small surfaces (favicon, mobile home icon) */
  icon: string;
  /** Alt text for accessibility */
  alt: string;
}

export interface BrandingAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  /** Full single-line version for display */
  full: string;
  /** Google Maps embed query, e.g. "123+Main+St+San+Francisco+CA" */
  mapsQuery: string;
}

export interface Branding {
  /**
   * Display name of the app/product, used in UI footers, browser tab title,
   * marketing copy. Often matches `practiceName` but can be a separate
   * product name (e.g. "Aurelia MD" while practice is "Aurelia Primary Care").
   */
  appName: string;
  /** Full legal/display name of the practice, e.g. "Blasko Medical Consultants Inc" */
  practiceName: string;
  /** Short marketing name used in headers, emails, SMS, e.g. "ShowMD" */
  shortName: string;
  /** Legal entity for legal/audit pages (e.g. terms of service, privacy notice). */
  legalEntity: string;
  /** Primary customer-facing domain (without protocol), e.g. "patient.example.com" */
  domain: string;
  /** Public support email, e.g. "support@example.com" */
  supportEmail: string;
  /** Public phone number, undefined if none */
  supportPhone?: string;
  /** Fax number, undefined if none */
  fax?: string;
  /** Name used as SMS sender prefix in message templates */
  smsSenderName: string;
  /** Physical office address */
  address: BrandingAddress;
  /** Office hours list for Contact page */
  hours: Array<{ day: string; time: string }>;
  /** Default appointment duration in minutes */
  defaultAppointmentDuration: number;
  /** Logo asset paths (drop files in web/public/branding/) */
  logos: BrandingLogos;
  /** Brand color palette */
  colors: BrandingColors;
  /** Admin AI agent identity (hosted via sidecar + OpenClaw) */
  adminAgent: BrandingAgent;
  /** Patient support AI agent identity */
  patientAgent: BrandingAgent;
  /** Platform vendor (you) — the entity the practice pays to run the system */
  platformVendor: BrandingPlatformVendor;
}

export const BRANDING: Branding = {
  appName: 'Aurelia MD',
  practiceName: 'Aurelia MD',
  shortName: 'Aurelia MD',
  legalEntity: 'Aurelia Primary Care',
  domain: 'patient-demo-project.web.app',
  supportEmail: 'support@aureliamd.com',
  supportPhone: undefined,
  fax: undefined,
  smsSenderName: 'Aurelia',
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
  adminAgent: {
    name: 'Aurelia',
    tagline: 'Your practice management assistant',
  },
  patientAgent: {
    name: 'Sunny',
    tagline: 'Here to help with your questions',
  },
  // TODO(per-fork): set real platform vendor name + billing email before
  // the first production deploy. Mirror the same values in
  // functions/src/branding.ts and mobile/lib/config/branding.dart.
  platformVendor: {
    name: 'Patient Portal Inc.',
    supportEmail: 'billing@patientportal.example',
    billingDescriptor: 'PATIENT PORTAL',
  },
};

/** Legacy alias — prefer `BRANDING` in new code. */
export const BUSINESS = BRANDING;
