/**
 * Redis-backed fixed-window limiter in production. Tests and local development
 * retain a small process-local sliding-window fallback so they do not require
 * external infrastructure; production fails closed when Redis is unavailable.
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

  return async function rateLimitMiddleware(req, res, next) {
    const key = String(getKey(req));
    const now = Date.now();
    let allowed;
    let retryAfterMs;
    let remaining;
    try {
      const { getRedisClient } = require('./redis');
      const redis = await getRedisClient();
      if (redis) {
        const bucket = Math.floor(now / windowMs);
        const redisKey = `rate-limit:${req.baseUrl || 'api'}:${req.path}:${key}:${bucket}`;
        const count = await redis.incr(redisKey);
        if (count === 1) await redis.pExpire(redisKey, windowMs);
        const ttl = Math.max(await redis.pTTL(redisKey), 0);
        allowed = count <= max;
        retryAfterMs = allowed ? 0 : ttl;
        remaining = Math.max(max - count, 0);
      } else {
        ({ allowed, retryAfterMs } = hit(store, key, now, windowMs, max));
        remaining = allowed ? Math.max(max - (store.get(key)?.length || 0), 0) : 0;
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'production') return next(error);
      ({ allowed, retryAfterMs } = hit(store, key, now, windowMs, max));
      remaining = allowed ? Math.max(max - (store.get(key)?.length || 0), 0) : 0;
    }
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(remaining));
    if (!allowed) {
      res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        requestId: req.id,
      });
    }
    next();
  };
}

module.exports = { createRateLimiter, hit };
