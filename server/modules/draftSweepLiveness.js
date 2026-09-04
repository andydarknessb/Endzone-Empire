const redis = require('./redis');
const { logger } = require('./logger');

/**
 * Draft sweep liveness (#842): the worker's proof that its draft-clock sweep is
 * actually running, readable from the API process.
 *
 * The API serves /api/health but only sees the worker through the
 * worker_heartbeats row, and that row says the PROCESS is alive, not that the
 * sweep inside it runs. During the #839 stall the worker heartbeat was green
 * while every 10s sweep skipped on a stranded lock. Redis is already the
 * worker-to-API channel for the Draft room, so the worker stamps this key after
 * each sweep (and once at boot, so "missing" never means "just started"), and
 * /api/health/worker reads it. The key expires on its own so a dead worker's
 * stamp cannot outlive it by more than the TTL.
 *
 * Fail-open on purpose: a Redis outage answers "unknown" (not stale), because
 * the composite health's redis section already carries that outage and this
 * must not manufacture a second 503 for the same cause.
 */
const DRAFT_SWEEP_KEY = 'draft-sweep:last-ran-at';
const DRAFT_SWEEP_TTL_SECONDS = 300;
/** Six missed 10s ticks: unambiguous, and longer than a deploy overlap. */
const DRAFT_SWEEP_STALE_AFTER_MS = 60_000;

/** Stamp the key. Never throws: the tick that calls this must not die on Redis. */
async function recordDraftSweep(now = new Date()) {
  try {
    const client = await redis.getRedisClient();
    if (!client) return false;
    await client.set(DRAFT_SWEEP_KEY, now.toISOString(), { EX: DRAFT_SWEEP_TTL_SECONDS });
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'draft sweep liveness stamp failed');
    return false;
  }
}

/**
 * Read the stamp. `draftSweepStale` is true when the key is missing (the worker
 * stamps at boot, so absence means no sweep for longer than the TTL or a flushed
 * Redis) or older than the threshold; false when Redis is unconfigured or down
 * (unknown, fail-open). `lastDraftSweepAt` is the ISO stamp or null.
 */
async function readDraftSweepLiveness(now = Date.now()) {
  try {
    const client = await redis.getRedisClient();
    if (!client) return { lastDraftSweepAt: null, draftSweepStale: false };
    const value = await client.get(DRAFT_SWEEP_KEY);
    if (!value) return { lastDraftSweepAt: null, draftSweepStale: true };
    const ageMs = now - Date.parse(value);
    return { lastDraftSweepAt: value, draftSweepStale: !(ageMs <= DRAFT_SWEEP_STALE_AFTER_MS) };
  } catch (error) {
    return { lastDraftSweepAt: null, draftSweepStale: false };
  }
}

module.exports = {
  DRAFT_SWEEP_KEY,
  DRAFT_SWEEP_TTL_SECONDS,
  DRAFT_SWEEP_STALE_AFTER_MS,
  recordDraftSweep,
  readDraftSweepLiveness,
};
