import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { Button } from './Button';
import { ModalOverlay } from './ModalOverlay';
import { ConfirmModal } from './ConfirmModal';
import { registerModals, type AlertArgs, type ConfirmArgs } from '../../lib/modals';

/**
 * Mount once near the app root. Wires the module-level `alert()` /
 * `confirm()` API in `lib/modals` to the actual modal components, so any
 * async code in the app can `await alert(...)` / `await confirm(...)`
 * without threading a hook through.
 */
export const GlobalModals: React.FC = () => {
  const [alertState, setAlertState] = useState<
    ({ id: number; resolve: () => void } & AlertArgs) | null
  >(null);
  const [confirmState, setConfirmState] = useState<
    ({ id: number; resolve: (ok: boolean) => void } & ConfirmArgs) | null
  >(null);
  const nextId = useRef(1);

  useEffect(() => {
    registerModals({
      alert: (args) =>
        new Promise<void>((resolve) => {
          setAlertState({ id: nextId.current++, resolve, ...args });
        }),
      confirm: (args) =>
        new Promise<boolean>((resolve) => {
          setConfirmState({ id: nextId.current++, resolve, ...args });
        }),
    });
  }, []);

  const closeAlert = () => {
    if (!alertState) return;
    alertState.resolve();
    setAlertState(null);
  };

  const resolveConfirm = (ok: boolean) => {
    if (!confirmState) return;
    confirmState.resolve(ok);
    setConfirmState(null);
  };

  return (
    <>
      {alertState && (
        <ModalOverlay isOpen>
          <div className="bg-surface-card rounded-xl max-w-md w-full shadow-xl">
            <div className="p-6">
              <div className="flex items-start space-x-4">
                <div className={`flex-shrink-0 p-2 rounded-lg ${toneStyles[alertState.tone ?? 'info'].icon}`}>
                  {React.createElement(toneStyles[alertState.tone ?? 'info'].Icon, { className: 'h-5 w-5' })}
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-secondary-900">
                    {alertState.title || toneStyles[alertState.tone ?? 'info'].defaultTitle}
                  </h3>
                  <p className="mt-2 text-sm text-secondary-600 whitespace-pre-wrap">
                    {alertState.message}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end px-6 py-4 bg-secondary-50 rounded-b-xl border-t border-secondary-100">
              <Button onClick={closeAlert}>OK</Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {confirmState && (
        <ConfirmModal
          isOpen
          onClose={() => resolveConfirm(false)}
          onConfirm={() => resolveConfirm(true)}
          title={confirmState.title || 'Confirm'}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          cancelLabel={confirmState.cancelLabel}
          variant={confirmState.variant === 'primary' ? 'info' : confirmState.variant}
        />
      )}
    </>
  );
};

const toneStyles = {
  info: {
    Icon: Info,
    icon: 'bg-primary-100 text-primary-600',
    defaultTitle: 'Notice',
  },
  error: {
    Icon: AlertCircle,
    icon: 'bg-red-100 text-red-600',
    defaultTitle: 'Error',
  },
  warning: {
    Icon: AlertTriangle,
    icon: 'bg-yellow-100 text-yellow-600',
    defaultTitle: 'Warning',
  },
  success: {
    Icon: CheckCircle2,
    icon: 'bg-green-100 text-green-600',
    defaultTitle: 'Success',
  },
} as const;
