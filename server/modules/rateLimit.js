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
 * `name` goes into the Redis key so two limiters on one route never share a count.
 *
 * @param {{ name?: string, windowMs: number, max: number, keyFn?: (req) => string }} opts
 */
function createRateLimiter({ name, windowMs, max, keyFn } = {}) {
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
        // Express matches mount paths case-insensitively, so the key must too or /API/auth/register gets a fresh count.
        const redisKey = `rate-limit:${(req.baseUrl || 'api').toLowerCase()}${name ? `:${name}` : ''}:${key}:${bucket}`;
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

/**
 * A limiter that counts only what the route reports as failed. `guard` is
 * middleware that refuses with 429 once `max` failures sit in the window and
 * never counts the request itself; `fail(req)` records one failure. Same
 * store rules as createRateLimiter: Redis fixed window, process-local
 * sliding window in tests and dev, fail closed in production.
 *
 * @param {{ name: string, windowMs: number, max: number, keyFn?: (req) => string }} opts
 */
function createFailureLimiter({ name, windowMs, max, keyFn }) {
  if (!name || !windowMs || !max) throw new Error('createFailureLimiter requires name, windowMs and max');
  const store = new Map();
  const getKey = keyFn || ((req) => req.user?.id ?? req.ip);
  const redisKeyFor = (req, now) =>
    `rate-limit:failures:${(req.baseUrl || 'api').toLowerCase()}:${name}:${String(getKey(req))}:${Math.floor(now / windowMs)}`;

  async function guard(req, res, next) {
    const key = String(getKey(req));
    const now = Date.now();
    let blocked;
    let retryAfterMs = 0;
    try {
      const { getRedisClient } = require('./redis');
      const redis = await getRedisClient();
      if (redis) {
        const redisKey = redisKeyFor(req, now);
        blocked = Number(await redis.get(redisKey)) >= max;
        if (blocked) retryAfterMs = Math.max(await redis.pTTL(redisKey), 0);
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'production') return next(error);
    }
    if (blocked === undefined) {
      const recent = (store.get(key) || []).filter((t) => t > now - windowMs);
      store.set(key, recent);
      blocked = recent.length >= max;
      if (blocked) retryAfterMs = Math.max(recent[0] + windowMs - now, 0);
    }
    if (!blocked) return next();
    res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    return res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many requests', requestId: req.id });
  }

  async function fail(req) {
    const key = String(getKey(req));
    const now = Date.now();
    try {
      const { getRedisClient } = require('./redis');
      const redis = await getRedisClient();
      if (redis) {
        const redisKey = redisKeyFor(req, now);
        if ((await redis.incr(redisKey)) === 1) await redis.pExpire(redisKey, windowMs);
        return;
      }
    } catch (error) {
      // The guard already fails closed in production; a lost count must not turn a 404 into a 500.
      console.error('failure limiter could not record', error);
    }
    store.set(key, [...(store.get(key) || []).filter((t) => t > now - windowMs), now]);
  }

  return { guard, fail };
}

const MAX_ACCOUNT_KEY = 254;

/** Typed username or email, lowercased and cut so a huge body cannot fatten a limiter key. */
function accountPart(req) {
  return String(req.body?.username || req.body?.email || '').trim().toLowerCase().slice(0, MAX_ACCOUNT_KEY);
}

/** Limiters for register, login and forgot-password; each is mounted on its own route(s). */
function createCredentialLimiters() {
  const HOUR = 60 * 60 * 1000;
  return {
    // Per IP + typed name: stops one account being hammered.
    account: createRateLimiter({
      name: 'account',
      windowMs: 10 * 60 * 1000,
      max: 20,
      keyFn: (req) => `${req.ip}:${accountPart(req) || 'unknown'}`,
    }),
    // Per IP alone: a new name must not buy a fresh limit (each register costs a bcrypt hash).
    registerIp: createRateLimiter({ name: 'register-ip', windowMs: HOUR, max: 10, keyFn: (req) => req.ip }),
    loginIp: createRateLimiter({ name: 'login-ip', windowMs: 10 * 60 * 1000, max: 100, keyFn: (req) => req.ip }),
    // Per email: a reset mail flood is bounded whatever IPs it comes from.
    forgotEmail: createRateLimiter({
      name: 'forgot-email',
      windowMs: HOUR,
      max: 5,
      keyFn: (req) => accountPart({ body: { email: req.body?.email } }) || `ip:${req.ip}`,
    }),
  };
}

module.exports = { createRateLimiter, createFailureLimiter, createCredentialLimiters, accountPart, hit };
