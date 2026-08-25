const { draftRosterSize, irSlotCount } = require('./rosterShape');

const IR_ELIGIBLE_DESIGNATIONS = new Set(['O', 'IR']);

/**
 * The current IR stashes, shared by the enforcement scan and the capacity
 * count so the two can never drift: each team's latest lineup snapshot at or
 * before the league's current week, still rostered, sitting in the IR slot.
 * Callers append their own scoping predicates and select list.
 *
 * Still-rostered is unconditional here. It used to be relaxed for a player
 * an undo was putting back, because his stash survived the drop as a stale
 * row and the undo landed him straight back in it. A lineup entry now
 * follows the roster (#197), so there is no such row to find and nothing to
 * relax: what an undo returns him to is the record the drop left on his
 * waiver hold, which `interruptedStash` reads instead.
 */
const fromCurrentIrStashes = () => `
       FROM "lineup_entries"
       JOIN "teams" ON "teams"."id" = "lineup_entries"."team_id"
       JOIN "leagues" ON "leagues"."id" = "teams"."league_id"
       JOIN "team_players" ON "team_players"."team_id" = "teams"."id"
         AND "team_players"."player_id" = "lineup_entries"."player_id"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
      WHERE "lineup_entries"."week" = (
              SELECT MAX("latest"."week") FROM "lineup_entries" AS "latest"
               WHERE "latest"."team_id" = "lineup_entries"."team_id"
                 AND "latest"."season" = "lineup_entries"."season"
                 AND "latest"."week" <= "leagues"."current_week"
            )
        AND "lineup_entries"."season" = "leagues"."current_season"
        AND "lineup_entries"."slot" = 'IR'`;
const INJURY_DESIGNATION_NAMES = {
  Q: 'questionable',
  D: 'doubtful',
  O: 'out',
  IR: 'injured reserve',
};

function isIrEligible(injuryDesignation) {
  return IR_ELIGIBLE_DESIGNATIONS.has(injuryDesignation);
}

/**
 * May this lineup entry legitimately sit in the IR slot? Eligibility is the
 * player's live injury designation; a commissioner attestation (#100) stands
 * in for it when the feed is wrong. Callers pass the entry row itself
 * (`injury_status` joined from players, `ir_attested` from lineup_entries).
 */
function isValidStash(entry) {
  return isIrEligible(entry.injury_status) || Boolean(entry.ir_attested);
}

function injuryDesignationName(injuryDesignation) {
  return INJURY_DESIGNATION_NAMES[injuryDesignation] || injuryDesignation || 'healthy';
}

/** Digits and nothing else: no sign, no point, no exponent, no 0x, no space. */
const PLAIN_DIGITS = /^[0-9]+$/;

/** A caller's value as it should read back in an error message. */
const describeValue = (value) => (
  typeof value === 'string' ? `the string ${JSON.stringify(value)}` : `${String(value)} (${typeof value})`
);

/**
 * One player id in canonical form: a positive safe integer, whether the
 * caller wrote it as a number or as a string of digits.
 *
 * Anything else is refused rather than dropped. Silently skipping a bad id
 * would answer a capacity question about a list the caller did not pass, and
 * handing it to `::int[]` would let the cast decide - either way a roster
 * limit moves with nothing to show for it, which is the whole failure mode
 * this family of defects has. Nothing here is user input (every caller reads
 * its ids from a database row or an already-validated route param), so a bad
 * one is a programmer error and `TypeError` is the honest shape for it, not
 * a status-carrying service error.
 *
 * Strings are held to plain digits on purpose. `Number` would also accept
 * `'0x15'`, `' 21 '` and `'1e3'` as 21, 21 and 1000, none of which Postgres
 * would accept as an `int`, and the point of this function is that the two
 * arms of one count stop disagreeing.
 */
function canonicalPlayerId(value, listName) {
  const id = typeof value === 'number' ? value
    : typeof value === 'string' && PLAIN_DIGITS.test(value) ? Number(value)
      : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new TypeError(
      `${listName} takes positive integer player ids; got ${describeValue(value)}`
    );
  }
  return id;
}

/**
 * A player-id list in canonical form: positive integers, each named once, in
 * the order first named.
 *
 * De-duplication belongs here, at the boundary, rather than at each point of
 * use: a restored id named twice must cost one read and earn one spot, and
 * collapsing after the reads would already have spent the second one.
 */
function canonicalPlayerIds(values, listName) {
  if (!Array.isArray(values)) {
    throw new TypeError(`${listName} takes an array of player ids; got ${describeValue(values)}`);
  }
  const canonical = new Set();
  for (const value of values) canonical.add(canonicalPlayerId(value, listName));
  return [...canonical];
}

/**
 * A team's **roster capacity**: how many players it may hold right now.
 * Draft roster size plus one per IR-eligible player currently stashed in an
 * IR slot, capped at the league's IR slot count. Only eligible (or
 * commissioner-attested, #100) occupants grant capacity, so a stash whose
 * occupant recovered leaves the team over capacity — a derived condition
 * that blocks adds until resolved, never a stored flag.
 *
 * `excludePlayerIds` names players leaving the roster in the same
 * transaction (a waiver drop, an outgoing trade piece): their stashes grant
 * nothing, since the move that needs the capacity also empties them.
 * `restoredPlayerIds` names a player an undo is putting back: the stash his
 * drop interrupted (see `interruptedStash`) counts even though he is neither
 * on the roster nor on a lineup card yet — without this, undoing the drop of
 * a stashed player on a full roster would be wrongly rejected. Only
 * `undoDrop` passes it; a waiver, trade, commissioner or free-agent add
 * benches the player instead and earns nothing. An attested stash rides the
 * undo too, deliberately: undoing the drop of an attested player restores
 * the commissioner's standing override the same way it restores an eligible
 * stash (a drop is not the manager slot move that ends an attestation), while
 * any other re-add benches him and the attestation ends with the bench row.
 *
 * The restored credit is re-derived here rather than trusted from the
 * caller, so a caller that passes an id whose recorded stash is no longer
 * valid gains nothing by it.
 *
 * The two lists are not independent: `excludePlayerIds` wins wherever they
 * overlap. An id in both names a player the same transaction is putting back
 * and taking away again, and the exclusion is the half that has actually
 * happened by the time capacity is checked, so crediting the restore would
 * count one IR spot twice. Both arms of the count therefore honour the
 * exclusion - the SQL for the still-rostered stashes, the overlap filter
 * below for the restored one.
 *
 * Both lists are canonicalised on entry (see `canonicalPlayerIds`), which is
 * what lets those two arms agree about what counts as the same player. Until
 * #277 they did not: the SQL arm coerced through `::int[]`, so `21` and
 * `'21'` were one player to it, while the overlap filter compared by
 * identity and saw two - and a restored id named twice was credited twice,
 * since a repeat that is not excluded passes the filter on every pass.
 * Neither was reachable (`undoDrop` passes one numeric id), but this
 * function's worth is that it re-derives the restored credit rather than
 * believing its caller, and those were the two places it still believed it:
 * about multiplicity, and about type.
 *
 * `league` must carry `id`, `roster_limit` and `ir_slots`; season and week
 * come from the team's league row inside the query, like the enforcement scan.
 */
async function rosterCapacity(client, { league, teamId, excludePlayerIds = [], restoredPlayerIds = [] }) {
  // Canonicalised before the zero-IR shortcut and before any read. The
  // contract belongs to the parameter, not to the league: whether `ir_slots`
  // happens to short-circuit the count must not decide whether a caller
  // hears about an id this function cannot use.
  const excluded = canonicalPlayerIds(excludePlayerIds, 'excludePlayerIds');
  const restored = canonicalPlayerIds(restoredPlayerIds, 'restoredPlayerIds');

  const base = draftRosterSize(league);
  const irSlots = irSlotCount(league);
  if (irSlots === 0) return base;

  const stash = await client.query(
    `SELECT COUNT(*)::int AS n${fromCurrentIrStashes()}
        AND "lineup_entries"."team_id" = $1
        AND ("players"."injury_status" = ANY($2::text[]) OR "lineup_entries"."ir_attested")
        AND NOT ("lineup_entries"."player_id" = ANY($3::int[]))`,
    [teamId, [...IR_ELIGIBLE_DESIGNATIONS], excluded]
  );
  let stashed = stash.rows[0].n;
  const excludedIds = new Set(excluded);
  // `restored` is already de-duplicated, so this loop reads once per player
  // rather than once per mention: a repeated id is one stash and one spot.
  for (const playerId of restored) {
    // Filtered before the read, not after: an excluded id earns nothing
    // whatever its record says, so asking is wasted work as well as wrong.
    // Both sides are canonical, so this comparison is the one the other
    // arm's `::int[]` cast already made.
    if (excludedIds.has(playerId)) continue;
    if (await undoRestoresStash(client, { leagueId: league.id, teamId, playerId })) stashed += 1;
  }
  return base + Math.min(irSlots, stashed);
}

/**
 * The stash a drop interrupted, if undoing it would return the player to a
 * valid one; null otherwise.
 *
 * The record is the `interrupted_slot` / `interrupted_ir_attested` pair the
 * drop wrote on the player's waiver hold (#197) - the slot and attestation
 * he held in the current week at the moment he was dropped. It is read
 * rather than a lineup row because a lineup entry follows the roster: the
 * drop deleted the row, and reviving one from an earlier week would restore
 * a stash the manager never left him in.
 *
 * Validity is the same question it always was: the occupant is IR-eligible,
 * or the commissioner attested the stash (#100). A stash that stopped being
 * valid while he was on waivers must not be restored past the placement
 * gate, and the enforcement scan (which only sees rostered players) would
 * never have flagged it. Scoped to the dropping team, so only the team that
 * holds the undo can be credited for it.
 */
async function interruptedStash(client, { leagueId, teamId, playerId }) {
  const result = await client.query(
    `SELECT "waiver_players"."interrupted_slot", "waiver_players"."interrupted_ir_attested",
            "players"."injury_status"
       FROM "waiver_players"
       JOIN "players" ON "players"."id" = "waiver_players"."player_id"
      WHERE "waiver_players"."league_id" = $1 AND "waiver_players"."player_id" = $2
        AND "waiver_players"."dropped_by_team_id" = $3`,
    [leagueId, playerId, teamId]
  );
  const record = result.rows[0];
  // Only a stash is ever restored, which is also what makes the restore safe
  // to write into a settled week: an IR entry never scores in any format.
  if (!record || record.interrupted_slot !== 'IR') return null;
  const attested = Boolean(record.interrupted_ir_attested);
  if (!attested && !isIrEligible(record.injury_status)) return null;
  return { slot: record.interrupted_slot, irAttested: attested };
}

/**
 * Would undoing this player's drop return him to a valid stash? The named
 * predicate over `interruptedStash`; `undoDrop` benches him when it is false.
 * Ask before the waiver hold is deleted, since the hold carries the record.
 */
async function undoRestoresStash(client, { leagueId, teamId, playerId }) {
  return (await interruptedStash(client, { leagueId, teamId, playerId })) !== null;
}

async function flagRecoveredIrStashes(client, transitions) {
  const transitionedPlayerIds = [...new Set(
    transitions
      .filter(({ previousDesignation, currentDesignation }) => (
        isIrEligible(previousDesignation) && !isIrEligible(currentDesignation)
      ))
      .map((transition) => transition.playerId)
  )];
  if (transitionedPlayerIds.length === 0) return [];

  const stashes = await client.query(
    `SELECT "lineup_entries"."player_id", "players"."name" AS "player_name",
            "players"."injury_status", "teams"."id" AS "team_id",
            "teams"."owner_id", "teams"."league_id"${fromCurrentIrStashes()}
        AND "lineup_entries"."player_id" = ANY($1::int[])
        AND NOT "lineup_entries"."ir_attested"`,
    [transitionedPlayerIds]
  );

  const { notify } = require('./activity.service');
  const irFlags = [];
  for (const stash of stashes.rows) {
    const message = `${stash.player_name} is no longer IR-eligible (${injuryDesignationName(stash.injury_status)}). Move him out of IR before saving your lineup.`;
    await notify(client, {
      userId: stash.owner_id,
      leagueId: stash.league_id,
      type: 'ir_flag',
      message,
      data: { playerId: stash.player_id, teamId: stash.team_id },
    });
    irFlags.push({
      userId: stash.owner_id,
      leagueId: stash.league_id,
      playerId: stash.player_id,
      playerName: stash.player_name,
      message,
    });
  }
  return irFlags;
}

async function sendIrFlagPushes(irFlags) {
  if (irFlags.length === 0) return { sent: 0 };
  const { usersWanting } = require('./prefs.service');
  const push = require('./push.service');
  const userIds = [...new Set(irFlags.map((flag) => flag.userId))];
  const wanted = new Set(await usersWanting(userIds, 'irAlerts'));
  let sent = 0;
  for (const flag of irFlags) {
    if (!wanted.has(flag.userId)) continue;
    const result = await push.sendPushToUsers([flag.userId], {
      title: 'IR roster action required',
      body: flag.message,
      url: `/#/league/${flag.leagueId}/lineup`,
    });
    sent += result.sent;
  }
  return { sent };
}

module.exports = {
  flagRecoveredIrStashes,
  injuryDesignationName,
  interruptedStash,
  isIrEligible,
  isValidStash,
  rosterCapacity,
  sendIrFlagPushes,
  undoRestoresStash,
};
