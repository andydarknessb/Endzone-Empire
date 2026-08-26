const pool = require('../modules/pool');
// Accessed via the namespace (not destructured) so tests can mock
// draftService.draftPlayer without racing this module's own require-time
// binding — see server/test/autopick.service.test.js.
const draftService = require('./draft.service');
const { teamForPick } = require('./draftOrder.service');
const { getIo } = require('../modules/io');
const { lastCompletedNflSeason } = require('./nflSeason.service');
const bestAvailable = require('./bestAvailable.service');

// Defensive bound on draftPlayer() attempts after a snipe — not a ranking cutoff.
const AUTOPICK_CANDIDATE_LIMIT = 25;

/**
 * Order candidates for one team's autopick: its own queue first (by the
 * team's stated rank), then best available (CONTEXT.md) — ADP, then last
 * completed season's points, then name. Never database id. Shared with the
 * Draft Sim's pool via bestAvailable.service.js's compareBestAvailable.
 */
function compareAutopickCandidates(a, b) {
  const aQueued = a.queue_rank != null;
  const bQueued = b.queue_rank != null;
  if (aQueued !== bQueued) return aQueued ? -1 : 1;
  if (aQueued) return a.queue_rank - b.queue_rank;
  return bestAvailable.compareBestAvailable(a, b);
}

/**
 * Server-side auto-pick for timed drafts. When a league's pick clock expires
 * the team on the clock drafts automatically: first eligible player from its
 * pre-draft queue, otherwise best available (CONTEXT.md).
 *
 * Candidate selection and the pick itself are separate transactions, so a
 * candidate can be sniped in between — draftPlayer's own validation catches
 * that (409) and we simply try the next candidate.
 */
async function autoPick({ leagueId }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league || league.draft_status !== 'active' || league.draft_paused) return null;

  const teamsResult = await pool.query(
    `SELECT "id", "owner_id", "autodraft" FROM "teams"
     WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
    [leagueId]
  );
  const teams = teamsResult.rows;
  if (teams.length === 0) return null;
  const onTheClock = teamForPick(league.current_pick, teams, {
    rotation: league.draft_rotation,
    overrides: league.draft_order_overrides,
  });
  if (!onTheClock) return null;
  // A pick fired by an expired clock is a "timeout" only when the team isn't
  // already autodrafting on purpose.
  const wasTimeout = !onTheClock.autodraft;

  const lastSeason = await lastCompletedNflSeason();
  const candidatesRes = await pool.query(
    `SELECT "players"."id", "players"."name", "players"."adp",
            "draft_queue"."rank" AS "queue_rank",
            "season_points"."fantasy_points" AS "last_season_points"
     FROM "players"
     LEFT JOIN "team_players" ON "team_players"."player_id" = "players"."id"
       AND "team_players"."league_id" = $1
     LEFT JOIN "draft_queue" ON "draft_queue"."player_id" = "players"."id"
       AND "draft_queue"."team_id" = $2
     LEFT JOIN "player_season_stats" "season_points"
       ON "season_points"."player_id" = "players"."id" AND "season_points"."season" = $3
     WHERE "team_players"."id" IS NULL`,
    [leagueId, onTheClock.id, lastSeason]
  );
  const candidates = [...candidatesRes.rows]
    .sort(compareAutopickCandidates)
    .slice(0, AUTOPICK_CANDIDATE_LIMIT);

  for (const candidate of candidates) {
    try {
      const outcome = await draftService.draftPlayer({
        leagueId,
        userId: onTheClock.owner_id,
        playerId: candidate.id,
        auto: true,
      });
      const io = getIo();
      if (io) {
        // Attributed by Team at the root, so the old `by` object (whose
        // `userId` was onTheClock.owner_id, a real account id broadcast to the
        // room) is gone (#344, #115 child C). `auto` is true here: this is the
        // autopick emit site. Kept in lockstep with the pick handler's emit,
        // and both are pinned to one key set by socketPayloadShape.test.js.
        io.to(`league:${leagueId}`).emit('draft:picked', { ...outcome, auto: true });
        if (outcome.draftComplete) {
          // An autopick can be the Pick that ends the draft; its completion
          // lifecycle entry (#437) rides to the combined feed on draft:activity,
          // exactly as the manual-pick handler delivers it.
          if (outcome.completion) {
            io.to(`league:${leagueId}`).emit('draft:activity', outcome.completion);
          }
          io.to(`league:${leagueId}`).emit('draft:complete', { leagueId });
        }
      }
      // After a genuine timeout, track the streak and flip autodraft on once it
      // crosses the threshold, so a persistently-absent owner stops stalling.
      if (wasTimeout) {
        const bumped = await pool.query(
          `UPDATE "teams" SET "consecutive_timeouts" = "consecutive_timeouts" + 1
           WHERE "id" = $1 RETURNING "consecutive_timeouts"`,
          [onTheClock.id]
        );
        if (draftService.shouldAutoEnableAutodraft(bumped.rows[0].consecutive_timeouts)) {
          await pool.query(`UPDATE "teams" SET "autodraft" = true WHERE "id" = $1`, [onTheClock.id]);
          await broadcastDraftState(leagueId);
        }
      }
      return outcome;
    } catch (err) {
      if (err.statusCode === 409) continue; // sniped or cap-blocked — next candidate
      throw err;
    }
  }
  return null; // nothing draftable (roster full etc.) — leave the clock alone
}

/** Re-broadcast the full draft state so clients refresh AUTO badges + the clock. */
async function broadcastDraftState(leagueId) {
  const io = getIo();
  if (!io) return;
  try {
    const { getDraftState } = require('../modules/draftSocket');
    io.to(`league:${leagueId}`).emit('draft:state', await getDraftState(leagueId));
  } catch (err) {
    console.error('draft state broadcast failed:', err.message);
  }
}

/** Scheduler entry: auto-pick every timed draft whose clock has expired. */
async function processExpiredPickClocks() {
  const due = await pool.query(
    `SELECT "id" FROM "leagues"
     WHERE "draft_status" = 'active' AND "draft_paused" = false
       AND "pick_time_seconds" > 0 AND "pick_deadline_at" IS NOT NULL
       AND "pick_deadline_at" <= now()`
  );
  const outcomes = [];
  for (const row of due.rows) {
    try {
      const outcome = await autoPick({ leagueId: row.id });
      if (outcome) outcomes.push({ leagueId: row.id, playerId: outcome.player.id });
    } catch (err) {
      console.error('auto-pick failed for league %s:', row.id, err.message);
    }
  }
  return outcomes;
}

module.exports = {
  autoPick,
  processExpiredPickClocks,
  // exported for unit tests
  compareAutopickCandidates,
};
