/**
 * Public surface of the `shared/lib` kit (ADR 0020, amendment #669): the League
 * Dashboard's shared non-presentational layer. Widgets import from this index,
 * never from the module files directly. This is a bottom layer of the FSD
 * island, a sibling of `shared/ui`, and depends on nothing above it.
 */
export { useEndpoint } from './useEndpoint';
export { subscribeToScoreFeed } from './scoreFeed';
// The League Dashboard commissioner strip and the commissioner-console page
// (ADR 0034) both read this one derivation off the league payload.
export { commissionerFacts } from './commissionerFacts';
export {
  URGENT_SECONDS,
  OVERDUE_AFTER_MS,
  deriveOnTheClock,
  remainingSeconds,
  isUrgent,
  isTeamOnTheClock,
  formatRemaining,
} from './onTheClock';
// Matchup arithmetic and display contracts (#1120, ADR 0031), promoted from
// private below-island and per-widget copies once matchupWinProbability
// passed ADR 0031's one-more-consumer threshold: matchup-hero, matchup-grid,
// matchup-preview, scoreboard-strip, around-the-league and the Matchup page
// all read these instead of a private copy.
export { matchupWinProbability, homeWinProbability, remainingPoints, MARGIN_SCALE } from './winProbability';
export { formatKickoff } from './kickoff';
export { finite, formatPoints } from './numeric';
// Avatar-initials fallback (#1146, ADR 0031's component amendment), promoted
// alongside TeamAvatar in `shared/ui` once both crossed the second-island-
// consumer threshold.
export { initialsFor } from './initials';
// The roster-slots parse (#1165, ADR 0031's second-island-consumer clause),
// promoted once quick-actions, my-team-summary and the Matchup page each
// carried their own parse-and-tolerate body for `league.roster_slots`.
export { parseRosterSlots } from './rosterSlots';
// The Unavailable reason -> label map (#1208), promoted once LineupScreen,
// the retro-scoreboard widget model and the slot-comparison widget model
// each carried an identical bye/out/ir label object.
export { unavailableLabel } from './unavailableLabel';
