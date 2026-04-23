/**
 * Shared SignalWire + fax admin helpers used by `signalwire-webhook.ts`,
 * `signalwire-fax-send.ts`, and `signalwire-fax-actions.ts`. Keeps the
 * secret definitions, webhook signature algorithm, and admin gate in one
 * place so security-relevant changes are made once.
 */

import {HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as crypto from "crypto";

// LaML API credentials. SignalWire also hands out a separate Signing Key
// that it may use for webhook HMACs — webhook verifiers try both.
export const signalwireProjectId = defineSecret("SIGNALWIRE_PROJECT_ID");
export const signalwireAuthToken = defineSecret("SIGNALWIRE_AUTH_TOKEN");
export const signalwireSigningKey = defineSecret("SIGNALWIRE_SIGNING_KEY");

/**
 * Twilio-compatible webhook HMAC. SignalWire's LaML subsystem reuses the
 * same algorithm: sort form params, append key+value to the request URL,
 * HMAC-SHA1 with the auth token (or signing key), base64. Do not change
 * this without understanding what SignalWire actually sends — mismatched
 * signatures silently reject real fax events.
 */
export function computeSignalwireSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }
  return crypto.createHmac("sha1", authToken).update(data).digest("base64");
}

/**
 * Admin gate used by all fax callables. Super-admins (by email) are
 * allowed through before the Firestore role check so a bootstrap admin
 * can operate without a user doc. Throws `HttpsError` on failure.
 */
export async function requireFaxAdmin(
  auth: { uid: string; token?: { email?: string } } | undefined,
): Promise<string> {
  if (!auth?.uid) throw new HttpsError("unauthenticated", "Sign-in required");
  const {isSuperAdminEmail} = await import("../superAdmins.js");
  if (isSuperAdminEmail(auth.token?.email)) return auth.uid;
  const userDoc = await admin.firestore().collection("users").doc(auth.uid).get();
  if (!userDoc.exists || userDoc.data()?.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin access required");
  }
  return auth.uid;
}
