const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { getIo } = require('../modules/io');
const { getDraftState } = require('../modules/draftSocket');

const router = express.Router();
router.use(requireAuth);

function intOrNull(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

async function myTeam(leagueId, userId) {
  const result = await pool.query(
    `SELECT * FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
    [leagueId, userId]
  );
  return result.rows[0] || null;
}

// GET /api/draft/queue?leagueId=N — the caller's pre-draft queue, in order
router.get('/queue', async (req, res) => {
  const leagueId = intOrNull(req.query.leagueId);
  if (!leagueId) return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  try {
    const team = await myTeam(leagueId, req.user.id);
    if (!team) return res.status(403).json({ error: 'you do not have a team in this league' });
    const result = await pool.query(
      `SELECT "players"."id", "players"."name", "players"."position", "players"."nfl_team",
              "draft_queue"."rank"
       FROM "draft_queue" JOIN "players" ON "players"."id" = "draft_queue"."player_id"
       WHERE "draft_queue"."team_id" = $1
       ORDER BY "draft_queue"."rank"`,
      [team.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching draft queue', error);
    res.status(500).json({ error: 'failed to fetch draft queue' });
  }
});

// PUT /api/draft/queue — replace the caller's queue with an ordered list
// { leagueId, playerIds: [best, next, ...] }
router.put('/queue', async (req, res) => {
  const { leagueId, playerIds } = req.body || {};
  if (!Number.isInteger(leagueId)) {
    return res.status(400).json({ error: 'leagueId (integer) is required' });
  }
  if (!Array.isArray(playerIds) || playerIds.some((id) => !Number.isInteger(id)) ||
      new Set(playerIds).size !== playerIds.length || playerIds.length > 100) {
    return res.status(400).json({ error: 'playerIds must be a list of unique integers (max 100)' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const teamResult = await client.query(
      `SELECT "id" FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2 FOR UPDATE`,
      [leagueId, req.user.id]
    );
    const team = teamResult.rows[0];
    if (!team) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'you do not have a team in this league' });
    }
    await client.query(`DELETE FROM "draft_queue" WHERE "team_id" = $1`, [team.id]);
    for (let i = 0; i < playerIds.length; i++) {
      await client.query(
        `INSERT INTO "draft_queue" ("league_id", "team_id", "player_id", "rank")
         VALUES ($1, $2, $3, $4)`,
        [leagueId, team.id, playerIds[i], i + 1]
      );
    }
    await client.query('COMMIT');
    res.json({ leagueId, teamId: team.id, queued: playerIds.length });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23503') {
      return res.status(400).json({ error: 'unknown player in queue' });
    }
    console.error('Error saving draft queue', error);
    res.status(500).json({ error: 'failed to save draft queue' });
  } finally {
    client.release();
  }
});

// POST /api/draft/league/:id/order — commissioner sets or randomizes draft order
// { order: [teamId, ...] } or { randomize: true }; draft must be pending
router.post('/league/:id/order', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const { order, randomize } = req.body || {};
  if (!randomize && (!Array.isArray(order) || order.some((id) => !Number.isInteger(id)))) {
    return res.status(400).json({ error: 'provide order (array of team ids) or randomize: true' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2 FOR UPDATE`,
      [leagueId, req.user.id]
    );
    if (!leagueResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'league not found or you are not the owner' });
    }
    if (leagueResult.rows[0].draft_status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'draft order is locked once the draft starts' });
    }
    const teamsResult = await client.query(
      `SELECT "id" FROM "teams" WHERE "league_id" = $1`,
      [leagueId]
    );
    const teamIds = teamsResult.rows.map((r) => r.id);
    let finalOrder;
    if (randomize) {
      finalOrder = [...teamIds];
      for (let i = finalOrder.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [finalOrder[i], finalOrder[j]] = [finalOrder[j], finalOrder[i]];
      }
    } else {
      const valid = order.length === teamIds.length && teamIds.every((id) => order.includes(id));
      if (!valid) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'order must contain every team in the league exactly once' });
      }
      finalOrder = order;
    }
    for (let i = 0; i < finalOrder.length; i++) {
      await client.query(
        `UPDATE "teams" SET "draft_position" = $1, "updated_at" = now() WHERE "id" = $2`,
        [i + 1, finalOrder[i]]
      );
    }
    await client.query('COMMIT');
    res.json({ leagueId, order: finalOrder });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error setting draft order', error);
    res.status(500).json({ error: 'failed to set draft order' });
  } finally {
    client.release();
  }
});

// POST /api/draft/league/:id/pause — commissioner pauses/resumes an active draft
// { paused: true|false }; resuming restarts the pick clock
router.post('/league/:id/pause', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const { paused } = req.body || {};
  if (typeof paused !== 'boolean') {
    return res.status(400).json({ error: 'paused (boolean) is required' });
  }
  try {
    const result = await pool.query(
      `UPDATE "leagues"
       SET "draft_paused" = $1,
           "pick_deadline_at" = CASE
             WHEN $1 THEN NULL
             WHEN "pick_time_seconds" > 0 THEN now() + make_interval(secs => "pick_time_seconds")
             ELSE NULL
           END,
           "updated_at" = now()
       WHERE "id" = $2 AND "owner_id" = $3 AND "draft_status" = 'active'
       RETURNING "id", "draft_paused", "pick_deadline_at"`,
      [paused, leagueId, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'league not found, not owner, or draft not active' });
    }
    const io = getIo();
    if (io) {
      const state = await getDraftState(leagueId);
      io.to(`league:${leagueId}`).emit('draft:state', state);
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error pausing draft', error);
    res.status(500).json({ error: 'failed to pause draft' });
  }
});

module.exports = router;
