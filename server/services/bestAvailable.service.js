/**
 * Best available (CONTEXT.md glossary): the order players are offered when
 * nobody has expressed a preference. By ADP where the market has one, then
 * by last completed season's fantasy points, then by name. Database id
 * NEVER decides order between two players.
 *
 * Shared by the Draft Sim's pool (publicRead.service.js getDraftPool, which
 * also applies the membership rule below) and the real draft's autopick
 * fallback (the Pick clock module, pickClock.service.js, which sorts every
 * undrafted candidate this way after its own queue). Both consumers call THIS
 * module's exports —
 * server/test/bestAvailable.sharedUsage.test.js fails if either stops.
 *
 * Callers hand rows/objects shaped `{ adp, last_season_points, name }` — the
 * raw column names a LEFT JOIN against player_season_stats for the last
 * completed season produces, so no remapping step sits between a query and
 * this comparator.
 */

/** Has the market ranked this player (ADP), or did they produce last season? */
function isBestAvailableEligible(row) {
  return row.adp != null || row.last_season_points != null;
}

/**
 * ADP ascending (no ADP sorts last), then last completed season's fantasy
 * points descending (no points sorts last, behind any point total including
 * zero), then name. Never falls back to id.
 */
function compareBestAvailable(a, b) {
  const aAdp = a.adp == null ? Infinity : Number(a.adp);
  const bAdp = b.adp == null ? Infinity : Number(b.adp);
  if (aAdp !== bAdp) return aAdp - bAdp;

  const aPoints = a.last_season_points == null ? -Infinity : Number(a.last_season_points);
  const bPoints = b.last_season_points == null ? -Infinity : Number(b.last_season_points);
  if (aPoints !== bPoints) return bPoints - aPoints;

  return String(a.name).localeCompare(String(b.name));
}

/**
 * Eligible rows (ADP or last-season production), in best-available order.
 * A convenience for callers that want filter+sort in one step; getDraftPool
 * calls isBestAvailableEligible/compareBestAvailable directly instead (see
 * publicRead.service.js) so a spy on the exported comparator observes real
 * usage — see server/test/bestAvailable.sharedUsage.test.js.
 */
function selectBestAvailable(rows) {
  return rows.filter(isBestAvailableEligible).sort(compareBestAvailable);
}

module.exports = { isBestAvailableEligible, compareBestAvailable, selectBestAvailable };
