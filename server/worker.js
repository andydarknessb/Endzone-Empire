require('dotenv').config();

const pool = require('./modules/pool');
const { validateEnvironment } = require('./modules/config');
const { assertRedisUrlForBoot } = require('./modules/bootGates');
const { installConsoleBridge, logger } = require('./modules/logger');
const { initSentry, captureError, flushSentry } = require('./modules/sentry');
const { startScheduler, stopScheduler, getSchedulerStatus } = require('./modules/scheduler');
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
  const scheduler = getSchedulerStatus();
  const live = getLiveGameEngineStatus();
  await recordWorkerHeartbeat({
    name: 'jobs',
    error: scheduler.lastTickError || live.lastError || null,
  });
}

async function startWorker() {
  assertRedisUrlForBoot(process.env, { role: 'worker' });
  validateEnvironment(process.env, { worker: true });
  initSentry();
  await heartbeat();
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
