const { isOnWaivers } = require('./waiverStatus');
const { lockedPlayerIds, weekLastKickoff } = require('./lineup.service');
const { DraftError } = require('./draftError');
const { rosterFit, positionCapGroup, parsePositionCaps, countAtPositionGroup } = require('./rosterFit.service');

/**
 * A roster write's direction. The freeze and the Team lock apply to both;
 * capacity, the position cap and the waiver hold are acquire-only (#944).
 */
const DIRECTION = Object.freeze({ ACQUIRE: 'acquire', RELEASE: 'release' });

/**
 * The six gates, each a token a caller may put in a write's exact-set bypass
 * list to skip that one check - because the caller enforces it itself (undoDrop
 * owns its restored-stash capacity; a waiver award owns its net capacity) or
 * because it is a deliberate override (the commissioner forced transaction).
 * An override is an explicit, readable decision, never the absence of a check
 * (#940 story 8).
 *
 * KICKOFF_HOLD is its own key, distinct from WAIVER_HOLD (#1376, ADR 0043,
 * lead ruling on issue #1376): a trade moves an already-rostered player, never
 * a Free agent, so it must be exempt from the kickoff check without also
 * dropping the existing waiver-row check the WAIVER_HOLD token guards. Folding
 * the kickoff check into WAIVER_HOLD would force that same choice on every
 * bypass of either one; keeping them separate lets trade.service.js bypass
 * only the kickoff half.
 */
const ROSTER_GATE = Object.freeze({
  FREEZE: 'freeze',
  TEAM_LOCK: 'teamLock',
  CAPACITY: 'capacity',
  POSITION_CAP: 'positionCap',
  WAIVER_HOLD: 'waiverHold',
  KICKOFF_HOLD: 'kickoffHold',
});

/**
 * The commissioner forced-transaction override (commissioner.service.forceTransaction),
 * reproduced as an explicit set rather than read out of that path's own comment,
 * which is known to be incomplete (#940). forceTransaction bypasses the freeze,
 * per-team locks and waiver holds, and does NOT enforce the position cap; roster
 * capacity still binds, so CAPACITY is deliberately absent here. Slice #944
 * defined the set and proved it against the gate; #964 wired forceTransaction
 * at it, so this constant and that path's behaviour are now the same fact.
 */
const COMMISSIONER_OVERRIDE = Object.freeze([
  ROSTER_GATE.FREEZE,
  ROSTER_GATE.TEAM_LOCK,
  ROSTER_GATE.WAIVER_HOLD,
  ROSTER_GATE.POSITION_CAP,
]);

/** Every token a caller may legally name in a bypass list. */
const KNOWN_GATES = new Set(Object.values(ROSTER_GATE));

/**
 * A bypass list, validated. An unknown name throws rather than being ignored
 * (#964): a typo or a renamed token would otherwise leave a caller believing
 * it had overridden a gate it had not, which is the silent-drift failure the
 * exact-set design exists to prevent. Fail closed, with the same
 * ROSTER_GATE_INDETERMINATE code every other "this gate cannot answer" refusal
 * carries, because that is what this is.
 */
const asBypassSet = (bypass) => {
  const set = bypass instanceof Set ? bypass : new Set(bypass || []);
  for (const name of set) {
    if (!KNOWN_GATES.has(name)) {
      throw new DraftError(
        500,
        `roster gate: unknown bypass "${name}"; refusing`,
        'ROSTER_GATE_INDETERMINATE'
      );
    }
  }
  return set;
};

// The gate's League read takes no lock: every caller holds the League row through its
// League write (ADR 0070), so nothing can change it under this read. It carries every
// column the freeze check and the acquire bundle need, so a caller cannot starve the gate.
// current_season/current_week are the kicked-off check's week (#1376, ADR 0043);
// waiver_period_hours puts its week clear.
const LEAGUE_GATE_SELECT =
  `SELECT "id", "transactions_locked", "draft_status", "roster_limit", "ir_slots",
          "position_caps", "waivers_clear_at", "waiver_period_hours", "current_season", "current_week"
     FROM "leagues" WHERE "id" = $1`;

/** Enforce a team's per-position draft cap (if the league sets one for this player's cap group). Throws DraftError(409) when full. */
async function assertPositionCapNotReached(client, { teamId, positionCaps, position }) {
  const group = positionCapGroup(position);
  const cap = parsePositionCaps(positionCaps)[group];
  if (!Number.isInteger(cap)) return;
  if (await countAtPositionGroup(client, { teamId, group }) >= cap) {
    throw new DraftError(409, `position cap reached: max ${cap} ${group}`);
  }
}

/**
 * Whether the player's OWN NFL team has kicked off for the league's current
 * season and week (#1376, ADR 0043): kickoff puts an unrostered player on
 * waivers the same way a drop does, so the Add is refused from the kickoff
 * instant even in the minutes before the scheduler tick has written his
 * waiver_players row (ticket 1). The gate reads the player's team from the
 * `players` table itself here, matching its existing rule of never trusting
 * a caller-supplied fact (#940 story 15) - a caller passes no team at all.
 *
 * Defers the actual schedule comparison to the lineup lock's own predicate,
 * `lockedPlayerIds` (lineup.service.js), rather than re-deriving it a second
 * way: one kicked-off answer for the whole app, not two that can drift.
 *
 * The hold ends at the week clear (ADR 0043, 2026-11-09 amendment): the week's
 * last kickoff plus the League's waiver period. From then on a kicked-off
 * unrostered Player is a Free agent, whether or not the week has advanced.
 */
async function isPlayersTeamKickedOff(client, { league, playerId }) {
  const playerResult = await client.query(
    `SELECT "nfl_team" FROM "players" WHERE "id" = $1`,
    [playerId]
  );
  const nflTeam = playerResult.rows[0] ? playerResult.rows[0].nfl_team : null;
  const locked = await lockedPlayerIds(client, {
    season: league.current_season,
    week: league.current_week,
    players: [{ id: playerId, nflTeam }],
  });
  if (!locked.has(playerId)) return false;

  const lastKickoff = await weekLastKickoff(client, { season: league.current_season, week: league.current_week });
  if (!lastKickoff) return true;
  if (!Number.isFinite(league.waiver_period_hours)) {
    throw new DraftError(500, 'roster gate cannot read the waiver period; refusing', 'ROSTER_GATE_INDETERMINATE');
  }
  return Date.now() < lastKickoff.getTime() + league.waiver_period_hours * 60 * 60 * 1000;
}

/**
 * The roster-acquisition checks shared by a Pick (pick.service.commitPick) and a
 * post-draft free-agent add (draft.service.js's addFreeAgent), #782 ruling 2: roster capacity,
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
async function assertRosterAcquisitionAllowed(client, { league, teamId, playerId, position, bypass, moves }) {
  const skip = asBypassSet(bypass);

  // One fit answer (rosterFit). `moves` is the Team's pending move set when a caller
  // writes several moves in turn (a trade leg); without it, the one add is the whole move.
  // The caller's position for the add spares rosterFit a players-table read.
  const refusal = await rosterFit(client, {
    league,
    teamId,
    adds: moves ? moves.adds : [playerId],
    drops: moves ? moves.drops : [],
    checkCapacity: !skip.has(ROSTER_GATE.CAPACITY),
    checkPositionCap: !skip.has(ROSTER_GATE.POSITION_CAP),
    knownPositions: new Map(position === undefined ? [] : [[playerId, position]]),
  });
  if (refusal) throw new DraftError(409, refusal);

  // Post-draft pickups are free agency: players still on waivers must be claimed
  // through the waiver process instead. An active draft never reaches this branch
  // (a Pick is not a waiver claim), so it is a no-op for pick.service.commitPick.
  if (!skip.has(ROSTER_GATE.WAIVER_HOLD) && league.draft_status === 'complete' &&
      await isOnWaivers(client, { league, playerId })) {
    throw new DraftError(409, 'player is on waivers; submit a waiver claim instead');
  }

  // A kicked-off team is the same hold, just not yet written as a waiver_players
  // row (#1376, ADR 0043) - but it is its OWN token, KICKOFF_HOLD, not folded
  // into WAIVER_HOLD above (lead ruling on issue #1376): a trade moves an
  // already-rostered player, never a Free agent, so trade.service.js's
  // receiving-side gate bypasses KICKOFF_HOLD alone, and the existing
  // waiver-row check above still runs for it unchanged. It runs only when
  // NEITHER token is bypassed, so every caller that already bypasses
  // WAIVER_HOLD wholesale (a waiver-claim award, the commissioner override)
  // is unaffected with no edits of its own.
  if (!skip.has(ROSTER_GATE.WAIVER_HOLD) && !skip.has(ROSTER_GATE.KICKOFF_HOLD) &&
      league.draft_status === 'complete' &&
      await isPlayersTeamKickedOff(client, { league, playerId })) {
    throw new DraftError(409, 'player is on waivers; submit a waiver claim instead');
  }
}

/**
 * Whether a League row is frozen, read the one fail-closed way the write-time
 * gate below reads it (#944 rule 2): a row that cannot answer is refused, not
 * treated as "not frozen". `claimTarget`/`submitClaim` (waiver.service.js) and
 * `proposeTrade` (trade.service.js) are entry gates, not write-time gates -
 * they tell a manager before he fills in a form, and the actual roster write
 * still runs the full `assertRosterWriteAllowed` gate below. They call this
 * function instead of re-reading `transactions_locked` themselves, so entry
 * and write time read the freeze the same way and cannot drift on what the
 * column means (#966).
 */
function isLeagueFrozen(league) {
  if (!('transactions_locked' in league)) {
    throw new DraftError(500, 'roster gate cannot read the freeze state; refusing', 'ROSTER_GATE_INDETERMINATE');
  }
  return league.transactions_locked;
}

/**
 * The write-time roster gate (#944): may this Team acquire or release this
 * player right now? One assertion over the League id, the Team id, a direction
 * and an exact-set bypass list, so a seventeenth roster write inherits every
 * rule (#940 story 14).
 *
 * Rule 1 - the gate reads the freeze off the League row its caller holds. The
 * League write (ADR 0070) locks that row and hands it over, so the gate takes
 * no League lock of its own, and a row without the freeze column is refused by
 * rule 2 (#940 story 15).
 *
 * Rule 2 - the gate fails closed on a gate-input column the row cannot answer.
 * Reading the row is not enough: the fake pool's matcher keys on verb + leading
 * table and is blind to select lists, so an existing handler can answer this
 * query with a row lacking `transactions_locked`; undefined is falsy and would
 * pass the freeze silently. A row that cannot answer is refused with a DISTINCT
 * 500/ROSTER_GATE_INDETERMINATE, never treated as "not frozen" (#940 story 16).
 *
 * The error type is DraftError, which does NOT extend TradeError: the due-trade
 * processor permanently cancels a trade when it catches a TradeError, so a
 * freeze refusal that looked like one would destroy every accepted trade whose
 * review window ended during a freeze (#940).
 *
 * Lock order is League then Team: the caller's League write has locked the
 * League row, and the gate locks the Team row, so no AB/BA deadlock.
 */
async function assertRosterWriteAllowed(client, { leagueId, teamId, direction, playerId, position, bypass, moves }) {
  if (direction !== DIRECTION.ACQUIRE && direction !== DIRECTION.RELEASE) {
    throw new DraftError(500, `roster gate: unknown direction "${direction}"; refusing`, 'ROSTER_GATE_INDETERMINATE');
  }
  const skip = asBypassSet(bypass);

  // The caller's League write holds the row (ADR 0070), so this read needs no lock of
  // its own and the gate locks only the Team row below.
  const leagueResult = await client.query(LEAGUE_GATE_SELECT, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) throw new DraftError(404, 'league not found');

  // Freeze applies to BOTH directions. A gate-input column is only required
  // when its gate is actually evaluated: a bypassed check reads nothing, so it
  // cannot be starved. When the freeze IS evaluated, a row that cannot answer
  // it is refused - fail closed, never read as "not frozen" (#944 rule 2).
  if (!skip.has(ROSTER_GATE.FREEZE) && isLeagueFrozen(league)) {
    throw new DraftError(409, 'transactions are locked by the commissioner', 'TRANSACTIONS_LOCKED');
  }

  const teamResult = await client.query(
    `SELECT "id", "locked" FROM "teams" WHERE "id" = $1 FOR UPDATE`,
    [teamId]
  );
  const team = teamResult.rows[0];
  if (!team) throw new DraftError(404, 'team not found');

  // Team lock applies to BOTH directions, with the same fail-closed rule.
  if (!skip.has(ROSTER_GATE.TEAM_LOCK)) {
    if (!('locked' in team)) {
      throw new DraftError(500, 'roster gate cannot read the team lock state; refusing', 'ROSTER_GATE_INDETERMINATE');
    }
    if (team.locked) {
      throw new DraftError(409, 'your team is locked by the commissioner', 'TEAM_LOCKED');
    }
  }

  // Capacity, the position cap and the waiver hold are acquire-only. The gate
  // reads its OWN league row here too, so the acquire bundle is never fed a
  // caller-supplied object either.
  if (direction === DIRECTION.ACQUIRE) {
    await assertRosterAcquisitionAllowed(client, { league, teamId, playerId, position, bypass: skip, moves });
  }
}

module.exports = {
  assertRosterWriteAllowed,
  assertRosterAcquisitionAllowed,
  assertPositionCapNotReached,
  isLeagueFrozen,
  DIRECTION,
  ROSTER_GATE,
  COMMISSIONER_OVERRIDE,
};
