require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');

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
const { attachDraftSocket } = require('./modules/draftSocket');
const { startScheduler } = require('./modules/scheduler');
const { startLiveGameEngine } = require('./modules/liveGameEngine');
const { createRateLimiter } = require('./modules/rateLimit');
const { requestLogMiddleware } = require('./modules/requestLog');
const { initSentry, captureError } = require('./modules/sentry');
const { getCorsOptions } = require('./modules/clientOrigins');

const app = express();

if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// Sentry's request handler (when available) needs to wrap everything else.
initSentry(app);

app.use(cors(getCorsOptions()));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogMiddleware); // one JSON line per /api request, on finish

// Rate limiting — general ceiling on all /api traffic, plus a much stricter
// per-IP limiter on just the credential-guessing targets (login, register,
// forgot-password). Deliberately NOT on /refresh or /logout: every open tab
// refreshes its 15-min access token independently, so a shared-IP office or
// household would trip a 10/min budget in normal use. Both are in-house
// sliding-window limiters; see rateLimit.js.
const generalApiLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 300 });
const credentialLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  keyFn: (req) => req.ip,
});
app.use('/api', generalApiLimiter);
app.use(
  ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password'],
  credentialLimiter
);

/* Routes */
app.use('/api/health', healthRouter); // no auth, no credential-limiter — see health.router.js
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
// Unauthenticated public layer (rankings, player profiles, NFL game recaps).
// No requireAuth, its own rate limiter, global NFL data only — see
// public.router.js. Mounted before the static/catch-all fallback.
app.use('/api/public', publicRouter);

// Serve the built React app
app.use(express.static('build'));

// SPA fallback for the self-host deployment: serve the built index.html for any
// non-/api GET so public deep links (/rankings, /players/:id, /recaps/:id, …)
// and the hash app both resolve to the shell. In production Netlify handles
// this rewrite (see netlify.toml); Express only serves build/ as a fallback.
// Guarded so it's a no-op in dev, where build/ doesn't exist.
const path = require('path');
const fs = require('fs');
const buildIndexPath = path.resolve(__dirname, '..', 'build', 'index.html');
app.get(/^(?!\/api\/).*/, (req, res, next) => {
  if (!fs.existsSync(buildIndexPath)) return next();
  res.sendFile(buildIndexPath);
});

// Central error handler — must be registered last (after all routes) so
// it catches anything thrown/next(err)'d out of a router.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  captureError(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
attachDraftSocket(server);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Endzone Empire listening on port ${PORT}`);
  });
  startScheduler(); // waiver clearing + trade review windows
  startLiveGameEngine(); // live NFL game clock/status -> live_game_states
}

module.exports = { app, server };
