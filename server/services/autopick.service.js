const pool = require('../modules/pool');
const { draftPlayer, teamIndexForPick, shouldAutoEnableAutodraft } = require('./draft.service');
const { getIo } = require('../modules/io');

/**
 * Server-side auto-pick for timed drafts. When a league's pick clock expires
 * the team on the clock drafts automatically: first eligible player from its
 * pre-draft queue, otherwise best available by players.default_rank.
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
  const onTheClock = teams[teamIndexForPick(league.current_pick, teams.length)];
  // A pick fired by an expired clock is a "timeout" only when the team isn't
  // already autodrafting on purpose.
  const wasTimeout = !onTheClock.autodraft;

  const candidates = await pool.query(
    `SELECT "players"."id"
     FROM "players"
     LEFT JOIN "team_players" ON "team_players"."player_id" = "players"."id"
       AND "team_players"."league_id" = $1
     LEFT JOIN "draft_queue" ON "draft_queue"."player_id" = "players"."id"
       AND "draft_queue"."team_id" = $2
     WHERE "team_players"."id" IS NULL
     ORDER BY ("draft_queue"."rank" IS NULL), "draft_queue"."rank",
              "players"."default_rank" NULLS LAST, "players"."id"
     LIMIT 25`,
    [leagueId, onTheClock.id]
  );

  for (const candidate of candidates.rows) {
    try {
      const outcome = await draftPlayer({
        leagueId,
        userId: onTheClock.owner_id,
        playerId: candidate.id,
        auto: true,
      });
      const io = getIo();
      if (io) {
        io.to(`league:${leagueId}`).emit('draft:picked', {
          ...outcome,
          by: { userId: onTheClock.owner_id, username: 'AUTO', auto: true },
        });
        if (outcome.draftComplete) {
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
        if (shouldAutoEnableAutodraft(bumped.rows[0].consecutive_timeouts)) {
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
      console.error(`auto-pick failed for league ${row.id}:`, err.message);
    }
  }
  return outcomes;
}

module.exports = { autoPick, processExpiredPickClocks };
