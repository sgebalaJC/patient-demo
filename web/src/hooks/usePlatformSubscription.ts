/**
 * Subscribes to platform/subscription + platform/config + platform/bonus +
 * current month usage. Exposes enforcement-relevant derived state:
 *   - daysSinceLapsed: how long we've been past_due/cancelled
 *   - locked: true when enforcement is on AND grace period has expired
 *   - inGrace: true when lapsed within the 7-day grace window
 */

import { useEffect, useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import {
  platformOperations,
  PlatformSubscription,
  PlatformConfig,
  PlatformBonus,
  PlatformUsage,
  DEFAULT_PLATFORM_CONFIG,
} from '../lib/firestore/platform';
import { useAppSettings } from '../contexts/AppSettingsContext';

export const LAPSED_GRACE_DAYS = 7;

const EMPTY_SUB: PlatformSubscription = {
  plan: null,
  status: 'none',
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  cancelAtPeriodEnd: false,
};

const EMPTY_USAGE: PlatformUsage = {
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
  requestCount: 0,
};

const EMPTY_BONUS: PlatformBonus = {
  tokensRemaining: 0,
  totalPurchased: 0,
};

function lapsedAtMs(ts: Timestamp | number | null | undefined): number | null {
  if (ts === null || ts === undefined) return null;
  if (typeof ts === 'number') return ts;
  return ts.toMillis();
}

function isLapsedStatus(status: string): boolean {
  return status === 'past_due' || status === 'cancelled';
}

export function usePlatformSubscription() {
  const { settings } = useAppSettings();
  const [subscription, setSubscription] = useState<PlatformSubscription>(EMPTY_SUB);
  const [config, setConfig] = useState<PlatformConfig>({ ...DEFAULT_PLATFORM_CONFIG });
  const [bonus, setBonus] = useState<PlatformBonus>(EMPTY_BONUS);
  const [usage, setUsage] = useState<PlatformUsage>(EMPTY_USAGE);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const unsubSub = platformOperations.watchSubscription((s) => {
      setSubscription(s);
      setLoaded(true);
    });
    const unsubCfg = platformOperations.watchConfig(setConfig);
    const unsubBonus = platformOperations.watchBonus(setBonus);
    const unsubUsage = platformOperations.watchCurrentMonthUsage(setUsage);
    return () => {
      unsubSub();
      unsubCfg();
      unsubBonus();
      unsubUsage();
    };
  }, []);

  const lapsedMs = lapsedAtMs(subscription.lapsedAt);
  const daysSinceLapsed =
    lapsedMs && isLapsedStatus(subscription.status)
      ? Math.floor((Date.now() - lapsedMs) / 86_400_000)
      : null;

  const inGrace =
    isLapsedStatus(subscription.status) &&
    daysSinceLapsed !== null &&
    daysSinceLapsed <= LAPSED_GRACE_DAYS;

  const locked =
    !!settings.practiceSubscriptionEnforced &&
    isLapsedStatus(subscription.status) &&
    daysSinceLapsed !== null &&
    daysSinceLapsed > LAPSED_GRACE_DAYS;

  const daysLeftInGrace =
    inGrace && daysSinceLapsed !== null
      ? Math.max(0, LAPSED_GRACE_DAYS - daysSinceLapsed)
      : null;

  const allowance = config.monthlyAllowanceTokens + bonus.tokensRemaining;
  const usedOutput = usage.outputTokens;
  const pctUsed = allowance > 0 ? (usedOutput / allowance) * 100 : 0;
  const overBudget = usedOutput >= allowance;

  return {
    subscription,
    config,
    bonus,
    usage,
    loaded,
    daysSinceLapsed,
    daysLeftInGrace,
    inGrace,
    locked,
    allowance,
    usedOutput,
    pctUsed,
    overBudget,
    enforcementOn: !!settings.practiceSubscriptionEnforced,
  };
}
