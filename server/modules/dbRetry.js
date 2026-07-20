const TRANSIENT_CODES = new Set([
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE',
]);

const TRANSIENT_MESSAGE =
  /supavisor|pgbouncer|pool (?:is )?(?:empty|exhausted)|too many connections|connection (?:terminated|reset|refused)|timeout (?:acquiring|waiting for) (?:a )?(?:client|connection)/i;

function isTransientDatabaseError(error) {
  if (!error) return false;
  if (TRANSIENT_CODES.has(String(error.code || '').toUpperCase())) return true;
  return TRANSIENT_MESSAGE.test(String(error.message || ''));
}

async function withDatabaseRetry(operation, {
  maxAttempts = 3,
  baseDelayMs = 100,
  maxDelayMs = 1000,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
} = {}) {
  if (typeof operation !== 'function') throw new TypeError('operation must be a function');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer');
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (error.retrySafe === false || !isTransientDatabaseError(error) || attempt === maxAttempts) {
        error.databaseAttempts = attempt;
        throw error;
      }
      const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      await sleep(delay);
    }
  }
  throw lastError;
}

module.exports = { isTransientDatabaseError, withDatabaseRetry };
