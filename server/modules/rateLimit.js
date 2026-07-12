/**
 * In-house sliding-window rate limiter (no npm dependency).
 *
 * Why: a couple of endpoints (auth in particular) need brute-force / abuse
 * protection, but pulling in a package like express-rate-limit for a single
 * in-process app is overkill. The window state lives in a plain Map keyed
 * by caller; expired hits are pruned lazily (only when that key is touched
 * again) rather than on a background timer, keeping this dependency-free
 * and simple to reason about.
 */

/**
 * Pure decision function, kept free of req/res so it's unit-testable
 * without spinning up Express. Given the shared store, a key, "now", and
 * the window/limit, decides whether to allow the request and records the
 * hit if allowed.
 *
 * @param {Map<string, number[]>} store - key -> ascending array of hit timestamps (ms epoch)
 * @param {string} key - caller identity (user id or IP)
 * @param {number} now - current time in ms epoch
 * @param {number} windowMs - sliding window size in ms
 * @param {number} max - max hits allowed within the window
 * @returns {{ allowed: boolean, retryAfterMs: number }}
 */
function hit(store, key, now, windowMs, max) {
  const windowStart = now - windowMs;
  const prior = store.get(key) || [];
  // Prune anything that's aged out of the window (lazy — only on access).
  const timestamps = prior.filter((t) => t > windowStart);

  if (timestamps.length >= max) {
    store.set(key, timestamps);
    // Caller can retry once the oldest hit in the window ages out.
    const retryAfterMs = Math.max(timestamps[0] + windowMs - now, 0);
    return { allowed: false, retryAfterMs };
  }

  timestamps.push(now);
  store.set(key, timestamps);
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Express middleware factory. Keys by `req.user?.id ?? req.ip` unless a
 * `keyFn` override is supplied (e.g. to key auth attempts by IP only,
 * since there's no authenticated user yet on login/register).
 *
 * @param {{ windowMs: number, max: number, keyFn?: (req) => string }} opts
 */
function createRateLimiter({ windowMs, max, keyFn } = {}) {
  if (!windowMs || !max) {
    throw new Error('createRateLimiter requires windowMs and max');
  }
  const store = new Map();
  const getKey = keyFn || ((req) => req.user?.id ?? req.ip);

  return function rateLimitMiddleware(req, res, next) {
    const key = String(getKey(req));
    const now = Date.now();
    const { allowed, retryAfterMs } = hit(store, key, now, windowMs, max);
    if (!allowed) {
      res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({ error: 'too many requests' });
    }
    next();
  };
}

module.exports = { createRateLimiter, hit };
