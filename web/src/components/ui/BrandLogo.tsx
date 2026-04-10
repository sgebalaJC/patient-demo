import React, { useState, useEffect } from 'react';
import { BRANDING } from '../../config/branding';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'h-8',
  md: 'h-10',
  lg: 'h-12',
};

function getTheme(): string {
  return document.documentElement.getAttribute('data-theme') || 'classic';
}

function useThemeLogo() {
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(getTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return theme === 'dark' ? BRANDING.logos.fullDark : BRANDING.logos.full;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  className = '',
}) => {
  const src = useThemeLogo();
  return (
    <img
      src={src}
      alt={BRANDING.logos.alt}
      className={`${sizeMap[size]} w-auto ${className}`}
    />
  );
};

export const BrandTextLogo: React.FC<{ className?: string }> = ({
  className = '',
}) => {
  const src = useThemeLogo();
  return (
    <img
      src={src}
      alt={BRANDING.logos.alt}
      className={`h-10 w-auto ${className}`}
    />
  );
};
