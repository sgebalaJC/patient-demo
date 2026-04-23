/**
 * Shared Stripe bootstrap helpers used by both the patient billing
 * (`stripe.ts`) and the platform billing (`platformStripe.ts`) surfaces.
 * Keeps the API version, instance construction, and webhook signature
 * verification in one place.
 */

import Stripe from "stripe";
import {HttpsError} from "firebase-functions/v2/https";
import {logger} from "firebase-functions";

// Bumping the pinned API version is a cross-cutting change — both billing
// surfaces upgrade together so the Stripe SDK type casts stay consistent.
const STRIPE_API_VERSION = "2024-12-18.acacia" as any;

/**
 * Construct a Stripe SDK instance from a secret key. Throws an `HttpsError`
 * with a setup hint when the secret isn't configured so that callable
 * functions surface an actionable error to the UI.
 */
export function makeStripeInstance(secretKey: string, envKeyName: string): Stripe {
  if (!secretKey) {
    throw new HttpsError(
      "failed-precondition",
      `${envKeyName} is not set. Run \`firebase functions:secrets:set ${envKeyName}\`.`,
    );
  }
  return new Stripe(secretKey, {apiVersion: STRIPE_API_VERSION});
}

export interface WebhookVerifyResult {
  event: Stripe.Event | null;
  /** Populated when verification fails — caller should send this response. */
  errorResponse?: { status: number; body: string };
}

/**
 * Verify a Stripe webhook signature. On failure returns an `errorResponse`
 * the caller should forward to Stripe; on success returns the parsed event.
 */
export function verifyWebhookSignature(
  stripe: Stripe,
  rawBody: Buffer | string,
  signature: string | string[] | undefined,
  webhookSecret: string,
  logLabel: string,
): WebhookVerifyResult {
  if (!signature || !webhookSecret) {
    return {
      event: null,
      errorResponse: {status: 400, body: "Missing signature or webhook secret"},
    };
  }
  try {
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature as string,
      webhookSecret,
    );
    return {event};
  } catch (err: any) {
    logger.error(`${logLabel} signature verification failed`, err.message);
    return {
      event: null,
      errorResponse: {status: 400, body: `Webhook Error: ${err.message}`},
    };
  }
}
