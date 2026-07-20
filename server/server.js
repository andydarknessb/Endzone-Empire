require('dotenv').config();
const http = require('http');
const express = require('express');

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
const { attachDraftSocket } = require('./modules/draftSocket');
const { startScheduler } = require('./modules/scheduler');
const { startLiveGameEngine } = require('./modules/liveGameEngine');
const { createRateLimiter } = require('./modules/rateLimit');
const { requestLogMiddleware } = require('./modules/requestLog');
const { initSentry, captureError } = require('./modules/sentry');

const app = express();

// Sentry's request handler (when available) needs to wrap everything else.
initSentry(app);

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

// Serve the built React app
app.use(express.static('build'));

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
  server.listen(PORT, () => {
    console.log(`Endzone Empire listening on port ${PORT}`);
  });
  startScheduler(); // waiver clearing + trade review windows
  startLiveGameEngine(); // live NFL game clock/status -> live_game_states
}

module.exports = { app, server };
