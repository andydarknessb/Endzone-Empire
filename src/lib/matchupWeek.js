/**
 * Picks the week the screen opens to: the league's current week when it's
 * one of the weeks we actually have matchups for, else the latest week that
 * still has an unfinished matchup (closest thing to "in progress"), else the
 * latest week that exists at all. 'All' only when there's nothing to pick.
 */
export function computeDefaultWeek(league, matchups, weeks) {
  if (league?.current_week && weeks.includes(league.current_week)) {
    return league.current_week;
  }
  const nonFinalWeeks = matchups.filter((m) => !m.final).map((m) => m.week);
  if (nonFinalWeeks.length) {
    return Math.max(...nonFinalWeeks);
  }
  if (weeks.length) {
    return Math.max(...weeks);
  }
  return 'All';
}
