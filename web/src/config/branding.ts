/**
 * Branding — flat view over the single per-fork config at /fork.config.ts.
 *
 * To rebrand a fork, edit /fork.config.ts. This file adapts the grouped
 * fork-config shape to the flat `BRANDING` object that existing callers
 * across web/src/ use (BrandLogo, EmailLinkLoginForm, Layout, etc.).
 */

import { FORK_CONFIG } from '../../../fork.config';

export interface BrandingAgent {
  name: string;
  tagline: string;
  pronouns: string;
}

export interface BrandingPlatformVendor {
  name: string;
  supportEmail: string;
  billingDescriptor: string;
}

export interface BrandingColors {
  primary: string;
  secondary: string;
  accent: string;
}

export interface BrandingLogos {
  full: string;
  fullDark: string;
  icon: string;
  alt: string;
}

export interface BrandingAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  full: string;
  mapsQuery: string;
}

export interface Branding {
  appName: string;
  practiceName: string;
  shortName: string;
  legalEntity: string;
  domain: string;
  supportEmail: string;
  fromEmail: string;
  supportPhone?: string;
  fax?: string;
  smsSenderName: string;
  address: BrandingAddress;
  hours: Array<{ day: string; time: string }>;
  defaultAppointmentDuration: number;
  practiceType: 'concierge' | 'standard';
  logos: BrandingLogos;
  colors: BrandingColors;
  adminAgent: BrandingAgent;
  patientAgent: BrandingAgent;
  platformVendor: BrandingPlatformVendor;
  isDemo?: boolean;
}

export const BRANDING: Branding = {
  appName: FORK_CONFIG.identity.appName,
  practiceName: FORK_CONFIG.identity.practiceName,
  shortName: FORK_CONFIG.identity.shortName,
  legalEntity: FORK_CONFIG.identity.legalEntity,
  domain: FORK_CONFIG.urls.domain,
  supportEmail: FORK_CONFIG.contact.supportEmail,
  fromEmail: FORK_CONFIG.contact.fromEmail,
  supportPhone: FORK_CONFIG.contact.supportPhone ?? undefined,
  fax: FORK_CONFIG.contact.fax ?? undefined,
  smsSenderName: FORK_CONFIG.identity.smsSenderName,
  address: { ...FORK_CONFIG.address },
  hours: FORK_CONFIG.hours.map((h) => ({ ...h })),
  defaultAppointmentDuration: FORK_CONFIG.defaultAppointmentDuration,
  practiceType: FORK_CONFIG.practiceType,
  logos: { ...FORK_CONFIG.logos },
  colors: { ...FORK_CONFIG.colors },
  adminAgent: { ...FORK_CONFIG.agents.admin },
  patientAgent: { ...FORK_CONFIG.agents.patient },
  platformVendor: { ...FORK_CONFIG.platformVendor },
  isDemo: FORK_CONFIG.isDemo,
};

/** Legacy alias — prefer `BRANDING` in new code. */
export const BUSINESS = BRANDING;
