/**
 * Hard-coded allowlist for `window.location.href = ...` redirects to
 * server-issued external URLs (Stripe Checkout, Stripe Customer Portal,
 * Google OAuth consent, EHR OAuth flows). The URLs come from Cloud
 * Functions, so the practical risk is "Cloud Function compromised", but
 * the allowlist makes the trust boundary explicit and prevents accidents
 * (e.g. an EHR adapter returning a phishing URL).
 *
 * Throws if the URL is not parseable or its hostname is not in the
 * allowlist. Same-origin redirects always pass.
 */

const ALLOWED_EXTERNAL_HOSTS: ReadonlySet<string> = new Set([
  // Stripe — Checkout + Customer Portal + their billing portal subdomain.
  'checkout.stripe.com',
  'billing.stripe.com',
  'js.stripe.com',
  // Google OAuth (admin Google Workspace integration).
  'accounts.google.com',
  // DrChrono OAuth (admin EHR integration).
  'drchrono.com',
  'app.drchrono.com',
]);

export function safeExternalRedirect(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url, window.location.href);
  } catch {
    throw new Error('Invalid redirect URL');
  }

  // Same-origin paths (e.g. `/billing?status=success`) always pass.
  if (parsed.origin === window.location.origin) {
    window.location.href = parsed.href;
    return;
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(`External redirect must use https: ${parsed.protocol}`);
  }

  if (!ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`Refusing redirect to non-allowlisted host: ${parsed.hostname}`);
  }

  window.location.href = parsed.href;
}
