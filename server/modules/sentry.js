const { logger } = require('./logger');

let sentry = null;
let errorCount = 0;
let lastErrorAt = null;
let lastErrorMessage = null;

function initSentry() {
  if (!process.env.SENTRY_DSN) return;
  try {
    sentry = require('@sentry/node');
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

function captureError(error, context = {}) {
  errorCount += 1;
  lastErrorAt = new Date().toISOString();
  lastErrorMessage = error?.message ? String(error.message).slice(0, 200) : null;
  if (!sentry || typeof sentry.captureException !== 'function') return;
  sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) scope.setExtra(key, value);
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
