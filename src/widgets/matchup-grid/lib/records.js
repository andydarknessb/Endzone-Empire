/**
 * The record lookup a MatchupGrid card reads its "2-0" from. Team record is not
 * on the Matchup wire (ADR 0031: the page passes standings down to the widgets
 * that show it), so the widget takes a lookup as a prop and reads it here.
 *
 * `records` may be any of three shapes, so a page can hand down whatever it
 * already holds: a function `(teamId) => string | null`, a Map keyed by Team
 * id, or a plain object keyed by Team id. A miss reads as null and the card
 * simply omits the record. Object keys are strings, so a numeric id looks up a
 * plain object correctly on its own; a Map is tried with the id as given and
 * then as a string, so a page that keyed by either form is served.
 */
export function lookupRecord(records, teamId) {
  if (records == null || teamId == null) return null;
  let value;
  if (typeof records === 'function') {
    value = records(teamId);
  } else if (typeof records.get === 'function') {
    value = records.get(teamId);
    if (value == null) value = records.get(String(teamId));
  } else {
    value = records[teamId];
  }
  return value == null || value === '' ? null : String(value);
}

/**
 * A record lookup (a Map keyed by Team id) from the scoring standings rows
 * (`GET /api/scoring/league/:id/standings`, each `{ teamId, wins, losses,
 * ties }`). "3-1" with no ties, "3-1-2" once a tie has happened: the same rule
 * the my-team-summary widget prints its record by. Rows without a Team id are
 * skipped; a missing count reads as zero.
 */
export function recordsFromStandings(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.teamId == null) continue;
    const wins = Number(row.wins) || 0;
    const losses = Number(row.losses) || 0;
    const ties = Number(row.ties) || 0;
    map.set(row.teamId, ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`);
  }
  return map;
}
