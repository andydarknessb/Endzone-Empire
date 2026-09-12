/**
 * Pure copy-building for the bye-cluster widget's own naming line (#1239,
 * AC3): "Week {N}: {players} sit. {waiver clear copy}." No network, no
 * React - unit-tested directly, the same split `start-sit-panel/lib/
 * suggestionView.js` already uses for its own view-building.
 */

/** "A" / "A and B" / "A, B and C" - no Oxford comma, this app's own house style. */
function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The waiver clear period reads the same way the commissioner's own rules
 * view already phrases it (`LeagueRules/WaiverTradeRulesView.jsx`: 0 hours is
 * "Continuous"/immediate, otherwise "N hours") rather than a second copy of
 * that judgment call. `league.waiver_period_hours` is a rolling per-claim
 * period, not a fixed weekly cutoff - this league has no such single clock
 * time, so the line names the rule that actually governs when a claimed
 * player clears, not an invented deadline.
 */
function waiverClearCopy(waiverPeriodHours) {
  const hours = waiverPeriodHours ?? 24;
  return hours === 0 ? 'Waivers clear immediately.' : `Waivers clear in ${hours} hours.`;
}

/**
 * `worst` is a `computeByeClusters` entry with `count >= 2` (or `null`, the
 * caller's "no week reaches two" case - AC3: the line is absent then).
 */
export function worstClusterLine({ worst, waiverPeriodHours }) {
  if (!worst) return null;
  const names = joinNames(worst.players.map((p) => p.name));
  return `Week ${worst.week}: ${names} sit. ${waiverClearCopy(waiverPeriodHours)}`;
}

export default worstClusterLine;
