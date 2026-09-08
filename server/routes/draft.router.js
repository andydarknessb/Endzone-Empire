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
const { teamForPick } = require('../services/draftOrder.service');
const { correctLatestPick, isDraftRefusal, DraftError } = require('../services/draft.service');
// The Draft act module (#947, part of #938) owns the transaction, the
// serializing League-row lock and the post-commit fan-out order for a lifecycle
// act. pause/resume is the first handler lifted onto it; the other three
// (autodraft, undo, reset) are the follower's.
const { runDraftAct } = require('../services/draftAct.service');
// A Pick lands in one place (#782): the offline bulk route commits AND fans out
// each Pick through the one seam, landPick, exactly like a live one.
const { landPick } = require('../services/pick.service');
// The Pick clock module owns arming (ADR 0018): pause, resume, the autodraft
// toggle and undo re-arm the deadline only through its named events, so no route
// writes the pick deadline column directly.
const pickClock = require('../services/pickClock.service');
const { validateKeepers, undoTargets } = require('../services/draftValidation.service');
const { draftRosterSize } = require('../services/rosterShape');
const { removeLineupEntries } = require('../services/lineup.service');
const { isLeagueCommissioner, commissionerPredicate } = require('../services/leagueRole.service');
const { requireMember } = require('../services/leagueMembership.service');
// The one write-time roster gate (#940). The undo and reset handlers below both
// remove roster rows and ask the same module, with the bypasses that reproduce
// what they have always done stated as an exact set (#965).
const { assertRosterWriteAllowed, ROSTER_GATE } = require('../services/rosterGate.service');
const { requireFantasyLeague, fantasySideWhereSql } = require('../services/leagueType');
const { appendLifecycleActivity, PAUSE, RESUME, RESET } = require('../services/draftActivity');
const { listPresenterDraftActivity } = require('../services/leagueFeed');
// Every room-wide emit in this router rides the one Draft room adapter (#745).
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');

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
    // Each early refusal below reads the locked leagues row (and teams) and then
    // sends its response and returns before any write; Ruling 2: returning from
    // `work` COMMITs, and a COMMIT of a read-only (FOR UPDATE) transaction frees
    // the same lock a ROLLBACK would. Refusals send their response inside `work`;
    // the success response is sent AFTER the wrapper resolves, so it never
    // precedes the COMMIT.
    const finalOrder = await withTransaction(pool, async (client) => {
      const leagueResult = await client.query(
        `SELECT * FROM "leagues" WHERE "id" = $1 AND ${commissionerPredicate(2)} FOR UPDATE`,
        [leagueId, req.user.id]
      );
      if (!leagueResult.rows[0]) {
        return res.status(403).json({ error: 'league not found or you are not the commissioner' });
      }
      if (leagueResult.rows[0].draft_status !== 'pending') {
        return res.status(409).json({ error: 'draft order is locked once the draft starts' });
      }
      const teamsResult = await client.query(
        `SELECT "id" FROM "teams" WHERE "league_id" = $1`,
        [leagueId]
      );
      const teamIds = teamsResult.rows.map((r) => r.id);
      let order_;
      if (randomize) {
        order_ = [...teamIds];
        for (let i = order_.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [order_[i], order_[j]] = [order_[j], order_[i]];
        }
      } else {
        const valid = order.length === teamIds.length && teamIds.every((id) => order.includes(id));
        if (!valid) {
          return res.status(400).json({ error: 'order must contain every team in the league exactly once' });
        }
        order_ = order;
      }
      for (let i = 0; i < order_.length; i++) {
        await client.query(
          `UPDATE "teams" SET "draft_position" = $1, "updated_at" = now() WHERE "id" = $2`,
          [i + 1, order_[i]]
        );
      }
      return order_;
    }, { label: 'draftOrder' });
    // A refusal above already sent the response; only the success path reaches here.
    if (!res.headersSent) res.json({ leagueId, order: finalOrder });
  } catch (error) {
    // Guarded because a refusal now responds inside `work` before the wrapper's
    // COMMIT: if that COMMIT of the read-only refusal transaction rejects (a dead
    // connection mid-request), the wrapper rethrows here with the response
    // already sent, and an unguarded res.status would throw ERR_HTTP_HEADERS_SENT.
    console.error('Error setting draft order', error);
    if (!res.headersSent) res.status(500).json({ error: 'failed to set draft order' });
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
  // the paused-boolean check here - stay AHEAD of the act module, so the League
  // row is never locked for malformed input; the module's lock delta then falls
  // only on authorization failures (the act body's refusal below).
  try {
    // The act module (#947) owns the transaction, the serializing League-row
    // lock and the post-commit fan-out order. pause/resume must still append its
    // Draft-activity entry from the SAME transaction that flips draft_paused
    // (#437 AC2), so a rolled-back toggle leaves no orphan activity and a
    // committed one always has its entry; the clock is armed through the Pick
    // clock module (ADR 0018), resuming granting the on-the-clock team the policy
    // clock rather than the time remaining at pause.
    const response = await runDraftAct({ leagueId, userId: req.user.id }, async ({ client, league, actingTeam }) => {
      // Authorization + precondition, reproducing the refusal set the old guarded
      // UPDATE fused into one empty result: league absent, caller not a
      // commissioner, or draft not active all return the IDENTICAL 403 and body.
      // The check sits immediately after the lock with nothing between it and the
      // rollback runDraftAct performs on the throw. commissionerPredicate(3)'s
      // WHERE-clause form is reproduced here by isLeagueCommissioner, its JS twin.
      if (!league || league.draft_status !== 'active' ||
          !(await isLeagueCommissioner(client, leagueId, req.user.id))) {
        throw new DraftError(403, 'league not found, not commissioner, or draft not active');
      }
      const result = await client.query(
        `UPDATE "leagues" SET "draft_paused" = $1, "updated_at" = now()
         WHERE "id" = $2 RETURNING "id", "draft_paused"`,
        [paused, leagueId]
      );
      // Clear the clock on pause, arm the policy clock on resume - the module is
      // the only writer of the deadline.
      const pickDeadlineAt = paused
        ? await pickClock.onPaused(client, { leagueId })
        : await pickClock.onResumed(client, { leagueId });
      // The acting commissioner's Team, or null when they hold none - recorded as
      // null, never fabricated (#437 AC5). Resolved by the act module (actingTeam)
      // rather than a second lookupTeam. Team identity only, no account field.
      const entry = await appendLifecycleActivity(client, {
        leagueId,
        kind: paused ? PAUSE : RESUME,
        team: actingTeam,
      });
      // The response still carries the re-armed (or cleared) deadline the clients
      // read, sourced from the Pick clock module rather than the flip's own UPDATE.
      // The module emits activityAppended before stateChanged, the one
      // narration-first order (matching pickClock.service.js's autoPick
      // escalation emit, after escalateNothingDraftable).
      return {
        response: { ...result.rows[0], pick_deadline_at: pickDeadlineAt },
        activity: [entry],
        broadcasts: ['stateChanged'],
      };
    });
    res.json(response);
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
  // Both database-free refusals stay AHEAD of the act module, so a malformed
  // request never locks the League row.
  try {
    // The act module (#967, part of #938) owns the transaction, the serializing
    // League-row lock and the post-commit fan-out. The handler is now
    // authorization plus a response shape.
    const response = await runDraftAct({ leagueId, userId: req.user.id }, async ({ client, league, teams }) => {
      if (!league) throw new DraftError(404, 'league not found');
      // The act module already loaded Teams in rotation order under the same
      // transaction, so the target team is picked out of that list rather than
      // re-SELECTed. Same row, same league scope (the module's read is
      // league_id-scoped), one fewer statement.
      const team = teams.find((row) => row.id === teamId);
      if (!team) throw new DraftError(404, 'team not found in this league');
      const isCommissioner = await isLeagueCommissioner(client, leagueId, req.user.id);
      const isTeamManager = team.owner_id === req.user.id;
      if (!isTeamManager && !isCommissioner) {
        throw new DraftError(403, 'only the team manager or a commissioner can change autodraft');
      }
      // Turning autodraft off clears any timeout streak.
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
        const onClock = teamForPick(league.current_pick, teams, {
          rotation: league.draft_rotation,
          overrides: league.draft_order_overrides,
        });
        if (onClock && onClock.id === teamId) {
          // The team now on the clock is autodrafting: arm the short delay through
          // the Pick clock module (ADR 0018), the only writer of the deadline. It
          // reads the offline rule and clock settings from the locked row itself
          // (#948); the act module holds that row under its serializing lock
          // and this body writes no Leagues column before this call.
          await pickClock.onAutodraftToggled(client, { leagueId });
        }
      }
      // No narration: an autodraft toggle appends no Draft-activity entry, so the
      // one fan-out order reduces to the single board fact.
      return {
        response: { leagueId, teamId, autodraft: enabled },
        broadcasts: ['stateChanged'],
      };
    });
    res.json(response);
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
    const result = await pool.query(
      `UPDATE "leagues" SET "pick_time_seconds" = $1, "updated_at" = now()
       WHERE "id" = $2 AND ${commissionerPredicate(3)} AND "draft_status" IN ('pending', 'active')
       RETURNING "id"`,
      [pickTimeSeconds, leagueId, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(403).json({ error: 'league not found, not commissioner, or the draft has already finished' });
    }
    await getDraftRoomBroadcast().stateChanged(leagueId);
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
  try {
    // The act module (#967, part of #938) owns the transaction, the serializing
    // League-row lock and the post-commit fan-out order.
    const response = await runDraftAct({ leagueId, userId: req.user.id }, async ({ client, league, teams }) => {
      // Authorization + precondition, reproducing the refusal set the old guarded
      // locked SELECT fused into one empty result: league absent, caller not a
      // commissioner, or draft not active all return the IDENTICAL 403 and body.
      // commissionerPredicate(2)'s WHERE-clause form is reproduced here by
      // isLeagueCommissioner, its JS twin, on the locked client.
      if (!league || league.draft_status !== 'active' ||
          !(await isLeagueCommissioner(client, leagueId, req.user.id))) {
        throw new DraftError(403, 'league not found, not commissioner, or draft not active');
      }
      const picksResult = await client.query(
        `SELECT "pick_number", "team_id", "player_id", "is_keeper" FROM "draft_picks"
         WHERE "league_id" = $1 AND "pick_number" <= $2`,
        [leagueId, league.current_pick]
      );
      const { targets, error: undoError } = undoTargets(picksResult.rows, count);
      // A refusal, not a fault: the act module rolls back and emits nothing.
      if (undoError) throw new DraftError(409, undoError);
      const targetRows = picksResult.rows.filter((p) => targets.includes(p.pick_number));
      for (const row of targetRows) {
        // The write gate, once per undone pick, immediately before that pick's
        // roster row goes (#965). Both release-direction gates are bypassed, and
        // both are decisions:
        //
        // - FREEZE. Same reading as the Pick commit: a commissioner freeze is the
        //   transaction lock and does not govern a draft-phase roster write. This
        //   route already refuses unless the draft is ACTIVE, so every row it can
        //   reach is a draft row.
        // - TEAM_LOCK. This is a commissioner tool acting on other managers'
        //   teams; a locked team's mispicked player must still be undoable, which
        //   is the whole point of an override (#940 story 7).
        //
        // So the call refuses nothing today. It is here so this write inherits a
        // release rule the module gains later by a stated decision rather than by
        // an omission - which is the failure #940 exists to end.
        await assertRosterWriteAllowed(client, {
          leagueId,
          teamId: row.team_id,
          direction: 'release',
          playerId: row.player_id,
          bypass: [ROSTER_GATE.FREEZE, ROSTER_GATE.TEAM_LOCK],
        });
        await client.query(
          `DELETE FROM "draft_picks" WHERE "league_id" = $1 AND "pick_number" = $2`,
          [leagueId, row.pick_number]
        );
        await client.query(
          `DELETE FROM "team_players" WHERE "league_id" = $1 AND "team_id" = $2 AND "player_id" = $3`,
          [leagueId, row.team_id, row.player_id]
        );
        // The lineup follows the roster (#197): the pick benched him when it
        // was made, so undoing it takes that row back too.
        await removeLineupEntries(client, { league, teamId: row.team_id, playerId: row.player_id });
      }
      // The earliest undone pick's own slot was itself open (a live pick, never
      // a keeper) before it was made, so rewinding current_pick straight to it
      // reproduces the exact pre-pick state — no re-scan for open slots needed.
      const newCurrentPick = Math.min(...targets) - 1;
      // The act module's Teams read is already the rotation-order list this
      // resolution needs (draft_position NULLS LAST, id), carrying `autodraft`,
      // so the handler's own teams SELECT is gone.
      const rotationOpts = { rotation: league.draft_rotation, overrides: league.draft_order_overrides };
      const onClock = teamForPick(newCurrentPick, teams, rotationOpts);
      // Rewind the turn and re-arm the team now on the clock by the one policy,
      // through the Pick clock module (ADR 0018): the only writer of current_pick
      // and the deadline. It reads the offline rule and clock settings from the
      // locked row itself (#948); the act module holds the league under its
      // serializing lock and this body writes no Leagues column before it.
      await pickClock.onPickUndone(client, {
        leagueId,
        newCurrentPick,
        onClockAutodraft: onClock ? onClock.autodraft : false,
      });
      // No narration on an undo, so the fan-out is the two board facts in the
      // order this route has always emitted them: rosters, then state.
      return {
        response: { leagueId, undone: targets.length, currentPick: newCurrentPick },
        broadcasts: ['rosterChanged', 'stateChanged'],
      };
    });
    res.json(response);
  } catch (error) {
    if (isDraftRefusal(error)) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error undoing draft pick', error);
    res.status(500).json({ error: 'failed to undo the pick' });
  }
});

// POST /api/draft/league/:id/correct-pick — commissioner correction (#439):
// pause the active draft and reverse ONLY its latest non-keeper pick as one
// atomic act, recording a 10-200 character reason, and leave the draft paused.
// This is the safe, reasoned administrative act (CONTEXT.md: Commissioner
// correction), distinct from the destructive Reset below and the general undo
// above. Every refusal carries a stable SCREAMING_SNAKE code (ADR 0008).
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
    const broadcast = getDraftRoomBroadcast();
    await broadcast.stateChanged(leagueId);
    // The correction rides the combined feed on draft:activity beside the paused
    // draft:state, the same path the pause/resume/reset lifecycle entries use.
    await broadcast.activityAppended(leagueId, outcome.activity);
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
    // The act module (#967, part of #938) owns the transaction, the serializing
    // League-row lock and the post-commit fan-out. Converting this handler is
    // also what FLIPS its fan-out order: reset used to emit stateChanged ahead of
    // activityAppended, the opposite of the order ADR 0025's 2026-09-03 amendment
    // assigns. The module emits the narration first, so this site now agrees with
    // pickClock.service.js's escalation path (draftFanoutOrder.test.js pins the
    // two equal).
    const response = await runDraftAct({ leagueId, userId: req.user.id }, async ({ client, league, teams, actingTeam }) => {
      // Authorization + precondition, reproducing the refusal set the old guarded
      // locked SELECT fused into one empty result: league absent, caller not a
      // commissioner, or draft not active all return the IDENTICAL 403 and body.
      if (!league || league.draft_status !== 'active' ||
          !(await isLeagueCommissioner(client, leagueId, req.user.id))) {
        throw new DraftError(403, 'league not found, not commissioner, or draft not active');
      }
      // Refuse rather than repair (#192): after #189 froze materialization on
      // final weeks, a deleted lineup_entries row behind a final matchup can
      // never be refilled, so a settled week would keep its score with nothing
      // behind it. Scoping the delete to spare only the non-final weeks was
      // considered and ruled out - a reset over settled weeks is a request to
      // invalidate results that already counted, and the answer to that
      // request is no. This check must run, and the transaction must roll
      // back, before any DELETE below.
      const finalMatchup = await client.query(
        `SELECT 1 FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "final" = true LIMIT 1`,
        [leagueId, league.current_season]
      );
      if (finalMatchup.rows[0]) {
        throw new DraftError(409, 'the draft cannot be reset because weeks of this season are already settled');
      }
      // The write gate, before the league-wide roster wipe (#965). The reset's
      // write is one statement over every roster in the league, so the gate is
      // asked once per TEAM rather than once per player - and that is exactly as
      // strong here, not a shortcut: the gate's release-direction inputs are the
      // League and the Team, and `playerId` is read only by the acquire bundle.
      // #940's "once per player, never once for a batch" rule exists because a
      // position cap accumulates across an acquire loop; nothing on the release
      // side accumulates, so per team is the finest distinction the gate can
      // make. Asking it 300 times to get the same 16 answers would be cost
      // without meaning.
      //
      // Bypasses are the undo handler's, for the same two reasons: this route
      // also refuses unless the draft is ACTIVE, and a reset must reach a locked
      // team's roster.
      //
      // The team list is the act module's, re-sorted by id: the module loads
      // Teams in ROTATION order and this loop wants a stable id order, so the
      // handler's own `SELECT "id" FROM "teams" ... ORDER BY "id"` is gone
      // rather than kept for its ordering alone.
      const wipeTeams = [...teams].sort((a, b) => a.id - b.id);
      for (const team of wipeTeams) {
        await assertRosterWriteAllowed(client, {
          leagueId,
          teamId: team.id,
          direction: 'release',
          playerId: null,
          bypass: [ROSTER_GATE.FREEZE, ROSTER_GATE.TEAM_LOCK],
        });
      }
      await client.query(`DELETE FROM "team_players" WHERE "league_id" = $1`, [leagueId]);
      // The season's lineup rows go with the rosters: the lineup screen has no
      // draft guard, and a stash set during the wiped draft must not be waiting
      // for the restarted one's keeper pre-fill or picks (#94, user story 13).
      await client.query(
        `DELETE FROM "lineup_entries" WHERE "league_id" = $1 AND "season" = $2`,
        [leagueId, league.current_season]
      );
      await client.query(`DELETE FROM "draft_picks" WHERE "league_id" = $1`, [leagueId]);
      await client.query(
        `UPDATE "teams" SET "autodraft" = false, "draft_ready" = false, "consecutive_timeouts" = 0, "updated_at" = now()
         WHERE "league_id" = $1`,
        [leagueId]
      );
      // draft_date is nulled so the 5-minute scheduler doesn't immediately
      // auto-restart the draft it just reset; draft_timezone clears with it
      // (#116 — a zone means nothing without the instant it describes).
      await client.query(
        `UPDATE "leagues"
         SET "draft_status" = 'pending', "current_pick" = 0, "draft_paused" = false,
             "draft_date" = NULL, "draft_timezone" = NULL, "draft_reminder_stage" = 0,
             "draft_autostart_failed" = false, "updated_at" = now()
         WHERE "id" = $1`,
        [leagueId]
      );
      // A reset to pending has no team on the clock: clear the deadline through the
      // Pick clock module (ADR 0018), the only writer of the pick deadline column.
      await pickClock.clearClock(client, { leagueId });
      // Record the reset as append-only Draft activity, in the SAME transaction
      // (#437 AC3). Every DELETE above wiped picks, rosters and lineup rows, but
      // NOT draft_activity: it has no FK to draft_picks and this route issues no
      // delete against it, so earlier Pick and lifecycle entries survive the
      // reset - the reset is an appended fact, not erased history. The acting
      // commissioner's Team comes from the act module (actingTeam) rather than a
      // second lookupTeam.
      const entry = await appendLifecycleActivity(client, { leagueId, kind: RESET, team: actingTeam });
      // The reset wipes every roster in the league but names only stateChanged:
      // rosterChanged sits on the module's BOARD_FACTS allowlist and is
      // deliberately not requested here, preserving this route's shipped emit set
      // (#947's inherited note).
      return {
        response: { leagueId, reset: true },
        activity: [entry],
        broadcasts: ['stateChanged'],
      };
    });
    res.json(response);
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
    await getDraftRoomBroadcast().stateChanged(leagueId);
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
    // All four early refusals below read the locked leagues row (and teams,
    // rosters) and validate in memory, then send their response and return
    // before the DELETE/INSERT; Ruling 2: returning from `work` COMMITs, and a
    // COMMIT of the read-only (FOR UPDATE) transaction frees the same lock a
    // ROLLBACK would. Refusals respond inside `work`; the success response is
    // sent after the wrapper resolves so it never precedes the COMMIT.
    const savedCount = await withTransaction(pool, async (client) => {
      const leagueResult = await client.query(
        `SELECT "draft_status", "roster_limit", "ir_slots", "keeper_count", "keeper_lock_at", "draft_date",
                ${commissionerPredicate(2)} AS "is_commissioner"
         FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
        [leagueId, req.user.id]
      );
      const league = leagueResult.rows[0];
      if (!league || !league.is_commissioner) {
        return res.status(403).json({ error: 'league not found or you are not the commissioner' });
      }
      if (league.draft_status !== 'pending') {
        return res.status(409).json({ error: 'keepers can only be edited before the draft starts' });
      }
      const lockAt = league.keeper_lock_at || league.draft_date;
      if (lockAt && new Date(lockAt).getTime() <= Date.now()) {
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
        draftRosterSize: draftRosterSize(league),
      });
      if (errors.length > 0) {
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
      return normalized.length;
    }, { label: 'draftKeepers' });
    // A refusal above already sent the response; only the success path reaches here.
    if (!res.headersSent) res.json({ leagueId, keepers: savedCount });
  } catch (error) {
    // Ruling 3: the 23503 mapping and logging move outward unchanged. The old
    // in-transaction catch also carried a bare `ROLLBACK().catch(() => {})` that
    // swallowed a rejecting rollback (the #839 shape); withTransaction owns that
    // close now and destroys the connection instead, so the swallow is gone.
    // A 23503 can only come from the INSERT on the success path, where no
    // response has been sent yet. The trailing 500 is guarded for the same
    // reason as the order handler: a refusal responds inside `work`, so a
    // rejecting post-refusal COMMIT must not drive an ERR_HTTP_HEADERS_SENT throw.
    if (error.code === '23503') {
      return res.status(400).json({ error: 'unknown team or player in keepers list' });
    }
    console.error('Error saving keepers', error);
    if (!res.headersSent) res.status(500).json({ error: 'failed to save keepers' });
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
        // own draftCompleted / rosterChanged cover completion. The route no longer
        // emits a closing stateChanged / rosterChanged of its own.
        await landPick({ leagueId, userId: req.user.id, playerId: playerIds[i], byCommissioner: true });
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
