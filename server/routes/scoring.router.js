const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const scoring = require('../services/scoring.service');

const router = express.Router();
router.use(requireAuth);

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

// GET /api/scoring/rules — expose the scoring rules to the UI
router.get('/rules', (req, res) => {
  res.json(scoring.SCORING_RULES);
});

module.exports = router;
