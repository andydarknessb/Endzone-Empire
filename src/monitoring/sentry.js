import * as Sentry from '@sentry/react';

export function initializeSentry() {
  const dsn = process.env.REACT_APP_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.REACT_APP_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.REACT_APP_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: Number(process.env.REACT_APP_SENTRY_TRACES_SAMPLE_RATE || 0.02),
  });
}

export function captureBrowserError(error, context = {}) {
  Sentry.withScope((scope) => {
    Object.entries(context).forEach(([key, value]) => scope.setExtra(key, value));
    Sentry.captureException(error);
  });
}
