import React from 'react';
import type { PriorAuthStatus, PolicyStatus } from '../../types/prior-auth';
import { PRIOR_AUTH_STATUS_LABEL, POLICY_STATUS_LABEL } from '../../types/prior-auth';

const PA_CLASSES: Record<PriorAuthStatus, string> = {
  draft: 'bg-secondary-100 text-secondary-700',
  submitted: 'bg-blue-100 text-blue-700',
  pending: 'bg-blue-100 text-blue-700',
  needs_info: 'bg-yellow-100 text-yellow-700',
  peer_to_peer: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-700',
  denied: 'bg-red-100 text-red-700',
  appeal: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-secondary-100 text-secondary-500',
};

const POLICY_CLASSES: Record<PolicyStatus, string> = {
  active: 'bg-green-100 text-green-700',
  pending_review: 'bg-yellow-100 text-yellow-700',
  stale: 'bg-orange-100 text-orange-700',
  broken: 'bg-red-100 text-red-700',
  no_public_policy: 'bg-secondary-100 text-secondary-500',
};

export const PaStatusBadge: React.FC<{ status: PriorAuthStatus }> = ({ status }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PA_CLASSES[status]}`}>
    {PRIOR_AUTH_STATUS_LABEL[status]}
  </span>
);

export const PolicyStatusBadge: React.FC<{ status: PolicyStatus }> = ({ status }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${POLICY_CLASSES[status]}`}>
    {POLICY_STATUS_LABEL[status]}
  </span>
);
