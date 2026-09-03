const pool = require('../modules/pool');
const { placeOnWaiversUndoable, isOnWaivers } = require('./waiver.service');
const { logTransaction } = require('./activity.service');
// Module object, not destructured: the seam tests mock benchAcquiredPlayer.
const lineupService = require('./lineup.service');
const { isLeagueCommissioner } = require('./leagueRole.service');
const { requireMember } = require('./leagueMembership.service');
const { teamIdentityOf } = require('./teamIdentity');
const { appendCorrectionActivity } = require('./draftActivity');
// correctionTarget is required lazily inside correctLatestPick, kept lazy to
// avoid any load-order coupling with draftValidation (which pulls in the roster
// and draft-order modules at load time).
const { assertFantasyLeagueRow } = require('./leagueType');
const { rosterCapacity, interruptedStash } = require('./irPolicy.service');
// Every room-wide emit here rides the one Draft room adapter (#745); addFreeAgent
// resolves it at call time (ADR 0025), the same way pick.service and the routes do.
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
const { logger } = require('../modules/logger');
const sentry = require('../modules/sentry');

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
 * The roster-acquisition checks shared by a Pick (pick.service.commitPick) and a
 * post-draft free-agent add (addFreeAgent below), #782 ruling 2: roster capacity,
 * the per-position cap, and - for a completed draft only - the on-waivers gate.
 * The order matches what the single pre-#782 commit ran before it was split into
 * pick.service.commitPick and addFreeAgent, so both callers refuse for the same
 * reason in the same order they always did.
 *
 * Roster capacity is the IR-policy capacity, not the static roster limit: a draft
 * pick and a post-draft add both land here, and an eligible IR stash grants a
 * spot beyond the draft roster size (#97). The added player himself earns no
 * restored credit - an add benches him (undoDrop is the one restore).
 */
async function assertRosterAcquisitionAllowed(client, { league, teamId, playerId, position }) {
  const rosterCountResult = await client.query(
    `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
    [teamId]
  );
  const capacity = await rosterCapacity(client, { league, teamId });
  if (rosterCountResult.rows[0].n >= capacity) {
    throw new DraftError(409, `roster capacity of ${capacity} reached`);
  }

  await assertPositionCapNotReached(client, { teamId, positionCaps: league.position_caps, position });

  // Post-draft pickups are free agency: players still on waivers must be claimed
  // through the waiver process instead. An active draft never reaches this branch
  // (a Pick is not a waiver claim), so it is a no-op for pick.service.commitPick.
  if (league.draft_status === 'complete' &&
      await isOnWaivers(client, { league, playerId })) {
    throw new DraftError(409, 'player is on waivers; submit a waiver claim instead');
  }
}

/**
 * A post-draft free-agent add: the caller adds a free player to their OWN roster
 * once the draft is complete. This is NOT a Pick (#782 ruling 2, CONTEXT.md) - it
 * takes the Pick path's roster-acquisition checks through the shared helper above,
 * but it commits no draft_pick, appends no Draft activity, arms no clock, and
 * fans out only `rosterChanged` (the availability read model changed). It refuses
 * unless the draft is complete; a Pick, conversely, refuses unless it is active.
 *
 * The transaction locks the league row FOR UPDATE, exactly as a Pick does, so the
 * capacity read cannot race a concurrent add; the (league_id, player_id) unique
 * constraint is the double-add backstop. addFreeAgent below wraps this commit with
 * the post-COMMIT `rosterChanged` fan-out.
 */
async function commitFreeAgentAdd({ leagueId, userId, playerId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
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

    await assertRosterAcquisitionAllowed(client, {
      league, teamId: myTeam.id, playerId, position: playerResult.rows[0].position,
    });

    await client.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id")
       VALUES ($1, $2, $3)`,
      [leagueId, myTeam.id, playerId]
    );
    // A free-agent add lands on the bench, never back in an old stash (#94, user
    // story 13); undoDrop is the one acquisition that restores a stash.
    await lineupService.benchAcquiredPlayer(client, { league, teamId: myTeam.id, playerId });
    // Free-agent pickups go in the league transaction log (draft picks don't).
    await logTransaction(client, {
      leagueId,
      teamId: myTeam.id,
      type: 'add',
      detail: { playerId, playerName: playerResult.rows[0].name },
    });

    await client.query('COMMIT');
    return {
      leagueId,
      ...teamIdentityOf(myTeam),
      player: playerResult.rows[0],
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
 * The post-draft free-agent add the team router calls (#782 ruling 2). Commits the
 * add (commitFreeAgentAdd) and, after COMMIT, fans out ONLY `rosterChanged`
 * through the one Draft room adapter (#745). A post-draft acquisition is never a
 * Pick, so it emits no `pickLanded` and no Draft activity.
 *
 * The commit is authoritative, the same rule landPick follows (ADR 0025): the add
 * is durable the moment commitFreeAgentAdd returns, so a room fan-out failure is
 * not a failure of the add. The fan-out is contained so a post-COMMIT
 * getDraftRoomBroadcast throw (#765) cannot surface a committed add as a 500.
 */
async function addFreeAgent({ leagueId, userId, playerId }) {
  const outcome = await commitFreeAgentAdd({ leagueId, userId, playerId });
  try {
    await getDraftRoomBroadcast().rosterChanged(leagueId);
  } catch (error) {
    logger.error({ err: error, event: 'roster:changed', leagueId }, 'free-agent add committed but room fan-out failed');
    sentry.captureError(error, { event: 'roster:changed', leagueId });
  }
  return outcome;
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
 * a normal free-agent add (addFreeAgent) would be rejected by the waiver-hold check.
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
    //   number (assertRosterAcquisitionAllowed, forceTransaction, trade, claimFailureReason),
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
 * The league row is locked FOR UPDATE, exactly as a Pick commit (pick.service.commitPick) locks it, so a
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
  addFreeAgent,
  assertRosterAcquisitionAllowed,
  dropPlayer,
  undoDrop,
  correctLatestPick,
  teamIndexForPick,
  shouldAutoEnableAutodraft,
  AUTO_ENABLE_TIMEOUTS,
  DraftError,
};
