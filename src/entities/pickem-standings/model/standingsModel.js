/**
 * The Pickem standings model (ADR 0029, entities/pickem-standings): per-row
 * derived fields the standings table needs, computed once from the standings
 * response's rows (CONTEXT.md, Scoring and the week) rather than the table
 * computing its own answer inline.
 */

/**
 * correct / (correct + incorrect); a tied or still-pending game credits
 * neither side (CONTEXT.md: "a tied game credits nobody"), so it never enters
 * this ratio. A team with no decided game yet (0 of 0) reads as null, never
 * NaN or 0 - a 0 accuracy would say "always wrong" rather than "nothing
 * decided yet".
 */
export function accuracy(row) {
  const decided = (row.correct || 0) + (row.incorrect || 0);
  if (decided === 0) return null;
  return row.correct / decided;
}

/**
 * The week (and its point total) with the most points, from a `weekly`
 * object keyed by week number. A tie between two weeks' points is broken
 * toward the earlier week, so the answer is stable regardless of the
 * object's own key order.
 */
export function bestWeek(weekly) {
  if (!weekly) return null;
  const weeks = Object.keys(weekly).map(Number);
  if (weeks.length === 0) return null;
  let best = null;
  for (const week of weeks.sort((a, b) => a - b)) {
    const points = weekly[week];
    if (best == null || points > best.points) best = { week, points };
  }
  return best;
}

/**
 * 'up'/'down' compares this rank against the previous one; 'flat' when
 * unchanged; null when there is no previous rank to compare against (the
 * first week a team has one). Rank counts down from 1, so a numerically
 * smaller rank is an improvement.
 */
export function trend(rank, previousRank) {
  if (rank == null || previousRank == null) return null;
  if (rank < previousRank) return 'up';
  if (rank > previousRank) return 'down';
  return 'flat';
}

/**
 * Marks every row whose rank is shared with another row as tied - the read
 * that lets the table render "T-1" instead of two rows silently both saying
 * "1".
 */
function withTiedRanks(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.rank, (counts.get(row.rank) || 0) + 1);
  return rows.map((row) => ({ ...row, tied: (counts.get(row.rank) || 0) > 1 }));
}

/**
 * The full per-row model: the wire row's own fields plus `tied`, `accuracy`,
 * `bestWeek` and `trend`. Rows are returned in the order given.
 */
export function standingsModel(rows) {
  return withTiedRanks(rows || []).map((row) => ({
    ...row,
    accuracy: accuracy(row),
    bestWeek: bestWeek(row.weekly),
    trend: trend(row.rank, row.previousRank),
  }));
}
