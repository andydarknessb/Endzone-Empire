/**
 * Per-user limits on client socket events (#2605, spec #2602 3/6).
 *
 * Two guards, one shape: a caller-owned store, a pure decision, and a thin
 * middleware that refuses before any handler runs. The decision functions take
 * `now` explicitly, the same way chatFlood.js and rateLimit.js do, so a test
 * can drive them at a fixed instant without mocking the global clock the
 * socket server's own timers run on.
 *
 * WHY ONE BUCKET PER USER, NOT PER SOCKET. A member holds several sockets at
 * once (a Dashboard tab and the Draft room), and counting them separately
 * would multiply the budget by however many tabs a client opens - which is
 * exactly the load this limit exists to bound. `user:<id>` is the room every
 * socket joins on connection, so every handler path here already has that
 * identity without a read.
 */

/**
 * Token bucket: BUCKET_CAPACITY events at once, REFILL_PER_SECOND more each
 * second after that, capped at the capacity. A burst of ordinary room traffic
 * (a join, a few picks) fits; a loop of events does not.
 */
const BUCKET_CAPACITY = 20;
const REFILL_PER_SECOND = 2;

/** How many sockets one user may hold before the next connection is refused. */
const MAX_SOCKETS_PER_USER = 10;

/**
 * Decide whether one client event may proceed, and spend a token if so.
 *
 * @param {Map<string, { tokens:number, at:number }>} store - caller-owned, one entry per user
 * @param {{ userId:number, now:number }} ctx
 * @returns {{ allowed:boolean, retryAfterMs:number, retryAfterSeconds:number }}
 */
function checkSocketEvent(store, { userId, now } = {}) {
  const key = String(userId);
  const bucket = store.get(key) || { tokens: BUCKET_CAPACITY, at: now };
  // A clock that went backwards must not mint tokens.
  const elapsedMs = Math.max(now - bucket.at, 0);
  const tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + (elapsedMs * REFILL_PER_SECOND) / 1000);

  if (tokens < 1) {
    // Keep the refilled balance: a refusal is not free, but it costs nothing
    // beyond the time already served.
    store.set(key, { tokens, at: now });
    const retryAfterMs = Math.ceil(((1 - tokens) / REFILL_PER_SECOND) * 1000);
    return { allowed: false, retryAfterMs, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }

  store.set(key, { tokens: tokens - 1, at: now });
  return { allowed: true, retryAfterMs: 0, retryAfterSeconds: 0 };
}

/**
 * The catch-all socket middleware (`socket.use`): every client event reaches
 * this before its handler. A refused event answers its acknowledgement - when
 * it has one - with the same `{ error, code }` shape and retry fields the chat
 * flood refusal already sends, and simply never calls `next()`, so no handler
 * runs and the socket stays connected.
 *
 * @param {Map<string, { tokens:number, at:number }>} store
 * @param {number} userId - whose bucket this socket draws from
 * @param {() => number} now
 */
function socketEventLimiter(store, userId, now = Date.now) {
  return ([, ...args], next) => {
    const decision = checkSocketEvent(store, { userId, now: now() });
    if (decision.allowed) return next();
    const ack = args[args.length - 1];
    if (typeof ack === 'function') {
      ack({
        error: 'you are sending events too quickly',
        code: 'RATE_LIMITED',
        retryAfterMs: decision.retryAfterMs,
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }
  };
}

/**
 * Connection middleware: refuse a user who already holds MAX_SOCKETS_PER_USER
 * sockets. Counted in the `user:<id>` room every socket joins, which is the
 * count the Redis adapter answers across instances, so the cap is the same
 * number behind one API instance or several.
 *
 * The cap is SOFT by design: two simultaneous connects can let one extra
 * through, and the 11th is refused rather than the oldest disconnected -
 * the client reconnects after a server disconnect (#2556), so evicting the
 * oldest would loop.
 *
 * An adapter failure lets the connection through: this is a load guard, not an
 * authorization gate, and a Redis blip must not lock every member out.
 */
function refuseExtraSockets(io, { max = MAX_SOCKETS_PER_USER } = {}) {
  return (socket, next) => {
    io.in(`user:${socket.user.id}`).fetchSockets()
      .then((held) => (held.length >= max ? next(new Error('TOO_MANY_SOCKETS')) : next()))
      .catch((error) => {
        console.error('socket count failed, admitting connection', error);
        next();
      });
  };
}

module.exports = {
  checkSocketEvent,
  socketEventLimiter,
  refuseExtraSockets,
  BUCKET_CAPACITY,
  REFILL_PER_SECOND,
  MAX_SOCKETS_PER_USER,
};
