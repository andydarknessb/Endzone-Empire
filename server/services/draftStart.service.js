const pool = require('../modules/pool');
const { meetsMinimum } = require('./leagueSize');
const { DraftError } = require('./draft.service');
const { startPlan } = require('./draftValidation.service');

/** Re-broadcast the full draft state so connected clients pick up the new status/order. */
async function broadcastDraftState(leagueId) {
  const { getIo } = require('../modules/io');
  const io = getIo();
  if (!io) return;
  try {
    const { getDraftState } = require('../modules/draftSocket');
    io.to(`league:${leagueId}`).emit('draft:state', await getDraftState(leagueId));
  } catch (err) {
    console.error('draft state broadcast failed for league %s:', leagueId, err.message);
  }
}

/**
 * Start a league's draft — the single entry point for every "start" trigger
 * (the commissioner's Instant Start button, the socket start event, and the
 * scheduled auto-start) so behavior can't drift between three copies of this
 * logic. `userId: null` means the caller is the scheduler, which bypasses the
 * owner check (there's no acting user).
 *
 * Locks the league row, re-validates via startPlan() (auction 501, stale
 * order-overrides/keepers 409), pre-inserts any keeper picks, and arms the
 * first open pick's clock. Broadcasts the resulting draft:state on success.
 */
async function startDraft({ leagueId, userId = null }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new DraftError(404, 'league not found');
    if (userId != null && league.owner_id !== userId) {
      throw new DraftError(403, 'only the commissioner can start this draft');
    }
    if (league.draft_status !== 'pending') {
      throw new DraftError(409, 'draft already started');
    }

    const teamsResult = await client.query(
      `SELECT "id", "owner_id", "draft_position", "autodraft", "locked" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    if (!meetsMinimum(teams.length, league.min_teams)) {
      throw new DraftError(409, `need at least ${league.min_teams} teams to start the draft (currently ${teams.length})`);
    }

    let keepers = [];
    if (league.keepers_enabled) {
      const keepersResult = await client.query(
        `SELECT "team_id", "player_id", "draft_round" FROM "keepers" WHERE "league_id" = $1`,
        [leagueId]
      );
      keepers = keepersResult.rows;
    }

    const plan = startPlan(league, teams, keepers);
    if (plan.error) {
      throw new DraftError(plan.error.status, plan.error.message);
    }

    for (const keeperPick of plan.keeperPicks) {
      await client.query(
        `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number", "is_keeper")
         VALUES ($1, $2, $3, $4, true)`,
        [leagueId, keeperPick.teamId, keeperPick.playerId, keeperPick.pickNumber + 1]
      );
      await client.query(
        `INSERT INTO "team_players" ("league_id", "team_id", "player_id")
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [leagueId, keeperPick.teamId, keeperPick.playerId]
      );
    }

    if (plan.autodraftAll) {
      await client.query(`UPDATE "teams" SET "autodraft" = true WHERE "league_id" = $1`, [leagueId]);
    }

    if (plan.firstOpenPick === null) {
      // Every roster slot was pre-filled by keepers — the draft is over before
      // a single live pick, so run the same completion side effects draftPlayer
      // would have on the final pick.
      await client.query(
        `UPDATE "leagues"
         SET "draft_status" = 'complete', "current_pick" = $2, "updated_at" = now(),
             "draft_autostart_failed" = false, "pick_deadline_at" = NULL,
             "waivers_clear_at" = now() + make_interval(hours => "waiver_period_hours")
         WHERE "id" = $1`,
        [leagueId, plan.totalPicks]
      );
      const { generateRegularSeason } = require('./season.service');
      await generateRegularSeason({ leagueId }, client);
    } else {
      await client.query(
        `UPDATE "leagues"
         SET "draft_status" = 'active', "current_pick" = $2, "updated_at" = now(),
             "draft_autostart_failed" = false,
             "pick_deadline_at" = CASE
               WHEN $3::int IS NULL THEN NULL
               ELSE now() + make_interval(secs => $3::int)
             END
         WHERE "id" = $1`,
        [leagueId, plan.firstOpenPick, plan.firstClockSeconds]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  await broadcastDraftState(leagueId);
  return { leagueId };
}

module.exports = { startDraft };
