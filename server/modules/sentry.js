const { logger } = require('./logger');

let sentry = null;
let errorCount = 0;
let lastErrorAt = null;
let lastErrorMessage = null;

/**
 * Initialize Sentry from SENTRY_DSN. `injectedClient` is a dependency-injection
 * seam (default: the real `@sentry/node`): a test passes a Sentry-shaped double
 * so captureError's scope handling can be asserted without a live DSN. Passing
 * null (or omitting it) with no DSN set clears the client back to its resting
 * state.
 */
function initSentry(injectedClient) {
  if (!process.env.SENTRY_DSN) {
    // No DSN: Sentry is off. Honor an explicit reset so a test can tear its
    // injected client back down.
    if (injectedClient === null) sentry = null;
    return;
  }
  try {
    sentry = injectedClient || require('@sentry/node');
    sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      release: process.env.RENDER_GIT_COMMIT || process.env.APP_RELEASE,
      sendDefaultPii: false,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.05),
    });
  } catch (error) {
    logger.error({ err: error }, 'sentry initialization failed');
    sentry = null;
    if (process.env.NODE_ENV === 'production') throw error;
  }
}

function setupSentryErrorHandler(app) {
  if (sentry && app && typeof sentry.setupExpressErrorHandler === 'function') {
    sentry.setupExpressErrorHandler(app);
  }
}

/**
 * Report an error to Sentry with `context` as scope extras. `options.fingerprint`
 * (ruling 5, #768) sets an explicit Sentry grouping fingerprint when given - it
 * is additive, so every existing two-argument caller is unchanged and never
 * needs editing. #768's captures also pass pool counters through `context`
 * (ruling 4), which land as ordinary extras below.
 */
function captureError(error, context = {}, options = {}) {
  errorCount += 1;
  lastErrorAt = new Date().toISOString();
  lastErrorMessage = error?.message ? String(error.message).slice(0, 200) : null;
  if (!sentry || typeof sentry.captureException !== 'function') return;
  sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) scope.setExtra(key, value);
    if (options.fingerprint && typeof scope.setFingerprint === 'function') {
      scope.setFingerprint(options.fingerprint);
    }
    sentry.captureException(error);
  });
}

async function flushSentry(timeoutMs = 2000) {
  if (sentry && typeof sentry.flush === 'function') await sentry.flush(timeoutMs);
}

function getErrorStats() {
  return {
    sentryConfigured: Boolean(sentry),
    errorsSinceBoot: errorCount,
    lastErrorAt,
    lastErrorMessage,
  };
}

module.exports = {
  captureError,
  flushSentry,
  getErrorStats,
  initSentry,
  setupSentryErrorHandler,
};
