import { deriveRankingTiers, compareByRankingPoints } from './rankingTiers';

/**
 * Positions where waiver-wire depth actually matters. QB, K, and DEF are
 * intentionally excluded: streaming those is covered by the strategy articles,
 * not "adds to monitor," and letting the highest-projected position (usually QB)
 * flood the module hides the flex-relevant names people actually claim. Excluded
 * positions never appear here — not even as backfill.
 */
export const WAIVER_POSITIONS = ['RB', 'WR', 'TE'];

export const DEFAULT_WAIVER_OPTIONS = {
  positions: WAIVER_POSITIONS,
  leadingTiers: 1, // top-tier players are studs, not realistic adds
  perPositionCap: 2, // keep any single position from dominating the ~6 cards
  limit: 6,
};

/**
 * Pick a position-balanced, flex-relevant set of "names to monitor" from a
 * public rankings list. Pure: no fetching, and the input rows are never mutated.
 *
 * Rules:
 *  - Only in-scope positions (RB/WR/TE by default) are ever eligible.
 *  - "Beyond the leading tiers": a candidate must sit outside its position's top
 *    `leadingTiers` ranking tiers (reusing {@link deriveRankingTiers}), so
 *    a lower-tier player is preferred over a top-tier stud.
 *  - Balance: at most `perPositionCap` per position on the first pass.
 *  - Backfill: if positions come up short, remaining slots are filled from the
 *    other in-scope positions by season points — never from excluded positions.
 *
 * Each returned row is a shallow copy of the original plus `positionRank`
 * (1-indexed rank within its position by season points) and `tier`.
 */
export function selectWaiverCandidates(rows = [], options = {}) {
  const { positions, leadingTiers, perPositionCap, limit } = { ...DEFAULT_WAIVER_OPTIONS, ...options };
  const tiers = deriveRankingTiers(rows);

  // Per-position, points-sorted groups so position rank reflects the true
  // depth of the fetched pool (e.g. "WR · Rank 24"), then keep only the players
  // beyond each position's leading tier(s).
  const candidatesByPosition = new Map();
  for (const position of positions) {
    const ranked = rows
      .filter((row) => row.position === position)
      .sort(compareByRankingPoints)
      .map((row, index) => ({ ...row, positionRank: index + 1, tier: tiers.get(row.playerId) || 1 }));
    candidatesByPosition.set(position, ranked.filter((row) => row.tier > leadingTiers));
  }

  // First pass: up to perPositionCap per position, best season points first.
  const selected = [];
  const selectedIds = new Set();
  for (const position of positions) {
    for (const pick of (candidatesByPosition.get(position) || []).slice(0, perPositionCap)) {
      selected.push(pick);
      selectedIds.add(pick.playerId);
    }
  }

  // Backfill remaining slots from leftover candidates. The pool is built only
  // from in-scope positions, so excluded positions can never leak in this way.
  if (selected.length < limit) {
    const leftovers = positions
      .flatMap((position) => candidatesByPosition.get(position) || [])
      .filter((row) => !selectedIds.has(row.playerId))
      .sort(compareByRankingPoints);
    for (const row of leftovers) {
      if (selected.length >= limit) break;
      selected.push(row);
      selectedIds.add(row.playerId);
    }
  }

  return selected.sort(compareByRankingPoints).slice(0, limit);
}

export default selectWaiverCandidates;
