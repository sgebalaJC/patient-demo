import * as Sentry from '@sentry/react';

const isProduction = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

export const initSentry = () => {
  if (!isProduction) return;

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: isProduction ? 'production' : 'development',
    tracesSampleRate: 0.2,
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: 0,
  });
};

export { Sentry };
