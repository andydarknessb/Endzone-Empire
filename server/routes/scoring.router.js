const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const scoring = require('../services/scoring.service');
const season = require('../services/season.service');

const router = express.Router();
router.use(requireAuth);

async function requireLeagueOwner(req, res, leagueId) {
  const owner = await pool.query(
    `SELECT 1 FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2`,
    [leagueId, req.user.id]
  );
  if (!owner.rows[0]) {
    res.status(403).json({ error: 'only the league owner can do this' });
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
    const owner = await pool.query(
      `SELECT 1 FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!owner.rows[0]) return res.status(403).json({ error: 'only the league owner can do this' });
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
    const owner = await pool.query(
      `SELECT 1 FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!owner.rows[0]) return res.status(403).json({ error: 'only the league owner can do this' });
    const result = await scoring.scoreMatchups({ leagueId, ...sw });
    res.json(result);
  } catch (error) {
    console.error('Matchup scoring failed:', error);
    res.status(500).json({ error: 'matchup scoring failed' });
  }
});

// GET /api/scoring/rules — default rules plus the selectable presets
router.get('/rules', (req, res) => {
  res.json({ defaults: scoring.SCORING_RULES, presets: scoring.SCORING_PRESETS });
});

// POST /api/scoring/sync-schedule — pull the NFL schedule into nfl_games
router.post('/sync-schedule', async (req, res) => {
  const seasonYear = Number(req.body && req.body.season);
  if (!Number.isInteger(seasonYear) || seasonYear < 2000 || seasonYear > 2100) {
    return res.status(400).json({ error: 'season (integer year) is required' });
  }
  try {
    const result = await scoring.syncSchedule({ season: seasonYear });
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Schedule sync failed:', error);
    res.status(500).json({ error: 'schedule sync failed' });
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

// POST /api/scoring/league/:id/schedule — owner generates the full regular season
router.post('/league/:id/schedule', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'league id must be a positive integer' });
  }
  const leagueId = Number(req.params.id);
  try {
    if (!(await requireLeagueOwner(req, res, leagueId))) return;
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
    if (!(await requireLeagueOwner(req, res, leagueId))) return;
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
    res.json({ scored: scoredResult.scored, ...advance });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Advance week failed:', error);
    res.status(500).json({ error: 'failed to advance week' });
  }
});

module.exports = router;
