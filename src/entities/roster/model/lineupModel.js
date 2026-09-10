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
 *     injuryStatus, spent, opponent }
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
 */

const BENCH = 'BENCH';
const IR = 'IR';

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
    spent: !!r.spent,
    opponent: r.opponent ?? null,
  };
}

/**
 * From the lineup body (`GET /api/team/lineup?leagueId=<id>&week=<week>`).
 * A null/undefined body maps to the empty shape (no entries, zero counts)
 * rather than throwing, matching the entities layer's other builders.
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
    entries,
    starters,
    benchCount,
    questionable,
  };
}

export default lineupModel;
