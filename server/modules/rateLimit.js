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
 * A limiter for guessable lookups: only requests the route reports as failed
 * stay counted. `guard` reserves a slot before the work runs (so parallel
 * guesses cannot all pass a read-only check) and answers 429 when none is
 * left; `refund(req)` refunds the slot, so the route calls it for every
 * outcome except the failure being limited. Same store rules as
 * createRateLimiter: Redis fixed window, process-local sliding window in tests
 * and dev, fail closed in production.
 *
 * @param {{ name: string, windowMs: number, max: number, keyFn?: (req) => string }} opts
 */
function createFailureLimiter({ name, windowMs, max, keyFn }) {
  if (!name || !windowMs || !max) throw new Error('createFailureLimiter requires name, windowMs and max');
  const store = new Map();
  const held = new WeakMap(); // req -> the slot it reserved, so refund undoes exactly that
  const getKey = keyFn || ((req) => req.user?.id ?? req.ip);

  async function guard(req, res, next) {
    const key = String(getKey(req));
    const now = Date.now();
    let count;
    let retryAfterMs = 0;
    let slot;
    try {
      const { getRedisClient } = require('./redis');
      const redis = await getRedisClient();
      if (redis) {
        slot = { redisKey: `rate-limit:failures:${(req.baseUrl || 'api').toLowerCase()}:${name}:${key}:${Math.floor(now / windowMs)}` };
        count = await redis.incr(slot.redisKey);
        if (count === 1) await redis.pExpire(slot.redisKey, windowMs);
        if (count > max) retryAfterMs = Math.max(await redis.pTTL(slot.redisKey), 0);
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'production') return next(error);
      slot = undefined;
      count = undefined;
    }
    if (count === undefined) {
      const recent = (store.get(key) || []).filter((t) => t > now - windowMs);
      slot = { key, now };
      recent.push(now);
      store.set(key, recent);
      count = recent.length;
      if (count > max) retryAfterMs = Math.max(recent[0] + windowMs - now, 0);
    }
    held.set(req, slot);
    if (count <= max) return next();
    await refund(req); // a refused request must not extend its own block
    res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
    return res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many requests', requestId: req.id });
  }

  async function refund(req) {
    const slot = held.get(req);
    if (!slot) return;
    held.delete(req);
    if (slot.redisKey) {
      try {
        const { getRedisClient } = require('./redis');
        await (await getRedisClient()).decr(slot.redisKey);
      } catch (error) {
        console.error('failure limiter could not refund', error); // the slot stays spent: stricter, never looser
      }
      return;
    }
    const times = store.get(slot.key) || [];
    const at = times.indexOf(slot.now);
    if (at !== -1) times.splice(at, 1);
  }

  return { guard, refund };
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
