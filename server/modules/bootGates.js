/**
 * A production process without REDIS_URL cannot reach the Draft room: the API's
 * @socket.io/redis-adapter is the only cross-process fan-out, and the worker's
 * emitter rides it. A missing REDIS_URL in production is a configuration error,
 * not a quiet mode, so boot refuses rather than running blind (ADR 0025, #744).
 *
 * Any non-production NODE_ENV (local dev, tests) keeps working without Redis:
 * jobs there run inside the API process with a real Socket.IO server, so the
 * emitter path is never taken. A connect failure at boot is a separate matter
 * and does NOT belong here: the worker still boots (it also runs scoring and
 * sync) and reports the first failed publish through the transport.
 */
function assertRedisUrlForBoot(env = process.env, { role = 'process' } = {}) {
  if (env.NODE_ENV === 'production' && !env.REDIS_URL) {
    throw new Error(`REDIS_URL is required to boot the ${role} in production`);
  }
}

module.exports = { assertRedisUrlForBoot };
