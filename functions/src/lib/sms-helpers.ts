/**
 * Shared SignalWire LaML SMS bootstrap for every Cloud Function that sends
 * SMS. Routes to the simulation sandbox when `system/settings.simulationMode`
 * is true, otherwise POSTs to SignalWire's Twilio-compatible Messages.json
 * endpoint under the LaML namespace.
 *
 * Every function that sends SMS must include `SMS_SECRETS` in its
 * `secrets: [...]` option so Firebase binds the secret values at runtime.
 */

import {defineSecret} from "firebase-functions/params";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import {signalwireProjectId, signalwireAuthToken} from "./signalwire-helpers.js";

// Space URL (e.g. `example.signalwire.com`) and the outbound SMS sender
// number are SMS-specific. The fax sender number already lives on
// `integrations/signalwire.faxNumber`; SMS uses its own secret so the two
// can be different DIDs.
export const SIGNALWIRE_SPACE_URL = defineSecret("SIGNALWIRE_SPACE_URL");
export const SIGNALWIRE_SMS_FROM = defineSecret("SIGNALWIRE_SMS_FROM");

/** Include this in every SMS-sending function's `secrets` option. */
export const SMS_SECRETS = [
  signalwireProjectId,
  signalwireAuthToken,
  SIGNALWIRE_SPACE_URL,
  SIGNALWIRE_SMS_FROM,
] as const;

interface SmsEnv {
  projectId: string;
  authToken: string;
  spaceUrl: string;
  fromNumber: string;
}

function readEnv(): SmsEnv | null {
  const projectId = process.env.SIGNALWIRE_PROJECT_ID || "";
  const authToken = process.env.SIGNALWIRE_AUTH_TOKEN || "";
  const spaceUrl = (process.env.SIGNALWIRE_SPACE_URL || "").replace(/\/+$/, "");
  const fromNumber = process.env.SIGNALWIRE_SMS_FROM || "";
  if (!projectId || !authToken || !spaceUrl || !fromNumber) return null;
  return {projectId, authToken, spaceUrl, fromNumber};
}

async function isSimulationOn(): Promise<boolean> {
  const snap = await admin.firestore().doc("system/settings").get();
  return snap.exists && snap.data()?.simulationMode === true;
}

export type SmsKind = "welcome" | "verification" | "admin" | "reminder";

export interface SendSmsOptions {
  to: string; // E.164 format (+1XXXXXXXXXX)
  body: string;
  kind: SmsKind;
  /**
   * Label for logs/warnings — identifies the call site without leaking PII.
   * Example: `"welcome-sms"`, `"phone-login-otp"`.
   */
  context: string;
}

export interface SendSmsResult {
  sent: boolean;
  sim: boolean;
  reason?: string;
}

/**
 * Single entry point for all SMS sends from Cloud Functions. Routes to
 * the simulation sandbox when `system/settings.simulationMode` is true,
 * otherwise hits SignalWire's LaML Messages.json. Missing secrets in real
 * mode log a warning and return `{sent: false}` — callers decide whether
 * that's fatal.
 */
export async function sendSms(opts: SendSmsOptions): Promise<SendSmsResult> {
  if (await isSimulationOn()) {
    const {recordSimSms} = await import("../simulation/simulators/messaging.js");
    await recordSimSms({to: opts.to, body: opts.body, kind: opts.kind});
    return {sent: true, sim: true};
  }

  const env = readEnv();
  if (!env) {
    logger.warn(`[${opts.context}] SignalWire SMS not configured — SMS not sent`);
    return {sent: false, sim: false, reason: "signalwire-not-configured"};
  }

  const form = new URLSearchParams({
    From: env.fromNumber,
    To: opts.to,
    Body: opts.body,
  });
  const basic = Buffer.from(`${env.projectId}:${env.authToken}`).toString("base64");
  const res = await fetch(
    `https://${env.spaceUrl}/api/laml/2010-04-01/Accounts/${env.projectId}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error(
      `[${opts.context}] SignalWire SMS send failed ${res.status}`,
      errText.slice(0, 200),
    );
    return {sent: false, sim: false, reason: `signalwire-${res.status}`};
  }
  return {sent: true, sim: false};
}
