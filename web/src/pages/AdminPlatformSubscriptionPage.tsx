import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CreditCard,
  Zap,
  AlertTriangle,
  CheckCircle,
  Lock,
  Receipt,
  Save,
} from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ErrorAlert } from '../components/ui/ErrorAlert';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { XCircle } from 'lucide-react';
import type { Timestamp } from 'firebase/firestore';
import { formatDate as fmtDate, formatDateTime, formatCurrency } from '../lib/date-helpers';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AdminGuard } from '../components/ui/AdminGuard';
import { AccessDenied } from '../components/ui/AccessDenied';
import { useAuth } from '../hooks/useAuth';
import { isSuperAdminEmail } from '../lib/roles';
import { usePlatformSubscription } from '../hooks/usePlatformSubscription';
import { getPlatformSubscriptionStatusBadge } from '../lib/status-helpers';
import { safeExternalRedirect } from '../lib/external-redirect';
import { errorMessage } from '../lib/errors';
import { platformStripe } from '../lib/platformStripe';
import {
  platformOperations,
  PlatformTopup,
} from '../lib/firestore/platform';
import { appSettingsOperations } from '../lib/firestore/app-settings';
import { BRANDING } from '../config/branding';

const PLAN_LABELS: Record<string, { label: string; price: string; cadence: string }> = {
  monthly: { label: 'Monthly', price: '$299', cadence: 'per month' },
  annual: { label: 'Annual', price: '$2,999', cadence: 'per year (2 months free)' },
};

// Status badge mapping moved to lib/status-helpers (centralized + exhaustive).

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(epochSeconds?: number | null): string | null {
  if (!epochSeconds) return null;
  return fmtDate(new Date(epochSeconds * 1000));
}

function formatTimestamp(ts: Timestamp | number | null | undefined): string | null {
  if (ts === null || ts === undefined) return null;
  const ms = typeof ts === 'number' ? ts : ts.toMillis();
  if (!ms) return null;
  return formatDateTime(new Date(ms));
}

function progressBarColor(pct: number): string {
  if (pct >= 100) return 'bg-red-500';
  if (pct >= 80) return 'bg-amber-500';
  return 'bg-green-500';
}

export const AdminPlatformSubscriptionPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const status = searchParams.get('status');
  const { user } = useAuth();

  const {
    subscription,
    config,
    bonus,
    usage,
    loaded,
    daysLeftInGrace,
    inGrace,
    locked,
    allowance,
    usedOutput,
    pctUsed,
    overBudget,
    enforcementOn,
  } = usePlatformSubscription();

  const [topups, setTopups] = useState<PlatformTopup[]>([]);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enforcementDraft, setEnforcementDraft] = useState(enforcementOn);
  const [enforcementSaving, setEnforcementSaving] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelConfirmText, setCancelConfirmText] = useState('');

  useEffect(() => setEnforcementDraft(enforcementOn), [enforcementOn]);

  useEffect(() => {
    const unsub = platformOperations.watchRecentTopups(setTopups);
    return () => unsub();
  }, []);

  const statusBadge = getPlatformSubscriptionStatusBadge(subscription.status);
  const planLabel = subscription.plan ? PLAN_LABELS[subscription.plan] : null;

  const handleSubscribe = async (plan: 'monthly' | 'annual') => {
    setAction(`subscribe-${plan}`);
    setError(null);
    try {
      const url = await platformStripe.startSubscriptionCheckout(plan);
      safeExternalRedirect(url);
    } catch (err: unknown) {
      setError(errorMessage(err) || 'Could not start checkout.');
      setAction(null);
    }
  };

  const handleTopup = async () => {
    setAction('topup');
    setError(null);
    try {
      const url = await platformStripe.startTopupCheckout();
      safeExternalRedirect(url);
    } catch (err: unknown) {
      setError(errorMessage(err) || 'Could not start top-up checkout.');
      setAction(null);
    }
  };

  const handlePortal = async () => {
    setAction('portal');
    setError(null);
    try {
      const url = await platformStripe.openBillingPortal();
      safeExternalRedirect(url);
    } catch (err: unknown) {
      setError(errorMessage(err) || 'Could not open billing portal.');
      setAction(null);
    }
  };

  const closeCancelModal = () => {
    setCancelConfirmOpen(false);
    setCancelConfirmText('');
  };

  const handleCancel = async () => {
    closeCancelModal();
    setAction('cancel');
    setError(null);
    try {
      await platformStripe.cancelSubscription();
    } catch (err: unknown) {
      setError(err.message || 'Could not cancel.');
    }
    setAction(null);
  };

  const handleResume = async () => {
    setAction('resume');
    setError(null);
    try {
      await platformStripe.resumeSubscription();
    } catch (err: unknown) {
      setError(err.message || 'Could not resume.');
    }
    setAction(null);
  };

  const handleSaveEnforcement = async () => {
    setEnforcementSaving(true);
    setError(null);
    const res = await appSettingsOperations.saveSettings({
      practiceSubscriptionEnforced: enforcementDraft,
    });
    if (!res.success) setError(res.error || 'Could not save enforcement setting.');
    setEnforcementSaving(false);
  };

  const renewDate = formatDate(subscription.currentPeriodEnd);
  const cancelDate = formatDate(subscription.cancelAt ?? null);

  // In demo forks, only super-admins can see platform billing — practice
  // admins on a shared demo shouldn't see the platform vendor's bill.
  if (BRANDING.isDemo && !isSuperAdminEmail(user?.email)) {
    return <AdminGuard><AccessDenied /></AdminGuard>;
  }

  return (
    <AdminGuard>
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        icon={CreditCard}
        iconColor="bg-primary-100 text-primary-600"
        title="Platform Subscription"
        subtitle={`Billed by ${BRANDING.platformVendor.name}`}
      />

      {status === 'subscribed' && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center">
          <CheckCircle className="h-4 w-4 mr-2 flex-shrink-0" />
          Subscription started. State will update in a few seconds once Stripe confirms.
        </div>
      )}
      {status === 'topup-success' && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 flex items-center">
          <CheckCircle className="h-4 w-4 mr-2 flex-shrink-0" />
          Top-up purchased. Tokens will appear in your balance within a few seconds.
        </div>
      )}
      {status === 'cancelled' && (
        <div className="p-3 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-700">
          Checkout cancelled. No changes made.
        </div>
      )}

      {error && <ErrorAlert message={error} />}

      {inGrace && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-start space-x-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium">Subscription lapsed.</p>
            <p className="mt-1">
              {daysLeftInGrace ?? 0} day{daysLeftInGrace === 1 ? '' : 's'} left before the admin
              panel is locked. Update your payment method or resume billing to restore access.
            </p>
          </div>
        </div>
      )}

      {locked && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3">
          <Lock className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">
            <p className="font-medium">Admin panel locked.</p>
            <p className="mt-1">
              The 7-day grace period has expired. Restore your subscription to unlock.
            </p>
          </div>
        </div>
      )}

      {/* Current plan */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Current plan</h2>
            <p className="text-sm text-secondary-500 mt-0.5">
              Single subscription per practice, shared across all admins.
            </p>
          </div>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusBadge.classes}`}
          >
            {statusBadge.label}
          </span>
        </div>

        {loaded ? (
          subscription.status === 'none' ? (
            <div className="space-y-4">
              <p className="text-sm text-secondary-600">
                Start a subscription to keep the platform running.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(['monthly', 'annual'] as const).map((plan) => {
                  const meta = PLAN_LABELS[plan];
                  return (
                    <div
                      key={plan}
                      className="border border-secondary-200 rounded-lg p-5 flex flex-col"
                    >
                      <p className="text-sm font-medium text-secondary-700">{meta.label}</p>
                      <p className="mt-2 text-3xl font-bold text-secondary-900">{meta.price}</p>
                      <p className="text-xs text-secondary-500">{meta.cadence}</p>
                      <div className="flex-1" />
                      <Button
                        className="mt-4"
                        onClick={() => handleSubscribe(plan)}
                        loading={action === `subscribe-${plan}`}
                        disabled={!!action}
                      >
                        Subscribe
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-secondary-500 text-xs">Plan</p>
                  <p className="font-medium text-secondary-900">
                    {planLabel ? `${planLabel.label} — ${planLabel.price}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-secondary-500 text-xs">Renews</p>
                  <p className="font-medium text-secondary-900">{renewDate ?? '—'}</p>
                </div>
                <div>
                  <p className="text-secondary-500 text-xs">Auto-renew</p>
                  <p className="font-medium text-secondary-900">
                    {subscription.cancelAtPeriodEnd ? 'Off' : 'On'}
                  </p>
                </div>
                {subscription.cancelAtPeriodEnd && cancelDate && (
                  <div>
                    <p className="text-secondary-500 text-xs">Ends</p>
                    <p className="font-medium text-secondary-900">{cancelDate}</p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  variant="secondary"
                  onClick={handlePortal}
                  loading={action === 'portal'}
                  disabled={!!action}
                  className="border-green-700 text-green-700 hover:bg-green-50"
                >
                  Manage billing
                </Button>
                {subscription.cancelAtPeriodEnd ? (
                  <Button
                    variant="secondary"
                    onClick={handleResume}
                    loading={action === 'resume'}
                    disabled={!!action}
                  >
                    Resume subscription
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={() => setCancelConfirmOpen(true)}
                    loading={action === 'cancel'}
                    disabled={!!action}
                    className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    Cancel at period end
                  </Button>
                )}
              </div>
            </div>
          )
        ) : (
          <LoadingSpinner />
        )}
      </Card>

      {/* Token usage */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="bg-primary-100 p-2 rounded-lg">
              <Zap className="h-5 w-5 text-primary-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-secondary-900">AI token usage</h2>
              <p className="text-sm text-secondary-500">
                When exhausted, the system falls back to {config.economyModel}.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={handleTopup}
            loading={action === 'topup'}
            disabled={!!action || subscription.status !== 'active'}
            className="border-green-700 text-green-700 hover:bg-green-50"
          >
            Buy $25 top-up
          </Button>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between text-sm">
            <div className="text-secondary-700">
              <span className="font-semibold">{formatTokens(usedOutput)}</span>
              <span className="text-secondary-500"> / {formatTokens(allowance)} tokens</span>
            </div>
            <div className={overBudget ? 'text-red-600 font-medium' : 'text-secondary-500'}>
              {pctUsed.toFixed(0)}%
              {overBudget && ' — on economy model'}
            </div>
          </div>
          <div className="w-full bg-secondary-100 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full ${progressBarColor(pctUsed)} transition-all`}
              style={{ width: `${Math.min(100, pctUsed)}%` }}
            />
          </div>
          <div className="grid grid-cols-3 gap-4 text-xs text-secondary-500 pt-2">
            <div>
              <p className="text-secondary-400">Monthly allowance</p>
              <p className="text-secondary-900 font-medium">
                {formatTokens(config.monthlyAllowanceTokens)}
              </p>
            </div>
            <div>
              <p className="text-secondary-400">Bonus balance</p>
              <p className="text-secondary-900 font-medium">
                {formatTokens(bonus.tokensRemaining)}
              </p>
            </div>
            <div>
              <p className="text-secondary-400">Requests this month</p>
              <p className="text-secondary-900 font-medium">{usage.requestCount}</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Enforcement */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Enforcement</h2>
            <p className="text-sm text-secondary-500 mt-0.5">
              When on, a 7-day grace banner appears after a failed payment, then the admin
              panel is locked until the subscription is restored. Patient-facing pages are
              never affected.
            </p>
          </div>
        </div>
        <label className="flex items-start space-x-3 p-4 border border-secondary-200 rounded-lg">
          <input
            type="checkbox"
            checked={enforcementDraft}
            onChange={(e) => setEnforcementDraft(e.target.checked)}
            className="mt-1"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-secondary-900">
              Lock admin panel when subscription lapses
            </p>
            <p className="text-xs text-secondary-500 mt-0.5">
              Off by default so practices can opt in.
            </p>
          </div>
        </label>
        <div className="flex justify-end pt-3">
          <Button
            size="sm"
            onClick={handleSaveEnforcement}
            loading={enforcementSaving}
            disabled={enforcementDraft === enforcementOn}
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
        </div>
      </Card>

      {/* Topup history */}
      <Card className="p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="bg-secondary-100 p-2 rounded-lg">
            <Receipt className="h-5 w-5 text-secondary-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-secondary-900">Top-up history</h2>
            <p className="text-sm text-secondary-500">Most recent first.</p>
          </div>
        </div>
        {topups.length === 0 ? (
          <p className="text-sm text-secondary-500">No top-ups purchased yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-secondary-500 border-b border-secondary-200">
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Amount</th>
                  <th className="pb-2 pr-4 font-medium">Tokens granted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {topups.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-4 text-secondary-700">
                      {formatTimestamp(t.createdAt) ?? '—'}
                    </td>
                    <td className="py-2 pr-4 text-secondary-900">
                      {formatCurrency(t.amountPaid ?? 0, t.currency || 'usd')}
                    </td>
                    <td className="py-2 pr-4 text-secondary-900">
                      {formatTokens(t.bonusTokensGranted)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={cancelConfirmOpen}
        onClose={closeCancelModal}
        title="Cancel platform subscription"
        icon={<div className="bg-red-100 p-2 rounded-lg"><AlertTriangle className="h-6 w-6 text-red-600" /></div>}
        maxWidth="max-w-md"
      >
        <div className="p-6 space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800">
              The subscription will end at the end of the current billing period. The platform will
              stop serving AI requests once the allowance runs out after that date.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-secondary-700 mb-2">
              Type <span className="font-bold">CANCEL</span> to confirm
            </label>
            <Input
              value={cancelConfirmText}
              onChange={(e) => setCancelConfirmText(e.target.value)}
              placeholder="Type CANCEL"
            />
          </div>

          <div className="flex items-center justify-end space-x-3 pt-2">
            <Button
              variant="secondary"
              size="md"
              onClick={closeCancelModal}
              disabled={action === 'cancel'}
            >
              Keep subscription
            </Button>
            <Button
              size="md"
              onClick={handleCancel}
              disabled={cancelConfirmText !== 'CANCEL' || action === 'cancel'}
              loading={action === 'cancel'}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <XCircle className="h-4 w-4 mr-2" />
              Cancel at period end
            </Button>
          </div>
        </div>
      </Modal>
    </div>
    </AdminGuard>
  );
};
