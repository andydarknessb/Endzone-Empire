require('dotenv').config();

const pool = require('./modules/pool');
const { validateEnvironment } = require('./modules/config');
const bootGates = require('./modules/bootGates');
const { installConsoleBridge, logger } = require('./modules/logger');
const { initSentry, captureError, flushSentry } = require('./modules/sentry');
const { startScheduler, stopScheduler, getSchedulerStatus } = require('./modules/scheduler');
const draftSweepLiveness = require('./modules/draftSweepLiveness');
const { createDraftRoomBroadcast, setDraftRoomBroadcast } = require('./modules/draftRoomBroadcast');
const { createEmitterTransport } = require('./modules/draftRoomEmitterTransport');
const {
  startLiveGameEngine,
  stopLiveGameEngine,
  getLiveGameEngineStatus,
} = require('./modules/liveGameEngine');
const { recordWorkerHeartbeat } = require('./services/workerHeartbeat.service');

let heartbeatTimer = null;
let stopping = false;

installConsoleBridge();

async function heartbeat() {
  const scheduler = await getSchedulerStatus();
  const live = getLiveGameEngineStatus();
  await recordWorkerHeartbeat({
    name: 'jobs',
    error: scheduler.lastTickError || live.lastError || null,
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
  await flushSentry();
}

if (require.main === module) {
  startWorker().catch(async (error) => {
    logger.fatal({ err: error }, 'background worker failed to start');
    captureError(error);
    await flushSentry();
    process.exitCode = 1;
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => shutdown(signal).then(() => {
      process.exitCode = 0;
    }));
  }
  process.once('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'worker uncaught exception');
    shutdown('uncaughtException').finally(() => {
      process.exitCode = 1;
    });
  });
  process.once('unhandledRejection', (error) => {
    logger.fatal({ err: error }, 'worker unhandled rejection');
    shutdown('unhandledRejection').finally(() => {
      process.exitCode = 1;
    });
  });
}

module.exports = { heartbeat, shutdown, startWorker };
