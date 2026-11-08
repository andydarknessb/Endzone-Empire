const { leagueWrite } = require('../modules/leagueWrite');
const { placeOnWaiversUndoable } = require('./waiver.service');
const { logTransaction, notify } = require('./activity.service');
const { requireMember } = require('./leagueMembership.service');
const { teamIdentityOf } = require('./teamIdentity');
const { assertFantasyLeagueRow } = require('./leagueType');
const { rosterCapacity, interruptedStash } = require('./irPolicy.service');
// #943: the acquire gate (roster capacity, the per-position cap, the waiver
// hold) now lives in rosterGate.service.js; this re-exports
// assertRosterAcquisitionAllowed below for pick.service.js and its own tests,
// and still calls assertPositionCapNotReached directly from undoDrop.
const {
  assertRosterAcquisitionAllowed,
  assertRosterWriteAllowed,
  assertPositionCapNotReached,
  ROSTER_GATE,
} = require('./rosterGate.service');
// The one writer of a single-player Roster move (#2535): the gate, the
// `team_players` row and the lineup step, in that order.
const rosterMove = require('./rosterMove.service');
const { DraftError } = require('./draftError');

/**
 * Whether a caught error is a draft REFUSAL rather than an internal fault. A
 * `DraftError` below 500 is a refusal: its message is copy a manager reads, so
 * a boundary echoes it verbatim. That holds with no exception today, including
 * the salary-cap/auction `startPlan` branch, which now answers 409 like every
 * other `startPlan` refusal (#824). A `DraftError` of 500 or above is an
 * internal invariant, not copy: every boundary logs it and answers with its
 * own generic message instead of showing the raw text.
 *
 * The predicate deliberately does not require `instanceof DraftError`: it
 * admits any error carrying a numeric `statusCode` below 500. That widening is
 * intentional (#808): narrowing to `instanceof DraftError` would have changed
 * the behavior of six of the seven draft boundaries this predicate replaced,
 * each of which let a non-`DraftError` with a `statusCode` through too (four
 * tested a bare `error.statusCode` alone, two tested
 * `instanceof DraftError || error.statusCode`); the seventh, the correct-pick
 * boundary, already tested `instanceof DraftError` alone, so the widening is a
 * no-op there. Anything without a numeric `statusCode` (a bare Error, a driver
 * error) is not a refusal either, so it takes the same generic, logged path.
 * This is the one predicate the seven draft boundaries branch on (#808).
 */
function isDraftRefusal(error) {
  return !!error && typeof error.statusCode === 'number' && error.statusCode < 500;
}


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
 * A post-draft free-agent add: the caller adds a free player to their OWN roster
 * once the draft is complete. This is NOT a Pick (#782 ruling 2, CONTEXT.md) - it
 * takes the Pick path's roster-acquisition checks through the shared helper
 * (assertRosterAcquisitionAllowed, re-exported from rosterGate.service.js),
 * but it commits no draft_pick, appends no Draft activity, arms no clock, and
 * reaches no room (a post-draft acquisition changes no Draft state, ADR 0025,
 * 2026-11-06). It refuses unless the draft is complete; a Pick, conversely, refuses
 * unless it is active. This is the free-agent add the team router calls (#782 ruling 2).
 *
 * The League write locks the league row FOR NO KEY UPDATE, exactly as a Pick does, so the
 * capacity read cannot race a concurrent add; the (league_id, player_id) unique
 * constraint is the double-add backstop.
 */
async function addFreeAgent({ leagueId, userId, playerId }) {
  // leagueWrite owns connect, BEGIN, the League lock, COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). The 23505 -> DraftError mapping that used to sit in
  // this transaction's own catch now sits in a catch around the wrapper (#1063
  // Ruling 3): the wrapper rethrows the ORIGINAL driver error untouched, so this
  // is a move, not a rewrite.
  try {
    return await leagueWrite({ leagueId, label: 'free-agent-add' }, async ({ client, league }) => {
      if (!league) throw new DraftError(404, 'league not found');
      // A pick'em-only league has no draft and no rosters; say so rather than the
      // generic "draft is not complete" (its draft_status is 'pending' forever).
      assertFantasyLeagueRow(league);
      // A free-agent add is a POST-draft acquisition: refuse until the draft is
      // complete. The mirror of commitPick's active-only guard (#782 ruling 2).
      if (league.draft_status !== 'complete') {
        throw new DraftError(409, 'the draft is not complete');
      }

      const teamsResult = await client.query(
        `SELECT "id", "name", "owner_id", "draft_position", "autodraft", "locked" FROM "teams"
         WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
        [leagueId]
      );
      const myTeam = teamsResult.rows.find((t) => t.owner_id === userId);
      if (!myTeam) throw new DraftError(403, 'not a member of this league');
      if (myTeam.locked) throw new DraftError(409, 'your team is locked by the commissioner');

      const playerResult = await client.query(
        `SELECT "id", "name", "position", "nfl_team" FROM "players" WHERE "id" = $1`,
        [playerId]
      );
      if (!playerResult.rows[0]) throw new DraftError(404, 'player not found');

      // The one Roster move writer (#2535): the acquire gate - which reads the
      // freeze off the League row this write holds, with no lock of its own - then the
      // roster row, then the bench. Team lock is
      // bypassed because this path already refused a locked team above
      // (myTeam.locked), which fails earlier and keeps that refusal's ordering
      // unchanged.
      await rosterMove.add(client, {
        league,
        teamId: myTeam.id,
        playerId,
        position: playerResult.rows[0].position,
        bypass: [ROSTER_GATE.TEAM_LOCK],
      });
      // Free-agent pickups go in the league transaction log (draft picks don't).
      await logTransaction(client, {
        leagueId,
        teamId: myTeam.id,
        type: 'add',
        detail: { playerId, playerName: playerResult.rows[0].name },
      });

      return {
        leagueId,
        ...teamIdentityOf(myTeam),
        player: playerResult.rows[0],
      };
    });
  } catch (error) {
    if (error.code === '23505') {
      throw new DraftError(409, 'player is already rostered in this league');
    }
    throw error;
  }
}

/**
 * Drop a player from the caller's roster in the league — transactional so the
 * roster row and any bookkeeping stay consistent.
 *
 * The lineup follows the roster (#197), and the roster move module owns that
 * step (#2535): it reads what his current-week row held before removing the
 * rows, and hands it back as the stash. The hold records that stash, because
 * the hold is what gates undo and the row will not be there to read afterwards.
 *
 * Lock order is League then Team (#962). This was the ONE path in the server
 * that inverted it: it took the Team row FOR UPDATE through requireMember and
 * then read the League unlocked, while every other roster write - and the
 * commissioner's forced transaction - locks the League first. Adopting the
 * write gate here without demoting that locking read would have shipped an
 * AB/BA pair between a drop and a forced transaction on the same league and
 * team. So the membership read is now a plain SELECT (it takes no row lock at
 * all); the League row is held by the write this runs in, and the gate inside `drop`
 * takes the Team row after it.
 */
async function dropPlayer({ leagueId, userId, playerId }) {
  // leagueWrite owns connect, BEGIN, the League lock, COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). No catch-side mapping here (the old catch only
  // rolled back and rethrew), so the wrapper is the whole transaction.
  return leagueWrite({ leagueId, label: 'drop-player' }, async ({ client, league }) => {
    // Demoted from FOR UPDATE (#962): see the lock-order note above. The Team
    // row is still locked a statement later, by the gate inside `drop`, after
    // the League write has locked the League row, so the order is League-then-Team.
    const team = await requireMember(client, { leagueId, userId });

    // The League write holds the row before this body runs, so `current_week`
    // (what the hold records and `removeLineupEntries` prunes against) cannot
    // move under the drop, and the gate inside `drop` reads that same row.
    if (!league) throw new DraftError(404, 'league not found');

    // A manager drop is undoable, so the module hands back what it interrupted;
    // nothing is bypassed: capacity, the position cap and the waiver hold are
    // acquire-only and never evaluated on a release.
    const { stash, removed } = await rosterMove.drop(client, {
      league, teamId: team.id, playerId, undoable: true,
    });
    if (removed === 0) {
      throw new DraftError(404, 'player is not on your roster');
    }

    // Dropped players pass through waivers before returning to free agency, and
    // the hold carries what the drop interrupted (#197, #2535). Shared with the
    // forced drop (#222).
    await placeOnWaiversUndoable(client, { league, teamId: team.id, playerId, stash });
    await logTransaction(client, {
      leagueId,
      teamId: team.id,
      type: 'drop',
      detail: { playerId },
    });

    return { leagueId, teamId: team.id, playerId };
  });
}

/**
 * How long an Undo drop stays open: two minutes, from the waiver hold's FIRST
 * write (#2546, spec #2540). Long enough for the 20-second Undo toast and for
 * the rollback of an add-with-drop, and no longer, because an undo withdraws
 * every other Team's pending Waiver claim on him (#2296).
 */
const UNDO_DROP_WINDOW_SECONDS = 120;

/**
 * Undo the caller's own recent drop: only valid while the player's waiver
 * hold still names this team as the dropper (see `placeOnWaivers`'s
 * `droppedByTeamId`) and is younger than UNDO_DROP_WINDOW_SECONDS. This is what
 * powers the drop snackbar's "Undo" button — a normal free-agent add
 * (addFreeAgent) would be rejected by the waiver-hold check.
 *
 * Undo is the one acquisition that does not bench: it returns the player to
 * the stash his drop interrupted, from the record the drop wrote on that
 * same hold (#197), and only while that stash is still valid. Everything the
 * undo needs is therefore read before the hold is deleted.
 */
async function undoDrop({ leagueId, userId, playerId }) {
  // leagueWrite owns connect, BEGIN, the League lock, COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). The 23505 -> DraftError mapping that used to sit in
  // this transaction's own catch now sits in a catch around the wrapper (#1063
  // Ruling 3); the wrapper rethrows the ORIGINAL driver error untouched.
  try {
    return await leagueWrite({ leagueId, label: 'undo-drop' }, async ({ client, league }) => {
      if (!league) throw new DraftError(404, 'league not found');

      const team = await requireMember(client, { leagueId, userId });

      // The freeze and the Team lock are asked HERE, before the hold is read, and
      // the module's own gate is told they were answered (#2535): the undo's other
      // refusals depend on what the hold says, so a frozen League must refuse
      // before that read rather than after it (#944). The module's acquire gate
      // therefore bypasses all five checks: capacity and the position cap below
      // are this function's own, the waiver hold IS the authorization to undo, and
      // the two locks were just refused here.
      await assertRosterWriteAllowed(client, {
        leagueId,
        teamId: team.id,
        direction: 'acquire',
        playerId,
        bypass: [ROSTER_GATE.CAPACITY, ROSTER_GATE.POSITION_CAP, ROSTER_GATE.WAIVER_HOLD],
      });

      // `created_at` is the hold's first write: a kickoff re-upsert of the same
      // hold moves only `available_at`/`updated_at` (waiver.service's ON
      // CONFLICT), so it cannot reopen an undo that has already expired.
      const holdResult = await client.query(
        `SELECT 1 FROM "waiver_players"
         WHERE "league_id" = $1 AND "player_id" = $2 AND "dropped_by_team_id" = $3
           AND "created_at" > now() - make_interval(secs => $4)`,
        [leagueId, playerId, team.id, UNDO_DROP_WINDOW_SECONDS]
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
    //   number (assertRosterAcquisitionAllowed, forceTransaction, trade, claimFailureReason),
    //   for the benefit of the one caller that passes restoredPlayerIds.
    //
    // The two reads can disagree on one axis, and it is worth being precise
    // about which: the recorded slot and attestation cannot move (the hold is
    // this transaction's own row and the league is held FOR NO KEY UPDATE), but
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
      // He is back on a roster, so every pending claim on him is now unwinnable
      // and would hold him on waivers (isOnWaivers) until a later tick (#2296).
      const withdrawn = await client.query(
        `UPDATE "waiver_claims" SET "status" = 'cancelled', "updated_at" = now()
         FROM "teams"
         WHERE "teams"."id" = "waiver_claims"."team_id"
           AND "waiver_claims"."league_id" = $1 AND "waiver_claims"."player_id" = $2
           AND "waiver_claims"."status" = 'pending'
         RETURNING "waiver_claims"."id", "teams"."owner_id"`,
        [leagueId, playerId]
      );
      for (const claim of withdrawn.rows) {
        await notify(client, {
          userId: claim.owner_id,
          leagueId,
          type: 'waiver_result',
          message: 'Your waiver claim was withdrawn: the player is no longer available because the drop was undone.',
          data: { claimId: claim.id, playerId },
        });
      }
      // The one Roster move writer (#2535): the acquire gate, the roster row,
      // then the stash his drop interrupted - the row the undo returns him to
      // no longer exists, so `add` recreates it in the recorded slot, carrying
      // the attestation the drop interrupted. No stash (it stopped qualifying
      // while he was on waivers) benches him like any other acquisition.
      await rosterMove.add(client, {
        league,
        teamId: team.id,
        playerId,
        position: playerResult.rows[0].position,
        stash: restored,
        bypass: [
          ROSTER_GATE.FREEZE, ROSTER_GATE.TEAM_LOCK,
          ROSTER_GATE.CAPACITY, ROSTER_GATE.POSITION_CAP, ROSTER_GATE.WAIVER_HOLD,
        ],
      });
      await logTransaction(client, {
        leagueId,
        teamId: team.id,
        type: 'add',
        detail: { playerId, playerName: playerResult.rows[0].name, undo: true },
      });

      return { leagueId, teamId: team.id, player: playerResult.rows[0] };
    });
  } catch (error) {
    if (error.code === '23505') {
      throw new DraftError(409, 'player is already rostered in this league');
    }
    throw error;
  }
}


module.exports = {
  addFreeAgent,
  assertRosterAcquisitionAllowed,
  dropPlayer,
  undoDrop,
  teamIndexForPick,
  shouldAutoEnableAutodraft,
  AUTO_ENABLE_TIMEOUTS,
  DraftError,
  isDraftRefusal,
};
