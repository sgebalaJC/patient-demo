/**
 * Branding for Cloud Functions — flat view over /fork.config.ts.
 *
 * /fork.config.ts is copied to functions/src/_fork.config.ts by the
 * `prebuild` npm script (see functions/package.json). Edit /fork.config.ts
 * at the repo root — never this file.
 */

import { FORK_CONFIG } from './_fork.config';

export const FUNCTIONS_BRANDING = {
  appName: FORK_CONFIG.identity.appName,
  shortName: FORK_CONFIG.identity.shortName,
  practiceName: FORK_CONFIG.identity.practiceName,
  legalEntity: FORK_CONFIG.identity.legalEntity,
  portalUrl: FORK_CONFIG.urls.portalUrl,
  fromEmail: FORK_CONFIG.contact.fromEmail,
  additionalOrigins: [...FORK_CONFIG.urls.additionalOrigins] as string[],
  platformVendor: { ...FORK_CONFIG.platformVendor },
} as const;
