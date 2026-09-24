const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const waivers = require('../services/waiver.service');
const { waiverSuggestions } = require('../services/decision.service');
const { isLeagueCommissioner } = require('../services/leagueRole.service');
const { requireMember } = require('../services/leagueMembership.service');
const { deriveNflWeek, getSeasonWeekBounds } = require('../services/pickemSeason.service');

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
      `SELECT "waiver_type", "waiver_period_hours", "faab_budget", "waivers_clear_at", "current_season"
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
              "drop"."name" AS "drop_player_name",
              "winner"."name" AS "winning_team_name",
              "waiver_players"."available_at" AS "clear_at"
       FROM "waiver_claims"
       JOIN "players" "add" ON "add"."id" = "waiver_claims"."player_id"
       LEFT JOIN "players" "drop" ON "drop"."id" = "waiver_claims"."drop_player_id"
       LEFT JOIN "teams" "winner" ON "winner"."id" = "waiver_claims"."winning_team_id"
       LEFT JOIN "waiver_players" ON "waiver_players"."league_id" = $2
         AND "waiver_players"."player_id" = "waiver_claims"."player_id"
       WHERE "waiver_claims"."team_id" = $1
       ORDER BY "waiver_claims"."created_at" DESC
       LIMIT 50`,
      [team.id, leagueId]
    );
    // Each claim's own Clear time rides only on pending claims, and the week a
    // claim resolved in only on resolved ones (won/lost/invalid): the same
    // Pick'em rollover deriveNflWeek applies, bounds loaded once per request
    // (ADR 0049; #1612 Ruling).
    const resolved = claimsResult.rows.filter(
      (c) => c.processed_at && ['won', 'lost', 'invalid'].includes(c.status)
    );
    const weekBounds = resolved.length
      ? await getSeasonWeekBounds({ season: leagueResult.rows[0]?.current_season })
      : [];
    const myClaims = claimsResult.rows.map((c) => ({
      ...c,
      clear_at: c.status === 'pending' ? c.clear_at ?? null : null,
      week: resolved.includes(c) ? deriveNflWeek(weekBounds, new Date(c.processed_at)) : null,
    }));
    res.json({
      league: leagueResult.rows[0],
      myTeam: team,
      onWaivers: onWaiversResult.rows,
      myClaims,
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

// PUT /api/waivers/claims/order — set the caller's Claim order (ADR 0048)
// { leagueId, claimIds: [...] }: exactly the caller's pending claim ids for the
// league, each once; a mismatch is a coded 409 (CLAIM_ORDER_MISMATCH).
router.put('/claims/order', async (req, res) => {
  const { leagueId, claimIds } = req.body || {};
  if (!Number.isInteger(leagueId) || !Array.isArray(claimIds) || !claimIds.every(Number.isInteger)) {
    return res.status(400).json({ error: 'leagueId (integer) and claimIds (array of integers) are required' });
  }
  try {
    const result = await waivers.reorderClaims({ leagueId, userId: req.user.id, claimIds });
    res.json(result);
  } catch (error) {
    // A coded refusal is { code, message } (ADR 0032); a codeless one keeps { error }.
    if (error.statusCode && error.code) return res.status(error.statusCode).json({ code: error.code, message: error.message });
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error reordering waiver claims', error);
    res.status(500).json({ error: 'failed to reorder claims' });
  }
});

// PATCH /api/waivers/claim/:id — edit the caller's own pending claim
// { bid?, dropPlayerId? } (#1580). claim_order and created_at never change.
// A coded refusal is { code, message } (ADR 0032).
router.patch('/claim/:id', async (req, res) => {
  const claimId = intOrNull(req.params.id);
  if (!claimId) return res.status(400).json({ error: 'claim id (integer) is required' });
  const { bid, dropPlayerId } = req.body || {};
  if (bid !== undefined && !Number.isInteger(bid)) {
    return res.status(400).json({ error: 'bid must be an integer' });
  }
  if (dropPlayerId !== undefined && dropPlayerId !== null && !Number.isInteger(dropPlayerId)) {
    return res.status(400).json({ error: 'dropPlayerId must be an integer or null' });
  }
  try {
    const claim = await waivers.editClaim({ userId: req.user.id, claimId, bid, dropPlayerId });
    res.json(claim);
  } catch (error) {
    if (error.statusCode && error.code) return res.status(error.statusCode).json({ code: error.code, message: error.message });
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error editing waiver claim', error);
    res.status(500).json({ error: 'failed to edit claim' });
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
