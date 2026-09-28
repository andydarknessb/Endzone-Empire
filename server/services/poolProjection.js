/**
 * The Pool projection accessor (#1705): the one place a reader of the Pool
 * map (`getWeekProjections` with no league / `getPoolWideProjections`, values
 * `{ points, source }`) turns an entry into a number, so no reader indexes
 * `.points` or tests `typeof` on a map value itself. Same convention as the
 * Weekly result's `pointsFor` (#1702): `null` when there is no Pool
 * projection value (absent player, or a `points` that is not a finite
 * number), never a coerced 0 - a caller that wants 0 keeps its own `|| 0`. The Pool
 * projection is a different producer from the Weekly projection and stays
 * one; this only removes the duplicated reads.
 *
 * Its own pure module (no DB) so a reader can import it without pulling in
 * projection.service, and a test that replaces that service whole keeps the
 * accessor.
 */

function poolPointsFor(poolMap, playerId) {
  const entry = poolMap.get(playerId);
  if (entry == null || entry.points == null) return null;
  const points = Number(entry.points);
  return Number.isFinite(points) ? points : null;
}

/** playerId -> points for every Pool entry that has a value (`poolPointsFor`'s non-null rows). */
function poolPointsMap(poolMap) {
  const points = new Map();
  for (const playerId of poolMap.keys()) {
    const value = poolPointsFor(poolMap, playerId);
    if (value != null) points.set(playerId, value);
  }
  return points;
}

module.exports = { poolPointsFor, poolPointsMap };
