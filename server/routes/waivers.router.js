const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const waivers = require('../services/waiver.service');
const { waiverSuggestions } = require('../services/decision.service');
const { isLeagueCommissioner } = require('../services/leagueRole.service');
const { requireMember } = require('../services/leagueMembership.service');

const router = express.Router();
router.use(requireAuth);

function intOrNull(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

// GET /api/waivers?leagueId=N — players on waivers + the caller's claims
router.get('/', async (req, res) => {
  const leagueId = intOrNull(req.query.leagueId);
  if (!leagueId) return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  try {
    const team = await requireMember(pool, { leagueId, userId: req.user.id });

    const leagueResult = await pool.query(
      `SELECT "waiver_type", "waiver_period_hours", "faab_budget", "waivers_clear_at"
       FROM "leagues" WHERE "id" = $1`,
      [leagueId]
    );
    const onWaiversResult = await pool.query(
      `SELECT "players".*, "waiver_players"."available_at"
       FROM "waiver_players" JOIN "players" ON "players"."id" = "waiver_players"."player_id"
       WHERE "waiver_players"."league_id" = $1 AND "waiver_players"."available_at" > now()
       ORDER BY "waiver_players"."available_at", "players"."name"`,
      [leagueId]
    );
    const claimsResult = await pool.query(
      `SELECT "waiver_claims".*,
              "add"."name" AS "player_name", "add"."position" AS "player_position",
              "drop"."name" AS "drop_player_name"
       FROM "waiver_claims"
       JOIN "players" "add" ON "add"."id" = "waiver_claims"."player_id"
       LEFT JOIN "players" "drop" ON "drop"."id" = "waiver_claims"."drop_player_id"
       WHERE "waiver_claims"."team_id" = $1
       ORDER BY "waiver_claims"."created_at" DESC
       LIMIT 50`,
      [team.id]
    );
    res.json({
      league: leagueResult.rows[0],
      myTeam: team,
      onWaivers: onWaiversResult.rows,
      myClaims: claimsResult.rows,
    });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching waivers', error);
    res.status(500).json({ error: 'failed to fetch waivers' });
  }
});

// GET /api/waivers/claim-target?leagueId=N&playerId=N - one server-approved
// player selected from Player Browser, including a blanket-waiver player.
router.get('/claim-target', async (req, res) => {
  const leagueId = intOrNull(req.query.leagueId);
  const playerId = intOrNull(req.query.playerId);
  if (!leagueId || !playerId) {
    return res.status(400).json({ error: 'leagueId and playerId query params (integers) are required' });
  }
  try {
    const player = await waivers.claimTarget({ leagueId, userId: req.user.id, playerId });
    res.json({ player });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching waiver claim target', error);
    res.status(500).json({ error: 'failed to fetch waiver claim target' });
  }
});

// GET /api/waivers/suggestions?leagueId=N&season=S&week=W — ranked upgrade
// candidates for the caller's team (season/week optional — league defaults)
router.get('/suggestions', async (req, res) => {
  const leagueId = intOrNull(req.query.leagueId);
  if (!leagueId) return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  const season = req.query.season === undefined ? undefined : intOrNull(req.query.season);
  if (req.query.season !== undefined && !season) {
    return res.status(400).json({ error: 'season must be a positive integer' });
  }
  const week = req.query.week === undefined ? undefined : intOrNull(req.query.week);
  if (req.query.week !== undefined && !week) {
    return res.status(400).json({ error: 'week must be a positive integer' });
  }
  try {
    const result = await waiverSuggestions({ leagueId, userId: req.user.id, season, week });
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching waiver suggestions', error);
    res.status(500).json({ error: 'failed to fetch waiver suggestions' });
  }
});

// POST /api/waivers/claim — submit a claim { leagueId, playerId, dropPlayerId?, bid? }
router.post('/claim', async (req, res) => {
  const { leagueId, playerId, dropPlayerId, bid } = req.body || {};
  if (!Number.isInteger(leagueId) || !Number.isInteger(playerId)) {
    return res.status(400).json({ error: 'leagueId and playerId (integers) are required' });
  }
  if (dropPlayerId !== undefined && dropPlayerId !== null && !Number.isInteger(dropPlayerId)) {
    return res.status(400).json({ error: 'dropPlayerId must be an integer' });
  }
  if (bid !== undefined && !Number.isInteger(bid)) {
    return res.status(400).json({ error: 'bid must be an integer' });
  }
  try {
    const claim = await waivers.submitClaim({
      leagueId,
      userId: req.user.id,
      playerId,
      dropPlayerId: dropPlayerId || null,
      bid: bid || 0,
    });
    res.status(201).json(claim);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error submitting waiver claim', error);
    res.status(500).json({ error: 'failed to submit claim' });
  }
});

// DELETE /api/waivers/claim/:id?leagueId=N — cancel a pending claim
router.delete('/claim/:id', async (req, res) => {
  const claimId = intOrNull(req.params.id);
  const leagueId = intOrNull(req.query.leagueId);
  if (!claimId || !leagueId) {
    return res.status(400).json({ error: 'claim id and leagueId (integers) are required' });
  }
  try {
    const claim = await waivers.cancelClaim({ leagueId, userId: req.user.id, claimId });
    res.json(claim);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error cancelling claim', error);
    res.status(500).json({ error: 'failed to cancel claim' });
  }
});

// POST /api/waivers/process — commissioner manually runs waiver processing
router.post('/process', async (req, res) => {
  const { leagueId } = req.body || {};
  if (!Number.isInteger(leagueId)) {
    return res.status(400).json({ error: 'leagueId (integer) is required' });
  }
  try {
    if (!(await isLeagueCommissioner(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'only the commissioner can do this' });
    }
    const result = await waivers.processWaivers({ leagueId });
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error processing waivers', error);
    res.status(500).json({ error: 'failed to process waivers' });
  }
});

module.exports = router;
