/**
 * Bye cluster computation (CONTEXT.md, Bye cluster; #1239, ADR 0037/parent
 * spec #1232: "computed client-side from the per-player bye week the lineup
 * payload already carries"): rostered players excluding IR, grouped by bye
 * week, for the seven weeks after a given week. Two is notable, three or
 * more is a warning.
 *
 * Born in `shared/lib` rather than `src/lib` (ADR 0031, docs/adr/0031-game-
 * center-and-matchup-detail-join-the-island.md:198-200): a pure helper with
 * domain meaning is promoted once a second island slice consumes it, and
 * this one is consumed by two - `pages/lineup` and `widgets/bye-cluster` -
 * from the moment it exists, so it never belongs below the island at all.
 * `src/lib/lineupAttention.js` is NOT a precedent to follow here: it is one
 * of the modules #1272 exists to move out of `src/lib` for the same reason,
 * awaiting its own promotion, not a sanctioned pattern.
 *
 * Reads `entities/roster`'s modeled entry shape (`slot`, `spent`, `byeWeek`,
 * `playerId`, `name`, `position`) - no network, no React, pure.
 */

const CLUSTER_SPAN = 7;

/**
 * `fromWeek` is the currently selected/viewed week; the grid always covers
 * the seven weeks strictly AFTER it (matching the design canvas: viewing
 * Wk 3 shows Wk 4 through Wk 10), never the selected week itself.
 */
export function computeByeClusters({ entries, fromWeek } = {}) {
  if (fromWeek == null) return [];

  const rostered = (Array.isArray(entries) ? entries : []).filter(
    (e) => e && e.slot !== 'IR' && !e.spent
  );

  return Array.from({ length: CLUSTER_SPAN }, (_, i) => {
    const week = fromWeek + i + 1;
    const players = rostered
      .filter((e) => e.byeWeek === week)
      .map((e) => ({ playerId: e.playerId, name: e.name, position: e.position }));
    const count = players.length;
    return {
      week,
      count,
      players,
      severity: count >= 3 ? 'warning' : count === 2 ? 'notable' : 'quiet',
    };
  });
}

/**
 * The single worst cluster the grid and the attention chip both name: the
 * highest count among weeks at two or more, earliest week on a tie. `null`
 * when no week reaches two - the caller's cue that the naming line and the
 * chip both go unrendered (CONTEXT.md's Bye cluster: "the count carries the
 * judgment").
 */
export function worstByeCluster(clusters) {
  const candidates = (Array.isArray(clusters) ? clusters : []).filter((c) => c && c.count >= 2);
  if (candidates.length === 0) return null;
  return candidates.reduce((worst, c) => (c.count > worst.count ? c : worst), candidates[0]);
}

export default computeByeClusters;
