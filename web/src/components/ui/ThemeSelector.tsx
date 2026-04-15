import React, { useState } from 'react';
import { Moon, Sun } from 'lucide-react';

type ThemeId = 'classic' | 'dark';

const STORAGE_KEY = 'patient-theme';

function applyTheme(id: ThemeId) {
  if (id === 'classic') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', id);
  }
}

function getSavedTheme(): ThemeId {
  return (localStorage.getItem(STORAGE_KEY) as ThemeId) || 'classic';
}

export function initTheme() {
  applyTheme(getSavedTheme());
}

interface ThemeToggleProps {
  className?: string;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '' }) => {
  const [current, setCurrent] = useState<ThemeId>(getSavedTheme);

  const toggle = () => {
    const next: ThemeId = current === 'dark' ? 'classic' : 'dark';
    setCurrent(next);
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  };

  const isDark = current === 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      className={className}
      style={{ color: 'var(--shell-text)' }}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
};
