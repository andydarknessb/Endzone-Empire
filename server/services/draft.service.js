const pool = require('../modules/pool');
const { placeOnWaiversUndoable, isOnWaivers } = require('./waiver.service');
const { logTransaction } = require('./activity.service');
const { teamForPick, nextOpenPickNumber } = require('./draftOrder.service');
// Module object, not destructured: the seam tests mock benchAcquiredPlayer.
const lineupService = require('./lineup.service');
const { isLeagueCommissioner } = require('./leagueRole.service');
const { requireMember } = require('./leagueMembership.service');
const { teamIdentityOf } = require('./teamIdentity');
const { appendPickActivity, appendLifecycleActivity, appendCorrectionActivity, COMPLETE } = require('./draftActivity');
// correctionTarget is required lazily inside correctLatestPick: draftValidation
// already requires this module at load time (nextPickClockSeconds), so a
// top-level require here would close a cycle and hand draftValidation a
// half-built exports object.
const { assertFantasyLeagueRow } = require('./leagueType');
const { draftRounds } = require('./rosterShape');
const { rosterCapacity, interruptedStash } = require('./irPolicy.service');
// The Pick clock module owns arming: the only writer of the deadline and the
// current pick (ADR 0018). draftPlayer advances the turn through its named
// pick-landed event, and the arming policy (nextPickClockSeconds) is re-exported
// from here for the existing importers (draftValidation, the draft-clock tests).
const pickClock = require('./pickClock.service');

const { POSITION_GROUPS } = lineupService;

class DraftError extends Error {
  constructor(statusCode, message, code = null) {
    super(message);
    this.statusCode = statusCode;
    // A stable SCREAMING_SNAKE code (ADR 0008) a client branches on, distinct
    // from the human message. Optional so existing throws keep their behaviour.
    this.code = code;
  }
}

/**
 * The human copy behind each Commissioner-correction refusal code (#439). The
 * CODE is the contract a client branches on (ADR 0008); this is the message it
 * shows if it has nothing better. correctionTarget emits the three pick-shaped
 * codes; the service adds the authority and lifecycle ones.
 */
const CORRECTION_MESSAGES = {
  NO_PICK_TO_CORRECT: 'there is no live pick to correct yet',
  KEEPER_UNCORRECTABLE: 'a keeper pick cannot be corrected',
  LATEST_PICK_CHANGED: 'the latest pick changed; refresh the draft and try again',
};

/** Snake-draft order: which team index picks at pick number n (0-based). */
function teamIndexForPick(pickNumber, teamCount) {
  const round = Math.floor(pickNumber / teamCount);
  const slot = pickNumber % teamCount;
  return round % 2 === 0 ? slot : teamCount - 1 - slot;
}

const AUTO_ENABLE_TIMEOUTS = 2;

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
      // nfl_team rides along for the Draft-activity snapshot (#435): the feed's
      // Pick entry shows the player's NFL team, and the activity is written from
      // this same transaction, so the fact is read here rather than re-fetched.
      `SELECT "id", "name", "position", "nfl_team" FROM "players" WHERE "id" = $1`,
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
    // The Draft-activity entry for this Pick (#435), null for a post-draft
    // free-agent add (that is not a Draft Pick and appends no Draft activity).
    let activity = null;
    // The completion lifecycle entry (#437), set only on the Pick that ends the
    // draft. It is a state transition no manager performed, so it carries no
    // actor Team; the final Pick's own `activity` above already attributes the
    // Pick to the drafting Team.
    let completion = null;

    if (league.draft_status === 'active') {
      if (league.draft_paused) {
        throw new DraftError(409, 'the draft is paused by the commissioner');
      }
      const onTheClock = teamForPick(league.current_pick, teams, rotationOpts);
      if (!onTheClock || onTheClock.id !== myTeam.id) {
        throw new DraftError(409, 'it is not your turn to pick');
      }
      pickNumber = league.current_pick + 1;
      const pickInsert = await client.query(
        `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number")
         VALUES ($1, $2, $3, $4) RETURNING "id"`,
        [leagueId, myTeam.id, playerId, pickNumber]
      );
      const sourcePickId = pickInsert.rows[0].id;

      // Append the immutable Draft activity for this Pick in the SAME
      // transaction as the Pick (#435 AC1), snapshotting the facts the feed must
      // show and survive a later correction (#435 AC2). The round is derived
      // from the overall Pick number and the team count (the same 0-based
      // pickNumber / teamCount the rotation uses, made 1-based); `auto` is the
      // authoritative write's own fact, so an autopick is labeled only when it
      // truly occurred (#435 AC3). The row names no feed_seq: the trigger
      // allocates it from the shared per-league sequence.
      const round = Math.floor((pickNumber - 1) / teams.length) + 1;
      activity = await appendPickActivity(client, {
        leagueId,
        team: myTeam,
        player: playerResult.rows[0],
        round,
        pickNumber,
        auto,
        // The draft_picks row this entry represents (#436): coverage and
        // reconciliation match a Pick to its feed entry by this identity, not by
        // pick_number, which undo + re-pick reuses.
        sourcePickId,
      });

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
      // Advance the turn and arm the next team's clock through the Pick clock
      // module (ADR 0018): the only writer of current_pick and the deadline. It
      // applies the one arming policy (short autodraft delay, full pick time, or
      // none, and never a clock for an offline draft) and keeps the turn advance
      // and clock arm in one atomic statement. draft_status rides that statement
      // because the final pick's advance IS the completion, and the completion
      // side effects below depend on 'complete' being set first (#194).
      pickDeadlineAt = await pickClock.onPickLanded(client, {
        leagueId,
        nextPick: draftComplete ? pickNumber : nextPickIndex,
        draftStatus: draftComplete ? 'complete' : 'active',
        draftComplete,
        nextTeam,
        league,
      });
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
        // Record the completion as append-only Draft activity, in the SAME
        // transaction that flips the status to complete (#437 AC4). No actor:
        // completion is a state transition, not an action a manager took, so
        // fabricating one would be a missing-fact invention (#437 AC5). It
        // orders AFTER this final Pick's own activity by the shared sequence.
        // #437 records completion only; it carries no post-completion
        // correction contract, so nothing here arms one.
        completion = await appendLifecycleActivity(client, {
          leagueId,
          kind: COMPLETE,
          team: null,
        });
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
      // The typed Draft-activity entry for the combined feed (#435), so the
      // `draft:picked` broadcast carries it to the room beside the board update.
      // Null for a post-draft free-agent add.
      activity,
      // The completion lifecycle entry (#437), set only on the Pick that ends
      // the draft, else null. The socket emit sites deliver it on `draft:activity`
      // so the room's feed shows the draft closing beside the final Pick.
      completion,
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

/**
 * Commissioner correction (#439): pause an active Draft and reverse ONLY its
 * latest non-keeper Pick as one atomic act, recording the commissioner's
 * reason, and leave the Draft paused (CONTEXT.md: Commissioner correction). It
 * is the separate administrative act the Pick definition defers to - not a
 * manager undo, and not the general N-pick undo route.
 *
 * The league row is locked FOR UPDATE, exactly as draftPlayer locks it, so a
 * correction and a concurrent Pick (a manager's or an autopick) serialize on
 * the same lock and cannot interleave. `expectedPickNumber` is the Pick the
 * commissioner confirmed; if a newer Pick has landed since, the request is
 * stale (LATEST_PICK_CHANGED) rather than reversing a different Pick than the
 * one confirmed - the second half of "cannot race a manager or autopick".
 *
 * Every refusal is a DraftError carrying a stable SCREAMING_SNAKE code (ADR
 * 0008); the transaction rolls back on any of them, so a rejected correction
 * changes no Draft state.
 */
async function correctLatestPick({ leagueId, userId, expectedPickNumber = null, reason }) {
  // Validate the reason before opening a transaction: an invalid reason never
  // touches the database (#439 AC4). Trim so whitespace cannot pad the bound.
  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (trimmedReason.length < 10 || trimmedReason.length > 200) {
    throw new DraftError(400, 'a correction reason of 10 to 200 characters is required', 'CORRECTION_REASON_INVALID');
  }

  const { correctionTarget } = require('./draftValidation.service');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new DraftError(404, 'league not found', 'LEAGUE_NOT_FOUND');

    // Authority is a distinct question from status, so it gets a distinct code
    // and predicate (co-commissioners included, #439 AC3), not the combined
    // "not found, not commissioner, or not active" the older routes share.
    if (!(await isLeagueCommissioner(client, leagueId, userId))) {
      throw new DraftError(403, 'only the commissioner can correct a pick', 'NOT_COMMISSIONER');
    }
    // A completed Draft's final Pick is not correctable under this feature
    // (#439 AC6, spec #429); a pending Draft has nothing to correct.
    if (league.draft_status === 'complete') {
      throw new DraftError(409, 'the draft is complete; its final pick is not correctable', 'DRAFT_ALREADY_COMPLETE');
    }
    if (league.draft_status !== 'active') {
      throw new DraftError(409, 'the draft is not active', 'DRAFT_NOT_ACTIVE');
    }

    const teamsResult = await client.query(
      `SELECT "id", "name", "owner_id", "draft_position", "autodraft" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    const picksResult = await client.query(
      `SELECT "pick_number", "team_id", "player_id", "is_keeper" FROM "draft_picks" WHERE "league_id" = $1`,
      [leagueId]
    );

    const { target, code } = correctionTarget(picksResult.rows, league.current_pick, expectedPickNumber);
    if (code) {
      throw new DraftError(409, CORRECTION_MESSAGES[code], code);
    }

    // The reversed Pick's facts, snapshotted onto the correction activity so the
    // append-only feed self-describes what was corrected (#439). The player row
    // may be gone in theory (ON DELETE SET NULL); the snapshot then carries what
    // is known.
    const playerResult = await client.query(
      `SELECT "id", "name", "position", "nfl_team" FROM "players" WHERE "id" = $1`,
      [target.player_id]
    );
    const player = playerResult.rows[0] || { id: target.player_id, name: null, position: null, nfl_team: null };
    const team = teams.find((tm) => tm.id === target.team_id) || { id: target.team_id, name: null };

    // Reverse exactly the latest non-keeper Pick: its draft_picks row, its
    // roster row, and the lineup rows the Pick benched (the lineup follows the
    // roster, #197 - through the same removeLineupEntries the undo route uses,
    // so a settled week is still spared).
    await client.query(
      `DELETE FROM "draft_picks" WHERE "league_id" = $1 AND "pick_number" = $2`,
      [leagueId, target.pick_number]
    );
    await client.query(
      `DELETE FROM "team_players" WHERE "league_id" = $1 AND "team_id" = $2 AND "player_id" = $3`,
      [leagueId, target.team_id, target.player_id]
    );
    await lineupService.removeLineupEntries(client, { league, teamId: target.team_id, playerId: target.player_id });

    // The corrected slot was itself open before the Pick was made (a live pick,
    // never a keeper), so rewinding current_pick straight to it reproduces the
    // pre-pick state - and the Draft is LEFT PAUSED with no armed clock, so the
    // same team is on the clock again only when a commissioner resumes.
    const newCurrentPick = target.pick_number - 1;
    await client.query(
      `UPDATE "leagues"
       SET "draft_paused" = true, "current_pick" = $2, "pick_deadline_at" = NULL, "updated_at" = now()
       WHERE "id" = $1`,
      [leagueId, newCurrentPick]
    );

    const round = Math.floor((target.pick_number - 1) / teams.length) + 1;
    const activity = await appendCorrectionActivity(client, {
      leagueId,
      team,
      player,
      round,
      pickNumber: target.pick_number,
      reason: trimmedReason,
    });

    await client.query('COMMIT');
    return {
      leagueId,
      pickNumber: target.pick_number,
      ...teamIdentityOf(team),
      player,
      currentPick: newCurrentPick,
      paused: true,
      // The typed correction entry for the combined feed, so the route can
      // broadcast it to the room beside the paused draft:state.
      activity,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  draftPlayer,
  dropPlayer,
  undoDrop,
  correctLatestPick,
  teamIndexForPick,
  // Re-exported from the Pick clock module, which owns the one arming policy
  // (ADR 0018), for draftValidation.startPlan and the draft-clock unit tests.
  nextPickClockSeconds: pickClock.nextPickClockSeconds,
  shouldAutoEnableAutodraft,
  AUTO_ENABLE_TIMEOUTS,
  DraftError,
};
