/**
 * The Roster/Lineup read model, pure (ADR 0029: the entities layer, following
 * the Matchup and Standings slices' shape). It is the one spelling of a team's
 * weekly lineup as the client knows it, built from the wire body
 * `GET /api/team/lineup?leagueId=<id>&week=<week>` returns
 * (server/services/lineup.service.js `getLineup`), so a surface reads one
 * camelCase player shape and never a database column name again.
 *
 * The shape:
 *
 *   { week, season, teamId, entries, starters, benchCount, questionable }
 *
 * `entries` is every roster row for the week (starters, bench and IR
 * together, CONTEXT.md's Roster), each mapped to the one player shape:
 *
 *   { playerId, name, position, nflTeam, slot, projectedPoints,
 *     injuryStatus, photoUrl, spent, opponent }
 *
 * `opponent` arrived with #1132 (server/services/lineup.service.js
 * `annotateLineupEntries`): the wire's own `opponentByTeam.get(...) ?? null`,
 * already folded to a Team code (#1136) or `null`. `null` means absence - a
 * bye week or an unsynced slate - never "unknown"; this model passes it
 * through as-is (missing key or explicit `null` both land as `null`) and
 * never derives, normalizes, or invents a value of its own.
 *
 * `starters` is the subset of `entries` whose `slot` is neither `BENCH` nor
 * `IR`, AND which is not `spent` (CONTEXT.md's Lineup entry: "a starting
 * slot it occupies is spent for that week" - a spent row is a settled-week
 * record of a departed starter, not a player a team starts today; getLineup
 * seats it via `spentStartingSlots` purely to hold the slot count, and it
 * carries no projection). `bench`, IR and spent rows stay in `entries`
 * only - a surface that wants them reads `entries` and applies its own
 * filter.
 *
 * `benchCount` counts entries in the `BENCH` slot; `questionable` counts
 * STARTERS (never bench, IR or spent) whose injury status is not null -
 * CONTEXT.md's Injury designation: any non-null value ("Questionable",
 * "Doubtful", "Out", "IR") means the feed has flagged the player as
 * something other than healthy, and this model does not narrow that to the
 * literal string "Questionable".
 *
 * This module also carries three more roster/lineup facts (#1207, part of
 * #1198's expand step):
 *
 *   - `pairStartersBySlot`, moved here byte-for-byte from
 *     `entities/matchup/model/matchupModel.js`, which re-exported it for one
 *     release until #1210 closed that exception - pairing two sides' starters
 *     by slot is a fact about the Lineup, not the Matchup. Read since #1210 by
 *     `pages/matchup/model/useMatchupPage.js` (a page importing an entity
 *     directly, ADR 0029), not by another entity.
 *   - `locked(entry)`, an exported fact mirroring LineupScreen.jsx's lock
 *     read. This module's own `eligibleSlots(entry, league)` (#1207's
 *     matching slot-eligibility fact) is gone (#1502): `lineupEntries` below
 *     now builds each entry's `eligibleSlots` field off the Roster template
 *     entity's `slotsFor` (`rosterTemplateModel.js`, #1500) directly, the
 *     same one rule `entities/roster`'s public `slotsFor` export answers
 *     everywhere else, rather than keeping a second, hand-mirrored copy of
 *     POSITION_GROUPS/IR_ELIGIBLE_DESIGNATIONS here that could drift from it
 *     (formerly pinned equal only by
 *     `rosterTemplateEligibleSlots.parity.test.js`, deleted alongside this
 *     function).
 *   - `lineupEntries(rosterWire, league)`, a second read model (distinct
 *     shape from `lineupModel` above) that normalizes the roster wire into
 *     the entry shape a future lineup surface will read, ordered by the
 *     league's own `roster_slots`.
 */

import { parseRosterSlots } from '../../../shared/lib';
import { slotsFor } from './rosterTemplateModel';

const BENCH = 'BENCH';
const IR = 'IR';

// injury_status codes that are "questionable-class" rather than Unavailable
// (#1330 ruling): the feed's `normalizeInjuryStatus`
// (server/services/scoring.service.js) writes exactly four non-null codes -
// 'IR', 'Q', 'D', 'O' - and O/IR are already Unavailable (the wire's
// `unavailable` code), so the remaining two, Q and D, are the whole set. This is the one
// spelling of "questionable"; a widget reads it through `isQuestionable`
// below rather than inventing its own designation list.
const QUESTIONABLE_DESIGNATIONS = new Set(['Q', 'D']);

/**
 * One lineup row (the wire's `id`, `name`, `position`, `nfl_team`, `slot`,
 * `projected_points`, `injury_status`, `opponent`, plus `spent` on a
 * spentStartingSlots row) as the one player shape. `projectedPoints` is
 * coerced to a finite number or null: node-postgres can hand a decimal back
 * as a string, a spent row carries no `projected_points` key at all, and a
 * missing projection must stay null rather than becoming 0 or NaN.
 * `opponent` is passed through unchanged - a missing key or an explicit
 * `null` both land as `null`, never derived or normalized here.
 */
function playerFromLineupEntry(row) {
  const r = row || {};
  const points = r.projected_points == null ? NaN : Number(r.projected_points);
  return {
    playerId: r.id ?? null,
    name: r.name ?? null,
    position: r.position ?? null,
    nflTeam: r.nfl_team ?? null,
    slot: r.slot ?? null,
    projectedPoints: Number.isFinite(points) ? points : null,
    injuryStatus: r.injury_status ?? null,
    photoUrl: r.photo_url ?? null,
    spent: !!r.spent,
    opponent: r.opponent ?? null,
  };
}

/**
 * From the lineup body (`GET /api/team/lineup?leagueId=<id>&week=<week>`).
 * A null/undefined body maps to the empty shape (no entries, zero counts)
 * rather than throwing, matching the entities layer's other builders.
 *
 * `rosterSlots`, `benchSlots`, `irSlots` and `currentWeek` (#1237) are the
 * wire's own already-resolved slot configuration (server/services/
 * lineup.service.js's `parseLineupSettings`: the league's `roster_slots`
 * with the standard 7-slot shape as its fallback, never re-resolved here) and
 * the server's own idea of "this week" - passed through unchanged rather than
 * re-derived, so a page building the Lineup surface reads them off this one
 * model instead of the raw wire body directly. `lineupEntries` below already
 * takes a caller-supplied `rosterSlots`; this is that same array, sourced
 * from the response `lineupEntries`'s own caller would otherwise have to
 * fetch a second time.
 */
export function lineupModel(body) {
  const b = body || {};
  const rawEntries = Array.isArray(b.entries) ? b.entries : [];
  const entries = rawEntries.map(playerFromLineupEntry);
  // Starters are neither BENCH nor IR (CONTEXT.md's Lineup/Slot), and never
  // spent: a spent row only holds a departed starter's slot count for a
  // settled week (CONTEXT.md's Lineup entry) and starts nobody today.
  // Dropping the BENCH/IR clause is the tested red-tell: it would seat bench
  // and IR rows as starters, over-counting them everywhere the count matters.
  const starters = entries.filter((e) => e.slot !== BENCH && e.slot !== IR && !e.spent);
  const benchCount = entries.filter((e) => e.slot === BENCH).length;
  const questionable = starters.filter((e) => e.injuryStatus != null).length;
  return {
    week: b.week ?? null,
    season: b.season ?? null,
    teamId: b.teamId ?? null,
    currentWeek: b.currentWeek ?? null,
    rosterSlots: Array.isArray(b.rosterSlots) ? b.rosterSlots : [],
    benchSlots: Number.isInteger(b.benchSlots) ? b.benchSlots : null,
    irSlots: Number.isInteger(b.irSlots) ? b.irSlots : null,
    entries,
    starters,
    benchCount,
    questionable,
  };
}

/**
 * Pairs the two starter arrays into one row per slot INSTANCE, matched by slot
 * key and never by array index. The arrays differ in length whenever one manager
 * has left a slot empty (or set no lineup at all), and lineup_entries can hold
 * any commissioner-defined slot key ('D LINE', 'IDP FLEX'), so an index zip
 * labels the row with whichever side happens to sit at that index and reads a QB
 * under a WR chip. The nth home starter in a slot pairs with the nth away starter
 * in the same slot; the remainder renders with an empty side.
 *
 * `slotOrder` is the league's roster_slots keys, in commissioner order (IDP slots
 * included). Pairing REFUSES without it: an empty or absent order returns no rows,
 * so a lineup view renders nothing until the league row arrives rather than
 * falling back to a fantasy-standard default order that knows no IDP slots and
 * would silently mis-place defensive starters (ADR 0030's sibling concern - a
 * default is a guess, and the guess this replaces put every IDP starter in the
 * wrong row). A slot the starters carry that the order does not name is appended
 * after the ordered slots, in the order it was first seen, so a stray slot still
 * renders rather than vanishing.
 *
 * Moved here from `entities/matchup/model/matchupModel.js` byte-for-byte in
 * behaviour (#1207, ADR 0029): pairing is a Roster/Lineup fact (which player sits
 * in which slot), not a Matchup one. `entities/matchup` re-exported it for one
 * release so its existing internal imports (`useMatchup.js`, its own test file)
 * kept working unchanged; #1210 closed that exception and moved the pairing
 * call up to `pages/matchup/model/useMatchupPage.js`, which reads it from
 * HERE directly.
 */
export function pairStartersBySlot(homeStarters, awayStarters, slotOrder) {
  const ordered = (slotOrder || []).filter((k) => k != null).map(String);
  if (ordered.length === 0) return [];

  const home = homeStarters || [];
  const away = awayStarters || [];
  // Key on the slot as a string on both sides, matching the stringified order
  // above, so a numeric slot key never groups under a value the order can't find.
  const slotKey = (p) => (p.slot == null ? '' : String(p.slot));
  const bySlot = (list) => list.reduce((acc, p) => {
    const key = slotKey(p);
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(p);
    return acc;
  }, new Map());
  const homeBySlot = bySlot(home);
  const awayBySlot = bySlot(away);

  const order = [];
  const seen = new Set();
  const add = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    order.push(key);
  };
  ordered.forEach(add);
  home.forEach((p) => add(slotKey(p)));
  away.forEach((p) => add(slotKey(p)));

  const rows = [];
  for (const slot of order) {
    const h = homeBySlot.get(slot) || [];
    const a = awayBySlot.get(slot) || [];
    const count = Math.max(h.length, a.length);
    for (let i = 0; i < count; i++) rows.push({ slot, home: h[i] || null, away: a[i] || null });
  }
  return rows;
}

/**
 * Whether a lineup entry's own game has already kicked off (CONTEXT.md's
 * Lineup lock), read as a plain fact off the wire's own `locked` boolean -
 * never recomputed here. Mirrors LineupScreen.jsx's `entry.locked` /
 * `targetEntry.locked` reads (:188-202) minus the drag-and-drop swap intent:
 * `canResolveLockedIrStash`'s exception (a locked, no-longer-eligible IR
 * occupant may still move to BENCH) is a client interaction rule about
 * WHERE a locked player may go, not a fact about whether he is locked, so it
 * stays out of this fact and out of `slotsFor` (the Roster template entity's
 * own slot-eligibility fact, `lineupEntries` below).
 */
export function locked(entry) {
  return Boolean(entry && entry.locked);
}

/**
 * Whether a lineup entry's injury designation is questionable-class (#1330
 * ruling: Q or D, `QUESTIONABLE_DESIGNATIONS` above) - the feed's only two
 * non-null, non-Unavailable codes. Reads the camelCase `injuryStatus` this
 * module's builders produce, reading the same field as the server's
 * Unavailable verdict.
 */
export function isQuestionable(entry) {
  const status = (entry && entry.injuryStatus) ?? null;
  return QUESTIONABLE_DESIGNATIONS.has(status);
}

/**
 * A lineup entry's availability from the wire's own Unavailable code
 * (CONTEXT.md's Unavailable; #1668 made `unavailable` the verdict's reason
 * code: 'bye' | 'out' | 'ir' | 'no_team', null when the player can play).
 * `reason` is the code alone, no label; a caller renders it through
 * `unavailableLabel`. The client holds no copy of the verdict (#1675).
 */
function availabilityFor(code) {
  return code ? { available: false, reason: code } : { available: true, reason: null };
}

/**
 * One player's slot on one team's lineup card for one week (CONTEXT.md's
 * Lineup entry), normalized from the roster wire (the same
 * `GET /api/team/lineup?leagueId=<id>&week=<week>` body `lineupModel` reads,
 * or its bare `entries` array) plus the league's OWN starting-slot order
 * (`league.roster_slots`, parsed by `parseRosterSlots`). No default order: a
 * missing or empty `roster_slots` throws rather than falling back to a
 * fantasy-standard order that would silently mis-order or mis-place a
 * commissioner's own slots - the same refusal `pairStartersBySlot` makes for
 * starter pairing (ADR 0029). A caller waits for the League row before
 * calling this.
 *
 * The shape: `{ playerId, name, position, nflTeam, slot, slotIndex,
 * eligibleSlots, locked, availability: { available, reason }, unavailable,
 * projectedPoints, projection, floor, ceiling, points, opponent, kickoff,
 * gameKey, edge: { kind, text }, irAttested, validStash, spent }`. `points`
 * (#1237) is the entry's actual/live fantasy points, null before kickoff or
 * when the week has no stats yet - the Ledger row's points cell reads this,
 * never `projectedPoints`. `slotIndex` is the entry's position in the
 * league's own slot order; a slot the entries carry that the order does not
 * name (BENCH, IR, or a stray key) is appended after the ordered slots, in
 * the order first seen, mirroring `pairStartersBySlot`'s same rule. The
 * returned array is sorted by `slotIndex`, so a caller reads entries already
 * in the league's order rather than sorting them itself.
 *
 * `projection` (the Weekly projection's mean), `floor` (its Interval's p10)
 * and `ceiling` (its p90), `kickoff`, `gameKey`, `unavailable` and `edge` all
 * arrived with #1235 (ADR 0037: the lineup entry carries its decision
 * context) - each a straight pass-through of the wire field
 * `server/services/lineup.service.js`'s `getLineup` now returns, so ticket 5
 * can render a Ledger row without re-deriving any of them.
 *
 * `eligibleSlots` (#1502) is built by the Roster template entity's own
 * `slotsFor(rosterSlots, entry)` (`rosterTemplateModel.js`, #1500) - the same
 * `rosterSlots` array this function already parsed for ordering above, so
 * this is not a second parse. This module no longer keeps its own
 * hand-mirrored slot-eligibility copy to answer that field with.
 *
 * Nothing consumes this yet (#1207, an expand step under #1198).
 */
export function lineupEntries(rosterWire, league) {
  const rosterSlots = parseRosterSlots(league && league.roster_slots);
  if (rosterSlots.length === 0) {
    throw new Error('lineupEntries: league.roster_slots is required and must be non-empty');
  }
  const orderedKeys = rosterSlots.map((s) => s && s.key).filter((k) => k != null).map(String);

  const rows = Array.isArray(rosterWire)
    ? rosterWire
    : Array.isArray(rosterWire && rosterWire.entries) ? rosterWire.entries : [];

  const built = rows.map((row) => {
    const r = row || {};
    const points = r.projected_points == null ? NaN : Number(r.projected_points);
    // Weekly projection mean/Floor(p10)/Ceiling(p90) (CONTEXT.md, Weekly
    // projection, Interval, Floor and Ceiling; #1235): all three come off the
    // wire's own `projection`/`floor`/`ceiling` fields, already null together
    // whenever the server had no estimate (server/services/lineup.service.js),
    // so this model coerces each independently rather than deriving one from
    // another.
    const projection = r.projection == null ? NaN : Number(r.projection);
    const floor = r.floor == null ? NaN : Number(r.floor);
    const ceiling = r.ceiling == null ? NaN : Number(r.ceiling);
    // The entry's actual/live fantasy points (#1237, formal review
    // ac2-points-cell-always-a-dash): the server's own `actualPoints`
    // (lineup.service.js's `calculateFantasyPoints` over the week's stats
    // row), null before kickoff or when the week has no stats yet - never
    // derived here.
    const actualPoints = r.actualPoints == null ? NaN : Number(r.actualPoints);
    const entry = {
      playerId: r.id ?? null,
      name: r.name ?? null,
      position: r.position ?? null,
      nflTeam: r.nfl_team ?? null,
      slot: r.slot ?? null,
      projectedPoints: Number.isFinite(points) ? points : null,
      projection: Number.isFinite(projection) ? projection : null,
      floor: Number.isFinite(floor) ? floor : null,
      ceiling: Number.isFinite(ceiling) ? ceiling : null,
      points: Number.isFinite(actualPoints) ? actualPoints : null,
      injuryStatus: r.injury_status ?? null,
      // The feed's own free-text detail for the designation (#1330 ruling,
      // precedent #1235's Edge line: "add no column, this ticket only adds
      // the client pass-through of a column that already exists" -
      // server/services/lineup.service.js selects `injury_detail` and
      // `annotateLineupEntries` spreads it onto every row), a pass-through
      // like `kickoff`/`opponent`: a missing key or an explicit `null` both
      // land as `null`, never derived here.
      injuryDetail: r.injury_detail ?? null,
      photoUrl: r.photo_url ?? null,
      opponent: r.opponent ?? null,
      // `kickoff` and `gameKey` (#1235) are passed through exactly as the
      // opponent already was above: a missing key or an explicit `null` both
      // land as `null`, never derived here.
      kickoff: r.kickoff ?? null,
      gameKey: r.game_key ?? null,
      // `line` and `weather` (#1329, ADR 0037): passed through exactly as
      // `kickoff`/`gameKey` already are - a missing key or an explicit
      // `null` both land as `null`, never derived here. Both arrive already
      // shaped by `server/services/lineup.service.js`'s `getLineup`
      // (fields-null once a game exists, per the Decision card's own rule),
      // so this entity draws no conclusions of its own about either.
      line: r.line ?? null,
      weather: r.weather ?? null,
      onBye: Boolean(r.onBye),
      // The player's own NFL bye week (#1239, CONTEXT.md's Bye cluster):
      // passed through exactly as kickoff/gameKey already are, coerced to a
      // number the same way projectedPoints is - lineup.service.js's
      // annotateLineupEntries computes this for every row regardless of
      // slot, so it is never derived here, only read. Distinct from `onBye`
      // (whether THIS row's bye week equals the currently selected week):
      // the bye-cluster widget needs the actual week number to group
      // entries across the seven weeks after the one selected.
      byeWeek: r.bye_week == null ? null : Number(r.bye_week),
      // The IR slot's own facts (CONTEXT.md's Attested stash and
      // IR-eligible; #1237): `irAttested` is the commissioner's vouch for
      // this stash (`lineup_entries.ir_attested`), and `validStash` is the
      // server's own answer to "is this stash still valid" (IR-eligible OR
      // attested), read alongside rather than re-derived from injuryStatus
      // here - the server already applies the attestation-ends-on-any-move
      // rule this entity does not model.
      irAttested: Boolean(r.ir_attested),
      validStash: Boolean(r.valid_stash),
      // CONTEXT.md's Lineup entry: a spent row is a settled week's record of
      // a departed starter's slot and starts nobody today - `lineupModel`'s
      // `starters` already excludes it on this same flag; this per-entry
      // model exposes it too so a surface rendering ALL entries (starters,
      // bench and IR together) can mark it inert rather than a live row.
      spent: Boolean(r.spent),
    };
    return {
      ...entry,
      eligibleSlots: slotsFor(rosterSlots, entry),
      locked: locked(r),
      availability: availabilityFor(r.unavailable ?? null),
      // The server's own Unavailable reason (#1235), passed through
      // unchanged; `availability` above is mapped from this same code.
      unavailable: r.unavailable ?? null,
      // The Edge line (CONTEXT.md, Edge line; ADR 0037; #1235): one typed
      // `{ kind, text }`, computed on the server (`lineup.service.js`'s
      // `computeEdgeLine`) and passed through verbatim - this entity draws no
      // conclusions of its own about why to start a player.
      edge: row && row.edge ? { kind: row.edge.kind ?? null, text: row.edge.text ?? null } : null,
      // The largest Factor's explanation (#1281): computed on the server
      // (`lineup.service.js`'s `factorEdgeText`) independent of which Edge
      // line kind won, and passed through verbatim here alongside `edge` -
      // this entity draws no conclusions of its own about which Factor is
      // largest.
      factorExplanation: row && row.factorExplanation != null ? row.factorExplanation : null,
    };
  });

  // Stray slots (BENCH, IR, or a key the league's order doesn't name) are
  // appended after the ordered ones, in the order first seen - the same rule
  // `pairStartersBySlot` applies to a starter's stray slot.
  const order = [];
  const seen = new Set();
  const add = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    order.push(key);
  };
  orderedKeys.forEach(add);
  built.forEach((e) => add(e.slot == null ? '' : String(e.slot)));
  const indexOf = new Map(order.map((key, i) => [key, i]));

  return built
    .map((e) => ({ ...e, slotIndex: indexOf.get(e.slot == null ? '' : String(e.slot)) }))
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

export default lineupModel;
