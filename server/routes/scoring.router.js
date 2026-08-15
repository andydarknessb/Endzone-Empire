const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { isTransientDatabaseError, withDatabaseRetry } = require('../modules/dbRetry');
const scoring = require('../services/scoring.service');
const sportsdb = require('../services/sportsdb.service');
const adp = require('../services/adp.service');
const sleeper = require('../services/sleeper.service');
const season = require('../services/season.service');
const correction = require('../services/correction.service');
const nflverseSync = require('../services/nflverseSync.service');
const commissioner = require('../services/commissioner.service');
const montecarlo = require('../services/montecarlo.service');
const { isLeagueCommissioner, commissionerPredicate } = require('../services/leagueRole.service');
const { requireFantasyLeague } = require('../services/leagueType');

const router = express.Router();
router.use(requireAuth);
// A pick'em-only league has no matchups or fantasy scoring: every write under
// /league/:id (matchups, score, correct-week, power-rankings, schedule,
// advance-week) fails closed with 409 PICKEM_ONLY_LEAGUE; reads pass untouched.
router.use('/league/:id', requireFantasyLeague());

// The commissioner or one of their co-commissioners. Responds 403 and returns
// false when the caller is neither, so callers can `if (!(await ...)) return;`.
async function requireLeagueCommissioner(req, res, leagueId) {
  if (!(await isLeagueCommissioner(pool, leagueId, req.user.id))) {
    res.status(403).json({ error: 'only the commissioner can do this' });
    return false;
  }
  return true;
}

function validSeasonWeek(req, res) {
  const season = Number(req.body && req.body.season);
  const week = Number(req.body && req.body.week);
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    res.status(400).json({ error: 'season (integer year) is required' });
    return null;
  }
  if (!Number.isInteger(week) || week < 1 || week > 25) {
    res.status(400).json({ error: 'week must be an integer between 1 and 25' });
    return null;
  }
  return { season, week };
}

// POST /api/scoring/sync — pull weekly stats from RapidAPI into player_stats
router.post('/sync', async (req, res) => {
  const sw = validSeasonWeek(req, res);
  if (!sw) return;
  try {
    const result = await scoring.syncWeekStats(sw);
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Stat sync failed:', error);
    res.status(500).json({ error: 'stat sync failed' });
  }
});

// POST /api/scoring/league/:id/matchups — generate this week's pairings (owner only)
router.post('/league/:id/matchups', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'league id must be a positive integer' });
  }
  const sw = validSeasonWeek(req, res);
  if (!sw) return;
  const leagueId = Number(req.params.id);
  try {
    if (!(await requireLeagueCommissioner(req, res, leagueId))) return;
    const result = await scoring.generateMatchups({ leagueId, ...sw });
    res.status(201).json(result);
  } catch (error) {
    console.error('Matchup generation failed:', error);
    res.status(500).json({ error: 'matchup generation failed' });
  }
});

// POST /api/scoring/league/:id/score — compute head-to-head scores for the week
router.post('/league/:id/score', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'league id must be a positive integer' });
  }
  const sw = validSeasonWeek(req, res);
  if (!sw) return;
  const leagueId = Number(req.params.id);
  try {
    if (!(await requireLeagueCommissioner(req, res, leagueId))) return;
    const result = await scoring.scoreMatchups({ leagueId, ...sw });
    res.json(result);
  } catch (error) {
    console.error('Matchup scoring failed:', error);
    res.status(500).json({ error: 'matchup scoring failed' });
  }
});

// POST /api/scoring/league/:id/correct-week — owner re-syncs a past week's
// stats and re-scores it (stat corrections). Settled matchups are re-scored
// too; changed scores are logged to the activity feed. Never re-runs waivers
// or rewrites playoff brackets — flipped playoff results alert the owner.
router.post('/league/:id/correct-week', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'league id must be a positive integer' });
  }
  const sw = validSeasonWeek(req, res);
  if (!sw) return;
  const leagueId = Number(req.params.id);
  const correctionRequest = Object.freeze({ leagueId, season: sw.season, week: sw.week });
  const requestBody = { ...(req.body || {}) };
  try {
    const leagueResult = await withDatabaseRetry(() =>
      pool.query(
        `SELECT "current_season", "current_week", ${commissionerPredicate(2)} AS "is_commissioner"
         FROM "leagues" WHERE "id" = $1`,
        [correctionRequest.leagueId, req.user.id]
      )
    );
    const league = leagueResult.rows[0];
    if (!league || !league.is_commissioner) {
      return res.status(403).json({ error: 'only the commissioner can do this' });
    }
    correction.assertManualCorrectionWindow({
      requestedSeason: sw.season,
      requestedWeek: sw.week,
      activeSeason: league.current_season,
      activeWeek: league.current_week,
      timestamp: new Date(),
    });
    const { matchupId, homeScore, awayScore } = requestBody;
    const hasManualScores = matchupId !== undefined || homeScore !== undefined || awayScore !== undefined;
    if (hasManualScores) {
      const validScore = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1000;
      if (!Number.isInteger(matchupId) || matchupId < 1 || !validScore(homeScore) || !validScore(awayScore)) {
        return res.status(400).json({
          error: 'matchupId and numeric homeScore/awayScore values between 0 and 1000 are required',
        });
      }
      const result = await commissioner.adjustMatchupScore({
        leagueId,
        userId: req.user.id,
        matchupId,
        homeScore: Number(homeScore),
        awayScore: Number(awayScore),
      });
      return res.json(result);
    }
    await withDatabaseRetry(() => scoring.syncWeekStats({
      season: correctionRequest.season,
      week: correctionRequest.week,
    }));
    const result = await withDatabaseRetry(() => correction.correctLeagueWeek(correctionRequest));
    res.json(result);
  } catch (error) {
    if (error instanceof correction.CorrectionWindowError) {
      return res.status(403).json({ error: error.code, message: error.message });
    }
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    if (isTransientDatabaseError(error)) {
      const attempts = error.databaseAttempts || 1;
      res.set('Retry-After', '1');
      return res.status(500).json({
        error: 'DATABASE_TEMPORARILY_UNAVAILABLE',
        message: `Score correction could not complete after ${attempts} database attempt${attempts === 1 ? '' : 's'}.`,
      });
    }
    console.error('Stat correction failed:', error);
    res.status(500).json({ error: 'stat correction failed' });
  }
});

// GET /api/scoring/rules — default rules plus the selectable presets
router.get('/rules', (req, res) => {
  res.json({ defaults: scoring.SCORING_RULES, presets: scoring.SCORING_PRESETS });
});

// POST /api/scoring/sync-schedule — pull the NFL schedule into nfl_games.
// source 'tank01' (default) spends 18 metered requests and drops games whose
// kickoff time is still TBD; source 'nflverse' is free, insert-only, and
// covers TBD-time games (week 18) with placeholder kickoffs — use it to
// complete a season Tank01 left with schedule gaps (unfillable byes).
router.post('/sync-schedule', async (req, res) => {
  const seasonYear = Number(req.body && req.body.season);
  if (!Number.isInteger(seasonYear) || seasonYear < 2000 || seasonYear > 2100) {
    return res.status(400).json({ error: 'season (integer year) is required' });
  }
  const source = req.body && req.body.source ? String(req.body.source) : 'tank01';
  if (!['tank01', 'nflverse'].includes(source)) {
    return res.status(400).json({ error: "source must be 'tank01' or 'nflverse'" });
  }
  try {
    const result = source === 'nflverse'
      ? await nflverseSync.syncScheduleFromNflverse({ season: seasonYear })
      : await scoring.syncSchedule({ season: seasonYear });
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Schedule sync failed:', error);
    res.status(500).json({ error: 'schedule sync failed' });
  }
});

// POST /api/scoring/sync-players — discover/refresh the NFL player pool
router.post('/sync-players', async (req, res) => {
  const seasonYear = Number(req.body && req.body.season);
  if (!Number.isInteger(seasonYear) || seasonYear < 2000 || seasonYear > 2100) {
    return res.status(400).json({ error: 'season (integer year) is required' });
  }
  try {
    const result = await scoring.syncPlayers({ season: seasonYear });
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Player sync failed:', error);
    res.status(500).json({ error: 'player sync failed' });
  }
});

// POST /api/scoring/sync-photos — enrich the player pool with headshots and
// jersey numbers from TheSportsDB (matched by name). Safe to re-run.
router.post('/sync-photos', async (req, res) => {
  try {
    const result = await sportsdb.syncPlayerPhotos();
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Photo sync failed:', error);
    res.status(500).json({ error: 'photo sync failed' });
  }
});

// POST /api/scoring/sync-season-stats — fill player_season_stats with real
// full-season lines from Sleeper. Optional body: { seasons: [2025, 2024] }.
router.post('/sync-season-stats', async (req, res) => {
  const body = req.body || {};
  const opts = {};
  if (Array.isArray(body.seasons) && body.seasons.length) {
    opts.seasons = body.seasons.map(Number).filter((y) => Number.isInteger(y) && y >= 2000 && y <= 2100);
  }
  try {
    const result = await sleeper.syncSeasonStats(opts);
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Season-stats sync failed:', error);
    res.status(500).json({ error: 'season-stats sync failed' });
  }
});

// POST /api/scoring/sync-adp — refresh players.adp from the free FFC ADP feed.
// Optional body: { format: 'half-ppr'|'ppr'|'standard'|..., teams, year }.
router.post('/sync-adp', async (req, res) => {
  const body = req.body || {};
  const opts = {};
  if (body.format) opts.format = String(body.format);
  if (body.teams) opts.teams = Number(body.teams);
  if (body.year) opts.year = Number(body.year);
  try {
    const result = await adp.syncAdp(opts);
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('ADP sync failed:', error);
    res.status(500).json({ error: 'adp sync failed' });
  }
});

// POST /api/scoring/backfill-seasons — roll up completed prior seasons'
// weekly stats into player_season_stats (powers the quick-view dialog's
// "Previous Seasons" tab). One-time / on-demand; optional `currentSeason`
// body sets the cutoff (defaults to the newest league's current season).
router.post('/backfill-seasons', async (req, res) => {
  const raw = req.body && req.body.currentSeason;
  let currentSeason;
  if (raw !== undefined) {
    currentSeason = Number(raw);
    if (!Number.isInteger(currentSeason) || currentSeason < 2000 || currentSeason > 2100) {
      return res.status(400).json({ error: 'currentSeason must be an integer year' });
    }
  }
  try {
    const result = await scoring.syncPlayerSeasonStats({ currentSeason });
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Season backfill failed:', error);
    res.status(500).json({ error: 'season backfill failed' });
  }
});

// POST /api/scoring/sync-injuries — refresh player injury designations
router.post('/sync-injuries', async (req, res) => {
  try {
    const result = await scoring.syncInjuries();
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Injury sync failed:', error);
    res.status(500).json({ error: 'injury sync failed' });
  }
});

// GET /api/scoring/league/:id/standings — record, PF/PA, streak, ranks
router.get('/league/:id/standings', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'league id must be a positive integer' });
  }
  const leagueId = Number(req.params.id);
  try {
    const membership = await pool.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });
    const leagueResult = await pool.query(
      `SELECT "playoff_teams", "regular_season_weeks", "season_status", "current_week"
       FROM "leagues" WHERE "id" = $1`,
      [leagueId]
    );
    if (!leagueResult.rows[0]) return res.status(404).json({ error: 'league not found' });
    const standings = await season.getStandings({ leagueId });
    const playoffTeams = leagueResult.rows[0].playoff_teams;
    res.json({
      league: leagueResult.rows[0],
      standings: standings.map((s) => ({ ...s, playoffSeed: s.rank <= playoffTeams ? s.rank : null })),
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching standings', error);
    res.status(500).json({ error: 'failed to fetch standings' });
  }
});

// GET /api/scoring/league/:id/power-rankings — latest Monte Carlo run:
// rankings with playoff/title odds. 404 until the first run has stored one.
router.get('/league/:id/power-rankings', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'league id must be a positive integer' });
  }
  const leagueId = Number(req.params.id);
  try {
    const membership = await pool.query(
      `SELECT "id" FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });
    const latest = await montecarlo.getLatestPowerRankings({ leagueId });
    if (!latest) return res.status(404).json({ error: 'no power rankings computed yet' });
    // Avatars are overlaid from the live teams table rather than baked into
    // the stored run (league_analytics.data) — same reasoning as league
    // history's champion avatar: a frozen snapshot shouldn't need updating
    // every time someone changes their avatar.
    const avatarsResult = await pool.query(
      `SELECT "id", "avatar_url", "avatar_static_url" FROM "teams" WHERE "league_id" = $1`,
      [leagueId]
    );
    const avatarsByTeam = new Map(avatarsResult.rows.map((t) => [t.id, t]));
    const rankings = latest.rankings.map((r) => ({
      ...r,
      avatarUrl: avatarsByTeam.get(r.teamId)?.avatar_url ?? null,
      avatarStaticUrl: avatarsByTeam.get(r.teamId)?.avatar_static_url ?? null,
    }));
    res.json({ ...latest, rankings, viewerTeamId: membership.rows[0].id });
  } catch (error) {
    console.error('Power rankings fetch failed:', error);
    res.status(500).json({ error: 'failed to fetch power rankings' });
  }
});

// GET /api/scoring/league/:id/recap — latest stored weekly recap (member only)
router.get('/league/:id/recap', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'league id must be a positive integer' });
  }
  const leagueId = Number(req.params.id);
  try {
    const membership = await pool.query(
      `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!membership.rows[0]) return res.status(403).json({ error: 'not a member of this league' });
    const recap = require('../services/recap.service');
    const latest = await recap.getLatestRecap({ leagueId });
    if (!latest) return res.status(404).json({ error: 'no recap generated yet' });
    res.json(latest);
  } catch (error) {
    console.error('Recap fetch failed:', error);
    res.status(500).json({ error: 'failed to fetch recap' });
  }
});

// POST /api/scoring/league/:id/power-rankings — owner recomputes on demand
router.post('/league/:id/power-rankings', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'league id must be a positive integer' });
  }
  const leagueId = Number(req.params.id);
  try {
    if (!(await requireLeagueCommissioner(req, res, leagueId))) return;
    const data = await montecarlo.computeLeagueOdds({ leagueId });
    if (!data) return res.status(409).json({ error: 'league is not ready for simulations' });
    res.json(data);
  } catch (error) {
    console.error('Power rankings compute failed:', error);
    res.status(500).json({ error: 'failed to compute power rankings' });
  }
});

// POST /api/scoring/league/:id/schedule — owner generates the full regular season
router.post('/league/:id/schedule', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'league id must be a positive integer' });
  }
  const leagueId = Number(req.params.id);
  try {
    if (!(await requireLeagueCommissioner(req, res, leagueId))) return;
    const result = await season.generateRegularSeason({ leagueId });
    res.status(201).json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Season scheduling failed:', error);
    res.status(500).json({ error: 'season scheduling failed' });
  }
});

// POST /api/scoring/league/:id/advance-week — owner closes out the current
// week: scores it under league rules, finalizes, then advances (playoff
// rounds are created/advanced automatically)
router.post('/league/:id/advance-week', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'league id must be a positive integer' });
  }
  const leagueId = Number(req.params.id);
  try {
    if (!(await requireLeagueCommissioner(req, res, leagueId))) return;
    const leagueResult = await pool.query(
      `SELECT "current_season", "current_week" FROM "leagues" WHERE "id" = $1`,
      [leagueId]
    );
    const { current_season, current_week } = leagueResult.rows[0];
    const scoredResult = await scoring.scoreMatchups({
      leagueId,
      season: current_season,
      week: current_week,
    });
    const advance = await season.finalizeWeekAndAdvance({ leagueId });
    // Post-week analytics in the background — display data, never worth
    // failing (or delaying) the week advance over. Odds first so the recap
    // reads fresh playoff numbers.
    montecarlo
      .computeLeagueOdds({ leagueId })
      .catch((err) => {
        console.error('power rankings failed for league %s:', leagueId, err.message);
      })
      .then(() => {
        const recap = require('../services/recap.service');
        return recap.generateWeeklyRecap({
          leagueId,
          season: current_season,
          week: current_week, // the week just finalized
        });
      })
      .catch((err) => {
        console.error('weekly recap failed for league %s:', leagueId, err.message);
      })
      .then(() => {
        const trophies = require('../services/trophy.service');
        return trophies.awardWeeklyTrophies({ leagueId, season: current_season, week: current_week });
      })
      .catch((err) => {
        console.error('trophy awards failed for league %s:', leagueId, err.message);
      })
      .then(() => {
        const digest = require('../services/digest.service');
        return digest.sendWeeklyRecapDigest({ leagueId, season: current_season, week: current_week });
      })
      .catch((err) => {
        console.error('recap digest failed for league %s:', leagueId, err.message);
      });
    res.json({ scored: scoredResult.scored, ...advance });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Advance week failed:', error);
    res.status(500).json({ error: 'failed to advance week' });
  }
});

module.exports = router;
