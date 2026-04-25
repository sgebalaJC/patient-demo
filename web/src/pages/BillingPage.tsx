import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SkeletonList } from '../components/ui/Skeleton';
import { PageHeader } from '../components/ui/PageHeader';
import { ErrorAlert } from '../components/ui/ErrorAlert';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { AlertTriangle } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { subscriptionOperations } from '../lib/firestore/subscriptions';
import type { SubscriptionPlan, PatientSubscription } from '../types';
import { BRANDING } from '../config/branding';
import { formatCurrency } from '../lib/date-helpers';
import { safeExternalRedirect } from '../lib/external-redirect';
import { useSupportEmail } from '../hooks/useSupportEmail';
import { CreditCard, CheckCircle, XCircle } from 'lucide-react';
import { getPatientSubscriptionStatusBadge } from '../lib/status-helpers';

export const BillingPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const supportEmail = useSupportEmail();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscription, setSubscription] = useState<PatientSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelConfirmText, setCancelConfirmText] = useState('');

  useEffect(() => {
    if (!user) return;
    loadData();
    const unsub = subscriptionOperations.watchPatientSubscription(user.uid, setSubscription);
    return () => unsub();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    const [plansRes, subRes] = await Promise.all([
      subscriptionOperations.listPlans({ activeOnly: true }),
      user ? subscriptionOperations.getPatientSubscription(user.uid) : Promise.resolve({ success: true, data: null as PatientSubscription | null }),
    ]);
    if (plansRes.success && plansRes.data) setPlans(plansRes.data);
    if (subRes.success && subRes.data) setSubscription(subRes.data);
    setLoading(false);
  };

  const handleSubscribe = async (priceId: string) => {
    if (!user) return;
    setActionLoading(priceId);
    setError(null);
    try {
      const createCheckoutSession = httpsCallable<
        { priceId: string; successUrl: string; cancelUrl: string },
        { url: string }
      >(functions, 'createCheckoutSession');
      const origin = window.location.origin;
      const res = await createCheckoutSession({
        priceId,
        successUrl: `${origin}/billing?status=success`,
        cancelUrl: `${origin}/billing?status=cancelled`,
      });
      if (res.data?.url) {
        safeExternalRedirect(res.data.url);
      } else {
        setError('Could not start checkout.');
      }
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : null) || 'Could not start checkout.');
    } finally {
      setActionLoading(null);
    }
  };

  const closeCancelModal = () => {
    setCancelConfirmOpen(false);
    setCancelConfirmText('');
  };

  const handleCancel = async () => {
    if (!user) return;
    closeCancelModal();
    setActionLoading('cancel');
    setError(null);
    try {
      const cancelSubscription = httpsCallable(functions, 'cancelSubscription');
      await cancelSubscription({});
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : null) || 'Could not cancel subscription.');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <div className="space-y-6"><SkeletonList rows={3} leading="icon" /></div>;
  if (!userProfile) return null;

  const activeSub =
    subscription && ['active', 'trialing', 'past_due'].includes(subscription.status)
      ? subscription
      : null;
  const currentPlan = activeSub?.priceId ? plans.find((p) => p.id === activeSub.priceId) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/dashboard"
        icon={CreditCard}
        title="Membership"
        subtitle={`Manage your ${BRANDING.shortName} membership subscription.`}
      />

      {error && <ErrorAlert message={error} />}

      {activeSub && (
        <Card>
          <div className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-secondary-900">Current membership</h3>
                {currentPlan && (
                  <p className="text-sm text-secondary-500 mt-1">
                    {currentPlan.name} — {formatCurrency(currentPlan.amount, currentPlan.currency)} / {currentPlan.interval}
                  </p>
                )}
                {(() => {
                  const badge = getPatientSubscriptionStatusBadge(activeSub.status);
                  return (
                    <span className={`inline-block mt-2 text-xs px-2 py-1 rounded ${badge.classes}`}>
                      {badge.label}
                    </span>
                  );
                })()}
                {activeSub.cancelAtPeriodEnd && activeSub.cancelAt && (
                  <p className="text-sm text-amber-700 mt-2">
                    Will cancel on {new Date(activeSub.cancelAt * 1000).toLocaleDateString()}.
                  </p>
                )}
                {!activeSub.cancelAtPeriodEnd && activeSub.currentPeriodEnd && (
                  <p className="text-sm text-secondary-500 mt-2">
                    Renews on {new Date(activeSub.currentPeriodEnd * 1000).toLocaleDateString()}.
                  </p>
                )}
              </div>
              {!activeSub.cancelAtPeriodEnd && (
                <Button
                  variant="secondary"
                  onClick={() => setCancelConfirmOpen(true)}
                  loading={actionLoading === 'cancel'}
                  className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Cancel membership
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {!activeSub && (
        plans.length === 0 ? (
          <Card>
            <div className="p-6 text-center">
              <h3 className="text-lg font-semibold text-secondary-900 mb-2">
                No plans available yet
              </h3>
              <p className="text-sm text-secondary-500">
                Membership plans are not yet configured. Please check back later or contact{' '}
                <a className="text-primary-600" href={`mailto:${supportEmail}`}>
                  {supportEmail}
                </a>
                .
              </p>
            </div>
          </Card>
        ) : (
          <div>
            <h3 className="text-lg font-semibold text-secondary-900 mb-4">Choose a membership</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => (
                <Card key={plan.id}>
                  <div className="p-6 flex flex-col h-full">
                    <h4 className="text-lg font-semibold text-secondary-900">{plan.name}</h4>
                    {plan.description && (
                      <p className="text-sm text-secondary-500 mt-1">{plan.description}</p>
                    )}
                    <div className="my-4">
                      <span className="text-3xl font-bold text-secondary-900">
                        {formatCurrency(plan.amount, plan.currency)}
                      </span>
                      <span className="text-secondary-500 text-sm"> / {plan.interval}</span>
                    </div>
                    {plan.features && plan.features.length > 0 && (
                      <ul className="space-y-2 mb-6 text-sm text-secondary-600">
                        {plan.features.map((feature, i) => (
                          <li key={i} className="flex items-start">
                            <CheckCircle className="h-4 w-4 text-primary-600 mr-2 mt-0.5 flex-shrink-0" />
                            {feature}
                          </li>
                        ))}
                      </ul>
                    )}
                    <Button
                      className="mt-auto"
                      variant="primary"
                      onClick={() => handleSubscribe(plan.id)}
                      loading={actionLoading === plan.id}
                    >
                      Subscribe
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )
      )}

      <Modal
        isOpen={cancelConfirmOpen}
        onClose={closeCancelModal}
        title="Cancel membership"
        icon={<div className="bg-red-100 p-2 rounded-lg"><AlertTriangle className="h-6 w-6 text-red-600" /></div>}
        maxWidth="max-w-md"
      >
        <div className="p-6 space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800">
              Your membership will end on the next renewal date. You'll keep access until then, but
              you won't be charged again.
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
              disabled={actionLoading === 'cancel'}
            >
              Keep membership
            </Button>
            <Button
              size="md"
              onClick={handleCancel}
              disabled={cancelConfirmText !== 'CANCEL' || actionLoading === 'cancel'}
              loading={actionLoading === 'cancel'}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <XCircle className="h-4 w-4 mr-2" />
              Cancel membership
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
