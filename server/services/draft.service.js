const pool = require('../modules/pool');
const { placeOnWaiversUndoable, isOnWaivers } = require('./waiver.service');
const { logTransaction } = require('./activity.service');
const { teamForPick, nextOpenPickNumber } = require('./draftOrder.service');
// Module object, not destructured: the seam tests mock benchAcquiredPlayer.
const lineupService = require('./lineup.service');
const { isLeagueCommissioner } = require('./leagueRole.service');
const { requireMember } = require('./leagueMembership.service');
const { teamIdentityOf } = require('./teamIdentity');
const { assertFantasyLeagueRow } = require('./leagueType');
const { draftRounds } = require('./rosterShape');
const { rosterCapacity, interruptedStash } = require('./irPolicy.service');

const { POSITION_GROUPS } = lineupService;

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
 * Position caps are keyed at the same granularity as positionCapsFeasible's
 * POSITION_KEYS: literal offense positions plus the three IDP group keys
 * (DL/LB/DB) rather than every specific position Tank01 reports. A 'CB' must
 * therefore be checked (and counted) against the 'DB' cap, not a literal
 * 'CB' cap that would never be set.
 */
function positionCapGroup(position) {
  return Object.keys(POSITION_GROUPS).find((key) => POSITION_GROUPS[key].includes(position)) || position;
}

/** Enforce a team's per-position draft cap (if the league sets one for this player's cap group). Throws DraftError(409) when full. */
async function assertPositionCapNotReached(client, { teamId, positionCaps, position }) {
  const caps = typeof positionCaps === 'string' ? JSON.parse(positionCaps) : positionCaps || {};
  const group = positionCapGroup(position);
  const cap = caps[group];
  if (!Number.isInteger(cap)) return;
  const members = POSITION_GROUPS[group] || [position];
  const countResult = await client.query(
    `SELECT COUNT(*)::int AS n FROM "team_players"
     JOIN "players" ON "players"."id" = "team_players"."player_id"
     WHERE "team_players"."team_id" = $1 AND "players"."position" = ANY($2::text[])`,
    [teamId, members]
  );
  if (countResult.rows[0].n >= cap) {
    throw new DraftError(409, `position cap reached: max ${cap} ${group}`);
  }
}

/**
 * Draft a player onto a team inside a single database transaction. The
 * league row is locked (SELECT ... FOR UPDATE) so concurrent picks in the
 * same league serialize; unique constraints on (league_id, player_id) are the
 * backstop against double-drafting.
 *
 * Works in two modes:
 *  - draft_status = 'active': enforces turn order (per the league's rotation
 *    and any round overrides) and records a pick
 *  - draft_status = 'complete': free-agent pickup (roster insert only)
 *
 * `byCommissioner` is set by the offline-draft bulk-entry endpoint: the
 * league owner applies the pick to whichever team is on the clock rather
 * than to their own team, and skips the team-lock check (an offline draft is
 * entirely commissioner-driven).
 */
async function draftPlayer({ leagueId, userId, playerId, auto = false, byCommissioner = false }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new DraftError(404, 'league not found');
    // A pick'em-only league has no draft and no rosters; say so rather than
    // "draft has not started" (its draft_status is 'pending' forever).
    assertFantasyLeagueRow(league);
    if (league.draft_status === 'pending') {
      throw new DraftError(409, 'draft has not started for this league');
    }
    if (byCommissioner && !(await isLeagueCommissioner(client, leagueId, userId))) {
      throw new DraftError(403, 'only the commissioner can enter picks for this draft');
    }

    const teamsResult = await client.query(
      `SELECT "id", "name", "owner_id", "draft_position", "autodraft", "locked" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    const rotationOpts = { rotation: league.draft_rotation, overrides: league.draft_order_overrides };

    let myTeam;
    if (byCommissioner) {
      if (league.draft_status !== 'active') {
        throw new DraftError(409, 'the draft is not active');
      }
      myTeam = teamForPick(league.current_pick, teams, rotationOpts);
      if (!myTeam) throw new DraftError(409, 'no team is currently on the clock');
    } else {
      // Caller comparison: the drafting manager's own team, found by the
      // caller's own id. Nothing about the league's creator enters here - the
      // commissioner branch above is where a commissioner-shaped power lives,
      // and it authorizes through isLeagueCommissioner.
      myTeam = teams.find((t) => t.owner_id === userId);
      if (!myTeam) throw new DraftError(403, 'not a member of this league');
      // A commissioner-locked team can't add players (draft picks flow through
      // this same function once draft_status === 'active'/'complete'); the
      // commissioner's own force-add tool bypasses this via a separate path.
      if (myTeam.locked) throw new DraftError(409, 'your team is locked by the commissioner');
      if (league.draft_status === 'active' && league.draft_type === 'offline') {
        throw new DraftError(409, 'this is an offline draft; the commissioner enters every pick');
      }
      // Autopick-type drafts resolve every pick server-side (autopick.service.js,
      // which calls in here with auto: true); a manager has no manual Pick
      // control for one (issue #120) and this is the server-side half of that
      // guarantee, not just a client-side hidden button.
      if (!auto && league.draft_status === 'active' && league.draft_type === 'autopick') {
        throw new DraftError(409, 'this is an autopick draft; picks are made automatically');
      }
    }

    const playerResult = await client.query(
      `SELECT "id", "name", "position" FROM "players" WHERE "id" = $1`,
      [playerId]
    );
    if (!playerResult.rows[0]) throw new DraftError(404, 'player not found');
    const position = playerResult.rows[0].position;

    const rosterCountResult = await client.query(
      `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
      [myTeam.id]
    );
    // Roster capacity, not the static roster limit: draft picks and post-draft
    // free-agent adds both land here, and an eligible IR stash grants a spot
    // beyond the draft roster size (#97). The added player himself earns no
    // restored credit - an add benches him (undoDrop is the one restore).
    const capacity = await rosterCapacity(client, { league, teamId: myTeam.id });
    if (rosterCountResult.rows[0].n >= capacity) {
      throw new DraftError(409, `roster capacity of ${capacity} reached`);
    }

    await assertPositionCapNotReached(client, { teamId: myTeam.id, positionCaps: league.position_caps, position });

    // Post-draft pickups are free agency: players still on waivers must be
    // claimed through the waiver process instead.
    if (league.draft_status === 'complete' &&
        await isOnWaivers(client, { league, playerId })) {
      throw new DraftError(409, 'player is on waivers; submit a waiver claim instead');
    }

    let pickNumber = null;
    let draftComplete = false;
    let nextTeamId = null;
    let pickDeadlineAt = null;

    if (league.draft_status === 'active') {
      if (league.draft_paused) {
        throw new DraftError(409, 'the draft is paused by the commissioner');
      }
      const onTheClock = teamForPick(league.current_pick, teams, rotationOpts);
      if (!onTheClock || onTheClock.id !== myTeam.id) {
        throw new DraftError(409, 'it is not your turn to pick');
      }
      pickNumber = league.current_pick + 1;
      await client.query(
        `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number")
         VALUES ($1, $2, $3, $4)`,
        [leagueId, myTeam.id, playerId, pickNumber]
      );

      // Rounds are draftRounds(league): fixed once when the draft went active
      // (ADR 0005), NOT a live draftRosterSize() recomputation — a completion
      // check that re-derived this from the league's current
      // roster_limit/ir_slots would let a later roster-shape reinterpretation
      // renumber picks already made. Goes through the same helper every other
      // consumer uses (not `league.draft_rounds` directly) so a legacy row the
      // one-time backfill migration hasn't reached yet falls back to the live
      // derivation instead of silently coercing `teams.length * null` to 0.
      const totalPicks = teams.length * draftRounds(league);
      // Keeper picks are pre-inserted at draft start and can occupy any slot,
      // so completion is a count of all picks made, not a comparison against
      // this pick's own (possibly non-terminal) pick_number.
      const pickCountResult = await client.query(
        `SELECT COUNT(*)::int AS n FROM "draft_picks" WHERE "league_id" = $1`,
        [leagueId]
      );
      draftComplete = pickCountResult.rows[0].n >= totalPicks;

      let nextTeam = null;
      let nextPickIndex = null;
      if (!draftComplete) {
        const takenResult = await client.query(
          `SELECT "pick_number" FROM "draft_picks" WHERE "league_id" = $1`,
          [leagueId]
        );
        const takenSet = new Set(takenResult.rows.map((r) => r.pick_number - 1));
        nextPickIndex = nextOpenPickNumber(takenSet, league.current_pick + 1, totalPicks);
        nextTeam = nextPickIndex === null ? null : teamForPick(nextPickIndex, teams, rotationOpts);
      }
      // The next team's clock: short autodraft delay if it autodrafts, else the
      // league pick clock (null = untimed / draft over). Offline drafts never
      // arm a deadline regardless of a team's autodraft flag or the league's
      // configured pick clock — picks only ever land via commissioner entry.
      const clockSeconds = league.draft_type === 'offline' ? null : nextPickClockSeconds({
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
        [draftComplete ? pickNumber : nextPickIndex, draftComplete ? 'complete' : 'active', leagueId, clockSeconds]
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

    // Every add lands on the bench, never back in an old stash (#94, user
    // story 13) - draft picks included, since the lineup screen has no draft
    // guard and a mid-draft drop leaves rows behind like any other.
    await lineupService.benchAcquiredPlayer(client, { league, teamId: myTeam.id, playerId });

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
    // teamName rides beside teamId so the `draft:picked` broadcast built from
    // this outcome can attribute the Pick by Team without a second lookup
    // (#112, parent #108).
    return {
      leagueId,
      ...teamIdentityOf(myTeam),
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
 *
 * The lineup follows the roster (#197): his unlocked current-week row and
 * every future week's row go with the roster row. What that row held is
 * recorded on the waiver hold first, because the hold is what gates undo and
 * the row will not be there to read afterwards.
 */
async function dropPlayer({ leagueId, userId, playerId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const team = await requireMember(client, { leagueId, userId, forUpdate: true });
    if (team.locked) throw new DraftError(409, 'your team is locked by the commissioner');

    const leagueResult = await client.query(
      `SELECT "id", "waiver_period_hours", "current_season", "current_week"
         FROM "leagues" WHERE "id" = $1`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new DraftError(404, 'league not found');

    const deleted = await client.query(
      `DELETE FROM "team_players"
       WHERE "team_id" = $1 AND "player_id" = $2 RETURNING "id"`,
      [team.id, playerId]
    );
    if (deleted.rowCount === 0) {
      throw new DraftError(404, 'player is not on your roster');
    }

    // Dropped players pass through waivers before returning to free agency,
    // and a manager drop is undoable, so the hold carries what the drop
    // interrupted (#197). Shared with the forced drop (#222).
    await placeOnWaiversUndoable(client, { league, teamId: team.id, playerId });
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
 *
 * Undo is the one acquisition that does not bench: it returns the player to
 * the stash his drop interrupted, from the record the drop wrote on that
 * same hold (#197), and only while that stash is still valid. Everything the
 * undo needs is therefore read before the hold is deleted.
 */
async function undoDrop({ leagueId, userId, playerId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const leagueResult = await client.query(
      `SELECT "id", "roster_limit", "ir_slots", "position_caps", "current_season", "current_week"
         FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new DraftError(404, 'league not found');

    const team = await requireMember(client, { leagueId, userId });

    const holdResult = await client.query(
      `SELECT 1 FROM "waiver_players"
       WHERE "league_id" = $1 AND "player_id" = $2 AND "dropped_by_team_id" = $3`,
      [leagueId, playerId, team.id]
    );
    if (!holdResult.rows[0]) {
      throw new DraftError(409, 'too late to undo; submit a waiver claim instead');
    }

    const rosterCountResult = await client.query(
      `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
      [team.id]
    );
    // restoredPlayerIds makes the undo really an undo: the stash his drop
    // interrupted still grants its spot on the way back in - but only while
    // it is still a valid stash. If it stopped being one while he was on
    // waivers, the undo benches him instead of restoring it ungated.
    const capacity = await rosterCapacity(client, {
      league,
      teamId: team.id,
      restoredPlayerIds: [playerId],
    });
    if (rosterCountResult.rows[0].n >= capacity) {
      throw new DraftError(409, `roster capacity of ${capacity} reached`);
    }
    // Read before the waiver hold is deleted below: the hold carries the
    // record of what the drop interrupted, and there is no longer a
    // surviving lineup row to fall back on (#197).
    //
    // This is the second read of that record in this function - `capacity`
    // above resolved it too, through `rosterCapacity`'s restoredPlayerIds -
    // and the duplication is kept on purpose (#222). Two ways to collapse it
    // were considered, and both cost more than the read:
    //
    // - Pass the resolved record INTO `rosterCapacity`. That gives up the
    //   property that makes it safe: it re-derives the restored credit
    //   itself rather than believing a caller, so no call site can inflate a
    //   roster limit by asserting a stash that is not there.
    // - Have `rosterCapacity` hand the record BACK. That keeps the property
    //   but widens a return value four other call sites consume as a bare
    //   number (draftPlayer, forceTransaction, trade, claimFailureReason),
    //   for the benefit of the one caller that passes restoredPlayerIds.
    //
    // The two reads can disagree on one axis, and it is worth being precise
    // about which: the recorded slot and attestation cannot move (the hold is
    // this transaction's own row and the league is held FOR UPDATE), but
    // validity also joins live `players.injury_status`, which the injury sync
    // updates under its own lock with no league lock. Every ordering is
    // benign: a designation that clears between the reads spends the credit
    // and benches him, one that qualifies restores the stash without the
    // credit, and a refusal is a 409 the manager retries.
    const restored = await interruptedStash(client, { leagueId, teamId: team.id, playerId });

    const playerResult = await client.query(
      `SELECT "id", "name", "position" FROM "players" WHERE "id" = $1`,
      [playerId]
    );
    if (!playerResult.rows[0]) throw new DraftError(404, 'player not found');

    await assertPositionCapNotReached(client, {
      teamId: team.id,
      positionCaps: league.position_caps,
      position: playerResult.rows[0].position,
    });

    await client.query(
      `DELETE FROM "waiver_players" WHERE "league_id" = $1 AND "player_id" = $2`,
      [leagueId, playerId]
    );
    await client.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueId, team.id, playerId]
    );
    if (restored) {
      // The row the undo returns him to no longer exists - the drop deleted
      // it - so the undo recreates it in the recorded slot, carrying the
      // attestation the drop interrupted.
      await lineupService.restoreInterruptedStash(client, {
        league, teamId: team.id, playerId, slot: restored.slot, irAttested: restored.irAttested,
      });
    } else {
      await lineupService.benchAcquiredPlayer(client, { league, teamId: team.id, playerId });
    }
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
