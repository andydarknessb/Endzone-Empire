/**
 * Order a game log chronologically (oldest week first) for display. The public
 * players endpoint returns recentGames newest-first, but the profile renders a
 * season-progression view labelled "Oldest to newest," so the UI sorts a local
 * copy ascending by week.
 *
 * Pure and defensive: never mutates the input, tolerates missing/non-numeric
 * week values (those sink to the end), and preserves the received order for
 * duplicate weeks. Makes no assumption about how many games are present.
 */
function weekValue(game) {
  // Number(null) and Number('') are 0, so guard those before coercing —
  // otherwise a missing week would sort ahead of Week 1 instead of sinking.
  const week = game == null ? null : game.week;
  if (week == null || week === '') return null;
  const num = Number(week);
  return Number.isFinite(num) ? num : null;
}

export function sortGamesByWeek(games = []) {
  return [...games].sort((a, b) => {
    const aWeek = weekValue(a);
    const bWeek = weekValue(b);
    if (aWeek == null && bWeek == null) return 0;
    if (aWeek == null) return 1;
    if (bWeek == null) return -1;
    return aWeek - bWeek;
  });
}

export default sortGamesByWeek;
