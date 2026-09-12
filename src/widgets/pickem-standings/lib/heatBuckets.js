/**
 * Weekly heat-strip derivation for the pickem-standings widget (#1266):
 * eighteen cells, one per week of the season, shaded by how many points a
 * team scored that week relative to its OWN best week
 * (`bestWeek`, entities/pickem-standings's `standingsModel`).
 *
 * A week is NOT PLAYED - no points, no bucket - when the row's `weekly` map
 * carries no entry for it. That is not the same as a week the team played
 * and scored zero: the standings entity only ever writes a `weekly[week]`
 * entry for a week the team made at least one pick in
 * (server/services/pickem.service.js's `scorePickemWeek` builds one row per
 * picking user; a team that made no picks that week is absent from it
 * entirely), so an absent key means "made no picks", not "scored none" -
 * this is a widget-owned read of that server behaviour, not a claim the
 * entity states directly.
 *
 * Bucket boundaries are relative to the row's own best week, not an absolute
 * scale: a league's weekly ceiling depends on its scoring mode (straight-up
 * tops out at the slate size; confidence tops out far higher,
 * CONTEXT.md's Scoring mode), and this widget reads the standings entity
 * only - it has no slate size to build an absolute scale from. Four buckets
 * by quartile of the best week, each boundary inclusive on its lower side:
 *   h1: 0% to 25% of the best week
 *   h2: >25% to 50%
 *   h3: >50% to 75%
 *   h4: >75% to 100% - always includes the best week itself
 * A best week of zero or absent (every played week scored zero, or the row
 * has no weekly data) buckets every played week h1 rather than dividing by
 * zero.
 */
export const HEAT_WEEKS = 18;

export function heatBucket(points, bestPoints) {
  if (points == null) return null;
  const best = bestPoints == null ? 0 : bestPoints;
  if (best <= 0) return 'h1';
  const fraction = points / best;
  if (fraction <= 0.25) return 'h1';
  if (fraction <= 0.5) return 'h2';
  if (fraction <= 0.75) return 'h3';
  return 'h4';
}

export function heatStrip(row) {
  const weekly = row?.weekly || {};
  const best = row?.bestWeek || null;
  const cells = [];
  for (let week = 1; week <= HEAT_WEEKS; week += 1) {
    const raw = weekly[week];
    const played = raw !== undefined && raw !== null;
    const points = played ? Number(raw) : null;
    cells.push({
      week,
      points,
      bucket: played ? heatBucket(points, best?.points) : null,
      isBest: played && best != null && best.week === week,
    });
  }
  return cells;
}
