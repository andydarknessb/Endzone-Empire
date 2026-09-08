const { isOnWaivers } = require('./waiverStatus');
const { rosterCapacity } = require('./irPolicy.service');
const { POSITION_GROUPS } = require('./lineup.service');
const { DraftError } = require('./draftError');

/**
 * A roster write's direction. The freeze and the Team lock apply to both;
 * capacity, the position cap and the waiver hold are acquire-only (#944).
 */
const DIRECTION = Object.freeze({ ACQUIRE: 'acquire', RELEASE: 'release' });

/**
 * The five gates, each a token a caller may put in a write's exact-set bypass
 * list to skip that one check - because the caller enforces it itself (undoDrop
 * owns its restored-stash capacity; a waiver award owns its net capacity) or
 * because it is a deliberate override (the commissioner forced transaction).
 * An override is an explicit, readable decision, never the absence of a check
 * (#940 story 8).
 */
const ROSTER_GATE = Object.freeze({
  FREEZE: 'freeze',
  TEAM_LOCK: 'teamLock',
  CAPACITY: 'capacity',
  POSITION_CAP: 'positionCap',
  WAIVER_HOLD: 'waiverHold',
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

// The gate reads its own League row FOR UPDATE (#944 rule 1): every column the
// freeze check and the acquire bundle need, listed so a caller cannot starve
// the gate of the freeze fact by handing it a row that never selected it.
const LEAGUE_GATE_SELECT =
  `SELECT "id", "transactions_locked", "draft_status", "roster_limit", "ir_slots",
          "position_caps", "waivers_clear_at"
     FROM "leagues" WHERE "id" = $1 FOR UPDATE`;

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
async function assertRosterAcquisitionAllowed(client, { league, teamId, playerId, position, bypass }) {
  const skip = asBypassSet(bypass);

  if (!skip.has(ROSTER_GATE.CAPACITY)) {
    const rosterCountResult = await client.query(
      `SELECT COUNT(*)::int AS n FROM "team_players" WHERE "team_id" = $1`,
      [teamId]
    );
    const capacity = await rosterCapacity(client, { league, teamId });
    if (rosterCountResult.rows[0].n >= capacity) {
      throw new DraftError(409, `roster capacity of ${capacity} reached`);
    }
  }

  if (!skip.has(ROSTER_GATE.POSITION_CAP)) {
    await assertPositionCapNotReached(client, { teamId, positionCaps: league.position_caps, position });
  }

  // Post-draft pickups are free agency: players still on waivers must be claimed
  // through the waiver process instead. An active draft never reaches this branch
  // (a Pick is not a waiver claim), so it is a no-op for pick.service.commitPick.
  if (!skip.has(ROSTER_GATE.WAIVER_HOLD) &&
      league.draft_status === 'complete' &&
      await isOnWaivers(client, { league, playerId })) {
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
 * Rule 1 - the gate reads the freeze itself. It re-reads the League row FOR
 * UPDATE (a no-op re-lock when the caller already holds it, per this spec's
 * League-first order) rather than trusting a caller-supplied league object, so
 * no caller can starve it of the freeze fact by passing a row that never
 * carried the column (#940 story 15).
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
 * Lock order is League then Team: the gate locks the League row, then the Team
 * row, matching every wired caller, so adopting it introduces no AB/BA deadlock.
 */
async function assertRosterWriteAllowed(client, { leagueId, teamId, direction, playerId, position, bypass }) {
  if (direction !== DIRECTION.ACQUIRE && direction !== DIRECTION.RELEASE) {
    throw new DraftError(500, `roster gate: unknown direction "${direction}"; refusing`, 'ROSTER_GATE_INDETERMINATE');
  }
  const skip = asBypassSet(bypass);

  // Lock the League row first, then the Team row: one order on every path, so
  // adopting the gate introduces no AB/BA deadlock (#940 story 18). Both are
  // re-locks when the caller already holds them.
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
    await assertRosterAcquisitionAllowed(client, { league, teamId, playerId, position, bypass: skip });
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
