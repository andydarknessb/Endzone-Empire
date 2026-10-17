/**
 * Pure copy-building for the bye-cluster widget's own naming line (#1239,
 * AC3): "Week {N}: {players} sit. {waiver clear copy}." No network, no
 * React - unit-tested directly, the same split `start-sit-panel/lib/
 * suggestionView.js` already uses for its own view-building.
 */
import { formatInstant } from '../../../shared/lib';

/** "A" / "A and B" / "A, B and C" - no Oxford comma, this app's own house style. */
function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The waiver clear copy. A league that clears every claim together at one time (`waiversClearAt`, the
 * `league.waivers_clear_at` the waivers read returns while a blanket clear is still to come) says when:
 * "Waivers clear Wed 2:00 AM." (spec #2347 ruling 4). Otherwise it reads the same way the commissioner's
 * own rules view phrases the waiver period (`LeagueRules/WaiverTradeRulesView.jsx`: 0 hours is
 * "Continuous"/immediate, otherwise "N hours"): `league.waiver_period_hours` is a rolling per-claim period,
 * so the line names the rule that governs when a claimed player clears, not an invented deadline. A clear
 * time already past is spent (the server NULLs it) and reads as absent.
 */
function waiverClearCopy(waiverPeriodHours, waiversClearAt, now) {
  const at = waiversClearAt == null ? NaN : new Date(waiversClearAt).getTime();
  if (Number.isFinite(at) && at > now) return `Waivers clear ${formatInstant(at, 'weekdayTime')}.`;
  const hours = waiverPeriodHours ?? 24;
  return hours === 0 ? 'Waivers clear immediately.' : `Waivers clear in ${hours} hours.`;
}

/**
 * `worst` is a `computeByeClusters` entry with `count >= 2` (or `null`, the
 * caller's "no week reaches two" case - AC3: the line is absent then).
 */
export function worstClusterLine({
  worst, waiverPeriodHours, waiversClearAt = null, now = Date.now(),
}) {
  if (!worst) return null;
  const names = joinNames(worst.players.map((p) => p.name));
  return `Week ${worst.week}: ${names} sit. ${waiverClearCopy(waiverPeriodHours, waiversClearAt, now)}`;
}

export default worstClusterLine;
