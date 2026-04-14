import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functionsCentral } from '../lib/firebase';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { PageHeader } from '../components/ui/PageHeader';
import { ErrorAlert } from '../components/ui/ErrorAlert';
import { useAuth } from '../hooks/useAuth';
import { subscriptionOperations } from '../lib/firestore/subscriptions';
import type { SubscriptionPlan, PatientSubscription } from '../types';
import { BRANDING } from '../config/branding';
import { CreditCard, CheckCircle, XCircle } from 'lucide-react';

const statusLabels: Record<string, { label: string; color: string }> = {
  active: { label: 'Active', color: 'bg-green-100 text-green-700' },
  trialing: { label: 'Trialing', color: 'bg-blue-100 text-blue-700' },
  past_due: { label: 'Past due', color: 'bg-amber-100 text-amber-700' },
  canceled: { label: 'Cancelled', color: 'bg-secondary-100 text-secondary-600' },
  incomplete: { label: 'Incomplete', color: 'bg-amber-100 text-amber-700' },
};

export const BillingPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscription, setSubscription] = useState<PatientSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      >(functionsCentral, 'createCheckoutSession');
      const origin = window.location.origin;
      const res = await createCheckoutSession({
        priceId,
        successUrl: `${origin}/billing?status=success`,
        cancelUrl: `${origin}/billing?status=cancelled`,
      });
      if (res.data?.url) {
        window.location.href = res.data.url;
      } else {
        setError('Could not start checkout.');
      }
    } catch (err: any) {
      setError(err.message || 'Could not start checkout.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!user) return;
    const confirmed = window.confirm(
      'Cancel your subscription at the end of the current period? You will keep access until then.',
    );
    if (!confirmed) return;
    setActionLoading('cancel');
    setError(null);
    try {
      const cancelSubscription = httpsCallable(functionsCentral, 'cancelSubscription');
      await cancelSubscription({});
    } catch (err: any) {
      setError(err.message || 'Could not cancel subscription.');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!userProfile) return null;

  const activeSub =
    subscription && ['active', 'trialing', 'past_due'].includes(subscription.status)
      ? subscription
      : null;
  const currentPlan = activeSub?.priceId ? plans.find((p) => p.id === activeSub.priceId) : null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <PageHeader
        backTo="/dashboard"
        icon={CreditCard}
        title="Membership & Billing"
        subtitle={`Manage your ${BRANDING.shortName} membership subscription.`}
      />

      {error && (
        <div className="mt-6">
          <ErrorAlert message={error} />
        </div>
      )}

      {activeSub && (
        <Card className="mt-6">
          <div className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-secondary-900">Current membership</h3>
                {currentPlan && (
                  <p className="text-sm text-secondary-500 mt-1">
                    {currentPlan.name} —{' '}
                    {(currentPlan.amount / 100).toLocaleString(undefined, {
                      style: 'currency',
                      currency: currentPlan.currency,
                    })}{' '}
                    / {currentPlan.interval}
                  </p>
                )}
                <span
                  className={`inline-block mt-2 text-xs px-2 py-1 rounded ${
                    statusLabels[activeSub.status]?.color || 'bg-secondary-100 text-secondary-600'
                  }`}
                >
                  {statusLabels[activeSub.status]?.label || activeSub.status}
                </span>
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
                  onClick={handleCancel}
                  loading={actionLoading === 'cancel'}
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
        <div className="mt-6">
          <h3 className="text-lg font-semibold text-secondary-900 mb-4">
            {plans.length === 0 ? 'No plans available yet' : 'Choose a membership'}
          </h3>
          {plans.length === 0 ? (
            <Card>
              <div className="p-6 text-center text-sm text-secondary-500">
                Membership plans are not yet configured. Please check back later or contact{' '}
                <a className="text-primary-600" href={`mailto:${BRANDING.supportEmail}`}>
                  {BRANDING.supportEmail}
                </a>
                .
              </div>
            </Card>
          ) : (
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
                        {(plan.amount / 100).toLocaleString(undefined, {
                          style: 'currency',
                          currency: plan.currency,
                        })}
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
          )}
        </div>
      )}
    </div>
  );
};
