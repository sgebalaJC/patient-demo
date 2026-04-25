import React from 'react';
import { AlertTriangle, CheckCircle2, Clock, X } from 'lucide-react';

export type ChipState =
  | { tone: 'pending'; label: string; detail?: string }
  | { tone: 'success'; label: string; detail?: string }
  | { tone: 'warning'; label: string; detail?: string }
  | { tone: 'error'; label: string; detail?: string };

const CHIP_TONE: Record<ChipState['tone'], string> = {
  pending: 'bg-secondary-500/10 text-secondary-600 dark:text-secondary-400 border-secondary-500/30',
  success: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  error: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
};

const CHIP_ICON: Record<ChipState['tone'], React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: X,
};

interface FaxStatusChipProps {
  label: string;
  state: ChipState;
}

export const FaxStatusChip: React.FC<FaxStatusChipProps> = ({ label, state }) => {
  const Icon = CHIP_ICON[state.tone];
  return (
    <div className={`rounded-lg border px-3 py-2 ${CHIP_TONE[state.tone]}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="flex items-center gap-2 mt-1">
        <Icon className="w-4 h-4 flex-shrink-0" />
        <div className="font-medium text-sm">{state.label}</div>
      </div>
      {state.detail && <div className="text-xs opacity-80 mt-0.5 ml-6">{state.detail}</div>}
    </div>
  );
};

export type FaxRowStatus = 'pending' | 'processing' | 'needs_review' | 'completed' | 'failed';

export interface FaxStatusBadgeConfig {
  label: string;
  className: string;
  icon: React.ComponentType<{ className?: string }>;
}

import { Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Outbound fax status (separate from inbound row status above) — used by the
// AdminSendFaxPage history list. SignalWire returns a free-form `status`
// string; we collapse it to a tone for the small pill.
// ---------------------------------------------------------------------------

const OUTBOUND_TERMINAL_OK = new Set(['delivered']);
const OUTBOUND_TERMINAL_BAD = new Set(['failed', 'no-answer', 'busy', 'canceled']);

export type OutboundFaxTone = 'pending' | 'success' | 'error';

export function outboundFaxTone(status: string): OutboundFaxTone {
  if (OUTBOUND_TERMINAL_OK.has(status)) return 'success';
  if (OUTBOUND_TERMINAL_BAD.has(status)) return 'error';
  return 'pending';
}

export const OUTBOUND_FAX_TONE_CLASS: Record<OutboundFaxTone, string> = {
  pending: 'bg-secondary-100 text-secondary-700 border-secondary-200',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  error: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const OUTBOUND_FAX_TONE_ICON: Record<OutboundFaxTone, React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  success: CheckCircle2,
  error: AlertTriangle,
};

export const FAX_STATUS_BADGE: Record<FaxRowStatus, FaxStatusBadgeConfig> = {
  pending: {
    label: 'Pending',
    className: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    icon: Clock,
  },
  processing: {
    label: 'Processing',
    className: 'bg-primary-500/15 text-primary-700 dark:text-primary-300 border-primary-500/30',
    icon: Loader2,
  },
  needs_review: {
    label: 'Needs Review',
    className: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
    icon: AlertTriangle,
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    icon: CheckCircle2,
  },
  failed: {
    label: 'Failed',
    className: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
    icon: X,
  },
};
