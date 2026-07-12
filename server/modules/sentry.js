/**
 * Optional Sentry error reporting. `@sentry/node` is NOT an installed
 * dependency — this module only attempts to require() it when SENTRY_DSN
 * is configured, and swallows any failure (missing package, bad DSN, etc.)
 * so the app behaves identically with or without Sentry available.
 */

let sentry = null;

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
  if (!sentry || typeof sentry.captureException !== 'function') return;
  try {
    sentry.captureException(err);
  } catch (captureErr) {
    console.error('Sentry captureException failed:', captureErr.message);
  }
}

module.exports = { initSentry, captureError };
