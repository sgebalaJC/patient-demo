import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { PageHeader } from '../components/ui/PageHeader';
import { useAuth } from '../hooks/useAuth';
import { subscriptionOperations } from '../lib/firestore/subscriptions';
import type { SubscriptionPlan } from '../types';
import { CreditCard, Plus, Trash2, Save, CheckCircle } from 'lucide-react';
import logger from '../lib/logger';

type PlanDraft = Omit<SubscriptionPlan, 'createdAt' | 'updatedAt'>;

const emptyPlan = (): PlanDraft => ({
  id: '',
  name: '',
  description: '',
  amount: 0,
  currency: 'usd',
  interval: 'month',
  active: true,
  features: [],
});

export const AdminSubscriptionPlansPage: React.FC = () => {
  const { userProfile, loading: authLoading } = useAuth();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<PlanDraft>(emptyPlan());
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (userProfile?.role === 'admin') loadPlans();
  }, [userProfile]);

  const loadPlans = async () => {
    setLoading(true);
    const res = await subscriptionOperations.listPlans();
    if (res.success && res.data) {
      setPlans(res.data);
    } else if (!res.success) {
      logger.error('Failed to load plans:', res.error);
    }
    setLoading(false);
  };

  const handleEdit = (plan: SubscriptionPlan) => {
    setDraft({
      id: plan.id,
      name: plan.name,
      description: plan.description || '',
      amount: plan.amount,
      currency: plan.currency,
      interval: plan.interval,
      active: plan.active,
      features: plan.features || [],
    });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!draft.id || !draft.name) return;
    setSaving(true);
    const res = await subscriptionOperations.upsertPlan(draft);
    if (res.success) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      setDraft(emptyPlan());
      setEditing(false);
      await loadPlans();
    }
    setSaving(false);
  };

  const handleDelete = async (priceId: string) => {
    const res = await subscriptionOperations.deletePlan(priceId);
    if (res.success) await loadPlans();
  };

  const handleFeatureChange = (index: number, value: string) => {
    const features = [...(draft.features || [])];
    features[index] = value;
    setDraft({ ...draft, features });
  };

  const addFeature = () => {
    setDraft({ ...draft, features: [...(draft.features || []), ''] });
  };

  const removeFeature = (index: number) => {
    const features = [...(draft.features || [])];
    features.splice(index, 1);
    setDraft({ ...draft, features });
  };

  if (authLoading || loading) return <LoadingSpinner />;
  if (userProfile?.role !== 'admin') return <AccessDenied />;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <PageHeader
        backTo="/admin"
        icon={CreditCard}
        title="Subscription Plans"
        subtitle="Manage membership plans that patients can subscribe to via Stripe."
      />

      <Card className="mt-6">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-secondary-900 mb-4">
            {editing ? 'Edit plan' : 'Add a new plan'}
          </h3>

          <div className="space-y-4">
            <Input
              label="Stripe Price ID"
              placeholder="price_1AbCdEfGhIjKlMn"
              value={draft.id}
              onChange={(e) => setDraft({ ...draft, id: e.target.value })}
              disabled={editing}
              helperText="Copy from Stripe dashboard → Products → Prices. Document id = price id."
            />
            <Input
              label="Plan name"
              placeholder="Concierge Monthly"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <Input
              label="Description"
              placeholder="Unlimited visits, 24/7 messaging"
              value={draft.description || ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
            <div className="grid grid-cols-3 gap-4">
              <Input
                label="Amount (cents)"
                type="number"
                placeholder="9900"
                value={String(draft.amount)}
                onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) || 0 })}
                helperText="e.g. 9900 = $99.00"
              />
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-1">Currency</label>
                <select
                  value={draft.currency}
                  onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                  className="input w-full"
                >
                  <option value="usd">USD</option>
                  <option value="eur">EUR</option>
                  <option value="gbp">GBP</option>
                  <option value="cad">CAD</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-secondary-700 mb-1">Interval</label>
                <select
                  value={draft.interval}
                  onChange={(e) => setDraft({ ...draft, interval: e.target.value as any })}
                  className="input w-full"
                >
                  <option value="month">Monthly</option>
                  <option value="year">Yearly</option>
                  <option value="week">Weekly</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-2">Features</label>
              <div className="space-y-2">
                {(draft.features || []).map((feature, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      className="input flex-1"
                      value={feature}
                      onChange={(e) => handleFeatureChange(i, e.target.value)}
                      placeholder="e.g. Unlimited office visits"
                    />
                    <button
                      onClick={() => removeFeature(i)}
                      className="p-2 text-secondary-400 hover:text-red-500"
                      aria-label="Remove feature"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addFeature}
                  className="text-sm text-primary-600 hover:text-primary-700 flex items-center"
                >
                  <Plus className="h-4 w-4 mr-1" /> Add feature
                </button>
              </div>
            </div>

            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                className="rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-secondary-700">Active (patients can subscribe)</span>
            </label>

            <div className="flex items-center space-x-3">
              <Button onClick={handleSave} disabled={saving || !draft.id || !draft.name} variant="primary">
                <Save className="h-4 w-4 mr-2" />
                {editing ? 'Save changes' : 'Create plan'}
              </Button>
              {editing && (
                <Button
                  onClick={() => {
                    setDraft(emptyPlan());
                    setEditing(false);
                  }}
                  variant="secondary"
                >
                  Cancel
                </Button>
              )}
              {saved && (
                <span className="text-green-600 text-sm flex items-center">
                  <CheckCircle className="h-4 w-4 mr-1" /> Saved
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-secondary-900 mb-4">Existing plans</h3>
          {plans.length === 0 ? (
            <p className="text-sm text-secondary-500">
              No plans yet. Create one above. Make sure you've already set up matching products in your Stripe
              dashboard first.
            </p>
          ) : (
            <div className="space-y-3">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className="flex items-center justify-between p-4 border border-secondary-200 rounded-lg"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <h4 className="font-medium text-secondary-900">{plan.name}</h4>
                      {plan.active ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Active</span>
                      ) : (
                        <span className="text-xs bg-secondary-100 text-secondary-600 px-2 py-0.5 rounded">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-secondary-500 mt-1">
                      {(plan.amount / 100).toLocaleString(undefined, {
                        style: 'currency',
                        currency: plan.currency,
                      })}{' '}
                      / {plan.interval}
                      {plan.description ? ` — ${plan.description}` : ''}
                    </p>
                    <p className="text-xs text-secondary-400 mt-1 font-mono">{plan.id}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button onClick={() => handleEdit(plan)} variant="secondary">
                      Edit
                    </Button>
                    <button
                      onClick={() => handleDelete(plan.id)}
                      className="p-2 text-secondary-400 hover:text-red-500"
                      aria-label="Delete plan"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};
