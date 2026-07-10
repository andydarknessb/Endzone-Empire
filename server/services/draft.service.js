const pool = require('../modules/pool');

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
async function draftPlayer({ leagueId, userId, playerId }) {
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
      `SELECT "id", "owner_id", "draft_position" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    const myTeam = teams.find((t) => t.owner_id === userId);
    if (!myTeam) throw new DraftError(403, 'you do not have a team in this league');

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

    let pickNumber = null;
    let draftComplete = false;
    let nextTeamId = null;

    if (league.draft_status === 'active') {
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
      await client.query(
        `UPDATE "leagues" SET "current_pick" = $1, "draft_status" = $2, "updated_at" = now()
         WHERE "id" = $3`,
        [pickNumber, draftComplete ? 'complete' : 'active', leagueId]
      );
      if (!draftComplete) {
        nextTeamId = teams[teamIndexForPick(pickNumber, teams.length)].id;
      }
    }

    await client.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id")
       VALUES ($1, $2, $3)`,
      [leagueId, myTeam.id, playerId]
    );

    await client.query('COMMIT');
    return {
      leagueId,
      teamId: myTeam.id,
      player: playerResult.rows[0],
      pickNumber,
      nextTeamId,
      draftComplete,
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
      `SELECT "id" FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2 FOR UPDATE`,
      [leagueId, userId]
    );
    const team = teamResult.rows[0];
    if (!team) throw new DraftError(403, 'you do not have a team in this league');

    const deleted = await client.query(
      `DELETE FROM "team_players"
       WHERE "team_id" = $1 AND "player_id" = $2 RETURNING "id"`,
      [team.id, playerId]
    );
    if (deleted.rowCount === 0) {
      throw new DraftError(404, 'player is not on your roster');
    }
    await client.query('COMMIT');
    return { leagueId, teamId: team.id, playerId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { draftPlayer, dropPlayer, teamIndexForPick, DraftError };
