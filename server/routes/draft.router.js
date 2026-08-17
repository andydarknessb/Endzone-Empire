const express = require('express');
const crypto = require('crypto');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { getIo } = require('../modules/io');
const { getDraftState } = require('../modules/draftSocket');
const { teamForPick } = require('../services/draftOrder.service');
const { draftPlayer, DraftError, nextPickClockSeconds } = require('../services/draft.service');
const { validateKeepers, undoTargets } = require('../services/draftValidation.service');
const { isLeagueCommissioner, commissionerPredicate, requireMember } = require('../services/leagueRole.service');
const { requireFantasyLeague } = require('../services/leagueType');

const router = express.Router();

function intOrNull(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

// GET /api/draft/board/:token — PUBLIC presenter-mode board (no auth). Must
// stay registered before router.use(requireAuth) below.
router.get('/board/:token', async (req, res) => {
  const { token } = req.params;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }
  try {
    const leagueResult = await pool.query(
      `SELECT "id" FROM "leagues" WHERE "draft_share_token" = $1`,
      [token]
    );
    const league = leagueResult.rows[0];
    if (!league) return res.status(404).json({ error: 'invalid presenter link' });
    const state = await getDraftState(league.id);
    if (!state) return res.status(404).json({ error: 'invalid presenter link' });
    // Anonymous viewers only get what's already visible on the draft board —
    // strip anything that identifies a real account.
    delete state.league.owner_id;
    delete state.league.invite_code;
    state.teams = state.teams.map(({ owner_id, ...team }) => team);
    if (state.onTheClock) {
      const { owner_id, ...clock } = state.onTheClock;
      state.onTheClock = clock;
    }
    res.json(state);
  } catch (error) {
    console.error('Error fetching presenter board', error);
    res.status(500).json({ error: 'failed to fetch draft board' });
  }
});

router.use(requireAuth);
// A pick'em-only league has no draft: every write under /league/:id (order,
// pause, autodraft, clock, undo, reset, ready, keepers, offline picks, share
// token) fails closed with 409 PICKEM_ONLY_LEAGUE; reads pass untouched.
router.use('/league/:id', requireFantasyLeague());

// GET /api/draft/queue?leagueId=N — the caller's pre-draft queue, in order
router.get('/queue', async (req, res) => {
  const leagueId = intOrNull(req.query.leagueId);
  if (!leagueId) return res.status(400).json({ error: 'leagueId query param (integer) is required' });
  try {
    const team = await requireMember(pool, { leagueId, userId: req.user.id });
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
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching draft queue', error);
    res.status(500).json({ error: 'failed to fetch draft queue' });
  }
});

// PUT /api/draft/queue — replace the caller's queue with an ordered list
// { leagueId, playerIds: [best, next, ...] }. The league id travels in the
// body, so the /league/:id blanket mount above cannot see it: guard here.
router.put('/queue', requireFantasyLeague({ param: 'leagueId', from: 'body' }), async (req, res) => {
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
    const team = await requireMember(client, { leagueId, userId: req.user.id, forUpdate: true });
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
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
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
      `SELECT * FROM "leagues" WHERE "id" = $1 AND ${commissionerPredicate(2)} FOR UPDATE`,
      [leagueId, req.user.id]
    );
    if (!leagueResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'league not found or you are not the commissioner' });
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
       WHERE "id" = $2 AND ${commissionerPredicate(3)} AND "draft_status" = 'active'
       RETURNING "id", "draft_paused", "pick_deadline_at"`,
      [paused, leagueId, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'league not found, not commissioner, or draft not active' });
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

// POST /api/draft/league/:id/teams/:teamId/autodraft — enable/disable autodraft
// for one team. The team's own owner or the league commissioner may toggle it.
// { enabled: boolean }
router.post('/league/:id/teams/:teamId/autodraft', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  const teamId = intOrNull(req.params.teamId);
  if (!leagueId || !teamId) {
    return res.status(400).json({ error: 'league id and team id must be positive integers' });
  }
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) is required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT "owner_id", "draft_status", "current_pick", "draft_paused", "autodraft_delay_seconds",
              "draft_rotation", "draft_order_overrides"
       FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'league not found' });
    }
    const teamResult = await client.query(
      `SELECT "id", "owner_id" FROM "teams" WHERE "id" = $1 AND "league_id" = $2`,
      [teamId, leagueId]
    );
    const team = teamResult.rows[0];
    if (!team) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'team not found in this league' });
    }
    const isCommissioner = await isLeagueCommissioner(client, leagueId, req.user.id);
    const isTeamOwner = team.owner_id === req.user.id;
    if (!isCommissioner && !isTeamOwner) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'only the team owner or commissioner can change autodraft' });
    }
    // Turning autodraft off (the owner is back) clears any timeout streak.
    await client.query(
      `UPDATE "teams" SET "autodraft" = $1,
              "consecutive_timeouts" = CASE WHEN $1 THEN "consecutive_timeouts" ELSE 0 END,
              "updated_at" = now()
       WHERE "id" = $2`,
      [enabled, teamId]
    );
    // Enabling for the team currently on the clock applies the short autodraft
    // delay right away, so an absent owner's pick fires promptly.
    if (enabled && league.draft_status === 'active' && !league.draft_paused) {
      const teams = await client.query(
        `SELECT "id" FROM "teams" WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
        [leagueId]
      );
      const onClock = teamForPick(league.current_pick, teams.rows, {
        rotation: league.draft_rotation,
        overrides: league.draft_order_overrides,
      });
      if (onClock && onClock.id === teamId) {
        await client.query(
          `UPDATE "leagues"
           SET "pick_deadline_at" = now() + make_interval(secs => GREATEST(1, "autodraft_delay_seconds"))
           WHERE "id" = $1`,
          [leagueId]
        );
      }
    }
    await client.query('COMMIT');
    const io = getIo();
    if (io) {
      io.to(`league:${leagueId}`).emit('draft:state', await getDraftState(leagueId));
    }
    res.json({ leagueId, teamId, autodraft: enabled });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error toggling autodraft', error);
    res.status(500).json({ error: 'failed to toggle autodraft' });
  } finally {
    client.release();
  }
});

// POST /api/draft/league/:id/clock — commissioner changes the pick clock
// mid-schedule or mid-draft. Never recomputes the *live* deadline — it takes
// effect starting with the next pick (pause→resume re-arms it sooner if
// immediate effect is wanted). { pickTimeSeconds: 0-3600 }
router.post('/league/:id/clock', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const { pickTimeSeconds } = req.body || {};
  if (!Number.isInteger(pickTimeSeconds) || pickTimeSeconds < 0 || pickTimeSeconds > 3600) {
    return res.status(400).json({ error: 'pickTimeSeconds must be an integer between 0 and 3600 (0 = untimed)' });
  }
  try {
    const result = await pool.query(
      `UPDATE "leagues" SET "pick_time_seconds" = $1, "updated_at" = now()
       WHERE "id" = $2 AND ${commissionerPredicate(3)} AND "draft_status" IN ('pending', 'active')
       RETURNING "id"`,
      [pickTimeSeconds, leagueId, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'league not found, not commissioner, or the draft has already finished' });
    }
    const io = getIo();
    if (io) io.to(`league:${leagueId}`).emit('draft:state', await getDraftState(leagueId));
    res.json({ leagueId, pickTimeSeconds });
  } catch (error) {
    console.error('Error setting pick clock', error);
    res.status(500).json({ error: 'failed to set the pick clock' });
  }
});

// POST /api/draft/league/:id/undo — commissioner undoes the last N live picks.
// Refuses to cross a keeper pick; only picks already reached by live play are
// eligible (a keeper pre-filled far ahead of the current pick must never
// block undoing recent live picks just because it has a higher pick_number).
// { count: 1-10, default 1 }
router.post('/league/:id/undo', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const count = req.body?.count === undefined ? 1 : req.body.count;
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    return res.status(400).json({ error: 'count must be an integer between 1 and 10' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 AND ${commissionerPredicate(2)} AND "draft_status" = 'active' FOR UPDATE`,
      [leagueId, req.user.id]
    );
    const league = leagueResult.rows[0];
    if (!league) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'league not found, not commissioner, or draft not active' });
    }
    const picksResult = await client.query(
      `SELECT "pick_number", "team_id", "player_id", "is_keeper" FROM "draft_picks"
       WHERE "league_id" = $1 AND "pick_number" <= $2`,
      [leagueId, league.current_pick]
    );
    const { targets, error: undoError } = undoTargets(picksResult.rows, count);
    if (undoError) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: undoError });
    }
    const targetRows = picksResult.rows.filter((p) => targets.includes(p.pick_number));
    for (const row of targetRows) {
      await client.query(
        `DELETE FROM "draft_picks" WHERE "league_id" = $1 AND "pick_number" = $2`,
        [leagueId, row.pick_number]
      );
      await client.query(
        `DELETE FROM "team_players" WHERE "league_id" = $1 AND "team_id" = $2 AND "player_id" = $3`,
        [leagueId, row.team_id, row.player_id]
      );
    }
    // The earliest undone pick's own slot was itself open (a live pick, never
    // a keeper) before it was made, so rewinding current_pick straight to it
    // reproduces the exact pre-pick state — no re-scan for open slots needed.
    const newCurrentPick = Math.min(...targets) - 1;
    const teamsResult = await client.query(
      `SELECT "id", "autodraft" FROM "teams" WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const rotationOpts = { rotation: league.draft_rotation, overrides: league.draft_order_overrides };
    const onClock = teamForPick(newCurrentPick, teamsResult.rows, rotationOpts);
    const clockSeconds = league.draft_type === 'offline' ? null : nextPickClockSeconds({
      draftComplete: false,
      nextTeamAutodraft: onClock ? onClock.autodraft : false,
      pickTimeSeconds: league.pick_time_seconds,
      autodraftDelaySeconds: league.autodraft_delay_seconds,
    });
    await client.query(
      `UPDATE "leagues"
       SET "current_pick" = $1, "updated_at" = now(),
           "pick_deadline_at" = CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(secs => $3::int) END
       WHERE "id" = $2`,
      [newCurrentPick, leagueId, clockSeconds]
    );
    await client.query('COMMIT');
    const io = getIo();
    if (io) io.to(`league:${leagueId}`).emit('draft:state', await getDraftState(leagueId));
    res.json({ leagueId, undone: targets.length, currentPick: newCurrentPick });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error undoing draft pick', error);
    res.status(500).json({ error: 'failed to undo the pick' });
  } finally {
    client.release();
  }
});

// POST /api/draft/league/:id/reset — commissioner, destructive: wipes every
// pick made so far and returns the league to pending. The keepers table
// itself is untouched — the next start re-applies them fresh.
router.post('/league/:id/reset', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT "id" FROM "leagues" WHERE "id" = $1 AND ${commissionerPredicate(2)} AND "draft_status" = 'active' FOR UPDATE`,
      [leagueId, req.user.id]
    );
    if (!leagueResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'league not found, not commissioner, or draft not active' });
    }
    await client.query(`DELETE FROM "team_players" WHERE "league_id" = $1`, [leagueId]);
    await client.query(`DELETE FROM "draft_picks" WHERE "league_id" = $1`, [leagueId]);
    await client.query(
      `UPDATE "teams" SET "autodraft" = false, "draft_ready" = false, "consecutive_timeouts" = 0, "updated_at" = now()
       WHERE "league_id" = $1`,
      [leagueId]
    );
    // draft_date is nulled so the 5-minute scheduler doesn't immediately
    // auto-restart the draft it just reset.
    await client.query(
      `UPDATE "leagues"
       SET "draft_status" = 'pending', "current_pick" = 0, "draft_paused" = false,
           "pick_deadline_at" = NULL, "draft_date" = NULL, "draft_reminder_stage" = 0,
           "draft_autostart_failed" = false, "updated_at" = now()
       WHERE "id" = $1`,
      [leagueId]
    );
    await client.query('COMMIT');
    const io = getIo();
    if (io) io.to(`league:${leagueId}`).emit('draft:state', await getDraftState(leagueId));
    res.json({ leagueId, reset: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error resetting draft', error);
    res.status(500).json({ error: 'failed to reset the draft' });
  } finally {
    client.release();
  }
});

// POST /api/draft/league/:id/ready — any team owner marks their own team
// ready/not-ready for a pending draft. { ready: boolean }
router.post('/league/:id/ready', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const { ready } = req.body || {};
  if (typeof ready !== 'boolean') {
    return res.status(400).json({ error: 'ready (boolean) is required' });
  }
  try {
    const result = await pool.query(
      `UPDATE "teams" SET "draft_ready" = $1, "updated_at" = now()
       FROM "leagues"
       WHERE "teams"."league_id" = "leagues"."id"
         AND "teams"."league_id" = $2 AND "teams"."owner_id" = $3
         AND "leagues"."draft_status" = 'pending'
       RETURNING "teams"."id"`,
      [ready, leagueId, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'not a member of this league, or the draft is not pending' });
    }
    const io = getIo();
    if (io) io.to(`league:${leagueId}`).emit('draft:state', await getDraftState(leagueId));
    res.json({ leagueId, ready });
  } catch (error) {
    console.error('Error updating draft readiness', error);
    res.status(500).json({ error: 'failed to update readiness' });
  }
});

// GET /api/draft/league/:id/keepers — any league member views the current keeper board
router.get('/league/:id/keepers', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    await requireMember(pool, { leagueId, userId: req.user.id });
    const result = await pool.query(
      `SELECT "keepers"."team_id", "keepers"."player_id", "keepers"."draft_round",
              "players"."name", "players"."position", "players"."nfl_team"
       FROM "keepers" JOIN "players" ON "players"."id" = "keepers"."player_id"
       WHERE "keepers"."league_id" = $1
       ORDER BY "keepers"."draft_round", "keepers"."team_id"`,
      [leagueId]
    );
    res.json(result.rows);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error fetching keepers', error);
    res.status(500).json({ error: 'failed to fetch keepers' });
  }
});

// GET /api/draft/league/:id/keeper-candidates — commissioner-only roster
// players grouped client-side by team for keeper assignment. A team with no
// roster deliberately returns no candidates: keeper validation permits a
// player search in that pre-season case.
router.get('/league/:id/keeper-candidates', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    if (!(await isLeagueCommissioner(pool, leagueId, req.user.id))) {
      return res.status(403).json({ error: 'league not found or you are not the commissioner' });
    }
    const result = await pool.query(
      `SELECT "team_players"."team_id", "players"."id", "players"."name", "players"."position", "players"."nfl_team"
       FROM "team_players" JOIN "players" ON "players"."id" = "team_players"."player_id"
       WHERE "team_players"."league_id" = $1
       ORDER BY "team_players"."team_id", "players"."position", "players"."name"`,
      [leagueId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching keeper candidates', error);
    res.status(500).json({ error: 'failed to fetch keeper candidates' });
  }
});

// PUT /api/draft/league/:id/keepers — commissioner replace-all
// { keepers: [{ teamId, playerId, round }] }
router.put('/league/:id/keepers', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const { keepers } = req.body || {};
  if (!Array.isArray(keepers)) {
    return res.status(400).json({ error: 'keepers must be an array' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT "draft_status", "roster_limit", "keeper_count", "keeper_lock_at", "draft_date",
              ${commissionerPredicate(2)} AS "is_commissioner"
       FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId, req.user.id]
    );
    const league = leagueResult.rows[0];
    if (!league || !league.is_commissioner) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'league not found or you are not the commissioner' });
    }
    if (league.draft_status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'keepers can only be edited before the draft starts' });
    }
    const lockAt = league.keeper_lock_at || league.draft_date;
    if (lockAt && new Date(lockAt).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'the keeper deadline has passed' });
    }
    const teamsResult = await client.query(`SELECT "id" FROM "teams" WHERE "league_id" = $1`, [leagueId]);
    const rosterResult = await client.query(
      `SELECT "team_id", "player_id" FROM "team_players" WHERE "league_id" = $1`,
      [leagueId]
    );
    const rosterByTeam = new Map();
    for (const row of rosterResult.rows) {
      if (!rosterByTeam.has(row.team_id)) rosterByTeam.set(row.team_id, new Set());
      rosterByTeam.get(row.team_id).add(row.player_id);
    }
    const normalized = keepers.map((k) => ({ teamId: k.teamId, playerId: k.playerId, round: k.round }));
    const errors = validateKeepers(normalized, {
      teams: teamsResult.rows,
      rosterByTeam,
      keeperCount: league.keeper_count,
      rosterLimit: league.roster_limit,
    });
    if (errors.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: errors.join('; ') });
    }
    await client.query(`DELETE FROM "keepers" WHERE "league_id" = $1`, [leagueId]);
    for (const k of normalized) {
      await client.query(
        `INSERT INTO "keepers" ("league_id", "team_id", "player_id", "draft_round")
         VALUES ($1, $2, $3, $4)`,
        [leagueId, k.teamId, k.playerId, k.round]
      );
    }
    await client.query('COMMIT');
    res.json({ leagueId, keepers: normalized.length });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23503') {
      return res.status(400).json({ error: 'unknown team or player in keepers list' });
    }
    console.error('Error saving keepers', error);
    res.status(500).json({ error: 'failed to save keepers' });
  } finally {
    client.release();
  }
});

// POST /api/draft/league/:id/offline-picks — commissioner bulk-enters picks
// for an active offline draft. Stops at the first rejected pick so the
// commissioner can see exactly where it went wrong. { playerIds: [...] }
router.post('/league/:id/offline-picks', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const { playerIds } = req.body || {};
  if (!Array.isArray(playerIds) || playerIds.length === 0 || playerIds.some((id) => !Number.isInteger(id))) {
    return res.status(400).json({ error: 'playerIds must be a non-empty array of integers' });
  }
  try {
    const leagueResult = await pool.query(
      `SELECT "draft_status", "draft_type", ${commissionerPredicate(2)} AS "is_commissioner"
       FROM "leagues" WHERE "id" = $1`,
      [leagueId, req.user.id]
    );
    const league = leagueResult.rows[0];
    if (!league || !league.is_commissioner) {
      return res.status(403).json({ error: 'league not found or you are not the commissioner' });
    }
    if (league.draft_type !== 'offline' || league.draft_status !== 'active') {
      return res.status(409).json({ error: 'offline pick entry requires an active offline draft' });
    }
    let applied = 0;
    let result = { applied };
    for (let i = 0; i < playerIds.length; i++) {
      try {
        await draftPlayer({ leagueId, userId: req.user.id, playerId: playerIds[i], byCommissioner: true });
        applied++;
      } catch (error) {
        const message = error instanceof DraftError || error.statusCode ? error.message : 'pick failed';
        result = { applied, error: message, failedAtIndex: i };
        break;
      }
    }
    if (!result.error) result = { applied };
    const io = getIo();
    if (io && applied > 0) io.to(`league:${leagueId}`).emit('draft:state', await getDraftState(leagueId));
    res.json(result);
  } catch (error) {
    console.error('Error entering offline picks', error);
    res.status(500).json({ error: 'failed to enter offline picks' });
  }
});

// POST /api/draft/league/:id/share-token — commissioner generates or rotates
// the presenter-mode link. Rotating invalidates any previously shared link.
router.post('/league/:id/share-token', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  const token = crypto.randomBytes(24).toString('hex');
  try {
    const result = await pool.query(
      `UPDATE "leagues" SET "draft_share_token" = $1, "updated_at" = now()
       WHERE "id" = $2 AND ${commissionerPredicate(3)}
       RETURNING "id"`,
      [token, leagueId, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'league not found or you are not the commissioner' });
    }
    res.json({ leagueId, token, url: `/#/present/${token}` });
  } catch (error) {
    console.error('Error generating share token', error);
    res.status(500).json({ error: 'failed to generate a share link' });
  }
});

// GET /api/draft/mine — the caller's leagues with a live or scheduled draft
// (Draft Central overview on the My Leagues page).
router.get('/mine', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT "id", "name", "draft_status", "draft_date", "draft_type", "roster_limit",
              (SELECT COUNT(*)::int FROM "draft_picks" WHERE "draft_picks"."league_id" = "leagues"."id") AS "picks_made",
              (SELECT COUNT(*)::int FROM "teams" WHERE "teams"."league_id" = "leagues"."id") AS "team_count"
       FROM "leagues"
       WHERE ${commissionerPredicate(1)}
         AND "pickem_only" = false
         AND "draft_status" IN ('active', 'pending')
       ORDER BY ("draft_status" = 'active') DESC, "draft_date" NULLS LAST`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching draft overview', error);
    res.status(500).json({ error: 'failed to fetch draft overview' });
  }
});

module.exports = router;
