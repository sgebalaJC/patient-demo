/**
 * Client wrappers for the platform Stripe Cloud Functions. See
 * `functions/src/platformStripe.ts` for the server side.
 */

import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

interface UrlResult {
  url: string;
}

function adminOrigin(): string {
  return window.location.origin;
}

function returnUrls(status: string) {
  const origin = adminOrigin();
  return {
    successUrl: `${origin}/admin/platform-subscription?status=${status}`,
    cancelUrl: `${origin}/admin/platform-subscription?status=cancelled`,
  };
}

export const platformStripe = {
  async startSubscriptionCheckout(plan: 'monthly' | 'annual'): Promise<string> {
    const fn = httpsCallable<
      { plan: 'monthly' | 'annual'; successUrl: string; cancelUrl: string },
      UrlResult
    >(functions, 'createPlatformCheckoutSession');
    const res = await fn({ plan, ...returnUrls('subscribed') });
    if (!res.data?.url) throw new Error('Checkout URL missing from response.');
    return res.data.url;
  },

  async startTopupCheckout(): Promise<string> {
    const fn = httpsCallable<
      { successUrl: string; cancelUrl: string },
      UrlResult
    >(functions, 'createPlatformTopupSession');
    const res = await fn(returnUrls('topup-success'));
    if (!res.data?.url) throw new Error('Checkout URL missing from response.');
    return res.data.url;
  },

  async openBillingPortal(): Promise<string> {
    const fn = httpsCallable<{ returnUrl: string }, UrlResult>(
      functions,
      'createPlatformBillingPortalSession',
    );
    const res = await fn({
      returnUrl: `${adminOrigin()}/admin/platform-subscription`,
    });
    if (!res.data?.url) throw new Error('Billing portal URL missing.');
    return res.data.url;
  },

  async cancelSubscription(): Promise<void> {
    const fn = httpsCallable(functions, 'cancelPlatformSubscription');
    await fn({});
  },

  async resumeSubscription(): Promise<void> {
    const fn = httpsCallable(functions, 'resumePlatformSubscription');
    await fn({});
  },
};
