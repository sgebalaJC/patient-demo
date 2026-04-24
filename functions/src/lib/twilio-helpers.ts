/**
 * Shared Twilio bootstrap for every Cloud Function that sends SMS. Keeps
 * secret wiring, client construction, and the sim-mode check in one place
 * so call sites shrink to a single `sendSms(...)` invocation.
 *
 * Every function that sends SMS must include `TWILIO_SECRETS` in its
 * `secrets: [...]` option so Firebase binds the secret values at runtime.
 */

import {defineSecret} from "firebase-functions/params";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";

export const TWILIO_ACCOUNT_SID = defineSecret("TWILIO_ACCOUNT_SID");
export const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
export const TWILIO_PHONE_NUMBER = defineSecret("TWILIO_PHONE_NUMBER");

/** Include this in every SMS-sending function's `secrets` option. */
export const TWILIO_SECRETS = [
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
] as const;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const twilio = require("twilio");

interface TwilioEnv {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

function readEnv(): TwilioEnv | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const fromNumber = process.env.TWILIO_PHONE_NUMBER || "";
  if (!accountSid || !authToken || !fromNumber) return null;
  return {accountSid, authToken, fromNumber};
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
 * otherwise hits Twilio. Missing secrets in real mode log a warning and
 * return `{sent: false}` — callers decide whether that's fatal.
 */
export async function sendSms(opts: SendSmsOptions): Promise<SendSmsResult> {
  if (await isSimulationOn()) {
    const {recordSimSms} = await import("../simulation/simulators/messaging.js");
    await recordSimSms({to: opts.to, body: opts.body, kind: opts.kind});
    return {sent: true, sim: true};
  }

  const env = readEnv();
  if (!env) {
    logger.warn(`[${opts.context}] Twilio not configured — SMS not sent`);
    return {sent: false, sim: false, reason: "twilio-not-configured"};
  }

  const client = twilio(env.accountSid, env.authToken);
  await client.messages.create({body: opts.body, from: env.fromNumber, to: opts.to});
  return {sent: true, sim: false};
}
