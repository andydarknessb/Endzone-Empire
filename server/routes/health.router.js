const express = require('express');
const pool = require('../modules/pool');
const { getSchedulerStatus } = require('../modules/scheduler');
const { getLiveGameEngineStatus } = require('../modules/liveGameEngine');
const { getRuntimeState } = require('../modules/runtimeState');
const { getRedisClient } = require('../modules/redis');
const { getQuotaState } = require('../modules/tank01Client');

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
    return { ok: false, obligations: [], unavailable: true, error: error.message };
  }
}

async function workerStatus() {
  try {
    const result = await pool.query(
      `SELECT "worker_name", "last_seen_at", "last_error"
       FROM "worker_heartbeats" ORDER BY "worker_name"`
    );
    const now = Date.now();
    const workers = result.rows.map((row) => ({
      name: row.worker_name,
      lastSeenAt: row.last_seen_at,
      lastError: row.last_error,
      stale: now - new Date(row.last_seen_at).getTime() > WORKER_STALE_MS,
    }));
    return {
      ok: workers.length > 0 && workers.every((worker) => !worker.stale && !worker.lastError),
      workers,
    };
  } catch (error) {
    return { ok: false, workers: [], unavailable: true };
  }
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
    scheduler: getSchedulerStatus(),
    liveGameEngine: getLiveGameEngineStatus(),
    uptimeSec: Math.round(process.uptime()),
    release: process.env.RENDER_GIT_COMMIT || process.env.APP_RELEASE || null,
  });
});

module.exports = router;
