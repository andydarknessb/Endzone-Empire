const pool = require('../modules/pool');
// DEFAULT_ROSTER_SLOTS lives in a pure leaf (no load-time require) so the client
// parity test can read it without pulling pg into jsdom (#677); re-exported below
// so every existing consumer resolves the identical reference unchanged.
const { DEFAULT_ROSTER_SLOTS } = require('./rosterSlots');
const { isPickemOnly, PICKEM_ONLY_MESSAGE } = require('./leagueType');
const { requireMember } = require('./leagueMembership.service');
const { computeByeWeeks } = require('./bye.service');
const { injuryDesignationName, isValidStash } = require('./irPolicy.service');
const { normalizeNflTeam } = require('./nflTeam');

class LineupError extends Error {
  constructor(statusCode, message, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const BENCH = 'BENCH';
const IR = 'IR';
const BEST_BALL_MANAGED_SLOTS = new Set([BENCH, IR]);

// Group keys usable in a slot's eligiblePositions alongside literal position
// codes (e.g. a "DP" slot's eligiblePositions might be ['DL','LB','DB']) —
// expands to every specific defensive position Tank01 reports in that group.
// Players keep their specific position (e.g. 'CB') for display; slots
// configure eligibility at the group level.
const POSITION_GROUPS = {
  DL: ['DL', 'DE', 'DT', 'NT'],
  LB: ['LB', 'ILB', 'OLB'],
  DB: ['DB', 'CB', 'S', 'FS', 'SS'],
};

/** A slot's eligiblePositions, with any group key (DL/LB/DB) expanded to its member positions. */
function expandEligibility(eligiblePositions) {
  const out = new Set();
  for (const p of eligiblePositions || []) {
    if (POSITION_GROUPS[p]) POSITION_GROUPS[p].forEach((m) => out.add(m));
    else out.add(p);
  }
  return out;
}

/**
 * Pure: may a player of this position sit in this named slot? BENCH/IR take
 * anyone. rosterSlots defaults to the standard 7-slot shape so existing
 * 2-arg call sites (and tests) keep working unchanged against it.
 */
function slotEligible(slotKey, position, rosterSlots = DEFAULT_ROSTER_SLOTS) {
  if (slotKey === BENCH || slotKey === IR) return true;
  const slot = rosterSlots.find((s) => s.key === slotKey);
  if (!slot) return false;
  return expandEligibility(slot.eligiblePositions).has(position);
}

/**
 * Normalize a league row's roster/lineup configuration (jsonb columns arrive
 * as objects from pg, but tolerate strings for safety).
 */
function parseLineupSettings(league) {
  const parse = (value, fallback) => {
    if (value == null) return fallback;
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return fallback; }
    }
    return value;
  };
  return {
    rosterSlots: parse(league.roster_slots, DEFAULT_ROSTER_SLOTS),
    positionCaps: parse(league.position_caps, {}),
    benchSlots: Number.isInteger(league.bench_slots) ? league.bench_slots : 5,
    irSlots: Number.isInteger(league.ir_slots) ? league.ir_slots : 1,
  };
}

/**
 * Pure: validate a full lineup against league settings.
 * entries: [{ playerId, position, slot }]. Returns an array of error strings
 * (empty when valid). Starting slots, BENCH, and IR are all capped — total
 * roster size is enforced as starters + bench + IR by construction.
 *
 * `baseline` (optional): the same lineup's entries as they stood BEFORE the
 * save under validation. When given, a slot's cap is enforced as "no worse
 * than baseline" rather than absolutely — see the comment at the cap check.
 *
 * `spent` (optional): `spentStartingSlots` rows, [{ slot }]. Each occupies a
 * seat of its starting slot in the counts and nothing more: a spent row is a
 * record, not a placement, so it faces no eligibility check (its player's
 * position may have been reclassified since the week was played) and a slot
 * key the league's shape no longer knows is ignored rather than an error —
 * an immovable row must never be able to refuse every save.
 */
function validateLineup(entries, { rosterSlots = DEFAULT_ROSTER_SLOTS, benchSlots = 5, irSlots = 1, baseline = null, spent = null } = {}) {
  const errors = [];
  const counts = {};
  const slotByKey = new Map(rosterSlots.map((s) => [s.key, s]));
  for (const row of spent || []) {
    if (slotByKey.has(row.slot)) counts[row.slot] = (counts[row.slot] || 0) + 1;
  }
  for (const entry of entries) {
    const slot = entry.slot;
    if (slot !== BENCH && slot !== IR && !slotByKey.has(slot)) {
      errors.push(`unknown slot "${slot}"`);
      continue;
    }
    if (!slotEligible(slot, entry.position, rosterSlots)) {
      errors.push(`a ${entry.position} cannot start at ${slot}`);
      continue;
    }
    counts[slot] = (counts[slot] || 0) + 1;
  }
  // A save is refused for overflow it CREATES, never for overflow it merely
  // inherits. A roster can hold more players than its fillable slots can
  // seat (a draft that took six QBs and no TE leaves seven players for a
  // six-slot bench), and with an absolute cap every such lineup rejects
  // every save, wedging the team permanently: the manager cannot even make
  // the moves or the drops that would dig them out. So when the caller
  // supplies the pre-save `baseline` entries, BENCH and IR caps are forgiven
  // up to the overflow that already stood there; a save that leaves them no
  // worse is legal, and one that worsens them still refuses with the same
  // message. Forgiveness covers ONLY the seats that never score. A STARTING
  // slot's cap stays absolute even against a baseline that overflows it:
  // every non-BENCH/IR row scores, so tolerating an inherited second QB
  // would turn a loud, correctable state into silent score inflation.
  // Eligibility above stays absolute too: an ineligible placement is always
  // new.
  const baselineCounts = {};
  for (const entry of baseline || []) {
    baselineCounts[entry.slot] = (baselineCounts[entry.slot] || 0) + 1;
  }
  for (const [slot, count] of Object.entries(counts)) {
    const max = slot === IR ? irSlots : slot === BENCH ? benchSlots : slotByKey.get(slot).count;
    const allowed = slot === BENCH || slot === IR
      ? Math.max(max, baselineCounts[slot] || 0)
      : max;
    if (count > allowed) errors.push(`too many players at ${slot} (${count}/${max})`);
  }
  return errors;
}

function entriesForLineupValidation(entries, league) {
  const lineupEntries = Array.from(entries);
  return league.best_ball
    ? lineupEntries.filter((entry) => entry.slot === IR)
    : lineupEntries;
}

/**
 * Is this (team, week) closed to new lineup rows? True only when the team's
 * OWN matchup for that week is final (#106).
 *
 * Absence of a matchup row is deliberately not finality: a team on a bye, or
 * any week before the schedule exists, has nothing to be final and must keep
 * materializing exactly as before. Another matchup being final says nothing
 * about a team that did not play in it, so the team is matched on either side
 * of its own game rather than on the week as a whole.
 */
async function isFinalWeekForTeam(client, { leagueId, teamId, season, week }) {
  const result = await client.query(
    `SELECT 1 FROM "matchups"
     WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "final" = true
       AND ("home_team_id" = $4 OR "away_team_id" = $4)
     LIMIT 1`,
    [leagueId, season, week, teamId]
  );
  return result.rows.length > 0;
}

/**
 * Ensure every player currently on the team's roster has a lineup_entries row
 * for (season, week). First touch of a week copies slots forward from the
 * team's most recent earlier week. A standard league's first-ever lineup is
 * seeded with a legal starter assignment; later players without history
 * default to BENCH.
 * Must run inside the caller's transaction (client).
 *
 * A FINAL week is frozen (#106): its rows are the record of the week as
 * played, never a working lineup, so nothing materializes into one. The guard
 * lives here rather than at each caller because a final week must be closed
 * on EVERY path that reaches this function, and because the next caller added
 * must inherit that for free rather than having to remember it. Without it, a
 * player acquired in the routine window between the last whistle and the
 * commissioner's advance gets a row in the finished week and is then paid for
 * it by the next re-score: a stat correction or a manual score call silently
 * rewrites a score that was already settled.
 *
 * This does not change how a live week scores, and it does not cost the
 * acquired player his bench spot: the new current week has no row for him
 * either, so its first touch materializes him onto the bench (#97 / PR #102).
 *
 * `acquiredPlayerId` (set only by `benchAcquiredPlayer`) names a player whose
 * copy-forward slot must not be trusted: his latest earlier week may hold the
 * starting slot he was dropped out of, and reviving it seats him beside
 * whoever holds that slot now (#623). His fresh row lands on the bench with
 * no attestation. The first-ever starter seed still applies to him - there is
 * no standing lineup for that seed to disrupt, and every live draft pick
 * arrives through this path (the keeper pre-fill writes no lineup rows, so
 * it neither needs nor gets the flag).
 */
async function materializeLineup(client, { leagueId, teamId, season, week, league, acquiredPlayerId }) {
  if (await isFinalWeekForTeam(client, { leagueId, teamId, season, week })) return;

  const rosterResult = await client.query(
    `SELECT "team_players"."player_id", "players"."position"
     FROM "team_players" JOIN "players" ON "players"."id" = "team_players"."player_id"
     WHERE "team_players"."team_id" = $1`,
    [teamId]
  );
  if (rosterResult.rows.length === 0) return;

  const existing = await client.query(
    `SELECT "player_id" FROM "lineup_entries"
     WHERE "team_id" = $1 AND "season" = $2 AND "week" = $3`,
    [teamId, season, week]
  );
  const have = new Set(existing.rows.map((r) => r.player_id));
  const missing = rosterResult.rows.filter((r) => !have.has(r.player_id));
  if (missing.length === 0) return;

  // Copy-forward source: the team's latest earlier week this season (if any).
  // The commissioner attestation travels with the slot (#100), so an
  // attested stash stays attested across weeks until the manager moves him.
  const prevResult = await client.query(
    `SELECT "player_id", "slot", "ir_attested" FROM "lineup_entries"
     WHERE "team_id" = $1 AND "season" = $2
       AND "week" = (SELECT MAX("week") FROM "lineup_entries"
                     WHERE "team_id" = $1 AND "season" = $2 AND "week" < $3)`,
    [teamId, season, week]
  );
  const prevEntries = new Map(prevResult.rows.map((r) => [r.player_id, r]));
  const initialStarterSlots = new Map();
  if (league && !league.best_ball && existing.rows.length === 0 && prevEntries.size === 0) {
    const { rosterSlots } = parseLineupSettings(league);
    const { starters } = optimalLineup(
      rosterResult.rows.map(({ player_id, position }) => ({ playerId: player_id, position })),
      rosterSlots
    );
    for (const starter of starters) initialStarterSlots.set(starter.playerId, starter.slot);
  }

  for (const row of missing) {
    const acquired = row.player_id === acquiredPlayerId;
    const prev = acquired ? undefined : prevEntries.get(row.player_id);
    await client.query(
      `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot", "ir_attested")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ("team_id", "season", "week", "player_id") DO NOTHING`,
      [leagueId, teamId, row.player_id, season, week,
        initialStarterSlots.get(row.player_id) || prev?.slot || BENCH,
        Boolean(prev?.ir_attested)]
    );
  }
}

/**
 * An acquired player never arrives in the IR slot (#94, user story 13): a
 * player gained by draft pick, waiver, trade, commissioner add or free agency
 * cannot bypass the placement gate.
 *
 * A lineup entry follows the roster now (#197), so an ordinary departure no
 * longer leaves a stash behind for a re-add to sit straight back into. What
 * still reaches this function and needs closing: a POST-KICKOFF departure
 * keeps its current-week row deliberately, and `materializeLineup`'s
 * copy-forward reads the player's latest earlier week - which can hold an IR
 * stash or the very starting slot he was dropped out of, now occupied by
 * someone else (#623).
 *
 * Two steps, in this order. First the current week is materialized, so it is
 * a complete week (never a lone row the next copy-forward would read as its
 * source and bench the whole roster by) and the player has a row in it;
 * naming him as acquired makes any fresh row of his land on the bench rather
 * than on whatever his old week held. Then every surviving IR row of his from
 * the current week on is moved to the bench, ending any standing attestation
 * (#100) with it: an acquisition is not the undo that restores one. The sweep
 * touches only IR rows: a starter row from a week he actually played stays as
 * played, with its points. Earlier weeks are history and stay as they were.
 *
 * `undoDrop` calls this only when the stash it would restore is no longer
 * valid (`undoRestoresStash`); otherwise an undo replays the stash its drop
 * interrupted, from the record on the waiver hold, which is also what
 * `rosterCapacity`'s `restoredPlayerIds` credits.
 * Must run inside the caller's transaction, after the roster write.
 */
async function benchAcquiredPlayer(client, { league, teamId, playerId }) {
  const { id: leagueId, current_season: season, current_week: week } = league;
  await materializeLineup(client, { leagueId, teamId, season, week, league, acquiredPlayerId: playerId });
  await client.query(
    `UPDATE "lineup_entries" SET "slot" = $5, "ir_attested" = false, "updated_at" = now()
     WHERE "team_id" = $1 AND "player_id" = $2 AND "season" = $3 AND "week" >= $4 AND "slot" = $6`,
    [teamId, playerId, season, week, BENCH, IR]
  );
}

/**
 * A lineup entry follows the roster (#197). When a team loses a player - by
 * drop, waiver claim, commissioner drop, trade, undone draft pick or the
 * keeper-pruning season rollover - his entries for that team go with him:
 *
 *   - every FUTURE week, always: he is not on the roster, so the row is noise
 *     that no reader should ever see;
 *   - the CURRENT week, unless BOTH his NFL game for it has already kicked
 *     off (by the same predicate the lineup lock uses, `lockedPlayerIds`, so
 *     no game row that week means not locked, and a DEF unit is answered the
 *     same way as anyone else, #227) AND a tenure of this team
 *     covered that kickoff (#228);
 *   - PAST weeks, never: they are the record of the week as played (#106).
 *
 * A surviving current-week row therefore means "he was on this roster at
 * kickoff", which is what every reader of a played week assumes. Deleting it
 * unconditionally would be the same disappearance #190 exists to prevent: a
 * starter dropped on Sunday night would lose his row and with it his points.
 *
 * The tenure half is what makes that sentence true rather than nearly true.
 * Kickoff alone spares the row of a player acquired AFTER his game was
 * played and dropped again, leaving behind evidence of a week he did not
 * play here; the #197 invariant then quietly means "his team's schedule had
 * started", which is not the same claim and not the one readers rely on.
 *
 * A week the team's own matchup has already settled is likewise left alone,
 * for the reason #106 gives - its rows are the record, not a working lineup,
 * and a DELETE is a write into it like any other. That only ever bites when
 * the kickoff question cannot answer (no game row for him that week), which
 * is a true bye or an unsynced schedule; the second is the one that would
 * cost real points.
 *
 * Runs inside the caller's transaction, after the roster row is gone.
 *
 * Six paths call this, and if you are adding a seventh, note that five of
 * them are one call beside one DELETE of a single roster row. The sixth,
 * `commissioner.service`'s keeper-pruning rollover, prunes the whole league
 * in one bulk statement, so it derives the pruned (team, player) pairs from
 * a roster read taken beforehand and loops. A bulk removal modelled on the
 * other five cleans nothing and fails no test.
 */
async function removeLineupEntries(client, { league, teamId, playerId, now = new Date() }) {
  const { id: leagueId, current_season: season, current_week: week } = league;
  const playerResult = await client.query(
    `SELECT "nfl_team" FROM "players" WHERE "id" = $1`,
    [playerId]
  );
  const nflTeam = playerResult.rows[0]?.nfl_team;
  const locked = await lockedPlayerIds(client, {
    season, week, now, players: [{ id: playerId, nflTeam }],
  });
  // Spared only if his game had kicked off AND a tenure of this team covered
  // that kickoff. "Kicked off" alone is what #197 shipped, and it is not
  // enough: a player acquired AFTER his game had already been played is
  // locked by the schedule while having been held for none of it, so his row
  // would survive as evidence of a week he did not play here (#190). The
  // tenure just closed by this drop is still visible - the trigger closed it
  // at `now()`, after kickoff - so it answers for the tenure that is ending.
  const kickedOff = locked.has(playerId);
  // Only a kicked-off game can spare the row, so the tenure is only worth
  // asking about once that is true. A departure before kickoff keeps exactly
  // the reads it has always made. `sparedByKickoff` therefore already implies
  // `kickedOff`, and re-testing it below would be dead.
  const sparedByKickoff = kickedOff && !(await playersNotHeldAtKickoff(client, {
    teamId, season, week, players: [{ id: playerId, nflTeam }],
  })).has(playerId);
  // Finality still wins over both (#106): a settled week's rows are the record,
  // and a DELETE into one is a write like any other, whatever the tenure says.
  const removeCurrentWeek = !sparedByKickoff
    && !(await isFinalWeekForTeam(client, { leagueId, teamId, season, week }));
  // One statement either way: the current week is spared by the bound
  // parameter, not by a second query, so there is a single predicate to read
  // and a single one to get wrong.
  const result = await client.query(
    `DELETE FROM "lineup_entries"
     WHERE "team_id" = $1 AND "player_id" = $2 AND "season" = $3
       AND ("week" > $4 OR ("week" = $4 AND $5::boolean))`,
    [teamId, playerId, season, week, removeCurrentWeek]
  );
  return { removedCurrentWeek: removeCurrentWeek, removed: result.rowCount };
}

/**
 * The starting slots already spent for (team, season, week) by surviving
 * as-played rows: lineup rows whose player is no longer on the roster (#627).
 *
 * For a current week such a row exists because `removeLineupEntries` spared
 * it - his game had kicked off and a tenure of this team covered that
 * kickoff - so it is the record of the week as played, and the settle pass
 * will score it (the as-played population has no roster join, and the #190
 * exclusion does not fire for a tenure that really covered the kickoff). A
 * slot it occupies is therefore spent: seating a replacement beside it
 * double-scores the slot, which is exactly the score inflation an absolute
 * starting cap exists to refuse - but the save validations read their
 * entries through a roster join that cannot see this row. Both validation
 * sites (`setLineup` and the commissioner's `forceSetLineup`) hand these
 * rows to `validateLineup` as its `spent` option: counted against the caps,
 * never movable, never eligibility-checked. (`removeLineupEntries` has a
 * second spare, finality - moot here, because advance-week sets `final` and
 * moves `current_week` on in one transaction, so a final week is never the
 * current week a save validates.)
 *
 * BENCH and IR rows are excluded because they never score: a bench seat is
 * not spent by a departed player, and blocking one would refuse harmless
 * saves. Validation receives a null `player_id`, while the read surface also
 * receives the departed player's identity so it can explain the spent seat.
 */
async function spentStartingSlots(client, { teamId, season, week }) {
  const result = await client.query(
    `SELECT "players"."position", "lineup_entries"."player_id" AS "spent_player_id",
            "players"."name", "players"."nfl_team",
            "players"."injury_status", "lineup_entries"."slot"
       FROM "lineup_entries"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
       LEFT JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
        AND "team_players"."player_id" = "lineup_entries"."player_id"
      WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
        AND "lineup_entries"."week" = $3
        AND "lineup_entries"."slot" NOT IN ('BENCH', 'IR')
        AND "team_players"."player_id" IS NULL`,
    [teamId, season, week]
  );
  return result.rows.map((row) => ({
    player_id: null,
    id: row.spent_player_id,
    name: row.name,
    position: row.position,
    nfl_team: row.nfl_team,
    injury_status: row.injury_status,
    slot: row.slot,
    spent: true,
  }));
}

/**
 * The slot and attestation a player holds on this team in the league's
 * current week right now, or null when he has no row there. A drop reads it
 * before `removeLineupEntries` takes the row away, so the waiver hold can
 * record what the drop interrupted and an undo can replay it (#197).
 */
async function currentWeekEntry(client, { league, teamId, playerId }) {
  const result = await client.query(
    `SELECT "slot", "ir_attested" FROM "lineup_entries"
     WHERE "team_id" = $1 AND "player_id" = $2 AND "season" = $3 AND "week" = $4`,
    [teamId, playerId, league.current_season, league.current_week]
  );
  return result.rows[0] || null;
}

/**
 * A `currentWeekEntry` result as the waiver hold's interrupted-stash fields
 * (#197). One mapping, shared by the two drops that are undoable, so "he had
 * no current-week entry" is spelled the same way at both.
 */
function interruptedStashFields(entry) {
  return {
    interruptedSlot: entry ? entry.slot : null,
    interruptedIrAttested: Boolean(entry && entry.ir_attested),
  };
}

/**
 * Undoing a drop puts the player back in the slot the drop interrupted,
 * recorded on his waiver hold at drop time (#197). The row itself is gone -
 * the drop deleted it - so the undo recreates it rather than finding it.
 *
 * Materialize first, for the same reason `benchAcquiredPlayer` does: the week
 * must be complete before it can be the next copy-forward's source. Then the
 * recorded slot and attestation are written over whatever materialization
 * left him in.
 *
 * This is the one write that a FINAL week does not refuse (#106), and it is
 * deliberate. `rosterCapacity` has already credited the restored stash by
 * the time we get here, so declining to write the row would put the player
 * back on a roster that is only legal because of a stash that does not
 * exist - reachable whenever a matchup is finalized between the drop and the
 * undo. Writing it cannot change a settled score either: the recorded slot
 * is always IR (`interruptedStash` restores nothing else) and an IR row
 * never scores, in any format. The undo is the exact inverse of a removal
 * that happened in this same week, not a new acquisition, which is what
 * #106's freeze is there to keep out.
 *
 * Only `undoDrop` calls this, and only when `undoRestoresStash` says the
 * recorded stash is still valid; every other acquisition benches the player.
 */
async function restoreInterruptedStash(client, { league, teamId, playerId, slot, irAttested }) {
  const { id: leagueId, current_season: season, current_week: week } = league;
  await materializeLineup(client, { leagueId, teamId, season, week, league });
  await client.query(
    `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot", "ir_attested")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ("team_id", "season", "week", "player_id")
     DO UPDATE SET "slot" = EXCLUDED."slot", "ir_attested" = EXCLUDED."ir_attested", "updated_at" = now()`,
    [leagueId, teamId, playerId, season, week, slot, Boolean(irAttested)]
  );
}

/**
 * THE KICKOFF QUESTION, AND WHY IT IS ANSWERED PER PLAYER (#227).
 *
 * Four rules in this codebase turn on "has this player's NFL game for the
 * week already started?" - `annotateLineupEntries` (what the manager is shown
 * as locked), `setLineup` (whether a move is refused), `removeLineupEntries`
 * (whether a departing player's current-week row is spared, #197), and the
 * score-of-record exclusion behind `playersNotHeldAtKickoff` (#190/#228).
 * They must agree about every player, always: a manager told a slot is locked
 * and a settle pass that thinks the game never started are the same bug seen
 * from two ends.
 *
 * They used to disagree, because the question was answered by comparing
 * `players.nfl_team` to `nfl_games.nfl_team` raw, and those two columns do
 * not share a vocabulary. `nfl_games` holds Tank01 abbreviations; a DEF
 * unit's `players.nfl_team` is a full team name; and even among codes Tank01
 * writes `WSH` where the app says `WAS`. So a DEF unit was in NO week's
 * locked set, on any of the four - never locked, never spared on a drop,
 * never excluded by the settle pass. See `services/nflTeam.js`.
 *
 * THE SHAPE IS THE FIX, not just the normalisation inside it. The predicate
 * takes the PLAYERS and answers about PLAYERS: a Set of player ids, a Map
 * keyed by player id. It hands no caller a set of team names, so the raw
 * comparison that caused this cannot be written here again by accident - the
 * object you would need in order to write it does not exist any more. That is
 * why `lockedNflTeams` is gone rather than fixed in place: it returned team
 * keys and trusted four call sites to spell their side the same way, and the
 * whole of #227 is that one of them could not.
 *
 * Both sides go through `normalizeNflTeam`, and neither spelling is
 * privileged: a `WSH` game row locks a `WAS` player and a `WAS` game row
 * locks a `WSH` player.
 *
 * ABSENCE STAYS ABSENCE. A player whose team has no `nfl_games` row that week
 * - a bye, or a schedule nobody synced - is simply not in the answer, on
 * every consumer. That is structural rather than a rule: no game row means no
 * entry to return, so nothing downstream can read it as a kickoff.
 */

/**
 * A player's schedule key, and the one thing that must not fail quietly.
 *
 * The team half is ordinary: normalise it, or `null` when he has none. The id
 * half is a GUARD, because every answer below is keyed by player id and the
 * four callers build their `{ id, nflTeam }` list from three different row
 * shapes - `players.id` in `getLineup`, `lineup_entries.player_id` in
 * `setLineup`, a bare `playerId` on the drop path. A caller that reaches for
 * the wrong field gets `undefined` ids, every lookup misses, and the answer
 * comes back EMPTY: nothing locked, nobody excluded. That is silent, and it is
 * bit-for-bit the failure #227 exists to end - so it is made loud here rather
 * than left to be noticed in a settled week.
 */
function scheduleKeyFor(player) {
  if (player.id === null || player.id === undefined) {
    throw new Error('lineup.service: a player in the kickoff question has no id');
  }
  return normalizeNflTeam(player.nflTeam);
}

/**
 * The normalised NFL teams whose game for (season, week) has kicked off.
 * Private on purpose: this is the schedule side of the comparison, and
 * handing it out is how the module got #227 in the first place.
 */
async function kickedOffTeams(client, { season, week, now }) {
  const result = await client.query(
    `SELECT "nfl_team" FROM "nfl_games"
     WHERE "season" = $1 AND "week" = $2 AND "kickoff_at" <= $3`,
    [season, week, now]
  );
  const teams = new Set();
  for (const row of result.rows) {
    const team = normalizeNflTeam(row.nfl_team);
    if (team !== null) teams.add(team);
  }
  return teams;
}

/**
 * Of these players, the ones whose OWN NFL game for (season, week) has
 * already kicked off - a Set of PLAYER IDS. An empty schedule locks nobody.
 *
 * `players` is `[{ id, nflTeam }]`, the same shape `playersNotHeldAtKickoff`
 * takes, so the two halves of a kickoff question are asked the same way.
 */
async function lockedPlayerIds(client, { season, week, now = new Date(), players }) {
  const kickedOff = await kickedOffTeams(client, { season, week, now });
  const locked = new Set();
  for (const player of players || []) {
    const team = scheduleKeyFor(player);
    if (team !== null && kickedOff.has(team)) locked.add(player.id);
  }
  return locked;
}

/**
 * The week's kickoffs, keyed by NORMALISED NFL team. Private for the same
 * reason as `kickedOffTeams`; `playerKickoffs` below is the way out.
 *
 * A team is expected at most once per week, so the MIN guard is a tie-break
 * that should never fire: it can only matter if the schedule holds two rows
 * for one team under two spellings, and the moment that team first took the
 * field is the honest answer to every question asked of this map.
 */
async function weekKickoffs(client, { season, week, kickoffCache = null }) {
  const key = `${season}:${week}`;
  if (kickoffCache && kickoffCache.has(key)) return kickoffCache.get(key);
  const result = await client.query(
    `SELECT "nfl_team", "kickoff_at" FROM "nfl_games"
     WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );
  const byTeam = new Map();
  for (const row of result.rows) {
    const team = normalizeNflTeam(row.nfl_team);
    if (team === null) continue;
    const held = byTeam.get(team);
    if (held === undefined || new Date(row.kickoff_at) < new Date(held)) {
      byTeam.set(team, row.kickoff_at);
    }
  }
  if (kickoffCache) kickoffCache.set(key, byTeam);
  return byTeam;
}

/**
 * Each of these players' own kickoff for (season, week), keyed by PLAYER ID.
 * A player with no game that week is ABSENT from the map rather than present
 * with a null, so a caller cannot mistake "no game" for a kickoff instant.
 *
 * The scoring path reaches `nfl_games` only through this module, here and
 * through `playersNotHeldAtLastKickoff` below, both over `weekKickoffs`: the
 * scoring service asks rather than joining the schedule itself, so there is
 * one place that knows how a week's games are found and one place for #227
 * to change.
 */
async function playerKickoffs(client, { season, week, players, kickoffCache = null }) {
  const kickoffs = await weekKickoffs(client, { season, week, kickoffCache });
  const byPlayer = new Map();
  for (const player of players || []) {
    const team = scheduleKeyFor(player);
    if (team === null) continue;
    const kickoff = kickoffs.get(team);
    if (kickoff !== undefined) byPlayer.set(player.id, kickoff);
  }
  return byPlayer;
}

/**
 * Of these players, the ones this team held NO tenure over at their own
 * game's kickoff (#228). The one reusable read behind both consumers of the
 * fact: the score-of-record exclusion and the `removeLineupEntries` spare.
 *
 * "Held at kickoff K" is `acquired_at <= K AND (released_at IS NULL OR
 * released_at > K)`. A tenure that began exactly at kickoff counts; one that
 * ended exactly at kickoff does not.
 *
 * TWO ABSENCES, BOTH DELIBERATE ANSWERS RATHER THAN GAPS.
 *
 * A player with NO GAME ROW that week is never returned - he is not in the
 * question at all, because a bye or an unsynced schedule is not evidence that
 * anyone failed to hold him. That is structural here rather than a rule: he
 * never enters the `unnest`, so no predicate can exclude him.
 *
 * A player with NO TENURE covering kickoff IS returned, and note what that
 * now means. Under the old roster-reading rules a missing row meant "he is
 * gone", which is why cutting a post-kickoff pickup made the rule stop firing
 * and handed his points back. A missing TENURE means something else entirely:
 * not "he is gone" but "no tenure of this team covered that kickoff". Cutting
 * him does not erase the tenure, it closes it, so the answer does not move.
 *
 * The team's tenures are asked about as they stand NOW, which is safe for the
 * same reason: tenures are append-and-close, never rewritten.
 *
 * `kickoffCache` is an OPTIONAL caller-owned Map memoising the week's schedule
 * across several calls that share one (season, week) - `scoreMatchups` asks
 * once per team per matchup, so a 12-team league re-read the same rows twelve
 * times per scoring pass and ~170 times per season-long correction sweep. The
 * caller owns its lifetime deliberately: the schedule is only stable within
 * one pass, so a module-level cache would be a staleness bug the moment a
 * sync-schedule run landed between passes. Omit it and nothing is memoised,
 * which is the right default for every other caller. It never changes an
 * answer, only how many times the same answer is fetched.
 */
async function playersNotHeldAtKickoff(client, { teamId, season, week, players, kickoffCache = null }) {
  const kickoffs = await playerKickoffs(client, { season, week, players, kickoffCache });
  const scheduled = players
    .map((player) => ({ id: player.id, kickoff: kickoffs.get(player.id) }))
    .filter((player) => player.kickoff !== undefined);
  return playersNotHeldAt(client, { teamId, scheduled });
}

/**
 * Of these players, the ones this team held NO tenure over at the WEEK'S
 * LAST kickoff (#635, ADR 0022). The second half of the best-ball
 * population rule, and best ball's alone.
 *
 * Best ball has no slot occupancy to bound a week's pool. A player dropped
 * after his own game keeps his row (#197 spares it), his replacement
 * materializes another, and `playersNotHeldAtKickoff` passes both because
 * each tenure covered its own player's kickoff. Every post-kickoff
 * drop-and-replace therefore added one more scored body to the pool
 * `optimalLineup` picks from, never one fewer. The bound is
 * the roster the team carried through the week's last kickoff: a candidate
 * must have been held then as well as at his own kickoff.
 *
 * The instant is the LATEST kickoff on the week's schedule, over every game
 * that week and not only the candidates' own, so the answer does not move
 * with the roster being asked about. A player with NO GAME ROW that week is
 * never returned, for the reason `playersNotHeldAtKickoff` gives: absence
 * stays absence. An empty schedule excludes nobody.
 *
 * A standard league never asks this. There the dropped starter's surviving
 * row still occupies his slot, so the pool is bounded by slot occupancy and
 * the week as played keeps him (#190).
 */
async function playersNotHeldAtLastKickoff(client, { teamId, season, week, players, kickoffCache = null }) {
  const schedule = await weekKickoffs(client, { season, week, kickoffCache });
  let last = null;
  for (const at of schedule.values()) {
    const time = new Date(at).getTime();
    if (last === null || time > last) last = time;
  }
  // No schedule, or one whose kickoffs do not parse: nothing to be held at,
  // so nobody is excluded (an Invalid Date would otherwise reach pg and roll
  // back the whole scoring pass).
  if (!Number.isFinite(last)) return new Set();
  const lastKickoff = new Date(last);
  const scheduled = (players || [])
    .filter((player) => {
      const team = scheduleKeyFor(player);
      return team !== null && schedule.has(team);
    })
    .map((player) => ({ id: player.id, kickoff: lastKickoff }));
  return playersNotHeldAt(client, { teamId, scheduled });
}

/**
 * The tenure predicate itself, shared by the two questions above: of these
 * (player, instant) pairs, the player ids this team held NO tenure over at
 * that instant. The SQL lives once so the two questions cannot drift.
 */
async function playersNotHeldAt(client, { teamId, scheduled }) {
  if (scheduled.length === 0) return new Set();
  const result = await client.query(
    `SELECT "kickoffs"."player_id"
       FROM unnest($2::int[], $3::timestamptz[]) AS "kickoffs"("player_id", "kickoff_at")
      WHERE NOT EXISTS (
              SELECT 1 FROM "roster_tenures"
               WHERE "roster_tenures"."team_id" = $1
                 AND "roster_tenures"."player_id" = "kickoffs"."player_id"
                 AND "roster_tenures"."acquired_at" <= "kickoffs"."kickoff_at"
                 AND ("roster_tenures"."released_at" IS NULL
                      OR "roster_tenures"."released_at" > "kickoffs"."kickoff_at"))`,
    [teamId, scheduled.map((p) => p.id), scheduled.map((p) => p.kickoff)]
  );
  return new Set(result.rows.map((row) => row.player_id));
}

/**
 * The week AS PLAYED: of this team's lineup rows for the week, the ones the
 * score of record counts. A row survives only if a tenure of this team
 * covered its player's own kickoff (#228), and in best ball only if one also
 * covered the week's LAST kickoff (#635, ADR 0022). A player with no game
 * that week is never excluded.
 *
 * This is the ONE population every reading of a settled week goes through:
 * the settle pass and the re-score of a final week (`scoreMatchups`), and
 * hindsight (#736). It lives here, beside the two questions it asks, so a
 * consumer cannot grow a second population that merely happens to agree
 * with the score of record today and drifts from it tomorrow; that is how
 * hindsight came to score every row of a settled week. A LIVE week is the
 * one reading this does not govern: it joins the current roster instead.
 *
 * `rows` carry `player_id` and `nfl_team` (the schedule key, folded through
 * the same predicate as the lineup lock). `client` is anything with a
 * `query`, so the pool serves outside a transaction.
 */
async function rowsHeldAsPlayed(client, { league, teamId, season, week, rows, kickoffCache = null }) {
  if (rows.length === 0) return rows;
  const playersOf = (list) => list.map((row) => ({ id: row.player_id, nflTeam: row.nfl_team }));
  const notHeldAtOwn = await playersNotHeldAtKickoff(client, {
    teamId, season, week, players: playersOf(rows), kickoffCache,
  });
  const held = rows.filter((row) => !notHeldAtOwn.has(row.player_id));
  if (!league.best_ball || held.length === 0) return held;
  const notHeldThrough = await playersNotHeldAtLastKickoff(client, {
    teamId, season, week, players: playersOf(held), kickoffCache,
  });
  return held.filter((row) => !notHeldThrough.has(row.player_id));
}

/**
 * Pure: add schedule-derived lock and bye metadata to lineup entries.
 *
 * `locked` is a Set of PLAYER IDS from `lockedPlayerIds`, not of team names
 * (#227). `byeByTeam` is still keyed by the caller's own team string, because
 * `computeByeWeeks` returns the caller's vocabulary back; that is the one map
 * here a raw `nfl_team` is the right key for.
 */
function annotateLineupEntries(entries, { locked, byeByTeam, selectedWeek }) {
  return entries.map((row) => {
    const byeWeek = byeByTeam.get(row.nfl_team) ?? null;
    return {
      ...row,
      bye_week: byeWeek,
      locked: row.spent || locked.has(row.id),
      onBye: !row.spent && byeWeek === selectedWeek,
      valid_stash: row.slot === IR && isValidStash(row),
    };
  });
}

async function loadLeagueAndTeam(client, { leagueId, userId, forUpdate = false }) {
  const leagueResult = await client.query(
    `SELECT * FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  const league = leagueResult.rows[0];
  if (!league) throw new LineupError(404, 'league not found');
  const team = await requireMember(client, { leagueId, userId, forUpdate });
  return { league, team };
}

/**
 * Fetch (materializing if needed) the caller's lineup for a week, annotated
 * with per-player locked, bye_week, and onBye metadata.
 */
async function getLineup({ leagueId, userId, week }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { league, team } = await loadLeagueAndTeam(client, { leagueId, userId });
    const season = league.current_season;
    const targetWeek = week || league.current_week;

    await materializeLineup(client, { leagueId, teamId: team.id, season, week: targetWeek, league });

    const entriesResult = await client.query(
      `SELECT "players"."id", "players"."name", "players"."position", "players"."nfl_team",
              "players"."injury_status", "lineup_entries"."slot", "lineup_entries"."ir_attested"
       FROM "lineup_entries"
       JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
         AND "team_players"."player_id" = "lineup_entries"."player_id"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
       WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
         AND "lineup_entries"."week" = $3
       ORDER BY "players"."position", "players"."name"`,
      [team.id, season, targetWeek]
    );
    const spent = league.best_ball
      ? []
      : await spentStartingSlots(client, { teamId: team.id, season, week: targetWeek });

    const playerIds = entriesResult.rows.map((row) => row.id);
    // Load lazily because scoring.service imports lineup.service. Passing the
    // League and these roster ids selects the scoring-aware weekly engine,
    // rather than the pool-wide extrapolator or a season-level estimate.
    const projectionService = require('./projection.service');
    const weeklyByPlayer = playerIds.length > 0
      ? await projectionService.getWeekProjections({
        season,
        week: targetWeek,
        league,
        playerIds,
      })
      : new Map();
    for (const entry of entriesResult.rows) {
      const projection = weeklyByPlayer.get(entry.id);
      const points = Number(projection?.points);
      entry.projected_points = projection?.points == null || !Number.isFinite(points)
        ? null
        : points;
    }

    const locked = await lockedPlayerIds(client, {
      season,
      week: targetWeek,
      players: entriesResult.rows.map((row) => ({ id: row.id, nflTeam: row.nfl_team })),
    });
    const byeByTeam = await computeByeWeeks(entriesResult.rows.map((row) => row.nfl_team), season);
    await client.query('COMMIT');

    const settings = parseLineupSettings(league);
    return {
      leagueId: league.id,
      teamId: team.id,
      season,
      week: targetWeek,
      currentWeek: league.current_week,
      rosterSlots: settings.rosterSlots,
      benchSlots: settings.benchSlots,
      irSlots: settings.irSlots,
      entries: annotateLineupEntries([...entriesResult.rows, ...spent], { locked, byeByTeam, selectedWeek: targetWeek }),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Apply one or more slot moves atomically. The team row is locked so
 * concurrent edits serialize; the FINAL lineup is validated against the
 * league's slot counts. Moves touching a locked player are rejected except
 * when the move takes that player out of IR to resolve an invalid stash.
 */
async function setLineup({ leagueId, userId, week, moves }) {
  if (!Array.isArray(moves) || moves.length === 0) {
    throw new LineupError(400, 'moves must be a non-empty array of { playerId, slot }');
  }
  for (const move of moves) {
    if (!Number.isInteger(move.playerId) || typeof move.slot !== 'string') {
      throw new LineupError(400, 'each move needs an integer playerId and a string slot');
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { league, team } = await loadLeagueAndTeam(client, { leagueId, userId, forUpdate: true });
    // No lineups in a pick'em-only league. Message-only like the best-ball
    // refusal below: team.router renders coded errors as { error: code }, which
    // the lineup screen would toast verbatim.
    if (isPickemOnly(league)) throw new LineupError(409, PICKEM_ONLY_MESSAGE);
    const season = league.current_season;
    const targetWeek = week || league.current_week;
    if (targetWeek < league.current_week) {
      throw new LineupError(409, 'cannot edit a past week');
    }

    await materializeLineup(client, { leagueId, teamId: team.id, season, week: targetWeek, league });

    const entriesResult = await client.query(
      `SELECT "lineup_entries"."player_id", "lineup_entries"."slot",
              "lineup_entries"."ir_attested",
              "players"."name", "players"."position", "players"."nfl_team",
              "players"."injury_status"
       FROM "lineup_entries"
       JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
         AND "team_players"."player_id" = "lineup_entries"."player_id"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
       WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
         AND "lineup_entries"."week" = $3
       FOR SHARE OF "players"`,
      [team.id, season, targetWeek]
    );
    const byPlayer = new Map(entriesResult.rows.map((r) => [r.player_id, r]));
    // Snapshot the pre-save slots NOW: the repair below and the moves both
    // mutate these rows in place, and the validation at the bottom forgives
    // only the overflow that stood before this save touched anything.
    const baseline = entriesResult.rows.map((r) => ({ player_id: r.player_id, slot: r.slot }));

    const locked = await lockedPlayerIds(client, {
      season,
      week: targetWeek,
      players: entriesResult.rows.map((row) => ({ id: row.player_id, nflTeam: row.nfl_team })),
    });
    const settings = parseLineupSettings(league);
    // A slot a surviving as-played row occupies is spent (#627): the row will
    // settle, so it counts against the cap even though the roster-joined read
    // above cannot see it. Fetched AFTER that read on purpose: a drop can
    // commit mid-transaction (drops lock the league row, this transaction
    // only the team row), and this order can only see the departing player in
    // at least one of the two sets, never in neither. Skipped in best ball,
    // whose validation covers IR rows alone. The rows are counted, never
    // movable, and never in `baseline` (starting caps are absolute, #622), so
    // they stay out of `byPlayer`; the repair below only learns how many
    // seats each slot has left.
    const spent = league.best_ball
      ? []
      : await spentStartingSlots(client, { teamId: team.id, season, week: targetWeek });
    const changedByPlayer = new Map();
    const markChanged = (entry) => changedByPlayer.set(entry.player_id, entry);
    // Older first-week materializations placed every player on BENCH. Repair
    // only that impossible state before applying the manager's requested
    // moves; a partial or legal lineup remains entirely manager-controlled.
    const allBenchOverflow = !league.best_ball
      && entriesResult.rows.length > settings.benchSlots
      && entriesResult.rows.every((entry) => entry.slot === BENCH);
    if (allBenchOverflow) {
      // The repair seats starters into the seats that are actually free: a
      // spent slot's seat is already taken by the surviving row, and seating
      // into it would have the validation below refuse the whole save for a
      // collision the manager never asked for (#627).
      const spentBySlot = {};
      for (const row of spent) spentBySlot[row.slot] = (spentBySlot[row.slot] || 0) + 1;
      const { starters } = optimalLineup(
        entriesResult.rows
          .filter((entry) => !locked.has(entry.player_id))
          .map(({ player_id, position }) => ({ playerId: player_id, position })),
        settings.rosterSlots.map((slot) => ({
          ...slot,
          count: Math.max(0, slot.count - (spentBySlot[slot.key] || 0)),
        }))
      );
      for (const starter of starters) {
        const entry = byPlayer.get(starter.playerId);
        entry.slot = starter.slot;
        entry.ir_attested = false;
        markChanged(entry);
      }
    }
    let resolvesLockedZeroBenchStash = false;
    for (const move of moves) {
      const entry = byPlayer.get(move.playerId);
      if (!entry) throw new LineupError(404, `player ${move.playerId} is not on your roster`);
      if (entry.slot === move.slot) continue;
      if (league.best_ball
          && (!BEST_BALL_MANAGED_SLOTS.has(entry.slot) || !BEST_BALL_MANAGED_SLOTS.has(move.slot))) {
        throw new LineupError(409, 'best-ball managers may move players only between BENCH and IR');
      }
      const resolvesStaleIrStash = !league.best_ball
        && entry.slot === IR
        && move.slot === BENCH
        && !isValidStash(entry);
      resolvesLockedZeroBenchStash ||= resolvesStaleIrStash
        && locked.has(entry.player_id)
        && league.bench_slots === 0;
      if (!resolvesStaleIrStash && locked.has(entry.player_id)) {
        throw new LineupError(409, 'that player is locked; his game has started', 'LINEUP_LOCKED');
      }
      entry.slot = move.slot;
      // A manager-initiated move ends any commissioner attestation on this
      // player right here (#100), so the save rule below judges the
      // post-move stash by the normal gate - moving an attested player out
      // and back within one save cannot relaunder the override.
      entry.ir_attested = false;
      markChanged(entry);
    }

    const invalidStash = Array.from(byPlayer.values()).find(
      (entry) => entry.slot === IR && !isValidStash(entry)
    );
    if (invalidStash) {
      throw new LineupError(
        400,
        `${invalidStash.name} cannot remain in IR; current injury designation: ${injuryDesignationName(invalidStash.injury_status)}`
      );
    }

    const validationSettings = resolvesLockedZeroBenchStash
      ? { ...settings, benchSlots: 1 }
      : settings;
    const entriesToValidate = entriesForLineupValidation(byPlayer.values(), league);
    const errors = validateLineup(
      entriesToValidate.map((e) => ({ playerId: e.player_id, position: e.position, slot: e.slot })),
      { ...validationSettings, baseline: entriesForLineupValidation(baseline, league), spent }
    );
    if (errors.length > 0) throw new LineupError(400, errors.join('; '));

    const changed = [...changedByPlayer.values()];
    for (const entry of changed) {
      await client.query(
        `UPDATE "lineup_entries" SET "slot" = $1, "ir_attested" = false, "updated_at" = now()
         WHERE "team_id" = $2 AND "season" = $3 AND "week" = $4 AND "player_id" = $5`,
        [entry.slot, team.id, season, targetWeek, entry.player_id]
      );
    }
    // The attestation must not outlive the manager's move in weeks that were
    // materialized ahead of time (#100): the weekly copy-forward would have
    // planted the attested stash there already, and nothing later rewrites
    // it. Earlier weeks keep their history.
    const movedPlayerIds = [...new Set(changed.map((entry) => entry.player_id))];
    if (movedPlayerIds.length > 0) {
      await client.query(
        `UPDATE "lineup_entries" SET "ir_attested" = false, "updated_at" = now()
         WHERE "team_id" = $1 AND "season" = $2 AND "week" > $3
           AND "player_id" = ANY($4::int[]) AND "ir_attested"`,
        [team.id, season, targetWeek, movedPlayerIds]
      );
    }
    await client.query('COMMIT');
    return { leagueId, teamId: team.id, season, week: targetWeek, updated: changed.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Pure: the best legal starting lineup for a set of players given per-player
 * points (actual or projected). Slots are filled most-restrictive first
 * (fewest eligible positions), each taking its best remaining players — with
 * the standard slot shapes (dedicated positions + FLEX as a superset) this
 * greedy order is provably optimal.
 *
 * players: [{ playerId, position }]; pointsFor: Map playerId -> points.
 * Returns { starters: [{ playerId, position, slot, points }], total }.
 */
function optimalLineup(players, rosterSlots = DEFAULT_ROSTER_SLOTS, pointsFor = new Map()) {
  const slots = rosterSlots
    .filter((s) => s.count > 0)
    .sort((a, b) => expandEligibility(a.eligiblePositions).size - expandEligibility(b.eligiblePositions).size);
  const available = [...players].sort(
    (a, b) => (Number(pointsFor.get(b.playerId)) || 0) - (Number(pointsFor.get(a.playerId)) || 0)
  );
  const taken = new Set();
  const starters = [];
  let total = 0;
  for (const { key: slot, count } of slots) {
    for (let i = 0; i < count; i++) {
      const pick = available.find(
        (p) => !taken.has(p.playerId) && slotEligible(slot, p.position, rosterSlots)
      );
      if (!pick) continue; // roster can't fill this slot — leave it empty
      taken.add(pick.playerId);
      const points = Number(pointsFor.get(pick.playerId)) || 0;
      starters.push({ playerId: pick.playerId, position: pick.position, slot, points });
      total += points;
    }
  }
  return { starters, total: Math.round(total * 100) / 100 };
}

module.exports = {
  LineupError,
  DEFAULT_ROSTER_SLOTS,
  POSITION_GROUPS,
  slotEligible,
  parseLineupSettings,
  validateLineup,
  entriesForLineupValidation,
  materializeLineup,
  benchAcquiredPlayer,
  removeLineupEntries,
  spentStartingSlots,
  currentWeekEntry,
  interruptedStashFields,
  restoreInterruptedStash,
  lockedPlayerIds,
  playersNotHeldAtKickoff,
  playersNotHeldAtLastKickoff,
  rowsHeldAsPlayed,
  annotateLineupEntries,
  getLineup,
  setLineup,
  optimalLineup,
};
