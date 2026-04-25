import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  serverTimestamp,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import { collections, mapDocStrict } from './base';
import type {
  ApiResponse,
  SubscriptionPlan,
  PatientSubscription,
} from '../../types';
import logger from '../logger';
import { errorMessage } from '../errors';

export const subscriptionOperations = {
  /** List all subscription plans (admin view includes inactive). */
  async listPlans(options?: { activeOnly?: boolean }): Promise<ApiResponse<SubscriptionPlan[]>> {
    try {
      const q = query(collections.subscriptionPlans, orderBy('amount', 'asc'));
      const snap = await getDocs(q);
      let plans = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SubscriptionPlan));
      if (options?.activeOnly) {
        plans = plans.filter((p) => p.active);
      }
      return { success: true, data: plans };
    } catch (error: unknown) {
      logger.error('Error listing subscription plans:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  /**
   * Create or update a subscription plan. Document id must equal the Stripe
   * price id so the webhook handler can look plans up by priceId.
   */
  async upsertPlan(plan: Omit<SubscriptionPlan, 'createdAt' | 'updatedAt'>): Promise<ApiResponse<void>> {
    try {
      const ref = doc(collections.subscriptionPlans, plan.id);
      const existing = await getDoc(ref);
      type PlanPayload = Omit<SubscriptionPlan, 'id' | 'createdAt' | 'updatedAt'> & {
        updatedAt: ReturnType<typeof serverTimestamp>;
        createdAt?: ReturnType<typeof serverTimestamp>;
      };
      const payload: PlanPayload = {
        name: plan.name,
        description: plan.description || '',
        amount: plan.amount,
        currency: plan.currency,
        interval: plan.interval,
        active: plan.active,
        features: plan.features || [],
        updatedAt: serverTimestamp(),
      };
      if (!existing.exists()) {
        payload.createdAt = serverTimestamp();
      }
      await setDoc(ref, payload, { merge: true });
      return { success: true };
    } catch (error: unknown) {
      logger.error('Error upserting subscription plan:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  async deletePlan(priceId: string): Promise<ApiResponse<void>> {
    try {
      await deleteDoc(doc(collections.subscriptionPlans, priceId));
      return { success: true };
    } catch (error: unknown) {
      logger.error('Error deleting subscription plan:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  /** Get the current patient's subscription (if any). */
  async getPatientSubscription(uid: string): Promise<ApiResponse<PatientSubscription | null>> {
    try {
      const snap = await getDoc(doc(collections.patientSubscriptions, uid));
      const mapped = mapDocStrict<PatientSubscription>(snap, ['status'], 'patient-subscriptions');
      return { success: true, data: mapped };
    } catch (error: unknown) {
      logger.error('Error getting patient subscription:', error);
      return { success: false, error: errorMessage(error) };
    }
  },

  /** Live-subscribe to the patient's subscription state. */
  watchPatientSubscription(
    uid: string,
    callback: (sub: PatientSubscription | null) => void,
  ): Unsubscribe {
    return onSnapshot(
      doc(collections.patientSubscriptions, uid),
      (snap) => {
        callback(mapDocStrict<PatientSubscription>(snap, ['status'], 'patient-subscriptions'));
      },
      (err) => {
        logger.error('patient subscription snapshot error', err);
        callback(null);
      },
    );
  },
};

// Prevent unused import warning if db is removed later
void db;
