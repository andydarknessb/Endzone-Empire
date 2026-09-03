const express = require('express');
const pool = require('../modules/pool');
// Required as module objects (not destructured at load) so their status getters
// stay a mockable seam and, more to the point, so this router is the single
// boundary that classifies their error field before it reaches the wire (#242).
const scheduler = require('../modules/scheduler');
const liveGameEngine = require('../modules/liveGameEngine');
const { getRuntimeState } = require('../modules/runtimeState');
const { getRedisClient } = require('../modules/redis');
const { getQuotaState } = require('../modules/tank01Client');
const { classifyError } = require('../modules/errorCategory');
// One spelling of the Overdue tolerance (#768): the constant lives in the Pick
// clock module (pickClock.service owns expiry) and both detectors read it.
const { OVERDUE_AFTER_MS } = require('../services/pickClock.service');

const router = express.Router();
const WORKER_STALE_MS = Number(process.env.WORKER_STALE_MS || 15 * 60 * 1000);

function withTimeout(promise, timeoutMs, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function databaseStatus() {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

async function redisStatus() {
  if (!process.env.REDIS_URL) {
    return { ok: process.env.NODE_ENV !== 'production', configured: false };
  }
  const started = Date.now();
  try {
    const client = await withTimeout(
      getRedisClient(),
      2000,
      'redis health check timed out'
    );
    await withTimeout(
      client.ping(),
      2000,
      'redis ping timed out'
    );
    return { ok: true, configured: true, latencyMs: Date.now() - started };
  } catch (error) {
    return { ok: false, configured: true, latencyMs: Date.now() - started };
  }
}

/**
 * Holdout-capture health by RECONCILIATION, not by log-reading: obligations
 * are derived from the schedule itself and checked against the immutable
 * ledger and the durable status table, so a capture that never even STARTED
 * (worker down for the whole window) shows up as `missed` instead of as
 * silence. An unavailable status source is itself unhealthy — "I cannot
 * tell" is not "fine".
 */
async function holdoutStatus() {
  try {
    const holdout = require('../services/holdout.service');
    const { ok, obligations } = await holdout.reconcileObligations();
    return { ok, obligations };
  } catch (error) {
    // The detail goes to the server log; the public route reports only that
    // reconciliation could not run. Raw database errors are not a public API.
    console.error('holdout reconciliation failed:', error.message);
    return { ok: false, obligations: [], unavailable: true };
  }
}

/**
 * Overdue Pick clocks (#768, ruling 2): the API-health half of the two
 * detectors. A stored deadline elapsed for longer than the tolerance and still
 * undischarged is Overdue - and because it reads the stored deadline, a DEAD
 * worker (which never runs the sweep) is still caught here. The predicate is the
 * sweep's own (`draft_status = 'active' AND draft_paused = false AND
 * pick_deadline_at IS NOT NULL`) plus the tolerance filter. `leagues` is small,
 * so no index (ADR 0018). Fields are named, never spread, so a wider leagues row
 * leaks nothing to this anonymous route. A read failure fails open to an empty
 * list: db.ok already carries a database outage, and this must not manufacture a
 * false 503 of its own.
 */
async function overdueClocks() {
  try {
    const result = await pool.query(
      `SELECT "id", "pick_deadline_at",
              EXTRACT(EPOCH FROM (now() - "pick_deadline_at")) * 1000 AS "age_ms"
       FROM "leagues"
       WHERE "draft_status" = 'active' AND "draft_paused" = false
         AND "pick_deadline_at" IS NOT NULL
         AND "pick_deadline_at" < now() - make_interval(secs => $1)`,
      [OVERDUE_AFTER_MS / 1000]
    );
    return result.rows.map((row) => ({
      leagueId: row.id,
      deadlineAt: row.pick_deadline_at,
      ageMs: Math.round(Number(row.age_ms)),
    }));
  } catch (error) {
    return [];
  }
}

async function workerStatus() {
  const overdue = await overdueClocks();
  try {
    const result = await pool.query(
      `SELECT "worker_name", "last_seen_at", "last_error", "release_sha"
       FROM "worker_heartbeats" ORDER BY "worker_name"`
    );
    const now = Date.now();
    const workers = result.rows.map((row) => ({
      name: row.worker_name,
      lastSeenAt: row.last_seen_at,
      // The raw message stays in worker_heartbeats.last_error for operators; the
      // anonymous payload carries only its category. `ok` below still keys off
      // truthiness, so null (healthy) vs a non-null category is unchanged.
      lastError: classifyError(row.last_error),
      release: row.release_sha,
      stale: now - new Date(row.last_seen_at).getTime() > WORKER_STALE_MS,
    }));
    return {
      // #768, ruling 2: an Overdue clock fails THIS section (so /worker answers
      // 503). The composite / carries the section but keeps its own ok rule, so
      // a stuck clock never flips the whole API to unhealthy.
      ok: workers.length > 0
        && workers.every((worker) => !worker.stale && !worker.lastError)
        && overdue.length === 0,
      workers,
      overdueClocks: overdue,
    };
  } catch (error) {
    return { ok: false, workers: [], overdueClocks: overdue, unavailable: true };
  }
}

/**
 * Republish a module status snapshot with its raw error message replaced by a
 * stable category. Spread-then-override so the key set is untouched: only the
 * value of the one error field changes. Used for the composite route's
 * `scheduler` and `liveGameEngine` sections (#242).
 */
function publishSchedulerStatus(status) {
  return { ...status, lastTickError: classifyError(status.lastTickError) };
}

function publishLiveGameEngineStatus(status) {
  return { ...status, lastError: classifyError(status.lastError) };
}

router.get('/livez', (req, res) => {
  const runtime = getRuntimeState();
  res.status(runtime.shuttingDown ? 503 : 200).json({
    ok: !runtime.shuttingDown,
    uptimeSec: Math.round(process.uptime()),
    release: process.env.RENDER_GIT_COMMIT || process.env.APP_RELEASE || null,
  });
});

router.get('/readyz', async (req, res) => {
  const runtime = getRuntimeState();
  const [db, redis] = await Promise.all([databaseStatus(), redisStatus()]);
  const ok = runtime.ready && !runtime.shuttingDown && db.ok && redis.ok;
  res.status(ok ? 200 : 503).json({
    ok,
    db,
    redis,
    release: process.env.RENDER_GIT_COMMIT || process.env.APP_RELEASE || null,
  });
});

// The alertable holdout signal: 503 whenever any obligation is missed or
// failed, or when the status source itself cannot be read. Point the
// monitor here — the main health endpoint carries the same section as
// context but does not fail the whole app for a holdout miss.
router.get('/holdout', async (req, res) => {
  const holdout = await holdoutStatus();
  res.status(holdout.ok ? 200 : 503).json(holdout);
});

router.get('/worker', async (req, res) => {
  const worker = await workerStatus();
  res.status(worker.ok ? 200 : 503).json(worker);
});

/**
 * Tank01 spend, trimmed to what a health check should show. Never fails the
 * check — a missing quota table (pre-migration) just reports unavailable.
 */
async function quotaStatus() {
  try {
    const state = await getQuotaState();
    return {
      provider: state.provider,
      mode: state.mode,
      used: state.used,
      budget: state.budget,
      remaining: state.remaining,
      cycleStart: state.cycleStart,
    };
  } catch (error) {
    return { unavailable: true };
  }
}

router.get('/', async (req, res) => {
  const [db, redis, worker, quota, holdout] = await Promise.all([
    databaseStatus(),
    redisStatus(),
    workerStatus(),
    quotaStatus(),
    holdoutStatus(),
  ]);
  const runtime = getRuntimeState();
  const ok = runtime.ready && db.ok && redis.ok;
  res.status(ok ? 200 : 503).json({
    ok,
    db,
    redis,
    runtime,
    worker,
    quota,
    holdout,
    // Spread keeps each status's key set exactly as pinned; only the error
    // field is rewritten from a raw message to its category (#242).
    scheduler: publishSchedulerStatus(await scheduler.getSchedulerStatus()),
    liveGameEngine: publishLiveGameEngineStatus(liveGameEngine.getLiveGameEngineStatus()),
    uptimeSec: Math.round(process.uptime()),
    release: process.env.RENDER_GIT_COMMIT || process.env.APP_RELEASE || null,
  });
});

module.exports = router;
