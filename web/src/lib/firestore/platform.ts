/**
 * Typed reads for the `platform/*` Firestore collection — the practice's
 * subscription to the platform vendor (you), token budget, and bonus balance.
 *
 * All writes go through the platformStripeWebhook Cloud Function — these are
 * read-only from the client. Admin-only per Firestore rules.
 */

import {
  doc,
  getDoc,
  onSnapshot,
  collection,
  query,
  orderBy,
  limit,
  Timestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import { mapDocStrict } from './base';
import logger from '../logger';

export type PlatformPlan = 'monthly' | 'annual' | null;
export type PlatformSubscriptionStatus =
  | 'none'
  | 'active'
  | 'past_due'
  | 'cancelled';

export interface PlatformSubscription {
  plan: PlatformPlan;
  status: PlatformSubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd: boolean;
  cancelAt?: number | null;
  lapsedAt?: Timestamp | null;
  updatedAt?: Timestamp;
}

export interface PlatformConfig {
  monthlyAllowanceTokens: number;
  topupBonusTokens: number;
  economyModel: string;
  warningPct: number;
}

export interface PlatformBonus {
  tokensRemaining: number;
  totalPurchased: number;
  updatedAt?: Timestamp;
}

export interface PlatformUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  requestCount: number;
  updatedAt?: Timestamp;
}

export interface PlatformTopup {
  id: string;
  stripeSessionId: string;
  amountPaid: number; // cents
  currency: string;
  bonusTokensGranted: number;
  initiatedByUid: string | null;
  createdAt?: Timestamp;
}

const SUB_DOC = doc(db, 'platform', 'subscription');
const CONFIG_DOC = doc(db, 'platform', 'config');
const BONUS_DOC = doc(db, 'platform', 'bonus');
const TOPUPS_COLL = collection(db, 'platform-topups');

function currentMonthKey(): string {
  const d = new Date();
  return `usage-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  monthlyAllowanceTokens: 10_000_000,
  topupBonusTokens: 2_500_000,
  economyModel: 'gpt-4.1-mini',
  warningPct: 80,
};

function normalizeSubscription(data: any): PlatformSubscription {
  return {
    plan: data?.plan ?? null,
    status: data?.status ?? 'none',
    stripeCustomerId: data?.stripeCustomerId ?? null,
    stripeSubscriptionId: data?.stripeSubscriptionId ?? null,
    currentPeriodStart: data?.currentPeriodStart,
    currentPeriodEnd: data?.currentPeriodEnd,
    cancelAtPeriodEnd: !!data?.cancelAtPeriodEnd,
    cancelAt: data?.cancelAt ?? null,
    lapsedAt: data?.lapsedAt ?? null,
    updatedAt: data?.updatedAt,
  };
}

function normalizeConfig(data: any): PlatformConfig {
  return {
    monthlyAllowanceTokens:
      typeof data?.monthlyAllowanceTokens === 'number'
        ? data.monthlyAllowanceTokens
        : DEFAULT_PLATFORM_CONFIG.monthlyAllowanceTokens,
    topupBonusTokens:
      typeof data?.topupBonusTokens === 'number'
        ? data.topupBonusTokens
        : DEFAULT_PLATFORM_CONFIG.topupBonusTokens,
    economyModel:
      typeof data?.economyModel === 'string' && data.economyModel
        ? data.economyModel
        : DEFAULT_PLATFORM_CONFIG.economyModel,
    warningPct:
      typeof data?.warningPct === 'number'
        ? data.warningPct
        : DEFAULT_PLATFORM_CONFIG.warningPct,
  };
}

function normalizeBonus(data: any): PlatformBonus {
  return {
    tokensRemaining: typeof data?.tokensRemaining === 'number' ? data.tokensRemaining : 0,
    totalPurchased: typeof data?.totalPurchased === 'number' ? data.totalPurchased : 0,
    updatedAt: data?.updatedAt,
  };
}

function normalizeUsage(data: any): PlatformUsage {
  return {
    inputTokens: typeof data?.inputTokens === 'number' ? data.inputTokens : 0,
    outputTokens: typeof data?.outputTokens === 'number' ? data.outputTokens : 0,
    estimatedCostUsd: typeof data?.estimatedCostUsd === 'number' ? data.estimatedCostUsd : 0,
    requestCount: typeof data?.requestCount === 'number' ? data.requestCount : 0,
    updatedAt: data?.updatedAt,
  };
}

export const platformOperations = {
  watchSubscription(cb: (sub: PlatformSubscription) => void): Unsubscribe {
    return onSnapshot(
      SUB_DOC,
      (snap) => cb(normalizeSubscription(snap.exists() ? snap.data() : null)),
      (err) => {
        logger.error('platform subscription snapshot error', err);
        cb(normalizeSubscription(null));
      },
    );
  },

  watchConfig(cb: (cfg: PlatformConfig) => void): Unsubscribe {
    return onSnapshot(
      CONFIG_DOC,
      (snap) => cb(normalizeConfig(snap.exists() ? snap.data() : null)),
      () => cb({ ...DEFAULT_PLATFORM_CONFIG }),
    );
  },

  watchBonus(cb: (bonus: PlatformBonus) => void): Unsubscribe {
    return onSnapshot(
      BONUS_DOC,
      (snap) => cb(normalizeBonus(snap.exists() ? snap.data() : null)),
      () => cb({ tokensRemaining: 0, totalPurchased: 0 }),
    );
  },

  watchCurrentMonthUsage(cb: (usage: PlatformUsage) => void): Unsubscribe {
    const usageDoc = doc(db, 'platform', currentMonthKey());
    return onSnapshot(
      usageDoc,
      (snap) => cb(normalizeUsage(snap.exists() ? snap.data() : null)),
      () => cb(normalizeUsage(null)),
    );
  },

  async getCurrentMonthUsage(): Promise<PlatformUsage> {
    const snap = await getDoc(doc(db, 'platform', currentMonthKey()));
    return normalizeUsage(snap.exists() ? snap.data() : null);
  },

  watchRecentTopups(cb: (topups: PlatformTopup[]) => void, max = 20): Unsubscribe {
    const q = query(TOPUPS_COLL, orderBy('createdAt', 'desc'), limit(max));
    return onSnapshot(
      q,
      (snap) =>
        cb(
          snap.docs
            .map((d) => mapDocStrict<PlatformTopup>(d, ['stripeSessionId', 'amountPaid'], 'platform-topups'))
            .filter((t): t is PlatformTopup => t !== null),
        ),
      (err) => {
        logger.error('platform topups snapshot error', err);
        cb([]);
      },
    );
  },

  currentMonthKey,
};
