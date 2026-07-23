require('dotenv').config();
require('express-async-errors');
const http = require('http');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');

const { validateEnvironment } = require('./modules/config');
const { installConsoleBridge, logger } = require('./modules/logger');
const {
  captureError,
  flushSentry,
  initSentry,
  setupSentryErrorHandler,
} = require('./modules/sentry');

initSentry();
installConsoleBridge();

const authRouter = require('./routes/auth.router');
const userRouter = require('./routes/user.router');
const playerRouter = require('./routes/player.router');
const leagueRouter = require('./routes/league.router');
const teamRouter = require('./routes/team.router');
const matchupsRouter = require('./routes/matchups.router');
const scoringRouter = require('./routes/scoring.router');
const waiversRouter = require('./routes/waivers.router');
const draftRouter = require('./routes/draft.router');
const tradesRouter = require('./routes/trades.router');
const notificationsRouter = require('./routes/notifications.router');
const newsRouter = require('./routes/news.router');
const commissionerRouter = require('./routes/commissioner.router');
const healthRouter = require('./routes/health.router');
const adminRouter = require('./routes/admin.router');
const publicRouter = require('./routes/public.router');
const safetyRouter = require('./routes/safety.router');
const pool = require('./modules/pool');
const { attachDraftSocket, closeDraftSocket } = require('./modules/draftSocket');
const { startScheduler, stopScheduler } = require('./modules/scheduler');
const { startLiveGameEngine, stopLiveGameEngine } = require('./modules/liveGameEngine');
const { createRateLimiter } = require('./modules/rateLimit');
const { requestLogMiddleware } = require('./modules/requestLog');
const { getClientOrigins, getCorsOptions } = require('./modules/clientOrigins');
const { closeRedis } = require('./modules/redis');
const { markReady, markShuttingDown } = require('./modules/runtimeState');

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.disable('x-powered-by');

const connectSources = ["'self'", ...getClientOrigins()];
if (process.env.SUPABASE_URL) connectSources.push(new URL(process.env.SUPABASE_URL).origin);

app.use(requestLogMiddleware);
app.use(cors(getCorsOptions()));
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: [...new Set([...connectSources, 'wss:'])],
      fontSrc: ["'self'", 'data:', 'https:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

const generalApiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  keyFn: (req) => req.ip,
});
const credentialLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyFn: (req) => {
    const account = String(req.body?.username || req.body?.email || '').trim().toLowerCase();
    return `${req.ip}:${account || 'unknown'}`;
  },
});
const refreshLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  keyFn: (req) => req.ip,
});

app.use('/api', generalApiLimiter);
app.use(
  ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password'],
  credentialLimiter
);
app.use(['/api/auth/refresh'], refreshLimiter);

app.use('/api/health', healthRouter);
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/api/players', playerRouter);
app.use('/api/league', leagueRouter);
app.use('/api/team', teamRouter);
app.use('/api/matchups', matchupsRouter);
app.use('/api/scoring', scoringRouter);
app.use('/api/waivers', waiversRouter);
app.use('/api/draft', draftRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/news', newsRouter);
app.use('/api/commissioner', commissionerRouter);
app.use('/api/admin', adminRouter);
app.use('/api/safety', safetyRouter);
app.use('/api/public', (req, res, next) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  next();
}, publicRouter);

app.use('/api', (req, res) => {
  res.status(404).json({
    code: 'NOT_FOUND',
    message: 'API route not found',
    requestId: req.id,
  });
});

app.use(express.static('build', {
  immutable: true,
  maxAge: '1y',
  setHeaders: (res, filename) => {
    if (filename.endsWith('index.html') || filename.endsWith('service-worker.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

const buildIndexPath = path.resolve(__dirname, '..', 'build', 'index.html');
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  if (!fs.existsSync(buildIndexPath)) return next();
  res.set('Cache-Control', 'no-cache');
  return res.sendFile(buildIndexPath);
});

setupSentryErrorHandler(app);
app.use((err, req, res, next) => {
  logger.error({ err, requestId: req.id }, 'unhandled request error');
  captureError(err, { requestId: req.id });
  if (res.headersSent) return next(err);
  return res.status(err.statusCode || 500).json({
    code: err.code || 'INTERNAL_ERROR',
    message: err.statusCode ? err.message : 'Internal server error',
    requestId: req.id,
  });
});

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const io = attachDraftSocket(server);
let shutdownPromise = null;

async function startServer() {
  validateEnvironment();
  await io.redisReady;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', resolve);
  });
  const runJobsInWeb =
    process.env.RUN_JOBS_IN_WEB === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.RUN_JOBS_IN_WEB !== 'false');
  if (runJobsInWeb) {
    startScheduler();
    startLiveGameEngine();
  }
  markReady();
  logger.info({ port: Number(PORT), runJobsInWeb }, 'api listening');
  return server;
}

async function shutdown(reason = 'shutdown') {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    markShuttingDown();
    logger.info({ reason }, 'graceful shutdown started');
    stopScheduler();
    stopLiveGameEngine();
    if (server.listening) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closeDraftSocket(io);
    await closeRedis();
    await pool.end();
    await flushSentry();
    logger.info({ reason }, 'graceful shutdown complete');
  })();
  return shutdownPromise;
}

if (require.main === module) {
  startServer().catch(async (error) => {
    logger.fatal({ err: error }, 'api failed to start');
    captureError(error);
    await flushSentry();
    process.exitCode = 1;
  });
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      shutdown(signal).then(() => {
        process.exitCode = 0;
      });
    });
  }
  process.once('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    shutdown('uncaughtException').finally(() => {
      process.exitCode = 1;
    });
  });
  process.once('unhandledRejection', (error) => {
    logger.fatal({ err: error }, 'unhandled rejection');
    shutdown('unhandledRejection').finally(() => {
      process.exitCode = 1;
    });
  });
}

module.exports = { app, io, server, shutdown, startServer };
