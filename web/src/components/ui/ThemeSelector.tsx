import React, { useState, useEffect } from 'react';
import { Palette } from 'lucide-react';
import { BRANDING } from '../../config/branding';

const THEMES = [
  { id: 'classic', label: 'Classic', primary: '#2563eb', secondary: '#64748b' },
  { id: 'brand', label: BRANDING.shortName, primary: BRANDING.colors.primary, secondary: BRANDING.colors.secondary },
  { id: 'dark', label: 'Dark', primary: '#14b8a6', secondary: '#334155' },
] as const;

type ThemeId = typeof THEMES[number]['id'];

const STORAGE_KEY = 'patient-theme';

function applyFavicon() {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) {
    link.type = 'image/png';
    link.href = '/favicon.png';
  }
}

function applyTheme(id: ThemeId) {
  if (id === 'classic') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', id);
  }
  applyFavicon();
}

function getSavedTheme(): ThemeId {
  return (localStorage.getItem(STORAGE_KEY) as ThemeId) || 'classic';
}

export function initTheme() {
  applyTheme(getSavedTheme());
}

export const ThemeSelector: React.FC = () => {
  const [current, setCurrent] = useState<ThemeId>(getSavedTheme);

  useEffect(() => {
    applyTheme(current);
  }, [current]);

  const handleSelect = (id: ThemeId) => {
    setCurrent(id);
    localStorage.setItem(STORAGE_KEY, id);
    applyTheme(id);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center space-x-2 text-sm font-medium text-secondary-700">
        <Palette className="h-4 w-4" />
        <span>Theme</span>
      </div>
      <div className="flex space-x-3">
        {THEMES.map((theme) => {
          const selected = current === theme.id;
          return (
            <button
              key={theme.id}
              onClick={() => handleSelect(theme.id)}
              className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl border-2 transition-all ${
                selected
                  ? 'border-primary-600 bg-primary-50 shadow-sm'
                  : 'border-secondary-200 bg-surface-card hover:border-secondary-300'
              }`}
            >
              <div className="flex -space-x-1">
                <div
                  className="w-5 h-5 rounded-full border-2 border-secondary-200 shadow-sm"
                  style={{ backgroundColor: theme.primary }}
                />
                <div
                  className="w-5 h-5 rounded-full border-2 border-secondary-200 shadow-sm"
                  style={{ backgroundColor: theme.secondary }}
                />
              </div>
              <span className={`text-sm font-medium ${selected ? 'text-primary-700' : 'text-secondary-600'}`}>
                {theme.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
