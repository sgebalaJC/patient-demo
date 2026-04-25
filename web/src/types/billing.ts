import { Timestamp } from 'firebase/firestore';

/**
 * Admin-managed subscription plan. Document id = Stripe price id.
 * Admins add rows via AdminSubscriptionPlansPage after creating products in
 * the Stripe dashboard.
 */
export interface SubscriptionPlan {
  id: string;
  /** Display name shown to patients, e.g. "Concierge Monthly" */
  name: string;
  /** Short marketing description */
  description?: string;
  /** Amount in smallest currency unit (cents). Informational only — Stripe is the source of truth. */
  amount: number;
  /** Three-letter ISO currency, e.g. "usd" */
  currency: string;
  /** Stripe recurring interval, e.g. "month" | "year" */
  interval: 'day' | 'week' | 'month' | 'year';
  /** Whether this plan is currently offered to patients */
  active: boolean;
  /** Ordered feature bullet points shown on the subscribe page */
  features?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

/**
 * Per-patient subscription state. Document id = patient uid.
 * Mirrored from Stripe by the stripeWebhook Cloud Function — never edit
 * directly from the client.
 */
export interface PatientSubscription {
  id: string;
  status: SubscriptionStatus;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  priceId?: string;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: number | null;
  endedAt?: number | null;
  updatedAt?: Timestamp;
}
