const express = require('express');
const crypto = require('crypto');
const pool = require('../modules/pool');
// A pooled transaction closes in one place (ADR 0033): these handlers open no
// BEGIN/COMMIT/ROLLBACK and release no client of their own.
const { withTransaction } = require('../modules/withTransaction');
const { requireAuth } = require('../modules/auth');
// The anonymous presenter board reads its own narrow snapshot (#788), so this
// route no longer imports anything from the Socket.IO attach module.
const { presenterSnapshot } = require('../services/draftRoomSnapshot');
const { isDraftRefusal } = require('../services/draft.service');
// Every Draft operation is a named export of the Draft act module (#947, #938,
// ticket 2697). A route validates its input, calls one operation and maps its
// refusal; the module owns the League lock, the transaction and the fan-out order.
const {
  setPaused,
  setAutodraft,
  setClock,
  reset,
  setReady,
  setOrder,
  saveKeepers,
  correctLatestPick,
} = require('../services/draftAct.service');
// A Pick lands in one place (#782): the offline bulk route commits AND fans out
// each Pick through the one seam, landPick, exactly like a live one.
const { landPick } = require('../services/pick.service');
const { isLeagueCommissioner, commissionerPredicate } = require('../services/leagueRole.service');
const { requireMember } = require('../services/leagueMembership.service');
const { requireFantasyLeague, fantasySideWhereSql } = require('../services/leagueType');
const { listPresenterDraftActivity } = require('../services/leagueFeed');

const router = express.Router();

function intOrNull(value) {
  return /^\d+$/.test(String(value)) ? Number(value) : null;
}

/**
 * Resolve a presenter share token to its league id, or null if the token is
 * unknown. The share token is the presenter's ONLY credential - there is no
 * account behind a presenter link - so this single lookup is the whole of a
 * presenter's authorization: it maps the opaque token to exactly one league and
 * grants nothing else. Both presenter routes go through it, so "a presenter is
 * whoever holds the link, scoped to that one league" lives in one place.
 */
async function presenterLeagueId(token) {
  const result = await pool.query(
    `SELECT "id" FROM "leagues" WHERE "draft_share_token" = $1`,
    [token]
  );
  return result.rows[0] ? result.rows[0].id : null;
}

// GET /api/draft/board/:token — PUBLIC presenter-mode board (no auth). Must
// stay registered before router.use(requireAuth) below.
router.get('/board/:token', async (req, res) => {
  const { token } = req.params;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }
  try {
    const leagueId = await presenterLeagueId(token);
    if (leagueId == null) return res.status(404).json({ error: 'invalid presenter link' });
    // The presenter snapshot (#788) is already narrowed to the published league,
    // team and pick fields at the source - a narrow query, not a redaction of a
    // wide read - so the route just resolves the token and serves it. A field
    // can reach an anonymous viewer only by being named in the snapshot module.
    const state = await presenterSnapshot(leagueId);
    if (!state) return res.status(404).json({ error: 'invalid presenter link' });
    res.json(state);
  } catch (error) {
    console.error('Error fetching presenter board', error);
    res.status(500).json({ error: 'failed to fetch draft board' });
  }
});

// GET /api/draft/board/:token/activity — PUBLIC presenter-safe Draft activity
// feed (#438), the anonymous companion to the presenter board above. It exposes
// the Draft-activity half of the combined feed ALONE: leagueFeed's
// listPresenterDraftActivity reads draft_activity and never chat_messages, so
// League chat, unread state, the composer and commissioner-hidden tombstones
// cannot enter a presenter payload (AC2). Entries are Team-only Pick and
// lifecycle facts (AC3, AC4); `?before=<seq>` pages older and `?after=<seq>`
// resumes newer, the same cursor contract as the member feed. Like the board,
// it must stay registered before router.use(requireAuth) below so a presenter
// link needs no credentials, and it is read-only: a presenter has no send path
// and no commissioner control here (AC5).
router.get('/board/:token/activity', async (req, res) => {
  const { token } = req.params;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'token is required' });
  }
  const before = intOrNull(req.query.before);
  const after = intOrNull(req.query.after);
  try {
    const leagueId = await presenterLeagueId(token);
    if (leagueId == null) return res.status(404).json({ error: 'invalid presenter link' });
    const entries = await listPresenterDraftActivity(pool, {
      leagueId,
      before,
      after,
    });
    res.json(entries);
  } catch (error) {
    console.error('Error fetching presenter activity', error);
    res.status(500).json({ error: 'failed to fetch draft activity' });
  }
});

router.use(requireAuth);
// A pick'em-only league has no draft: every write under /league/:id (order,
// pause, autodraft, clock, reset, ready, keepers, offline picks, share
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
    if (isDraftRefusal(error)) return res.status(error.statusCode).json({ error: error.message });
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
  try {
    const team = await withTransaction(pool, async (client) => {
      const team = await requireMember(client, { leagueId, userId: req.user.id, forUpdate: true });
      await client.query(`DELETE FROM "draft_queue" WHERE "team_id" = $1`, [team.id]);
      for (let i = 0; i < playerIds.length; i++) {
        await client.query(
          `INSERT INTO "draft_queue" ("league_id", "team_id", "player_id", "rank")
           VALUES ($1, $2, $3, $4)`,
          [leagueId, team.id, playerIds[i], i + 1]
        );
      }
      return team;
    }, { label: 'draftQueue' });
    res.json({ leagueId, teamId: team.id, queued: playerIds.length });
  } catch (error) {
    // Ruling 3: the error-code mapping and logging that used to sit in the
    // in-transaction catch move outward, unchanged. withTransaction rethrows the
    // ORIGINAL error from work, so requireMember's refusal and the INSERT's 23503
    // still map exactly as before.
    if (isDraftRefusal(error)) return res.status(error.statusCode).json({ error: error.message });
    if (error.code === '23503') {
      return res.status(400).json({ error: 'unknown player in queue' });
    }
    console.error('Error saving draft queue', error);
    res.status(500).json({ error: 'failed to save draft queue' });
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
  try {
    res.json(await setOrder({ leagueId, userId: req.user.id, order, randomize }));
  } catch (error) {
    if (isDraftRefusal(error)) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error setting draft order', error);
    res.status(500).json({ error: 'failed to set draft order' });
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
  // Both refusals decidable without the database - the leagueId parse above and
  // the paused-boolean check here - stay AHEAD of the act, so the League row is
  // never locked for malformed input.
  try {
    res.json(await setPaused({ leagueId, userId: req.user.id, paused }));
  } catch (error) {
    if (isDraftRefusal(error)) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error pausing draft', error);
    res.status(500).json({ error: 'failed to pause draft' });
  }
});

// POST /api/draft/league/:id/teams/:teamId/autodraft — enable/disable autodraft
// for one team. A manager controls their own Team; a commissioner controls any
// Team in the league.
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
  // Both database-free refusals stay AHEAD of the act, so a malformed request
  // never locks the League row.
  try {
    res.json(await setAutodraft({ leagueId, userId: req.user.id, teamId, enabled }));
  } catch (error) {
    if (isDraftRefusal(error)) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error toggling autodraft', error);
    res.status(500).json({ error: 'failed to toggle autodraft' });
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
    res.json(await setClock({ leagueId, userId: req.user.id, pickTimeSeconds }));
  } catch (error) {
    if (isDraftRefusal(error)) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error setting pick clock', error);
    res.status(500).json({ error: 'failed to set the pick clock' });
  }
});

// POST /api/draft/league/:id/correct-pick — commissioner correction (#439):
// pause the active draft and reverse ONLY its latest non-keeper pick as one
// atomic act, recording a 10-200 character reason, and leave the draft paused.
// This is the safe, reasoned administrative act (CONTEXT.md: Commissioner
// correction), distinct from the destructive Reset below. Every refusal carries a
// stable SCREAMING_SNAKE code (ADR 0008).
// { pickNumber: int (the pick the commissioner confirmed), reason: string }
router.post('/league/:id/correct-pick', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer', code: 'INVALID_REQUEST' });
  const { pickNumber, reason } = req.body || {};
  if (pickNumber !== undefined && pickNumber !== null && !Number.isInteger(pickNumber)) {
    return res.status(400).json({ error: 'pickNumber must be an integer', code: 'INVALID_REQUEST' });
  }
  try {
    const outcome = await correctLatestPick({
      leagueId,
      userId: req.user.id,
      // The pick the commissioner is looking at when they confirm; the service
      // rejects the request as stale if a newer pick has since landed.
      expectedPickNumber: pickNumber ?? null,
      reason,
    });
    res.json(outcome);
  } catch (error) {
    if (isDraftRefusal(error)) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    console.error('Error correcting draft pick', error);
    res.status(500).json({ error: 'failed to correct the pick' });
  }
});

// POST /api/draft/league/:id/reset — commissioner, destructive: wipes every
// pick made so far and returns the league to pending. The keepers table
// itself is untouched — the next start re-applies them fresh.
router.post('/league/:id/reset', async (req, res) => {
  const leagueId = intOrNull(req.params.id);
  if (!leagueId) return res.status(400).json({ error: 'league id must be a positive integer' });
  try {
    res.json(await reset({ leagueId, userId: req.user.id }));
  } catch (error) {
    if (isDraftRefusal(error)) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error resetting draft', error);
    res.status(500).json({ error: 'failed to reset the draft' });
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
    res.json(await setReady({ leagueId, userId: req.user.id, ready }));
  } catch (error) {
    if (isDraftRefusal(error)) return res.status(error.statusCode).json({ error: error.message });
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
    if (isDraftRefusal(error)) return res.status(error.statusCode).json({ error: error.message });
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
  try {
    res.json(await saveKeepers({ leagueId, userId: req.user.id, keepers }));
  } catch (error) {
    // A DraftError refusal maps first (it carries a numeric statusCode); a pg
    // foreign-key violation (23503) carries `code`, and can only come from the
    // keepers INSERT, which rolled the whole save back.
    if (isDraftRefusal(error)) return res.status(error.statusCode).json({ error: error.message });
    if (error.code === '23503') {
      return res.status(400).json({ error: 'unknown team or player in keepers list' });
    }
    console.error('Error saving keepers', error);
    res.status(500).json({ error: 'failed to save keepers' });
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
        // Each committed offline Pick fans out exactly like a live one through
        // landPick (#782 ruling 3): a `pickLanded` per Pick, and the final Pick's
        // own draftCompleted covers completion. The route emits no closing state.
        await landPick({ leagueId, by: { kind: 'commissioner', userId: req.user.id }, playerId: playerIds[i] });
        applied++;
      } catch (error) {
        // A refusal below 500 is copy the commissioner reads (which pick failed
        // and why); a 500-and-up DraftError or any other fault is an internal
        // invariant, logged here and reported with generic copy, never shown
        // verbatim (#808).
        let message;
        if (isDraftRefusal(error)) {
          message = error.message;
        } else {
          console.error('Error entering offline picks', error);
          message = 'pick failed';
        }
        result = { applied, error: message, failedAtIndex: i };
        break;
      }
    }
    if (!result.error) result = { applied };
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
      `SELECT "id", "name", "draft_status", "draft_date", "draft_timezone", "draft_type", "roster_limit", "ir_slots", "draft_rounds",
              (SELECT COUNT(*)::int FROM "draft_picks" WHERE "draft_picks"."league_id" = "leagues"."id") AS "picks_made",
              (SELECT COUNT(*)::int FROM "teams" WHERE "teams"."league_id" = "leagues"."id") AS "team_count"
       FROM "leagues"
       WHERE ${commissionerPredicate(1)}
         AND ${fantasySideWhereSql()}
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
