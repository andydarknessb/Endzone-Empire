/**
 * Optional Sentry error reporting. `@sentry/node` is NOT an installed
 * dependency — this module only attempts to require() it when SENTRY_DSN
 * is configured, and swallows any failure (missing package, bad DSN, etc.)
 * so the app behaves identically with or without Sentry available.
 */

let sentry = null;

// Local error tally so the admin dashboard has an error-rate signal even
// when Sentry itself isn't configured (Sentry has no query API to pull
// counts back from anyway).
let errorCount = 0;
let lastErrorAt = null;
let lastErrorMessage = null;

/** Call once at boot. No-ops unless SENTRY_DSN is set and the package resolves. */
function initSentry(app) {
  if (!process.env.SENTRY_DSN) return;
  try {
    // eslint-disable-next-line global-require -- conditional by design
    sentry = require('@sentry/node');
    sentry.init({ dsn: process.env.SENTRY_DSN });
    if (app && sentry.Handlers && typeof sentry.Handlers.requestHandler === 'function') {
      app.use(sentry.Handlers.requestHandler());
    }
  } catch (err) {
    console.error('Sentry init skipped (package unavailable):', err.message);
    sentry = null;
  }
}

/** Report an error to Sentry if it's available; always safe to call. */
function captureError(err) {
  errorCount += 1;
  lastErrorAt = new Date().toISOString();
  lastErrorMessage = err && err.message ? String(err.message).slice(0, 200) : null;
  if (!sentry || typeof sentry.captureException !== 'function') return;
  try {
    sentry.captureException(err);
  } catch (captureErr) {
    console.error('Sentry captureException failed:', captureErr.message);
  }
}

/** Error summary for the admin dashboard (in-process, since boot). */
function getErrorStats() {
  return {
    sentryConfigured: Boolean(sentry),
    errorsSinceBoot: errorCount,
    lastErrorAt,
    lastErrorMessage,
  };
}

module.exports = { initSentry, captureError, getErrorStats };
