/**
 * The standings read model, pure (ADR 0029: the entities layer; this is its
 * second slice, on the model of the Matchup read model). It is the one spelling
 * of a Team's standing as the client knows it, and the ONE place a Team's
 * Record is computed: three widgets used to derive it from raw rows and drifted
 * apart (#958), so a fourth derivation must have nowhere to live.
 *
 * The shape:
 *
 *   { teamId, rank, position, wins, losses, ties, gamesPlayed, record,
 *     pointsFor, pointsAgainst, streak, winPct, playoffSeed }
 *
 * `rank` is the SERVER'S rank for the Team (season.service.js), falling back to
 * the row's position when the server sends none. `position` is the row's place
 * in the response order, index + 1. Both exist because the two readers want
 * different things and the difference is a settled ruling, not drift: the
 * standings table's Rank column is the POSITION (the #617 ruling: the column and
 * the row order cannot be allowed to disagree), while the my-team-summary card's
 * "2nd" is the Team's own rank as the server computed it.
 *
 * `record` is CONDITIONAL (CONTEXT.md, Record): wins-losses while the Team has
 * no ties, wins-losses-ties once a tie has actually happened. A tie count is
 * never printed as zero.
 *
 * Counts and points are coerced (a missing count reads as zero, which is what
 * the server means by omitting it). Everything else is carried across verbatim
 * - this module renames, it does not retype - so `streak`, `winPct` and
 * `playoffSeed` reach a presenter exactly as the wire sent them and each
 * surface formats or masks them as it always has.
 *
 * This module is pure: it imports nothing at all.
 */

const count = (value) => Number(value) || 0;

/**
 * The Record string for a set of counts. Not exported: a caller reads `record`
 * off a Team standing, so there is exactly one way to get one.
 */
function formatRecord(wins, losses, ties) {
  return ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
}

/**
 * One standings row (`GET /api/scoring/league/:id/standings`, one entry of
 * `standings[]`) as the client knows it. `index` is the row's place in the
 * response order and is what `position` reports; it also stands in for a
 * missing server rank. Total: a null row yields a zeroed standing rather than
 * throwing.
 */
export function teamStandingFromRow(row, index = 0) {
  const r = row || {};
  const wins = count(r.wins);
  const losses = count(r.losses);
  const ties = count(r.ties);
  const serverRank = Number(r.rank);
  return {
    teamId: r.teamId ?? null,
    rank: Number.isFinite(serverRank) ? serverRank : index + 1,
    position: index + 1,
    wins,
    losses,
    ties,
    gamesPlayed: wins + losses + ties,
    record: formatRecord(wins, losses, ties),
    pointsFor: count(r.pf),
    pointsAgainst: count(r.pa),
    streak: r.streak ?? null,
    winPct: r.winPct ?? null,
    playoffSeed: r.playoffSeed ?? null,
  };
}

/**
 * The whole read: the Team standings in the server's order, and the league's
 * bracket size beside them (`league.playoff_teams`, which the standings table
 * needs to know whether there is a playoff cut at all). A body with no
 * `standings` array is an empty table, never a throw.
 */
export function standingsFromResponse(body) {
  const rows = Array.isArray(body?.standings) ? body.standings : [];
  const playoffTeams = Number(body?.league?.playoff_teams);
  return {
    rows: rows.map((row, index) => teamStandingFromRow(row, index)),
    playoffTeams: Number.isFinite(playoffTeams) && playoffTeams > 0 ? playoffTeams : null,
  };
}

/**
 * A Record lookup (a Map keyed by Team id) built from RAW standings rows, for a
 * surface that holds the response and wants only the records - the Matchup card
 * reads its "3-1" through this. Rows with no Team id are skipped.
 */
export function recordsByTeamId(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.teamId == null) continue;
    map.set(row.teamId, teamStandingFromRow(row).record);
  }
  return map;
}

/**
 * The Team standing for one Team id, or null. Matching is by Team id and never
 * by an account identifier (#112, CONTEXT.md team identity).
 */
export function findTeamStanding(rows, teamId) {
  if (teamId == null || !Array.isArray(rows)) return null;
  return rows.find((row) => row && row.teamId === teamId) || null;
}
