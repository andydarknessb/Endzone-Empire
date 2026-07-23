const crypto = require('crypto');
const { logger } = require('./logger');

/**
 * Structured request logging: one JSON line per request, emitted on
 * `finish` so the real status code and duration are known. Restricted to
 * /api/* traffic — static asset / SPA fallback requests are noise we don't
 * need in the log stream.
 */

/** True for paths we want to log (API traffic); false for static assets. */
function shouldLog(path) {
  return typeof path === 'string' && path.startsWith('/api');
}

/**
 * Pure line formatter, kept free of req/res so it's unit-testable.
 * `info` is a plain object (not a real Express request) with just the
 * fields we need: { method, path, userId }.
 *
 * @param {{ method: string, path: string, userId?: number|string|null }} info
 * @param {number} status - response status code
 * @param {number} ms - request duration in milliseconds
 * @returns {string} a single JSON line
 */
function formatLine(info, status, ms) {
  return JSON.stringify({
    time: new Date().toISOString(),
    method: info.method,
    path: info.path,
    status,
    ms,
    userId: info.userId ?? null,
    requestId: info.requestId ?? null,
  });
}

/** Express middleware: logs one JSON line per /api request on finish. */
function requestLogMiddleware(req, res, next) {
  const suppliedId = req.get('x-request-id');
  req.id = suppliedId && /^[a-zA-Z0-9._-]{8,100}$/.test(suppliedId)
    ? suppliedId
    : crypto.randomUUID();
  res.set('X-Request-ID', req.id);
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const path = req.path;
    if (!shouldLog(path)) return;
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const line = formatLine(
      { method: req.method, path, userId: req.user?.id, requestId: req.id },
      res.statusCode,
      Math.round(ms)
    );
    logger.info(JSON.parse(line), 'request completed');
  });
  next();
}

module.exports = { requestLogMiddleware, formatLine, shouldLog };
