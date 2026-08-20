const pool = require('../modules/pool');
const { logTransaction, notify, notifyLeague } = require('./activity.service');
const {
  materializeLineup,
  parseLineupSettings,
  validateLineup,
} = require('./lineup.service');
const { computeStandings } = require('./season.service');
const { placeOnWaivers } = require('./waiver.service');
const { assertManualCorrectionWindow } = require('./correction.service');
const { deleteAvatarObjects } = require('./avatar.service');
const { commissionerPredicate } = require('./leagueRole.service');
const { isIrEligible, rosterCapacity } = require('./irPolicy.service');
const { benchAcquiredPlayer } = require('./lineup.service');
const { isPickemOnly } = require('./leagueType');
const { getStandings: getPickemStandings, getSeasonSlate } = require('./pickem.service');
const { pickemChampions } = require('./pickemSeason.service');
const { getPickemChampionTeamIds } = require('./trophy.service');

class CommissionerError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * The commissioner gate for every commissioner-only operation: the league
 * owner, or anyone the owner made a co-commissioner. New commissioner powers
 * should route through here (or leagueRole.service directly) rather than
 * comparing owner_id, so co-commissioners aren't silently excluded.
 */
async function requireCommissioner(client, { leagueId, userId, forUpdate = false }) {
  const result = await client.query(
    `SELECT *, ${commissionerPredicate(2)} AS "is_commissioner"
       FROM "leagues" WHERE "id" = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [leagueId, userId]
  );
  const league = result.rows[0];
  if (!league) throw new CommissionerError(404, 'league not found');
  if (!league.is_commissioner) {
    throw new CommissionerError(403, 'only the commissioner can do this');
  }
  return league;
}

/**
 * Remove a team from the league. Before the draft this is clean; later it
 * also cascades the team's roster, lineups, and matchups (history rewrites
 * are on the commissioner). The commissioner's own team can't be removed.
 */
async function removeTeam({ leagueId, userId, teamId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const league = await requireCommissioner(client, { leagueId, userId, forUpdate: true });
    const teamResult = await client.query(
      `SELECT * FROM "teams" WHERE "id" = $1 AND "league_id" = $2`,
      [teamId, leagueId]
    );
    const team = teamResult.rows[0];
    if (!team) throw new CommissionerError(404, 'team not found in this league');
    if (team.owner_id === league.owner_id) {
      throw new CommissionerError(409, "the commissioner's own team can't be removed");
    }
    await client.query(`DELETE FROM "teams" WHERE "id" = $1`, [teamId]);
    // Leaving the league gives up commissioner powers with it.
    await client.query(
      `DELETE FROM "league_commissioners" WHERE "league_id" = $1 AND "user_id" = $2`,
      [leagueId, team.owner_id]
    );
    await logTransaction(client, {
      leagueId,
      teamId: null,
      type: 'commissioner',
      detail: { action: 'remove_team', teamId, teamName: team.name },
    });
    await notify(client, {
      userId: team.owner_id,
      leagueId,
      type: 'league',
      message: `Your team was removed from ${league.name} by the commissioner`,
    });
    await client.query('COMMIT');
    return { leagueId, removedTeamId: teamId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Commissioner force-sets any team's lineup for a week. Bypasses ownership
 * and lineup locks, but still validates slot counts and eligibility so the
 * result is a legal lineup.
 */
async function forceSetLineup({ leagueId, userId, teamId, week, moves }) {
  if (!Array.isArray(moves) || moves.length === 0) {
    throw new CommissionerError(400, 'moves must be a non-empty array of { playerId, slot }');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const league = await requireCommissioner(client, { leagueId, userId });
    const teamResult = await client.query(
      `SELECT * FROM "teams" WHERE "id" = $1 AND "league_id" = $2 FOR UPDATE`,
      [teamId, leagueId]
    );
    if (!teamResult.rows[0]) throw new CommissionerError(404, 'team not found in this league');
    const season = league.current_season;
    const targetWeek = week || league.current_week;

    await materializeLineup(client, { leagueId, teamId, season, week: targetWeek });
    const entriesResult = await client.query(
      `SELECT "lineup_entries"."player_id", "lineup_entries"."slot",
              "lineup_entries"."ir_attested",
              "players"."position", "players"."injury_status"
       FROM "lineup_entries"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
       JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
         AND "team_players"."player_id" = "lineup_entries"."player_id"
       WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
         AND "lineup_entries"."week" = $3`,
      [teamId, season, targetWeek]
    );
    const byPlayer = new Map(entriesResult.rows.map((r) => [r.player_id, r]));
    const changed = [];
    for (const move of moves) {
      const entry = byPlayer.get(move.playerId);
      if (!entry) throw new CommissionerError(404, `player ${move.playerId} is not on that roster`);
      // The force path is the attestation's one writer (#100): stashing a
      // player the feed calls ineligible attests him; an eligible stash needs
      // none, and any forced move elsewhere ends whatever attestation stood.
      // A same-slot force-set still lands when it changes the attestation:
      // re-stashing an already-stashed player is exactly how a standing stash
      // gets attested after the feed wrongly clears its occupant.
      const irAttested = move.slot === 'IR' && !isIrEligible(entry.injury_status);
      if (entry.slot === move.slot && Boolean(entry.ir_attested) === irAttested) continue;
      entry.slot = move.slot;
      entry.ir_attested = irAttested;
      changed.push(entry);
    }
    const errors = validateLineup(
      Array.from(byPlayer.values()).map((e) => ({ playerId: e.player_id, position: e.position, slot: e.slot })),
      parseLineupSettings(league)
    );
    if (errors.length > 0) throw new CommissionerError(400, errors.join('; '));
    for (const entry of changed) {
      await client.query(
        `UPDATE "lineup_entries" SET "slot" = $1, "ir_attested" = $2, "updated_at" = now()
         WHERE "team_id" = $3 AND "season" = $4 AND "week" = $5 AND "player_id" = $6`,
        [entry.slot, entry.ir_attested, teamId, season, targetWeek, entry.player_id]
      );
    }
    // Like the manager path, a force-set governs this week FORWARD: weeks
    // materialized ahead of time already carry copies of the old state, so
    // the new state propagates - a granted attestation is planted into rows
    // still holding the stash (what the weekly copy-forward would have done
    // had those weeks materialized later), an ended one is swept out.
    // Earlier weeks keep their history.
    const attestedIds = [...new Set(changed
      .filter((entry) => entry.slot === 'IR' && entry.ir_attested)
      .map((entry) => entry.player_id))];
    const endedIds = [...new Set(changed
      .filter((entry) => !(entry.slot === 'IR' && entry.ir_attested))
      .map((entry) => entry.player_id))];
    if (attestedIds.length > 0) {
      await client.query(
        `UPDATE "lineup_entries" SET "ir_attested" = true, "updated_at" = now()
         WHERE "team_id" = $1 AND "season" = $2 AND "week" > $3
           AND "player_id" = ANY($4::int[]) AND "slot" = 'IR' AND NOT "ir_attested"`,
        [teamId, season, targetWeek, attestedIds]
      );
    }
    if (endedIds.length > 0) {
      await client.query(
        `UPDATE "lineup_entries" SET "ir_attested" = false, "updated_at" = now()
         WHERE "team_id" = $1 AND "season" = $2 AND "week" > $3
           AND "player_id" = ANY($4::int[]) AND "ir_attested"`,
        [teamId, season, targetWeek, endedIds]
      );
    }
    await logTransaction(client, {
      leagueId,
      teamId,
      type: 'commissioner',
      detail: { action: 'force_set_lineup', teamId, week: targetWeek, updated: changed.length },
    });
    await client.query('COMMIT');
    return { leagueId, teamId, week: targetWeek, updated: changed.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Manually override a matchup's scores (logged to the transaction log). */
async function adjustMatchupScore({ leagueId, userId, matchupId, homeScore, awayScore }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const league = await requireCommissioner(client, { leagueId, userId, forUpdate: true });
    const matchupResult = await client.query(
      `SELECT "season", "week" FROM "matchups"
       WHERE "id" = $1 AND "league_id" = $2 FOR UPDATE`,
      [matchupId, leagueId]
    );
    const matchup = matchupResult.rows[0];
    if (!matchup) throw new CommissionerError(404, 'matchup not found in this league');
    assertManualCorrectionWindow({
      requestedSeason: matchup.season,
      requestedWeek: matchup.week,
      activeSeason: league.current_season,
      activeWeek: league.current_week,
      timestamp: new Date(),
    });
    const result = await client.query(
      `UPDATE "matchups" SET "home_score" = $1, "away_score" = $2
       WHERE "id" = $3 AND "league_id" = $4 RETURNING *`,
      [homeScore, awayScore, matchupId, leagueId]
    );
    await logTransaction(client, {
      leagueId,
      teamId: null,
      type: 'commissioner',
      detail: { action: 'adjust_score', matchupId, homeScore, awayScore },
    });
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Freeze or unfreeze all roster transactions (adds, drops, waivers, trades). */
async function setTransactionsLocked({ leagueId, userId, locked }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requireCommissioner(client, { leagueId, userId });
    await client.query(
      `UPDATE "leagues" SET "transactions_locked" = $1, "updated_at" = now() WHERE "id" = $2`,
      [locked, leagueId]
    );
    await logTransaction(client, {
      leagueId,
      teamId: null,
      type: 'commissioner',
      detail: { action: locked ? 'lock_transactions' : 'unlock_transactions' },
    });
    await client.query('COMMIT');
    return { leagueId, transactionsLocked: locked };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Season rollover: archive final standings and the champion into
 * league_history, then reset the league for a new season. Optional keepers
 * ([{ teamId, playerIds }]) survive the roster wipe; everything else —
 * draft picks, waivers, pending claims and trades — is cleared. Historical
 * matchups, lineups, and stats stay (they're keyed by season).
 */
async function rolloverSeason({ leagueId, userId, keepers = [] }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const league = await requireCommissioner(client, { leagueId, userId, forUpdate: true });
    if (league.season_status !== 'complete') {
      throw new CommissionerError(409, 'the season must be complete before rolling over');
    }
    const pickemOnly = isPickemOnly(league);
    if (pickemOnly && keepers.length > 0) {
      // ADR 0002: roster-shaped writes against a pick'em-only league fail
      // closed. There is no roster to keep anything from.
      throw new CommissionerError(409, "this is a pick'em league; it has no rosters or keepers");
    }

    const teamsResult = await client.query(
      `SELECT "id", "name", "owner_id" FROM "teams" WHERE "league_id" = $1`,
      [leagueId]
    );

    let standings;
    let rosters;
    let championTeamId;
    let championUserId;
    if (pickemOnly) {
      // A pick'em-only league has no matchups or rosters: the season record
      // is the pick'em standings, the champion is whoever season completion
      // crowned (the pickem_champion trophy rows, first of the co-champions
      // on a tie), and those rows are the awards. Reading the empty matchup
      // table here would have crowned standings[0] of an all-zero table, an
      // arbitrary team. The declared champion is read back rather than
      // recomputed: a recap landing after completion must not make history
      // name a different winner than the trophy and the notification did.
      // The season's games are read on the pool, not this client: the recap
      // probe inside getSeasonSlate swallows a missing-table error, which
      // inside an open transaction would poison every statement after it.
      const seasonGames = await getSeasonSlate({ season: league.current_season });
      const final = await getPickemStandings({
        leagueId, season: league.current_season, db: client, games: seasonGames,
      });
      const teamByOwner = new Map(teamsResult.rows.map((team) => [team.owner_id, team]));
      standings = final.standings.map((row) => {
        const team = teamByOwner.get(row.userId);
        return { ...row, teamId: team ? team.id : null, name: team ? team.name : row.teamName };
      });
      rosters = [];
      const declared = await getPickemChampionTeamIds({
        db: client, leagueId, season: league.current_season,
      });
      if (declared.length > 0) {
        championTeamId = declared[0];
        championUserId =
          teamsResult.rows.find((team) => team.id === championTeamId)?.owner_id || null;
      } else {
        // Nothing was crowned (no picks resolved, or the winner had no teams
        // row): the best answer left is the leader as the table stands.
        const champion = pickemChampions(final.standings)[0] || null;
        championUserId = champion ? champion.userId : null;
        championTeamId = teamByOwner.get(championUserId)?.id || null;
      }
    } else {
      const matchupsResult = await client.query(
        `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2`,
        [leagueId, league.current_season]
      );
      standings = computeStandings(teamsResult.rows, matchupsResult.rows);
      const rostersResult = await client.query(
        `SELECT "team_players"."team_id", "team_players"."player_id",
                "players"."name" AS "player_name", "players"."position",
                "players"."nfl_team"
         FROM "team_players"
         JOIN "players" ON "players"."id" = "team_players"."player_id"
         WHERE "team_players"."league_id" = $1
         ORDER BY "team_players"."team_id", "team_players"."player_id"`,
        [leagueId]
      );
      rosters = rostersResult.rows;

      // Champion: winner of the last final, non-consolation playoff game
      const playoffFinals = matchupsResult.rows
        .filter((m) => m.is_playoff && !m.is_consolation && m.final)
        .sort((a, b) => b.week - a.week);
      const decider = playoffFinals[0];
      championTeamId = decider
        ? (Number(decider.home_score) >= Number(decider.away_score)
          ? decider.home_team_id
          : decider.away_team_id)
        : (standings[0] ? standings[0].teamId : null);
      championUserId =
        teamsResult.rows.find((team) => team.id === championTeamId)?.owner_id || null;
    }

    // The fantasy champion trophy is singular; pick'em champions are
    // multi-recipient rows already written by season completion, so they are
    // left exactly as they are.
    if (championTeamId && !pickemOnly) {
      // The weekly trophy index is team-aware so both closest-game teams can
      // share a type. Champion remains singular, so replace any stale winner
      // explicitly before inserting the authoritative season result.
      await client.query(
        `DELETE FROM "trophies"
         WHERE "league_id" = $1 AND "season" = $2 AND "week" = 0 AND "type" = 'champion'`,
        [leagueId, league.current_season]
      );
      await client.query(
        `INSERT INTO "trophies" ("league_id", "team_id", "season", "week", "type", "label", "data")
         VALUES ($1, $2, $3, 0, 'champion', $4, '{}')
         ON CONFLICT ("league_id", "season", "week", "team_id", "type")
         DO UPDATE SET "team_id" = EXCLUDED."team_id", "label" = EXCLUDED."label"`,
        [leagueId, championTeamId, league.current_season, `${league.current_season} League Champion`]
      );
    }
    const awardsResult = await client.query(
      `SELECT "team_id", "season", "week", "type", "label", "data", "awarded_at"
       FROM "trophies" WHERE "league_id" = $1 AND "season" = $2
       ORDER BY "week", "type"`,
      [leagueId, league.current_season]
    );

    await client.query(
      `INSERT INTO "league_history"
         ("league_id", "season", "champion_team_id", "champion_user_id", "standings", "rosters", "awards")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ("league_id", "season")
       DO UPDATE SET "champion_team_id" = EXCLUDED."champion_team_id",
                     "champion_user_id" = EXCLUDED."champion_user_id",
                     "standings" = EXCLUDED."standings",
                     "rosters" = EXCLUDED."rosters",
                     "awards" = EXCLUDED."awards"`,
      [
        leagueId,
        league.current_season,
        championTeamId,
        championUserId,
        JSON.stringify(standings),
        JSON.stringify(rosters),
        JSON.stringify(awardsResult.rows),
      ]
    );

    // Roster wipe with keeper exceptions, plus the rest of the fantasy reset.
    // A pick'em-only league has none of it (ADR 0002: no roster-shaped writes).
    const keeperPairs = [];
    if (!pickemOnly) {
      for (const k of keepers) {
        if (!Number.isInteger(k.teamId) || !Array.isArray(k.playerIds)) {
          throw new CommissionerError(400, 'keepers must be [{ teamId, playerIds }]');
        }
        for (const pid of k.playerIds) keeperPairs.push([k.teamId, pid]);
      }
      if (keeperPairs.length > 0) {
        await client.query(
          `DELETE FROM "team_players"
           WHERE "league_id" = $1 AND ("team_id", "player_id") NOT IN
             (${keeperPairs.map((_, i) => `(${i * 2 + 2}, ${i * 2 + 3})`).join(', ')})`,
          [leagueId, ...keeperPairs.flat()]
        );
      } else {
        await client.query(`DELETE FROM "team_players" WHERE "league_id" = $1`, [leagueId]);
      }

      await client.query(`DELETE FROM "draft_picks" WHERE "league_id" = $1`, [leagueId]);
      await client.query(`DELETE FROM "waiver_players" WHERE "league_id" = $1`, [leagueId]);
      await client.query(
        `UPDATE "waiver_claims" SET "status" = 'cancelled', "updated_at" = now()
         WHERE "league_id" = $1 AND "status" = 'pending'`,
        [leagueId]
      );
      await client.query(
        `UPDATE "trades" SET "status" = 'cancelled', "updated_at" = now()
         WHERE "league_id" = $1 AND "status" IN ('pending', 'accepted')`,
        [leagueId]
      );
      await client.query(
        `UPDATE "teams" SET "faab_remaining" = $1, "updated_at" = now()
         WHERE "league_id" = $2`,
        [league.faab_budget, leagueId]
      );
    }
    const newSeason = league.current_season + 1;
    await client.query(
      `UPDATE "leagues"
       SET "current_season" = $1, "current_week" = 1, "season_status" = 'regular',
           "draft_status" = 'pending', "current_pick" = 0, "draft_paused" = false,
           "pick_deadline_at" = NULL, "waivers_clear_at" = NULL,
           "transactions_locked" = false, "updated_at" = now()
       WHERE "id" = $2`,
      [newSeason, leagueId]
    );
    await logTransaction(client, {
      leagueId,
      teamId: null,
      type: 'commissioner',
      detail: { action: 'season_rollover', archivedSeason: league.current_season, championTeamId },
    });
    await notifyLeague(client, {
      leagueId,
      type: 'season',
      message: pickemOnly
        ? "A new season has begun! Pick'em opens with the new NFL schedule."
        : `A new season has begun! ${keeperPairs.length > 0 ? 'Keepers are locked in and ' : ''}the draft is open to be scheduled.`,
    });
    await client.query('COMMIT');
    return { leagueId, archivedSeason: league.current_season, newSeason, championTeamId, championUserId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Freeze or unfreeze a single team's roster moves (adds, drops, waivers, trades). */
async function setTeamLocked({ leagueId, userId, teamId, locked }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requireCommissioner(client, { leagueId, userId });
    const result = await client.query(
      `UPDATE "teams" SET "locked" = $1, "updated_at" = now()
       WHERE "id" = $2 AND "league_id" = $3 RETURNING "id", "owner_id"`,
      [locked, teamId, leagueId]
    );
    if (!result.rows[0]) throw new CommissionerError(404, 'team not found in this league');
    await logTransaction(client, {
      leagueId,
      teamId,
      type: 'commissioner',
      detail: { action: locked ? 'lock_team' : 'unlock_team' },
    });
    await notify(client, {
      userId: result.rows[0].owner_id,
      leagueId,
      type: 'league',
      message: locked
        ? 'Your team was locked by the commissioner; roster moves are frozen until it is unlocked'
        : 'Your team was unlocked by the commissioner',
    });
    await client.query('COMMIT');
    return { leagueId, teamId, locked };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Directly set a team's remaining FAAB budget (bypasses the normal only-decreases-on-win path). */
async function setTeamFaab({ leagueId, userId, teamId, faabRemaining }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requireCommissioner(client, { leagueId, userId });
    const result = await client.query(
      `UPDATE "teams" SET "faab_remaining" = $1, "updated_at" = now()
       WHERE "id" = $2 AND "league_id" = $3 RETURNING "id"`,
      [faabRemaining, teamId, leagueId]
    );
    if (!result.rows[0]) throw new CommissionerError(404, 'team not found in this league');
    await logTransaction(client, {
      leagueId,
      teamId,
      type: 'commissioner',
      detail: { action: 'set_faab', faabRemaining },
    });
    await client.query('COMMIT');
    return { leagueId, teamId, faabRemaining };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Force an add or drop on any team's behalf. Bypasses waiver holds, the
 * league-wide transaction lock, and per-team locks (that's the point of an
 * override) but still respects the roster limit and the one-roster-per-league
 * constraint on adds; a forced add also clears any pending waiver hold/claims
 * for that player so it can't be won out from under the new roster spot.
 */
async function forceTransaction({ leagueId, userId, teamId, action, playerId }) {
  if (action !== 'add' && action !== 'drop') {
    throw new CommissionerError(400, "action must be 'add' or 'drop'");
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const league = await requireCommissioner(client, { leagueId, userId, forUpdate: true });
    const teamResult = await client.query(
      `SELECT * FROM "teams" WHERE "id" = $1 AND "league_id" = $2 FOR UPDATE`,
      [teamId, leagueId]
    );
    const team = teamResult.rows[0];
    if (!team) throw new CommissionerError(404, 'team not found in this league');

    const playerResult = await client.query(`SELECT "id", "name" FROM "players" WHERE "id" = $1`, [playerId]);
    if (!playerResult.rows[0]) throw new CommissionerError(404, 'player not found');
    const playerName = playerResult.rows[0].name;

    if (action === 'add') {
      const rosterCountResult = await client.query(
        `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
        [teamId]
      );
      // The override bypasses locks and holds, but roster capacity still
      // binds: a forced add gets no more room than any other add site (#97).
      const capacity = await rosterCapacity(client, { league, teamId });
      if (rosterCountResult.rows[0].n >= capacity) {
        throw new CommissionerError(409, `roster capacity of ${capacity} reached`);
      }
      try {
        await client.query(
          `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
          [leagueId, teamId, playerId]
        );
      } catch (error) {
        if (error.code === '23505') {
          throw new CommissionerError(409, 'player is already rostered in this league; drop them first');
        }
        throw error;
      }
      // A forced add is still an add: bench, never back into a stash (#94).
      await benchAcquiredPlayer(client, { league, teamId, playerId });
      await client.query(
        `DELETE FROM "waiver_players" WHERE "league_id" = $1 AND "player_id" = $2`,
        [leagueId, playerId]
      );
      await client.query(
        `UPDATE "waiver_claims" SET "status" = 'cancelled', "updated_at" = now()
         WHERE "league_id" = $1 AND "player_id" = $2 AND "status" = 'pending'`,
        [leagueId, playerId]
      );
    } else {
      const deleted = await client.query(
        `DELETE FROM "team_players" WHERE "team_id" = $1 AND "player_id" = $2 RETURNING "id"`,
        [teamId, playerId]
      );
      if (deleted.rowCount === 0) throw new CommissionerError(404, 'player is not on that roster');
      await placeOnWaivers(client, {
        leagueId,
        playerId,
        waiverPeriodHours: league.waiver_period_hours,
        droppedByTeamId: teamId,
      });
    }

    await logTransaction(client, {
      leagueId,
      teamId,
      type: 'commissioner',
      detail: { action: `force_${action}`, playerId, playerName },
    });
    await notify(client, {
      userId: team.owner_id,
      leagueId,
      type: 'league',
      message: action === 'add'
        ? `The commissioner added ${playerName} to your roster`
        : `The commissioner dropped ${playerName} from your roster`,
    });
    await client.query('COMMIT');
    return { leagueId, teamId, action, playerId, playerName };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Commissioner-initiated avatar removal — moderation, not the owner's own
 * reset (that's avatar.service.js's removeTeamAvatar, called from
 * team.router.js). Unlike a silent self-reset, this privately notifies the
 * affected owner via `notify` (never `notifyLeague`, which would broadcast
 * the moderation action to the whole league).
 */
async function removeTeamAvatar({ leagueId, userId, teamId }) {
  const client = await pool.connect();
  let priorAvatar = null;
  try {
    await client.query('BEGIN');
    await requireCommissioner(client, { leagueId, userId });
    const teamResult = await client.query(
      `SELECT "owner_id", "avatar_url", "avatar_static_url" FROM "teams"
       WHERE "id" = $1 AND "league_id" = $2 FOR UPDATE`,
      [teamId, leagueId]
    );
    const team = teamResult.rows[0];
    if (!team) throw new CommissionerError(404, 'team not found in this league');
    priorAvatar = { avatar_url: team.avatar_url, avatar_static_url: team.avatar_static_url };
    await client.query(
      `UPDATE "teams" SET "avatar_url" = NULL, "avatar_static_url" = NULL, "updated_at" = now()
       WHERE "id" = $1`,
      [teamId]
    );
    await logTransaction(client, {
      leagueId,
      teamId,
      type: 'commissioner',
      detail: { action: 'remove_team_avatar' },
    });
    await notify(client, {
      userId: team.owner_id,
      leagueId,
      type: 'league',
      message: 'Your team avatar was removed by the commissioner',
    });
    await client.query('COMMIT');
    void deleteAvatarObjects(priorAvatar);
    return { leagueId, teamId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  CommissionerError,
  removeTeam,
  forceSetLineup,
  adjustMatchupScore,
  setTransactionsLocked,
  rolloverSeason,
  setTeamLocked,
  setTeamFaab,
  forceTransaction,
  removeTeamAvatar,
};
