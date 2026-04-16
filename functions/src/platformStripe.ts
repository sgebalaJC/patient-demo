/**
 * Platform Stripe billing — the practice owner pays the platform vendor
 * (you) to run the portal. Separate from `functions/src/stripe.ts`, which
 * handles patient-pays-practice subscriptions.
 *
 * Scope:
 * - `createPlatformCheckoutSession` — admin-only callable; starts a hosted
 *   Stripe Checkout for the monthly or annual plan.
 * - `createPlatformTopupSession` — admin-only callable; starts a hosted
 *   Stripe Checkout for a $25 one-time token top-up. Requires active sub.
 * - `createPlatformBillingPortalSession` — admin-only; redirect to Stripe's
 *   hosted customer portal (payment method, invoice history, cancel).
 * - `cancelPlatformSubscription` / `resumePlatformSubscription` — admin-only;
 *   toggle `cancel_at_period_end` on the active subscription.
 * - `platformStripeWebhook` — HTTPS endpoint; separate from `stripeWebhook`
 *   to avoid demultiplexing. Configure a second endpoint in the Stripe
 *   dashboard pointing at this URL.
 *
 * Firestore docs mirrored:
 * - `platform/subscription` (singleton) — plan, status, stripeCustomerId,
 *   stripeSubscriptionId, currentPeriodStart/End, cancelAtPeriodEnd, lapsedAt
 * - `platform/bonus` (singleton) — running top-up token balance
 * - `platform/config` (singleton) — monthly allowance, economy model name
 * - `platform-topups/{id}` — ledger of each successful top-up purchase
 * - `platform-stripe-events/{eventId}` — idempotency guard
 *
 * Secrets (configure via `firebase functions:secrets:set` or functions/.env):
 * - `PLATFORM_STRIPE_SECRET_KEY` — separate Stripe account from the
 *   practice's patient-billing account.
 * - `PLATFORM_STRIPE_WEBHOOK_SECRET` — from the webhook endpoint configured
 *   in the platform Stripe dashboard.
 * - `PLATFORM_STRIPE_PRICE_MONTHLY` — price id for $300/mo subscription.
 * - `PLATFORM_STRIPE_PRICE_ANNUAL` — price id for $3000/yr subscription.
 * - `PLATFORM_STRIPE_PRICE_TOPUP` — price id for $25 one-time top-up.
 *
 * Role model: any admin can subscribe / top-up / cancel. The practice
 * subscription is singleton (one per fork).
 */

import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {logger} from "firebase-functions";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import {FUNCTIONS_BRANDING} from "./branding.js";
import {assertAdmin} from "./superAdmins.js";

const PLATFORM_STRIPE_SECRET_KEY = defineSecret("PLATFORM_STRIPE_SECRET_KEY");
const PLATFORM_STRIPE_WEBHOOK_SECRET = defineSecret("PLATFORM_STRIPE_WEBHOOK_SECRET");
const PLATFORM_STRIPE_PRICE_MONTHLY = defineSecret("PLATFORM_STRIPE_PRICE_MONTHLY");
const PLATFORM_STRIPE_PRICE_ANNUAL = defineSecret("PLATFORM_STRIPE_PRICE_ANNUAL");
const PLATFORM_STRIPE_PRICE_TOPUP = defineSecret("PLATFORM_STRIPE_PRICE_TOPUP");
const ALL_PLATFORM_SECRETS = [
  PLATFORM_STRIPE_SECRET_KEY,
  PLATFORM_STRIPE_WEBHOOK_SECRET,
  PLATFORM_STRIPE_PRICE_MONTHLY,
  PLATFORM_STRIPE_PRICE_ANNUAL,
  PLATFORM_STRIPE_PRICE_TOPUP,
];

// Amount of bonus output tokens granted per successful $25 top-up. Tunable
// at runtime via `platform/config.topupBonusTokens`; this is just the fallback
// used when the config doc is absent.
const DEFAULT_TOPUP_BONUS_TOKENS = 2_500_000;

function getStripe(): Stripe {
  const key = PLATFORM_STRIPE_SECRET_KEY.value();
  if (!key) {
    throw new HttpsError(
      "failed-precondition",
      "PLATFORM_STRIPE_SECRET_KEY is not set. Add it to functions/.env or set via firebase functions:secrets:set.",
    );
  }
  return new Stripe(key, {apiVersion: "2024-12-18.acacia" as any});
}

const SUB_DOC = () => admin.firestore().doc("platform/subscription");
const BONUS_DOC = () => admin.firestore().doc("platform/bonus");
const CONFIG_DOC = () => admin.firestore().doc("platform/config");

/**
 * Create (or fetch) the singleton platform Stripe customer and return its id.
 * The customer represents the practice as a whole, not a specific admin user.
 */
async function ensurePlatformCustomer(stripe: Stripe): Promise<string> {
  const snap = await SUB_DOC().get();
  const existing = snap.data()?.stripeCustomerId as string | undefined;
  if (existing) return existing;

  const customer = await stripe.customers.create({
    name: FUNCTIONS_BRANDING.practiceName,
    description: `Platform subscription for ${FUNCTIONS_BRANDING.practiceName}`,
    metadata: {
      practiceShortName: FUNCTIONS_BRANDING.shortName,
      platformVendor: FUNCTIONS_BRANDING.platformVendor.name,
    },
  });
  await SUB_DOC().set(
    {
      stripeCustomerId: customer.id,
      status: "none",
      plan: null,
      cancelAtPeriodEnd: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
  return customer.id;
}

function resolvePriceId(plan: "monthly" | "annual"): string {
  const ref = plan === "monthly" ? PLATFORM_STRIPE_PRICE_MONTHLY : PLATFORM_STRIPE_PRICE_ANNUAL;
  const envKey = plan === "monthly" ? "PLATFORM_STRIPE_PRICE_MONTHLY" : "PLATFORM_STRIPE_PRICE_ANNUAL";
  const priceId = ref.value();
  if (!priceId) {
    throw new HttpsError(
      "failed-precondition",
      `${envKey} is not set. Run \`firebase functions:secrets:set ${envKey}\`.`,
    );
  }
  return priceId;
}

/** Admin-only: start hosted Stripe Checkout for the platform subscription. */
export const createPlatformCheckoutSession = onCall({secrets: ALL_PLATFORM_SECRETS}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  await assertAdmin(request.auth);
  const {plan, successUrl, cancelUrl} = request.data as {
    plan?: "monthly" | "annual";
    successUrl?: string;
    cancelUrl?: string;
  };
  if (!plan || (plan !== "monthly" && plan !== "annual")) {
    throw new HttpsError("invalid-argument", "plan must be 'monthly' or 'annual'.");
  }
  if (!successUrl || !cancelUrl) {
    throw new HttpsError("invalid-argument", "successUrl and cancelUrl are required.");
  }

  const stripe = getStripe();
  const customerId = await ensurePlatformCustomer(stripe);
  const priceId = resolvePriceId(plan);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{price: priceId, quantity: 1}],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {type: "platform-subscription", plan, initiatedByUid: request.auth.uid},
    subscription_data: {
      metadata: {type: "platform-subscription", plan},
    },
  });

  logger.info("platform checkout session created", {
    uid: request.auth.uid,
    plan,
    sessionId: session.id,
  });
  return {url: session.url};
});

/** Admin-only: start Checkout for a one-time $25 token top-up. */
export const createPlatformTopupSession = onCall({secrets: ALL_PLATFORM_SECRETS}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  await assertAdmin(request.auth);
  const {successUrl, cancelUrl} = request.data as {
    successUrl?: string;
    cancelUrl?: string;
  };
  if (!successUrl || !cancelUrl) {
    throw new HttpsError("invalid-argument", "successUrl and cancelUrl are required.");
  }

  const priceId = PLATFORM_STRIPE_PRICE_TOPUP.value();
  if (!priceId) {
    throw new HttpsError(
      "failed-precondition",
      "PLATFORM_STRIPE_PRICE_TOPUP is not set.",
    );
  }

  const subSnap = await SUB_DOC().get();
  const subData = subSnap.data();
  if (!subData || subData.status !== "active") {
    throw new HttpsError(
      "failed-precondition",
      "An active platform subscription is required before buying a top-up.",
    );
  }

  const stripe = getStripe();
  const customerId = await ensurePlatformCustomer(stripe);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [{price: priceId, quantity: 1}],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {type: "platform-topup", initiatedByUid: request.auth.uid},
    payment_intent_data: {
      metadata: {type: "platform-topup"},
    },
  });

  logger.info("platform topup session created", {
    uid: request.auth.uid,
    sessionId: session.id,
  });
  return {url: session.url};
});

/** Admin-only: redirect to Stripe's hosted Billing Portal. */
export const createPlatformBillingPortalSession = onCall({secrets: ALL_PLATFORM_SECRETS}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  await assertAdmin(request.auth);
  const {returnUrl} = request.data as {returnUrl?: string};
  if (!returnUrl) {
    throw new HttpsError("invalid-argument", "returnUrl is required.");
  }

  const subSnap = await SUB_DOC().get();
  const customerId = subSnap.data()?.stripeCustomerId as string | undefined;
  if (!customerId) {
    throw new HttpsError(
      "failed-precondition",
      "No platform Stripe customer exists yet — subscribe first.",
    );
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return {url: session.url};
});

/** Admin-only: schedule cancellation at the current period end. */
export const cancelPlatformSubscription = onCall({secrets: ALL_PLATFORM_SECRETS}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  await assertAdmin(request.auth);

  const subSnap = await SUB_DOC().get();
  const stripeSubscriptionId = subSnap.data()?.stripeSubscriptionId as string | undefined;
  if (!stripeSubscriptionId) {
    throw new HttpsError("failed-precondition", "No active subscription to cancel.");
  }

  const stripe = getStripe();
  const updated = await stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
  await SUB_DOC().set(
    {
      cancelAtPeriodEnd: true,
      cancelAt: updated.cancel_at,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
  logger.info("platform subscription cancellation scheduled", {
    uid: request.auth.uid,
    stripeSubscriptionId,
  });
  return {cancelAt: updated.cancel_at};
});

/** Admin-only: undo a scheduled cancellation. */
export const resumePlatformSubscription = onCall({secrets: ALL_PLATFORM_SECRETS}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  await assertAdmin(request.auth);

  const subSnap = await SUB_DOC().get();
  const stripeSubscriptionId = subSnap.data()?.stripeSubscriptionId as string | undefined;
  if (!stripeSubscriptionId) {
    throw new HttpsError("failed-precondition", "No subscription to resume.");
  }

  const stripe = getStripe();
  const updated = await stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: false,
  });
  await SUB_DOC().set(
    {
      cancelAtPeriodEnd: false,
      cancelAt: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
  logger.info("platform subscription resumed", {
    uid: request.auth.uid,
    stripeSubscriptionId,
  });
  return {status: updated.status};
});

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/**
 * Platform Stripe webhook — mirrors subscription + top-up events into
 * Firestore. Separate endpoint from `stripeWebhook` (patient billing).
 * Idempotency via `platform-stripe-events/{eventId}` write-once.
 */
export const platformStripeWebhook = onRequest({secrets: ALL_PLATFORM_SECRETS}, async (req, res) => {
  const signature = req.headers["stripe-signature"];
  const webhookSecret = PLATFORM_STRIPE_WEBHOOK_SECRET.value();
  if (!signature || !webhookSecret) {
    res.status(400).send("Missing signature or webhook secret");
    return;
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    const rawBody = (req as any).rawBody || req.body;
    event = stripe.webhooks.constructEvent(rawBody, signature as string, webhookSecret);
  } catch (err: any) {
    logger.error("platform stripe webhook signature verification failed", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  const db = admin.firestore();
  const eventRef = db.collection("platform-stripe-events").doc(event.id);

  // Idempotency: claim via transaction. If doc already exists, we've processed
  // this event before — return 200 so Stripe stops retrying.
  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(eventRef);
      if (existing.exists) {
        throw new Error("DUPLICATE_EVENT");
      }
      tx.set(eventRef, {
        type: event.type,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
  } catch (err: any) {
    if (err?.message === "DUPLICATE_EVENT") {
      logger.info("platform stripe webhook duplicate event ignored", {eventId: event.id});
      res.status(200).send({received: true, duplicate: true});
      return;
    }
    logger.error("platform stripe webhook idempotency guard failed", err);
    res.status(500).send("idempotency guard failed");
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const type = session.metadata?.type;
        if (type === "platform-topup") {
          await handleTopupCompleted(db, session);
        } else if (type === "platform-subscription") {
          await handleSubscriptionCheckout(db, session);
        } else {
          logger.info("platform webhook: unknown checkout type", {type, sessionId: session.id});
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as any;
        if (sub.metadata?.type !== "platform-subscription") {
          logger.info("platform webhook: non-platform subscription event ignored", {subId: sub.id});
          break;
        }
        await mirrorSubscription(db, sub);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as any;
        if (sub.metadata?.type !== "platform-subscription") break;
        await SUB_DOC().set(
          {
            status: "cancelled",
            endedAt: sub.ended_at,
            lapsedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
        );
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        // On successful renewal, clear any lapsed state.
        await SUB_DOC().set(
          {
            status: "active",
            lapsedAt: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
        );
        break;
      }
      case "invoice.payment_failed": {
        const subSnap = await SUB_DOC().get();
        const alreadyLapsed = !!subSnap.data()?.lapsedAt;
        await SUB_DOC().set(
          {
            status: "past_due",
            // Set lapsedAt the first time we see this failure so the 7-day
            // grace timer doesn't reset on every retry.
            ...(alreadyLapsed ? {} : {lapsedAt: admin.firestore.FieldValue.serverTimestamp()}),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
        );
        break;
      }
      default:
        logger.info("platform stripe webhook unhandled", {type: event.type});
    }
    res.status(200).send({received: true});
  } catch (err: any) {
    logger.error("platform stripe webhook handler error", err);
    // Delete the idempotency claim so Stripe retry can succeed.
    try {
      await eventRef.delete();
    } catch { /* best-effort */ }
    res.status(500).send("handler error");
  }
});

async function handleSubscriptionCheckout(
  db: admin.firestore.Firestore,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const plan = session.metadata?.plan as "monthly" | "annual" | undefined;
  await SUB_DOC().set(
    {
      status: "active",
      stripeCustomerId: session.customer,
      stripeSubscriptionId: session.subscription,
      plan: plan ?? null,
      lapsedAt: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
  logger.info("platform subscription activated", {
    plan,
    sessionId: session.id,
    subscriptionId: session.subscription,
  });
}

async function mirrorSubscription(
  db: admin.firestore.Firestore,
  sub: any,
): Promise<void> {
  const update: Record<string, any> = {
    status: mapStripeStatusToInternal(sub.status),
    stripeCustomerId: sub.customer,
    stripeSubscriptionId: sub.id,
    plan: sub.metadata?.plan ?? null,
    currentPeriodStart: sub.current_period_start,
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    cancelAt: sub.cancel_at ?? null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  // If Stripe says active, clear any lapsed state. If past_due and we haven't
  // recorded lapsedAt yet, set it now.
  if (update.status === "active") {
    update.lapsedAt = null;
  } else if (update.status === "past_due") {
    const existing = await SUB_DOC().get();
    if (!existing.data()?.lapsedAt) {
      update.lapsedAt = admin.firestore.FieldValue.serverTimestamp();
    }
  }
  await SUB_DOC().set(update, {merge: true});
}

function mapStripeStatusToInternal(stripeStatus: string): string {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      return stripeStatus;
  }
}

async function handleTopupCompleted(
  db: admin.firestore.Firestore,
  session: Stripe.Checkout.Session,
): Promise<void> {
  // Look up the bonus-token grant from config (fall back to default).
  const cfgSnap = await CONFIG_DOC().get();
  const bonusTokens: number =
    (cfgSnap.data()?.topupBonusTokens as number | undefined) ?? DEFAULT_TOPUP_BONUS_TOKENS;

  // Ledger entry — one per successful top-up.
  await db.collection("platform-topups").doc(session.id).set({
    stripeSessionId: session.id,
    stripeCustomerId: session.customer,
    amountPaid: session.amount_total,
    currency: session.currency,
    bonusTokensGranted: bonusTokens,
    initiatedByUid: session.metadata?.initiatedByUid ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Increment the running bonus balance.
  await BONUS_DOC().set(
    {
      tokensRemaining: admin.firestore.FieldValue.increment(bonusTokens),
      totalPurchased: admin.firestore.FieldValue.increment(bonusTokens),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    {merge: true},
  );

  logger.info("platform topup recorded", {
    sessionId: session.id,
    bonusTokens,
  });
}
