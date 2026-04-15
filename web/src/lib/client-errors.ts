/**
 * Client-side error telemetry.
 *
 * Forwards `logger.warn` / `logger.error` calls plus `window.onerror` and
 * `unhandledrejection` events to the `logClientError` Cloud Function, which
 * scrubs PII and writes to Cloud Logging.
 *
 * Design constraints:
 *  - Must not recurse. A failure inside the sink (network, auth, etc.) is
 *    swallowed silently; it must never itself call `logger.error`.
 *  - Must not flood. Simple per-minute cap + de-dup of identical messages.
 *  - Must survive during development without a deployed function: errors
 *    from `httpsCallable` are swallowed, so `npm run dev` still works.
 */

import {httpsCallable} from 'firebase/functions';
import {functions} from './firebase';
import logger from './logger';

const MAX_PER_SESSION = 30;
const DEDUP_WINDOW_MS = 10_000;

// Ignore-list for well-known browser noise that isn't actionable — these
// fire on nearly every session and drown out real errors.
const NOISE_PATTERNS: RegExp[] = [
  /ResizeObserver loop/i,
  /Script error\.?$/i,                          // cross-origin throw without CORP
  /Failed to fetch dynamically imported module/i, // stale-chunk path — main.tsx reloads
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Expected a JavaScript-or-Wasm module script/i,
  /net::ERR_QUIC_PROTOCOL_ERROR/i,
  /net::ERR_NETWORK_CHANGED/i,
  /chrome-extension:\/\//i,                     // extension-injected frames
  /moz-extension:\/\//i,
];

function isNoise(message: string, stack: string): boolean {
  const s = `${message}\n${stack}`;
  return NOISE_PATTERNS.some((r) => r.test(s));
}

let initialised = false;
let inFlight = false;
let sentThisSession = 0;
const recent = new Map<string, number>();

let sendFn: ReturnType<typeof httpsCallable> | null = null;

function shouldSend(key: string, message: string, stack: string): boolean {
  if (isNoise(message, stack)) return false;
  if (sentThisSession >= MAX_PER_SESSION) return false;

  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < DEDUP_WINDOW_MS) return false;
  recent.set(key, now);

  // Keep the dedup map bounded.
  if (recent.size > 200) {
    const cutoff = now - DEDUP_WINDOW_MS;
    for (const [k, t] of recent) if (t < cutoff) recent.delete(k);
  }

  sentThisSession++;
  return true;
}

async function dispatch(payload: {
  level: 'warn' | 'error';
  message: string;
  stack: string;
  route: string;
  userAgent: string;
  context?: unknown;
}): Promise<void> {
  if (inFlight) return;  // One at a time — prevents a burst of errors during a
                         // storm from queuing indefinitely.
  inFlight = true;
  try {
    if (!sendFn) sendFn = httpsCallable(functions, 'logClientError');
    await sendFn(payload);
  } catch {
    // Intentional no-op. If the sink itself fails we must not re-enter
    // logger.error (would recurse into this function).
  } finally {
    inFlight = false;
  }
}

function findStack(args: any[]): string {
  for (const a of args) {
    if (a instanceof Error && a.stack) return a.stack;
  }
  return '';
}

function currentRoute(): string {
  try {
    return window.location.pathname + window.location.search;
  } catch {
    return '';
  }
}

export function initClientErrorReporter(): void {
  if (initialised) return;
  initialised = true;

  logger.setRemoteSink((level, message, args) => {
    const stack = findStack(args);
    const msg = String(message);
    if (!shouldSend(`${level}:${msg}`, msg, stack)) return;
    void dispatch({
      level,
      message: msg,
      stack,
      route: currentRoute(),
      userAgent: navigator.userAgent,
    });
  });

  window.addEventListener('error', (event) => {
    const message = event.message || 'window.onerror';
    const stack = event.error?.stack || '';
    if (!shouldSend(`error:${message}`, message, stack)) return;
    void dispatch({
      level: 'error',
      message,
      stack,
      route: currentRoute(),
      userAgent: navigator.userAgent,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const r: any = (event as PromiseRejectionEvent).reason;
    const message = `unhandledrejection: ${r?.message || String(r)}`;
    const stack = r?.stack || '';
    if (!shouldSend(`reject:${message}`, message, stack)) return;
    void dispatch({
      level: 'error',
      message,
      stack,
      route: currentRoute(),
      userAgent: navigator.userAgent,
    });
  });
}
