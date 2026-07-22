export const MIN_PROJECTION_TIER_DROP = 2;
export const PROJECTION_TIER_DROP_RATIO = 0.12;
export const MAX_PROJECTION_TIERS = 6;
export const RANKING_POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function projection(row) {
  const value = Number(row.projectedPoints);
  return row.projectedPoints == null || !Number.isFinite(value) ? null : value;
}

export function compareByProjection(a, b) {
  const aPoints = projection(a);
  const bPoints = projection(b);
  if (aPoints == null && bPoints == null) return Number(a.rank) - Number(b.rank);
  if (aPoints == null) return 1;
  if (bPoints == null) return -1;
  return bPoints - aPoints || Number(a.rank) - Number(b.rank);
}

function groupByPosition(rows) {
  const groups = new Map();
  for (const row of rows) {
    const position = row.position || 'ALL';
    if (!groups.has(position)) groups.set(position, []);
    groups.get(position).push(row);
  }
  return groups;
}

/** Group positions in the public filter order and projections high-to-low within each group. */
export function orderRowsByPosition(rows = [], positionOrder = RANKING_POSITION_ORDER) {
  const groups = groupByPosition(rows);
  const knownPositions = positionOrder.filter((position) => groups.has(position));
  const remainingPositions = [...groups.keys()].filter((position) => !positionOrder.includes(position));

  return [...knownPositions, ...remainingPositions]
    .flatMap((position) => [...groups.get(position)].sort(compareByProjection));
}

/** Assign projection-drop tiers independently within each fantasy position. */
export function deriveProjectionTiers(rows = []) {
  const groups = groupByPosition(rows);

  const tiers = new Map();
  for (const players of groups.values()) {
    const sortedPlayers = [...players].sort(compareByProjection);

    let tier = 1;
    let tierAnchor = null;
    let missingTierStarted = false;
    for (const player of sortedPlayers) {
      const current = projection(player);
      if (tierAnchor != null && current == null && !missingTierStarted) {
        tier = Math.min(tier + 1, MAX_PROJECTION_TIERS);
        missingTierStarted = true;
      } else if (tierAnchor != null && current != null) {
        const threshold = Math.max(
          MIN_PROJECTION_TIER_DROP,
          Math.abs(tierAnchor) * PROJECTION_TIER_DROP_RATIO
        );
        if (tierAnchor - current >= threshold && tier < MAX_PROJECTION_TIERS) {
          tier += 1;
          tierAnchor = current;
        }
      }
      tiers.set(player.playerId, tier);
      if (current != null && tierAnchor == null) {
        tierAnchor = current;
        missingTierStarted = false;
      }
    }
  }
  return tiers;
}

export default deriveProjectionTiers;
