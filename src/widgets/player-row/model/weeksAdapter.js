/**
 * Adapts the Players list's own `weeks[]` shape (`GET /api/players?view=cards`,
 * `server/services/playerCard.service.js` `buildWeeksForPage`: each entry is
 * `{ week, points }` or `{ week, reason }` with no `kind`) onto
 * `entities/player`'s `WeeklyPointsBars`, which this widget reuses for the
 * sparkline rather than redrawing eighteen bars a second time (#1310, ADR
 * 0040's Plan naming `player-row` as new work, not the bars themselves).
 *
 * `buildWeeksForPage` never marks a week 'actual' (the list runs from the
 * CURRENT week forward only, ADR 0040's Lead correction item 3), so every
 * points-bearing week maps to 'projected'; `reason: 'on bye'` is WeeklyPointsBars'
 * own 'bye' kind, and any other reason ('on IR', 'out') is its 'unavailable'
 * kind, carrying the reason through unchanged.
 */
export function weeksForSparkline(weeks) {
  if (!Array.isArray(weeks)) return [];
  return weeks.map((week) => {
    if (week.reason === 'on bye') return { week: week.week, kind: 'bye' };
    if (week.reason != null) return { week: week.week, kind: 'unavailable', reason: week.reason };
    return { week: week.week, kind: 'projected', points: week.points };
  });
}

export default weeksForSparkline;
