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
 *   { playerId, name, position, nflTeam, slot, opponent, projectedPoints,
 *     injuryStatus }
 *
 * `starters` is the subset of `entries` whose `slot` is neither `BENCH` nor
 * `IR` (CONTEXT.md's Lineup: the subset of a roster a team starts). `bench`
 * and IR rows stay in `entries` only - a surface that wants them reads
 * `entries` and applies its own filter.
 *
 * `benchCount` counts entries in the `BENCH` slot; `questionable` counts
 * STARTERS (never bench or IR) whose injury status is not null - CONTEXT.md's
 * Injury designation: any non-null value ("Questionable", "Doubtful", "Out",
 * "IR") means the feed has flagged the player as something other than
 * healthy, and this model does not narrow that to the literal string
 * "Questionable".
 */

const BENCH = 'BENCH';
const IR = 'IR';

/**
 * One lineup row (the wire's `id`, `name`, `position`, `nfl_team`, `slot`,
 * `opponent`, `projected_points`, `injury_status`) as the one player shape.
 * `projectedPoints` is coerced to a finite number or null: node-postgres can
 * hand a decimal back as a string, and a missing projection must stay null
 * rather than becoming 0 or NaN.
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
    opponent: r.opponent ?? null,
    projectedPoints: Number.isFinite(points) ? points : null,
    injuryStatus: r.injury_status ?? null,
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
  // Starters are neither BENCH nor IR (CONTEXT.md's Lineup/Slot). Dropping
  // this clause is the tested red-tell: it would seat bench and IR rows as
  // starters, over-counting them everywhere the count matters.
  const starters = entries.filter((e) => e.slot !== BENCH && e.slot !== IR);
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
