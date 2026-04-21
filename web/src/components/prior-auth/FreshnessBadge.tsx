import React from 'react';
import type { Timestamp } from 'firebase/firestore';
import { POLICY_FRESHNESS_WARN_DAYS, POLICY_FRESHNESS_STALE_DAYS } from '../../types/prior-auth';

interface Props {
  sourceFetchedAt?: Timestamp | null;
  humanReviewedAt?: Timestamp | null;
}

// Coordinator-facing "how fresh is this policy?" indicator. Green under a
// week since fetch + approved by a human, yellow between 7–30 days, red
// beyond 30 or never-reviewed. Surfaces as a pill so the coordinator knows
// at a glance whether to trust the suggestion or double-check the payer site.
export const FreshnessBadge: React.FC<Props> = ({ sourceFetchedAt, humanReviewedAt }) => {
  if (!sourceFetchedAt) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Never fetched</span>;
  }
  const ageDays = (Date.now() - sourceFetchedAt.toMillis()) / 86_400_000;
  const reviewed = !!humanReviewedAt;
  if (!reviewed) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">Awaiting review</span>;
  }
  if (ageDays <= POLICY_FRESHNESS_WARN_DAYS) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Fresh · {Math.round(ageDays)}d</span>;
  }
  if (ageDays <= POLICY_FRESHNESS_STALE_DAYS) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">{Math.round(ageDays)}d since fetch</span>;
  }
  return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Stale · {Math.round(ageDays)}d</span>;
};
