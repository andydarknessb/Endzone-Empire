const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const trades = require('../services/trade.service');

const router = express.Router();
router.use(requireAuth);

function intOrNull(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

// GET /api/trades?leagueId=N — trades involving my team, plus league trades in review
router.get('/', async (req, res) => {
  const leagueId = intOrNull(req.query.leagueId);
  if (!leagueId) return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  try {
    const teamResult = await pool.query(
      `SELECT "id" FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, req.user.id]
    );
    if (!teamResult.rows[0]) return res.status(403).json({ error: 'not a member of this league' });
    const myTeamId = teamResult.rows[0].id;

    const tradesResult = await pool.query(
      `SELECT "trades".*,
              proposing."name" AS "proposing_team_name",
              receiving."name" AS "receiving_team_name"
       FROM "trades"
       JOIN "teams" proposing ON proposing."id" = "trades"."proposing_team_id"
       JOIN "teams" receiving ON receiving."id" = "trades"."receiving_team_id"
       WHERE "trades"."league_id" = $1
         AND ("trades"."proposing_team_id" = $2 OR "trades"."receiving_team_id" = $2
              OR "trades"."status" = 'accepted')
       ORDER BY "trades"."created_at" DESC
       LIMIT 50`,
      [leagueId, myTeamId]
    );
    const ids = tradesResult.rows.map((t) => t.id);
    let items = [];
    if (ids.length > 0) {
      const itemsResult = await pool.query(
        `SELECT "trade_items".*, "players"."name", "players"."position", "players"."nfl_team"
         FROM "trade_items" JOIN "players" ON "players"."id" = "trade_items"."player_id"
         WHERE "trade_items"."trade_id" = ANY($1::int[])`,
        [ids]
      );
      items = itemsResult.rows;
    }
    res.json({
      myTeamId,
      trades: tradesResult.rows.map((t) => ({
        ...t,
        items: items.filter((i) => i.trade_id === t.id),
      })),
    });
  } catch (error) {
    console.error('Error fetching trades', error);
    res.status(500).json({ error: 'failed to fetch trades' });
  }
});

// POST /api/trades — propose { leagueId, receivingTeamId, playerIds: [] }
router.post('/', async (req, res) => {
  const { leagueId, receivingTeamId, playerIds } = req.body || {};
  if (!Number.isInteger(leagueId) || !Number.isInteger(receivingTeamId)) {
    return res.status(400).json({ error: 'leagueId and receivingTeamId (integers) are required' });
  }
  if (!Array.isArray(playerIds) || playerIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: 'playerIds must be an array of integers' });
  }
  try {
    const trade = await trades.proposeTrade({ leagueId, userId: req.user.id, receivingTeamId, playerIds });
    res.status(201).json(trade);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error proposing trade', error);
    res.status(500).json({ error: 'failed to propose trade' });
  }
});

// POST /api/trades/:id/respond — { action: 'accept' | 'reject' }
router.post('/:id/respond', async (req, res) => {
  const tradeId = intOrNull(req.params.id);
  if (!tradeId) return res.status(400).json({ error: 'trade id must be a positive integer' });
  try {
    const outcome = await trades.respondToTrade({
      tradeId,
      userId: req.user.id,
      action: (req.body || {}).action,
    });
    res.json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error responding to trade', error);
    res.status(500).json({ error: 'failed to respond to trade' });
  }
});

// POST /api/trades/:id/cancel — proposer withdraws the offer
router.post('/:id/cancel', async (req, res) => {
  const tradeId = intOrNull(req.params.id);
  if (!tradeId) return res.status(400).json({ error: 'trade id must be a positive integer' });
  try {
    const outcome = await trades.cancelTrade({ tradeId, userId: req.user.id });
    res.json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error cancelling trade', error);
    res.status(500).json({ error: 'failed to cancel trade' });
  }
});

// POST /api/trades/:id/counter — { playerIds: [] } counter-offer
router.post('/:id/counter', async (req, res) => {
  const tradeId = intOrNull(req.params.id);
  if (!tradeId) return res.status(400).json({ error: 'trade id must be a positive integer' });
  const { playerIds } = req.body || {};
  if (!Array.isArray(playerIds) || playerIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: 'playerIds must be an array of integers' });
  }
  try {
    const counter = await trades.counterTrade({ tradeId, userId: req.user.id, playerIds });
    res.status(201).json(counter);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error countering trade', error);
    res.status(500).json({ error: 'failed to counter trade' });
  }
});

// POST /api/trades/:id/veto — league member votes to veto during review
router.post('/:id/veto', async (req, res) => {
  const tradeId = intOrNull(req.params.id);
  if (!tradeId) return res.status(400).json({ error: 'trade id must be a positive integer' });
  try {
    const outcome = await trades.vetoTrade({ tradeId, userId: req.user.id });
    res.json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error vetoing trade', error);
    res.status(500).json({ error: 'failed to veto trade' });
  }
});

// POST /api/trades/:id/decide — commissioner { approve: true|false }
router.post('/:id/decide', async (req, res) => {
  const tradeId = intOrNull(req.params.id);
  if (!tradeId) return res.status(400).json({ error: 'trade id must be a positive integer' });
  const { approve } = req.body || {};
  if (typeof approve !== 'boolean') {
    return res.status(400).json({ error: 'approve (boolean) is required' });
  }
  try {
    const outcome = await trades.commissionerDecide({ tradeId, userId: req.user.id, approve });
    res.json(outcome);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error deciding trade', error);
    res.status(500).json({ error: 'failed to decide trade' });
  }
});

module.exports = router;
