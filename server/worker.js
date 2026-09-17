require('dotenv').config();

const pool = require('./modules/pool');
const { validateEnvironment } = require('./modules/config');
const bootGates = require('./modules/bootGates');
const { installConsoleBridge, logger } = require('./modules/logger');
const { initSentry, captureError, flushSentry } = require('./modules/sentry');
const { startScheduler, stopScheduler, getSchedulerStatus } = require('./modules/scheduler');
const { setVegasOddsProvider } = require('./services/vegasOdds.provider');
const { espnOddsProvider } = require('./services/espnOdds.provider');
const draftSweepLiveness = require('./modules/draftSweepLiveness');
const { createDraftRoomBroadcast, setDraftRoomBroadcast } = require('./modules/draftRoomBroadcast');
const { createEmitterTransport } = require('./modules/draftRoomEmitterTransport');
const {
  startLiveGameEngine,
  stopLiveGameEngine,
  getLiveGameEngineStatus,
} = require('./modules/liveGameEngine');
const { recordWorkerHeartbeat } = require('./services/workerHeartbeat.service');
// The module object, not a destructured function, so a test can stub
// closeRedis on it (server/test/worker.lifecycle.test.js).
const redis = require('./modules/redis');

let heartbeatTimer = null;
let stopping = false;

installConsoleBridge();

// ESPN's scoreboard needs no key and is not quota-metered, so the odds seam
// (vegasOdds.provider.js) is filled unconditionally at boot, unlike the
// credential-gated Tank01 syncs (#1234, ADR 0037).
setVegasOddsProvider(espnOddsProvider);

async function heartbeat() {
  const scheduler = await getSchedulerStatus();
  const live = getLiveGameEngineStatus();
  await recordWorkerHeartbeat({
    name: 'jobs',
    error: scheduler.lastTickError || live.lastError || null,
    scheduler,
    liveGameEngine: live,
  });
}

async function startWorker() {
  bootGates.assertRedisUrlForBoot(process.env, { role: 'worker' });
  validateEnvironment(process.env, { worker: true });
  initSentry();
  // The worker has no local Socket.IO server, so it broadcasts room-wide Draft
  // events over the Redis emitter transport (#744) through the one draft room
  // adapter (#745). Registered BEFORE the scheduler starts, so the first
  // scheduled autostart or expiry autopick already has an honest transport
  // rather than the silent drop this replaces.
  setDraftRoomBroadcast(createDraftRoomBroadcast(createEmitterTransport(), 'emitter'));
  await heartbeat();
  // Boot stamp for the sweep-liveness key (#842), so a missing key never means
  // "just started": from here on only a sweep that stopped running leaves it
  // absent or stale.
  await draftSweepLiveness.recordDraftSweep();
  startScheduler();
  startLiveGameEngine();
  heartbeatTimer = setInterval(() => {
    heartbeat().catch((error) => {
      logger.error({ err: error }, 'worker heartbeat failed');
      captureError(error);
    });
  }, 60 * 1000);
  heartbeatTimer.unref();
  logger.info('background worker started');
}

async function shutdown(reason) {
  if (stopping) return;
  stopping = true;
  logger.info({ reason }, 'background worker stopping');
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  stopScheduler();
  stopLiveGameEngine();
  await heartbeat().catch(() => {});
  await pool.end();
  // The cache client and the draft emitter's publisher hold Redis sockets
  // open. Left open they keep the event loop alive after everything else has
  // stopped, which is how the worker sat "live" with no timers for 17 hours
  // on 2026-09-16 (#1535). Best effort: a failed quit must not block the exit
  // below, which no longer depends on the loop draining anyway.
  await redis.closeRedis().catch((error) => {
    logger.warn({ err: error }, 'redis close failed during shutdown');
  });
  await flushSentry();
}

// How long a fatal event or a signal waits for shutdown() before the process
// is exited regardless. Render restarts an exited worker within seconds; a
// hung one it never touches.
const SHUTDOWN_DEADLINE_MS = 10 * 1000;

/**
 * Wire the fatal and signal handlers on `proc` so that the worker EXITS.
 *
 * Before #1535 the handlers ran shutdown() and set `process.exitCode`, which
 * only takes effect once the event loop drains. On 2026-09-16 at 17:55:50Z a
 * pooled Postgres client being closed took `read ECONNABORTED`, the error had
 * no listener, `uncaughtException` fired, shutdown() cleared every timer and
 * wrote one last heartbeat, and then the Redis sockets kept the loop alive: a
 * process with nothing left to do, reported as running, for 17 hours. Every
 * scheduled job (waivers, live scoring, pick'em, reminders, syncs) stopped
 * with it, and the uptime watchdog's page was the only signal.
 *
 * Now the handler exits explicitly when shutdown settles, or at
 * `deadlineMs` if it does not, whichever comes first, and exactly once.
 * Injectable `proc`, `exit`, `shutdown` and `deadlineMs` are the test seam
 * (server/test/worker.lifecycle.test.js); production passes nothing.
 */
function installProcessHandlers(proc = process, {
  exit = (code) => proc.exit(code),
  shutdown: doShutdown = shutdown,
  deadlineMs = SHUTDOWN_DEADLINE_MS,
  log = logger,
} = {}) {
  let exiting = false;
  const exitAfterShutdown = (reason, code) => {
    if (exiting) return;
    exiting = true;
    // Set first: if shutdown leaves nothing holding the loop open, Node may
    // exit on its own before either exit() below runs, and it must not
    // report success after a fatal event.
    proc.exitCode = code;
    let exited = false;
    const exitOnce = (why) => {
      if (exited) return;
      exited = true;
      if (why) log.fatal({ reason, code }, why);
      exit(code);
    };
    const deadline = setTimeout(() => exitOnce('worker shutdown deadline elapsed; exiting anyway'), deadlineMs);
    if (typeof deadline.unref === 'function') deadline.unref();
    Promise.resolve()
      .then(() => doShutdown(reason))
      .catch((error) => log.error({ err: error, reason }, 'worker shutdown failed'))
      .finally(() => {
        clearTimeout(deadline);
        exitOnce(null);
      });
  };
  for (const signal of ['SIGTERM', 'SIGINT']) {
    proc.once(signal, () => exitAfterShutdown(signal, 0));
  }
  proc.once('uncaughtException', (error) => {
    log.fatal({ err: error }, 'worker uncaught exception');
    exitAfterShutdown('uncaughtException', 1);
  });
  proc.once('unhandledRejection', (error) => {
    log.fatal({ err: error }, 'worker unhandled rejection');
    exitAfterShutdown('unhandledRejection', 1);
  });
}

if (require.main === module) {
  installProcessHandlers(process);
  startWorker().catch(async (error) => {
    logger.fatal({ err: error }, 'background worker failed to start');
    captureError(error);
    await flushSentry();
    process.exit(1);
  });
}

module.exports = { heartbeat, shutdown, startWorker, installProcessHandlers, SHUTDOWN_DEADLINE_MS };
