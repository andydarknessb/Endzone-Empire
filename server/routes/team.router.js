const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { draftPlayer, dropPlayer } = require('../services/draft.service');
const { getLineup, setLineup } = require('../services/lineup.service');

const router = express.Router();
router.use(requireAuth);

// GET /api/team/roster?leagueId=N — the caller's roster in a league
router.get('/roster', async (req, res) => {
  const leagueId = req.query.leagueId;
  if (!/^\d+$/.test(String(leagueId))) {
    return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  }
  try {
    const result = await pool.query(
      `SELECT "players".*, "team_players"."created_at" AS "acquired_at", "teams"."id" AS "team_id"
       FROM "team_players"
       JOIN "players" ON "players"."id" = "team_players"."player_id"
       JOIN "teams" ON "teams"."id" = "team_players"."team_id"
       WHERE "teams"."league_id" = $1 AND "teams"."owner_id" = $2
       ORDER BY "players"."position", "players"."name"`,
      [Number(leagueId), req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching roster', error);
    res.status(500).json({ error: 'failed to fetch roster' });
  }
});

// POST /api/team/roster/:playerId — add a player (free agency); transactional
router.post('/roster/:playerId', async (req, res) => {
  if (!/^\d+$/.test(req.params.playerId)) {
    return res.status(400).json({ error: 'playerId must be a positive integer' });
  }
  const leagueId = req.body && req.body.leagueId;
  if (!Number.isInteger(leagueId) || leagueId < 1) {
    return res.status(400).json({ error: 'leagueId (integer) is required in the body' });
  }
  try {
    const outcome = await draftPlayer({
      leagueId,
      userId: req.user.id,
      playerId: Number(req.params.playerId),
    });
    res.status(201).json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error adding player to roster', error);
    res.status(500).json({ error: 'failed to add player' });
  }
});

// DELETE /api/team/roster/:playerId — drop a player; transactional
router.delete('/roster/:playerId', async (req, res) => {
  if (!/^\d+$/.test(req.params.playerId)) {
    return res.status(400).json({ error: 'playerId must be a positive integer' });
  }
  const leagueId = req.query.leagueId;
  if (!/^\d+$/.test(String(leagueId))) {
    return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  }
  try {
    const outcome = await dropPlayer({
      leagueId: Number(leagueId),
      userId: req.user.id,
      playerId: Number(req.params.playerId),
    });
    res.json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error dropping player', error);
    res.status(500).json({ error: 'failed to drop player' });
  }
});

// GET /api/team/lineup?leagueId=N&week=W — the caller's weekly lineup
// (materialized on first view; carries forward from the previous week)
router.get('/lineup', async (req, res) => {
  const leagueId = req.query.leagueId;
  if (!/^\d+$/.test(String(leagueId))) {
    return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  }
  const week = req.query.week === undefined ? undefined : req.query.week;
  if (week !== undefined && !/^\d+$/.test(String(week))) {
    return res.status(400).json({ error: 'week must be a positive integer' });
  }
  try {
    const lineup = await getLineup({
      leagueId: Number(leagueId),
      userId: req.user.id,
      week: week === undefined ? undefined : Number(week),
    });
    res.json(lineup);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching lineup', error);
    res.status(500).json({ error: 'failed to fetch lineup' });
  }
});

// PUT /api/team/lineup — move players between slots; the whole batch is
// validated and applied atomically (slot counts, eligibility, lineup locks)
router.put('/lineup', async (req, res) => {
  const { leagueId, week, moves } = req.body || {};
  if (!Number.isInteger(leagueId) || leagueId < 1) {
    return res.status(400).json({ error: 'leagueId (integer) is required in the body' });
  }
  if (week !== undefined && (!Number.isInteger(week) || week < 1)) {
    return res.status(400).json({ error: 'week must be a positive integer' });
  }
  try {
    const outcome = await setLineup({ leagueId, userId: req.user.id, week, moves });
    res.json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error setting lineup', error);
    res.status(500).json({ error: 'failed to set lineup' });
  }
});

// PUT /api/team/:id — rename the caller's team
router.put('/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.status(400).json({ error: 'team id must be a positive integer' });
  }
  const { name } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const result = await pool.query(
      `UPDATE "teams" SET "name" = $1, "updated_at" = now()
       WHERE "id" = $2 AND "owner_id" = $3 RETURNING *`,
      [name, Number(req.params.id), req.user.id]
    );
    if (!result.rows[0]) return res.status(403).json({ error: 'team not found or not yours' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error renaming team', error);
    res.status(500).json({ error: 'failed to rename team' });
  }
});

module.exports = router;
