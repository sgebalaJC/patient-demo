/**
 * Module-level alert / confirm API. Drop-in replacement for native
 * `window.alert` / `window.confirm` with a branded modal. Works from
 * any async function (not just React components) because the GlobalModals
 * provider registers the render hooks with this module on mount.
 *
 * Usage:
 *   import { alert, confirm } from 'lib/modals';
 *   await alert({ title: 'Error', message: 'Delete failed' });
 *   const ok = await confirm({ title: 'Delete?', message: '...', variant: 'danger' });
 */

export interface AlertArgs {
  title?: string;
  message: string;
  tone?: 'info' | 'error' | 'success' | 'warning';
}

export interface ConfirmArgs {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
}

type AlertFn = (args: AlertArgs) => Promise<void>;
type ConfirmFn = (args: ConfirmArgs) => Promise<boolean>;

let _alert: AlertFn = async ({ message }) => {
  // Fallback before provider mounts (shouldn't fire in practice).
  // eslint-disable-next-line no-console
  console.warn('[modals] alert called before GlobalModals mounted:', message);
};

let _confirm: ConfirmFn = async ({ message }) => {
  // eslint-disable-next-line no-console
  console.warn('[modals] confirm called before GlobalModals mounted:', message);
  return false;
};

export function registerModals(fns: { alert: AlertFn; confirm: ConfirmFn }): void {
  _alert = fns.alert;
  _confirm = fns.confirm;
}

export function alert(args: AlertArgs): Promise<void> {
  return _alert(args);
}

export function confirm(args: ConfirmArgs): Promise<boolean> {
  return _confirm(args);
}
