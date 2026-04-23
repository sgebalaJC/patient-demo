/**
 * Stripe subscription billing — minimal template.
 *
 * Scope:
 * - `createCheckoutSession`: callable function that creates a Stripe Checkout
 *   Session for a patient-selected subscription plan. Returns the hosted
 *   checkout URL.
 * - `cancelSubscription`: callable function that cancels a patient's active
 *   subscription at period end.
 * - `stripeWebhook`: HTTPS endpoint that Stripe calls for subscription
 *   lifecycle events. Mirrors state into Firestore `patient-subscriptions`.
 *
 * Firestore collections used:
 * - `subscription-plans` — admin-managed products/prices (docId = Stripe price id)
 * - `patient-subscriptions` — per-patient subscription state (docId = patient uid)
 *
 * Secrets (configure via `firebase functions:secrets:set`):
 * - `STRIPE_SECRET_KEY` — from https://dashboard.stripe.com/apikeys
 * - `STRIPE_WEBHOOK_SECRET` — from the webhook endpoint in Stripe dashboard
 *
 * Setup (per fork):
 * 1. Create a Stripe account for the practice.
 * 2. In Stripe dashboard → Products, create one product per membership plan.
 * 3. In this project, add matching docs to `subscription-plans` via the admin UI
 *    (id = Stripe price id, not Stripe product id).
 * 4. Set the two secrets above via `firebase functions:secrets:set`.
 * 5. Deploy: `firebase deploy --only functions:createCheckoutSession,functions:cancelSubscription,functions:stripeWebhook`
 * 6. In Stripe dashboard → Developers → Webhooks, add a webhook pointing at
 *    the deployed `stripeWebhook` URL. Enable these events:
 *    - checkout.session.completed
 *    - customer.subscription.created
 *    - customer.subscription.updated
 *    - customer.subscription.deleted
 *    - invoice.payment_succeeded
 *    - invoice.payment_failed
 */

import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import {makeStripeInstance, verifyWebhookSignature} from "./lib/stripe-helpers.js";

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

function getStripe(): Stripe {
  return makeStripeInstance(STRIPE_SECRET_KEY.value(), "STRIPE_SECRET_KEY");
}

/**
 * Create a Stripe Checkout session for a subscription plan.
 *
 * Request body:
 *   - `priceId` (string) — the Stripe price id the patient is subscribing to.
 *     Must exist in the `subscription-plans` Firestore collection.
 *   - `successUrl` (string) — absolute URL to redirect to after success.
 *   - `cancelUrl` (string) — absolute URL to redirect to if the patient cancels.
 *
 * Returns `{ url: string }` — the Stripe hosted checkout URL.
 */
export const createCheckoutSession = onCall(
  {secrets: [STRIPE_SECRET_KEY]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = request.auth.uid;
    const {priceId, successUrl, cancelUrl} = request.data as {
      priceId?: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    if (!priceId || !successUrl || !cancelUrl) {
      throw new HttpsError(
        "invalid-argument",
        "priceId, successUrl, and cancelUrl are required.",
      );
    }

    // Verify the plan is one the admin has approved
    const db = admin.firestore();
    const planSnap = await db.collection("subscription-plans").doc(priceId).get();
    if (!planSnap.exists || planSnap.data()?.active === false) {
      throw new HttpsError("not-found", "Subscription plan not found or inactive.");
    }

    // Look up or create a Stripe customer for this patient
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data() || {};
    let customerId: string | undefined = userData.stripeCustomerId;
    const stripe = getStripe();

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.email,
        name: [userData.firstName, userData.lastName].filter(Boolean).join(" ") || undefined,
        metadata: {firebaseUid: uid},
      });
      customerId = customer.id;
      await db.collection("users").doc(uid).set(
        {stripeCustomerId: customerId},
        {merge: true},
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{price: priceId, quantity: 1}],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: uid,
      metadata: {firebaseUid: uid, priceId},
    });

    logger.info("checkout session created", {uid, priceId, sessionId: session.id});
    return {url: session.url};
  },
);

/**
 * Cancel a patient's active subscription at period end.
 * Returns `{ cancelAt: number }` — unix seconds when the subscription ends.
 */
export const cancelSubscription = onCall(
  {secrets: [STRIPE_SECRET_KEY]},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = request.auth.uid;
    const db = admin.firestore();
    const subSnap = await db.collection("patient-subscriptions").doc(uid).get();
    if (!subSnap.exists) {
      throw new HttpsError("not-found", "No subscription found.");
    }
    const subData = subSnap.data() || {};
    const stripeSubscriptionId: string | undefined = subData.stripeSubscriptionId;
    if (!stripeSubscriptionId) {
      throw new HttpsError("failed-precondition", "Subscription not linked to Stripe.");
    }

    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await db.collection("patient-subscriptions").doc(uid).set(
      {
        cancelAtPeriodEnd: true,
        cancelAt: updated.cancel_at,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true},
    );

    logger.info("subscription cancellation scheduled", {uid, stripeSubscriptionId});
    return {cancelAt: updated.cancel_at};
  },
);

/**
 * Stripe webhook — mirrors subscription lifecycle events into Firestore.
 * Signature verified via STRIPE_WEBHOOK_SECRET.
 */
export const stripeWebhook = onRequest(
  {secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET]},
  async (req, res) => {
    const stripe = getStripe();
    // firebase-functions passes the raw body buffer in `rawBody`
    const rawBody = (req as any).rawBody || req.body;
    const verified = verifyWebhookSignature(
      stripe,
      rawBody,
      req.headers["stripe-signature"],
      STRIPE_WEBHOOK_SECRET.value(),
      "stripe webhook",
    );
    if (!verified.event) {
      res.status(verified.errorResponse!.status).send(verified.errorResponse!.body);
      return;
    }
    const event = verified.event;

    const db = admin.firestore();

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const uid = session.client_reference_id || session.metadata?.firebaseUid;
          if (uid && session.subscription) {
            await db.collection("patient-subscriptions").doc(uid).set(
              {
                status: "active",
                stripeCustomerId: session.customer,
                stripeSubscriptionId: session.subscription,
                priceId: session.metadata?.priceId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              {merge: true},
            );
          }
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          // Cast to `any` because some fields (current_period_*) shifted in
          // recent Stripe API versions — the template uses loose typing so
          // forks don't need to babysit the Stripe SDK version.
          const sub = event.data.object as any;
          const uid = (sub.metadata?.firebaseUid as string | undefined) ||
            await lookupUidByCustomer(db, sub.customer as string);
          if (uid) {
            await db.collection("patient-subscriptions").doc(uid).set(
              {
                status: sub.status,
                stripeCustomerId: sub.customer,
                stripeSubscriptionId: sub.id,
                priceId: sub.items?.data?.[0]?.price?.id,
                currentPeriodStart: sub.current_period_start,
                currentPeriodEnd: sub.current_period_end,
                cancelAtPeriodEnd: sub.cancel_at_period_end,
                cancelAt: sub.cancel_at,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              {merge: true},
            );
          }
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object as any;
          const uid = (sub.metadata?.firebaseUid as string | undefined) ||
            await lookupUidByCustomer(db, sub.customer as string);
          if (uid) {
            await db.collection("patient-subscriptions").doc(uid).set(
              {
                status: "canceled",
                endedAt: sub.ended_at,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              {merge: true},
            );
          }
          break;
        }
        case "invoice.payment_succeeded":
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          logger.info(`stripe ${event.type}`, {invoiceId: invoice.id, customer: invoice.customer});
          break;
        }
        default:
          logger.info("stripe webhook unhandled", {type: event.type});
      }
      res.status(200).send({received: true});
    } catch (err: any) {
      logger.error("stripe webhook handler error", err);
      res.status(500).send("handler error");
    }
  },
);

/**
 * Given a Stripe customer id, look up the Firebase uid by searching the `users`
 * collection for a matching `stripeCustomerId` field. Falls back to undefined.
 */
async function lookupUidByCustomer(
  db: admin.firestore.Firestore,
  customerId: string,
): Promise<string | undefined> {
  if (!customerId) return undefined;
  const snap = await db
    .collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();
  return snap.empty ? undefined : snap.docs[0].id;
}
