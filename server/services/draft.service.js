const pool = require('../modules/pool');
const { placeOnWaivers, isOnWaivers } = require('./waiver.service');
const { logTransaction } = require('./activity.service');

class DraftError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Snake-draft order: which team index picks at pick number n (0-based). */
function teamIndexForPick(pickNumber, teamCount) {
  const round = Math.floor(pickNumber / teamCount);
  const slot = pickNumber % teamCount;
  return round % 2 === 0 ? slot : teamCount - 1 - slot;
}

const AUTO_ENABLE_TIMEOUTS = 2;

/**
 * Pure: seconds on the clock for the next pick. Returns null for "no clock".
 * An autodrafting team always gets the short autodraft delay (even in an
 * otherwise untimed draft); everyone else gets the league pick clock.
 */
function nextPickClockSeconds({ draftComplete, nextTeamAutodraft, pickTimeSeconds, autodraftDelaySeconds }) {
  if (draftComplete) return null;
  if (nextTeamAutodraft) return Math.max(1, autodraftDelaySeconds || 1);
  return pickTimeSeconds > 0 ? pickTimeSeconds : null;
}

/** Pure: a team hitting this many consecutive timeouts gets autodraft turned on. */
function shouldAutoEnableAutodraft(consecutiveTimeouts) {
  return consecutiveTimeouts >= AUTO_ENABLE_TIMEOUTS;
}

/**
 * Draft a player onto the caller's team inside a single database transaction.
 * The league row is locked (SELECT ... FOR UPDATE) so concurrent picks in the
 * same league serialize; unique constraints on (league_id, player_id) are the
 * backstop against double-drafting.
 *
 * Works in two modes:
 *  - draft_status = 'active': enforces snake-draft turn order and records a pick
 *  - draft_status = 'complete': free-agent pickup (roster insert only)
 */
async function draftPlayer({ leagueId, userId, playerId, auto = false }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new DraftError(404, 'league not found');
    if (league.draft_status === 'pending') {
      throw new DraftError(409, 'draft has not started for this league');
    }

    const teamsResult = await client.query(
      `SELECT "id", "owner_id", "draft_position", "autodraft", "locked" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    const myTeam = teams.find((t) => t.owner_id === userId);
    if (!myTeam) throw new DraftError(403, 'you do not have a team in this league');
    // A commissioner-locked team can't add players (draft picks flow through
    // this same function once draft_status === 'active'/'complete'); the
    // commissioner's own force-add tool bypasses this via a separate path.
    if (myTeam.locked) throw new DraftError(409, 'your team is locked by the commissioner');

    const playerResult = await client.query(
      `SELECT "id", "name", "position" FROM "players" WHERE "id" = $1`,
      [playerId]
    );
    if (!playerResult.rows[0]) throw new DraftError(404, 'player not found');

    const rosterCountResult = await client.query(
      `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
      [myTeam.id]
    );
    if (rosterCountResult.rows[0].n >= league.roster_limit) {
      throw new DraftError(409, `roster limit of ${league.roster_limit} reached`);
    }

    // Per-position roster caps (league.position_caps jsonb, e.g. {"RB":4})
    const caps = typeof league.position_caps === 'string'
      ? JSON.parse(league.position_caps)
      : league.position_caps || {};
    const position = playerResult.rows[0].position;
    const cap = caps[position];
    if (Number.isInteger(cap)) {
      const positionCountResult = await client.query(
        `SELECT COUNT(*)::int AS n FROM "team_players"
         JOIN "players" ON "players"."id" = "team_players"."player_id"
         WHERE "team_players"."team_id" = $1 AND "players"."position" = $2`,
        [myTeam.id, position]
      );
      if (positionCountResult.rows[0].n >= cap) {
        throw new DraftError(409, `position cap reached: max ${cap} ${position}`);
      }
    }

    // Post-draft pickups are free agency: players still on waivers must be
    // claimed through the waiver process instead.
    if (league.draft_status === 'complete' &&
        await isOnWaivers(client, { league, playerId })) {
      throw new DraftError(409, 'player is on waivers — submit a waiver claim instead');
    }

    let pickNumber = null;
    let draftComplete = false;
    let nextTeamId = null;
    let pickDeadlineAt = null;

    if (league.draft_status === 'active') {
      if (league.draft_paused) {
        throw new DraftError(409, 'the draft is paused by the commissioner');
      }
      const onTheClock = teams[teamIndexForPick(league.current_pick, teams.length)];
      if (onTheClock.id !== myTeam.id) {
        throw new DraftError(409, 'it is not your turn to pick');
      }
      pickNumber = league.current_pick + 1;
      await client.query(
        `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number")
         VALUES ($1, $2, $3, $4)`,
        [leagueId, myTeam.id, playerId, pickNumber]
      );

      const totalPicks = teams.length * league.roster_limit;
      draftComplete = pickNumber >= totalPicks;
      const nextTeam = draftComplete ? null : teams[teamIndexForPick(pickNumber, teams.length)];
      // The next team's clock: short autodraft delay if it autodrafts, else the
      // league pick clock (null = untimed / draft over).
      const clockSeconds = nextPickClockSeconds({
        draftComplete,
        nextTeamAutodraft: nextTeam ? nextTeam.autodraft : false,
        pickTimeSeconds: league.pick_time_seconds,
        autodraftDelaySeconds: league.autodraft_delay_seconds,
      });
      const leagueUpdate = await client.query(
        `UPDATE "leagues"
         SET "current_pick" = $1, "draft_status" = $2, "updated_at" = now(),
             "pick_deadline_at" = CASE
               WHEN $4::int IS NULL THEN NULL
               ELSE now() + make_interval(secs => $4::int)
             END
         WHERE "id" = $3
         RETURNING "pick_deadline_at"`,
        [pickNumber, draftComplete ? 'complete' : 'active', leagueId, clockSeconds]
      );
      pickDeadlineAt = leagueUpdate.rows[0].pick_deadline_at;
      // A present owner making their own pick clears any timeout streak.
      if (!auto) {
        await client.query(
          `UPDATE "teams" SET "consecutive_timeouts" = 0 WHERE "id" = $1`,
          [myTeam.id]
        );
      }
      if (draftComplete) {
        // All undrafted players start on waivers for one waiver period
        await client.query(
          `UPDATE "leagues" SET "waivers_clear_at" = now() + make_interval(hours => $1)
           WHERE "id" = $2`,
          [league.waiver_period_hours, leagueId]
        );
        // The season schedule exists the moment the draft ends
        const { generateRegularSeason } = require('./season.service');
        await generateRegularSeason({ leagueId }, client);
      } else {
        nextTeamId = nextTeam.id;
      }
    }

    await client.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id")
       VALUES ($1, $2, $3)`,
      [leagueId, myTeam.id, playerId]
    );

    // Free-agent pickups go in the league transaction log (draft picks don't)
    if (league.draft_status === 'complete') {
      await logTransaction(client, {
        leagueId,
        teamId: myTeam.id,
        type: 'add',
        detail: { playerId, playerName: playerResult.rows[0].name },
      });
    }

    await client.query('COMMIT');
    return {
      leagueId,
      teamId: myTeam.id,
      player: playerResult.rows[0],
      pickNumber,
      nextTeamId,
      draftComplete,
      pickDeadlineAt,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new DraftError(409, 'player is already rostered in this league');
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Drop a player from the caller's roster in the league — transactional so the
 * roster row and any bookkeeping stay consistent.
 */
async function dropPlayer({ leagueId, userId, playerId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const teamResult = await client.query(
      `SELECT "id", "locked" FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2 FOR UPDATE`,
      [leagueId, userId]
    );
    const team = teamResult.rows[0];
    if (!team) throw new DraftError(403, 'you do not have a team in this league');
    if (team.locked) throw new DraftError(409, 'your team is locked by the commissioner');

    const deleted = await client.query(
      `DELETE FROM "team_players"
       WHERE "team_id" = $1 AND "player_id" = $2 RETURNING "id"`,
      [team.id, playerId]
    );
    if (deleted.rowCount === 0) {
      throw new DraftError(404, 'player is not on your roster');
    }

    // Dropped players pass through waivers before returning to free agency
    const leagueResult = await client.query(
      `SELECT "waiver_period_hours" FROM "leagues" WHERE "id" = $1`,
      [leagueId]
    );
    await placeOnWaivers(client, {
      leagueId,
      playerId,
      waiverPeriodHours: leagueResult.rows[0].waiver_period_hours,
      droppedByTeamId: team.id,
    });
    await logTransaction(client, {
      leagueId,
      teamId: team.id,
      type: 'drop',
      detail: { playerId },
    });

    await client.query('COMMIT');
    return { leagueId, teamId: team.id, playerId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Undo the caller's own recent drop: only valid while the player's waiver
 * hold still names this team as the dropper (see `placeOnWaivers`'s
 * `droppedByTeamId`). This is what powers the drop snackbar's "Undo" button —
 * a normal `draftPlayer` call would be rejected by the waiver-hold check.
 */
async function undoDrop({ leagueId, userId, playerId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const leagueResult = await client.query(
      `SELECT "roster_limit", "position_caps" FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new DraftError(404, 'league not found');

    const teamResult = await client.query(
      `SELECT "id" FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, userId]
    );
    const team = teamResult.rows[0];
    if (!team) throw new DraftError(403, 'you do not have a team in this league');

    const holdResult = await client.query(
      `SELECT 1 FROM "waiver_players"
       WHERE "league_id" = $1 AND "player_id" = $2 AND "dropped_by_team_id" = $3`,
      [leagueId, playerId, team.id]
    );
    if (!holdResult.rows[0]) {
      throw new DraftError(409, 'too late to undo — submit a waiver claim instead');
    }

    const rosterCountResult = await client.query(
      `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
      [team.id]
    );
    if (rosterCountResult.rows[0].n >= league.roster_limit) {
      throw new DraftError(409, `roster limit of ${league.roster_limit} reached`);
    }

    const playerResult = await client.query(
      `SELECT "id", "name", "position" FROM "players" WHERE "id" = $1`,
      [playerId]
    );
    if (!playerResult.rows[0]) throw new DraftError(404, 'player not found');

    const caps = typeof league.position_caps === 'string'
      ? JSON.parse(league.position_caps)
      : league.position_caps || {};
    const cap = caps[playerResult.rows[0].position];
    if (Number.isInteger(cap)) {
      const positionCountResult = await client.query(
        `SELECT COUNT(*)::int AS n FROM "team_players"
         JOIN "players" ON "players"."id" = "team_players"."player_id"
         WHERE "team_players"."team_id" = $1 AND "players"."position" = $2`,
        [team.id, playerResult.rows[0].position]
      );
      if (positionCountResult.rows[0].n >= cap) {
        throw new DraftError(409, `position cap reached: max ${cap} ${playerResult.rows[0].position}`);
      }
    }

    await client.query(
      `DELETE FROM "waiver_players" WHERE "league_id" = $1 AND "player_id" = $2`,
      [leagueId, playerId]
    );
    await client.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueId, team.id, playerId]
    );
    await logTransaction(client, {
      leagueId,
      teamId: team.id,
      type: 'add',
      detail: { playerId, playerName: playerResult.rows[0].name, undo: true },
    });

    await client.query('COMMIT');
    return { leagueId, teamId: team.id, player: playerResult.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new DraftError(409, 'player is already rostered in this league');
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  draftPlayer,
  dropPlayer,
  undoDrop,
  teamIndexForPick,
  nextPickClockSeconds,
  shouldAutoEnableAutodraft,
  AUTO_ENABLE_TIMEOUTS,
  DraftError,
};
