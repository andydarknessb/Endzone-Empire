const express = require('express');
const pool = require('../modules/pool');
const { requireAuth, requirePlatformAdmin } = require('../modules/auth');
const { getSchedulerStatus } = require('../modules/scheduler');
const { getErrorStats } = require('../modules/sentry');

const router = express.Router();
router.use(requireAuth, requirePlatformAdmin);

// GET /api/admin/overview — platform health at a glance
router.get('/overview', async (req, res) => {
  try {
    const [users, growth, leaguesByStatus, recentSignups, statsCoverage] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS "total" FROM "users"`),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE "created_at" > now() - interval '7 days')::int AS "last7",
           COUNT(*) FILTER (WHERE "created_at" > now() - interval '30 days')::int AS "last30"
         FROM "users"`
      ),
      pool.query(
        `SELECT "draft_status", "season_status", COUNT(*)::int AS "count"
         FROM "leagues" GROUP BY "draft_status", "season_status"
         ORDER BY "count" DESC`
      ),
      pool.query(
        `SELECT "id", "username", "created_at" FROM "users"
         ORDER BY "created_at" DESC LIMIT 10`
      ),
      pool.query(
        // player_stats has no timestamps — report coverage instead
        `SELECT MAX("season") AS "season", MAX("week") FILTER (WHERE "season" = (SELECT MAX("season") FROM "player_stats")) AS "week",
                COUNT(*)::int AS "rows"
         FROM "player_stats"`
      ),
    ]);

    res.json({
      users: {
        total: users.rows[0].total,
        signupsLast7Days: growth.rows[0].last7,
        signupsLast30Days: growth.rows[0].last30,
      },
      leagues: leaguesByStatus.rows,
      recentSignups: recentSignups.rows,
      sync: {
        scheduler: getSchedulerStatus(),
        statsCoverage: statsCoverage.rows[0],
        rapidApiConfigured: Boolean(process.env.RAPID_API_KEY && process.env.RAPID_API_HOST),
      },
      errors: getErrorStats(),
      uptimeSec: Math.round(process.uptime()),
    });
  } catch (error) {
    console.error('Admin overview failed:', error);
    res.status(500).json({ error: 'failed to load admin overview' });
  }
});

// POST /api/admin/sync/:job — manual sync triggers. Body may carry
// { season, week } where the job needs them (defaults: current NFL year).
router.post('/sync/:job', async (req, res) => {
  const { job } = req.params;
  const season = Number((req.body || {}).season) || new Date().getFullYear();
  const week = Number((req.body || {}).week) || null;
  try {
    const scoring = require('../services/scoring.service');
    let result;
    if (job === 'players') {
      result = await scoring.syncPlayers({ season });
    } else if (job === 'schedule') {
      result = await scoring.syncSchedule({ season });
    } else if (job === 'injuries') {
      result = await scoring.syncInjuries();
    } else if (job === 'stats') {
      if (!week) return res.status(400).json({ error: 'week is required for a stats sync' });
      result = await scoring.syncWeekStats({ season, week });
    } else if (job === 'photos') {
      // Free source (TheSportsDB) — no RapidAPI needed.
      result = await require('../services/sportsdb.service').syncPlayerPhotos();
    } else if (job === 'adp') {
      result = await require('../services/adp.service').syncAdp();
    } else if (job === 'season-stats') {
      result = await require('../services/sleeper.service').syncSeasonStats();
    } else if (job === 'backfill-seasons') {
      result = await scoring.syncPlayerSeasonStats({ currentSeason: season });
    } else if (job === 'defenses') {
      // No RapidAPI call — backfills any of the 32 team-DEF rows still
      // missing from a hardcoded team list, not a live sync.
      result = await scoring.syncTeamDefenses();
    } else {
      return res.status(400).json({
        error: 'job must be players, schedule, injuries, stats, photos, adp, season-stats, backfill-seasons, or defenses',
      });
    }
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error(`Admin sync (${job}) failed:`, error);
    res.status(500).json({ error: `${job} sync failed` });
  }
});

module.exports = router;
