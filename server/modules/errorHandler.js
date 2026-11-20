const { logger } = require('./logger');
const { captureError } = require('./sentry');

// Postgres refuses an id past integer range (22003) or one that is not an
// integer at all (22P02): the caller sent that value, so it is a 400, not a fault.
const BAD_INPUT_SQLSTATES = new Set(['22003', '22P02']);

// The API's last error middleware (server.js mounts it after every route).
function handleUnhandledError(err, req, res, next) {
  logger.error({ err, requestId: req.id }, 'unhandled request error');
  captureError(err, { requestId: req.id });
  if (res.headersSent) return next(err);
  if (BAD_INPUT_SQLSTATES.has(err.code)) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'Invalid input', requestId: req.id });
  }
  return res.status(err.statusCode || 500).json({
    code: err.code || 'INTERNAL_ERROR',
    message: err.statusCode ? err.message : 'Internal server error',
    requestId: req.id,
  });
}

module.exports = { handleUnhandledError };
