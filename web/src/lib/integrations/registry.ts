/**
 * EHR provider registry — single source of truth for the Integrations tab
 * and the generic Setup component.
 *
 * Each entry describes one EHR integration: the user-visible name, the
 * Cloud Function name prefix (so `saveCredentials` / `authorize` /
 * `setEnabled` resolve automatically), and the extra fields required
 * beyond the standard client id + client secret.
 *
 * Adding a new EHR: append to `EHR_PROVIDERS`. The generic Setup card and
 * the AgentPage Integrations panel pick it up automatically.
 */

import { Stethoscope, Activity } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type FieldType = 'text' | 'password' | 'url' | 'checkbox';

export interface FieldDef {
  /** Property name on the integration doc + saveCredentials payload. */
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  /** Optional: shown as muted helper text under the field. */
  help?: string;
  required?: boolean;
  /** Optional: client-side regex validation before submit. */
  pattern?: RegExp;
  patternMessage?: string;
}

export interface EhrProviderDef {
  /** Machine id — matches Firestore doc name `integrations/{id}` and the
   *  Cloud Function name prefix. */
  id: string;
  name: string;
  icon: LucideIcon;
  description: string;
  /** Description shown when the integration is authorized + enabled. */
  activeDescription: string;
  /** Placeholder text for ClientId field — varies slightly per vendor. */
  clientIdPlaceholder?: string;
  clientSecretPlaceholder?: string;
  /** True if clientSecret is required. eCW (public SMART clients) can omit. */
  clientSecretRequired?: boolean;
  /** Extra fields beyond clientId/clientSecret. */
  extraFields: FieldDef[];
  /** Optional help block shown at the top of the credential editor. */
  setupHelp?: string;
  /** Config-driven extra badges — e.g. "Sandbox" when `sandbox: true`. */
  extraBadges?: (cfg: Record<string, unknown>) => { label: string; tone: 'blue' | 'purple' }[];
  /** Optional static badges always shown (e.g. "FHIR R4"). */
  staticBadges?: { label: string; tone: 'blue' | 'purple' }[];
}

// ─── Shared field defs ─────────────────────────────────────────────

const SANDBOX_FIELD: FieldDef = {
  key: 'sandbox',
  label: 'Use sandbox',
  type: 'checkbox',
  help: 'Connect to the vendor test environment instead of production.',
};

// ─── Provider registry ─────────────────────────────────────────────

export const EHR_PROVIDERS: EhrProviderDef[] = [
  {
    id: 'drchrono',
    name: 'DrChrono',
    icon: Stethoscope,
    description: 'Connect DrChrono so the admin agent can search patients and manage chart data',
    activeDescription: 'The admin agent can read & write the practice EHR when this integration is enabled',
    clientIdPlaceholder: 'EHR-generated client ID',
    clientSecretPlaceholder: 'EHR-generated client secret',
    clientSecretRequired: true,
    extraFields: [],
    setupHelp:
      "Create an application in the DrChrono developer console, then paste the Client ID and Client Secret here. You'll also need to register the redirect URI shown below.",
  },
  {
    id: 'athena',
    name: 'Athenahealth',
    icon: Stethoscope,
    description: 'Connect Athenahealth so the admin agent can query the practice EHR',
    activeDescription:
      'The admin agent can read Athena patient and appointment data when this integration is enabled',
    clientIdPlaceholder: 'Athena-issued client ID',
    clientSecretPlaceholder: 'Athena-issued client secret',
    clientSecretRequired: true,
    extraFields: [
      {
        key: 'practiceId',
        label: 'Practice ID',
        type: 'text',
        placeholder: 'Numeric tenant id, e.g. 195900',
        required: true,
        pattern: /^[0-9]+$/,
        patternMessage: 'Practice ID must be numeric',
      },
      {
        key: 'preview',
        label: 'Use preview sandbox (api.preview.platform.athenahealth.com)',
        type: 'checkbox',
      },
    ],
    setupHelp:
      "Register an application on Athena's developer portal, paste its Client ID and Client Secret, and set the practice (tenant) ID you want to connect. Use the preview sandbox toggle for test credentials.",
    extraBadges: (cfg) =>
      cfg.preview ? [{ label: 'Preview sandbox', tone: 'blue' }] : [],
  },
  {
    id: 'elation',
    name: 'Elation Health',
    icon: Stethoscope,
    description: 'Connect Elation so the admin agent can query the practice EHR',
    activeDescription:
      'The admin agent can read Elation patient and clinical data when this integration is enabled',
    clientIdPlaceholder: 'Elation-issued client ID',
    clientSecretPlaceholder: 'Elation-issued client secret',
    clientSecretRequired: true,
    extraFields: [SANDBOX_FIELD],
    setupHelp:
      "Create an OAuth application in Elation's developer portal. Use the sandbox toggle to connect to the test environment.",
    extraBadges: (cfg) => (cfg.sandbox ? [{ label: 'Sandbox', tone: 'blue' }] : []),
  },
  {
    id: 'ecw',
    name: 'eClinicalWorks',
    icon: Activity,
    description: 'Connect eClinicalWorks via SMART-on-FHIR so the admin agent can query the practice EHR',
    activeDescription:
      'The admin agent can read Patient/Appointment/Encounter FHIR resources when this integration is enabled',
    clientIdPlaceholder: 'SMART-on-FHIR client ID',
    clientSecretPlaceholder: 'Optional — confidential clients only',
    clientSecretRequired: false,
    extraFields: [
      {
        key: 'fhirBase',
        label: 'FHIR base URL',
        type: 'url',
        placeholder: 'https://fhir4.eclinicalworks.com/fhir/r4/<practice-id>',
        required: true,
        pattern: /^https:\/\/.+/,
        patternMessage: 'Must be an https URL',
      },
      {
        key: 'authUrl',
        label: 'Authorize URL',
        type: 'url',
        placeholder: 'https://.../oauth2/authorize',
        required: true,
        pattern: /^https:\/\/.+/,
        patternMessage: 'Must be an https URL',
      },
      {
        key: 'tokenUrl',
        label: 'Token URL',
        type: 'url',
        placeholder: 'https://.../oauth2/token',
        required: true,
        pattern: /^https:\/\/.+/,
        patternMessage: 'Must be an https URL',
      },
      {
        key: 'scope',
        label: 'Scopes (optional)',
        type: 'text',
        placeholder: 'Default: system/Patient.read system/Appointment.read …',
      },
    ],
    setupHelp:
      "eCW assigns a FHIR base URL, authorize endpoint, and token endpoint per practice. Pull them from the practice's `.well-known/smart-configuration` document and paste here along with the client ID/secret. Leave client secret blank for public SMART clients.",
    staticBadges: [{ label: 'FHIR R4', tone: 'purple' }],
  },
  {
    id: 'nextgen',
    name: 'NextGen Healthcare',
    icon: Stethoscope,
    description: 'Connect NextGen so the admin agent can query the practice EHR',
    activeDescription:
      'The admin agent can read NextGen patient and chart data when this integration is enabled',
    clientIdPlaceholder: 'NextGen-issued client ID',
    clientSecretPlaceholder: 'NextGen-issued client secret',
    clientSecretRequired: true,
    extraFields: [SANDBOX_FIELD],
    setupHelp:
      "Register an app in NextGen's developer portal. Use the sandbox toggle for non-prod tenants.",
    extraBadges: (cfg) => (cfg.sandbox ? [{ label: 'Sandbox', tone: 'blue' }] : []),
  },
  {
    id: 'tebra',
    name: 'Tebra (Kareo)',
    icon: Stethoscope,
    description:
      'Connect Tebra so the admin agent can query the practice EHR and billing system',
    activeDescription:
      'The admin agent can read Tebra patient, appointment, and billing data when this integration is enabled',
    clientIdPlaceholder: 'Tebra-issued client ID',
    clientSecretPlaceholder: 'Tebra-issued client secret',
    clientSecretRequired: true,
    extraFields: [],
    setupHelp:
      'Request API access in the Tebra partner portal and paste the Client ID and Client Secret here.',
  },
  {
    id: 'greenway',
    name: 'Greenway Health',
    icon: Stethoscope,
    description: 'Connect Greenway Intergy / Prime Suite so the admin agent can query the practice EHR',
    activeDescription:
      'The admin agent can read Greenway patient and chart data when this integration is enabled',
    clientIdPlaceholder: 'Greenway-issued client ID',
    clientSecretPlaceholder: 'Greenway-issued client secret',
    clientSecretRequired: true,
    extraFields: [SANDBOX_FIELD],
    setupHelp:
      "Register an OAuth app in the Greenway developer portal. Use the sandbox toggle for the sandbox tenant.",
    extraBadges: (cfg) => (cfg.sandbox ? [{ label: 'Sandbox', tone: 'blue' }] : []),
  },
  {
    id: 'pfusion',
    name: 'Practice Fusion',
    icon: Stethoscope,
    description: 'Connect Practice Fusion so the admin agent can query the practice EHR',
    activeDescription:
      'The admin agent can read Practice Fusion patient and chart data when this integration is enabled',
    clientIdPlaceholder: 'Practice Fusion-issued client ID',
    clientSecretPlaceholder: 'Practice Fusion-issued client secret',
    clientSecretRequired: true,
    extraFields: [],
    setupHelp:
      "Create an OAuth application in the Practice Fusion developer portal and paste the Client ID and Client Secret here.",
  },
];
