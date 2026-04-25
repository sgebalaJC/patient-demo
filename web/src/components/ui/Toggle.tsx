import React from 'react';

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible label for screen readers when no visible label is provided. */
  ariaLabel?: string;
}

/**
 * Tailwind switch built on a hidden checkbox + peer styles. Used wherever
 * the admin UI needs an on/off toggle (settings, integrations) — replaces
 * the inline `peer-checked:after:translate-x-full ...` chains that were
 * copy-pasted across pages.
 */
export const Toggle: React.FC<ToggleProps> = ({ checked, onChange, disabled, ariaLabel }) => (
  <label className={`relative inline-flex items-center flex-shrink-0 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={ariaLabel}
      className="sr-only peer"
    />
    <div className="w-11 h-6 bg-secondary-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-secondary-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600" />
  </label>
);
