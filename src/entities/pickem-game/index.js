/**
 * Public surface of the Pickem game entity (ADR 0029: the FSD island's
 * entities layer; ADR 0038: Pick'em joins the island). Widgets, features, the
 * `pickem` page and the legacy `src/components` surfaces read a Pickem game
 * from HERE and never from an internal path; the entity itself never imports
 * a feature, a widget or a page.
 *
 * `gameModel` is the slate read (gameKey, teams in away@home order, kickoff,
 * lock, phase, the viewer's own pick and confidence); `gameDetailModel` adds
 * the glossary's Line (favorite derived from the spread's sign), Weather
 * (the 15 mph / 30% display thresholds), Record (the neutral-site split
 * rule), Venue, Broadcast, Situation and the final extras. Kickoff-window
 * grouping (`kickoffWindowFor`, `groupByKickoffWindow`) is a pure function
 * here, computed off the league's own scheduling zone rather than the
 * viewer's.
 *
 * Within the island it depends on nothing above it and reaches below the
 * island for one thing, in the sense ADR 0029's 2026-09-05 amendment allows
 * (plumbing with no domain meaning, never a domain concept):
 *
 *   - `src/api/apiClient`, `src/lib/httpFailure`, `src/hooks/useResource` and
 *     `src/lib/resourceCache` - a plain fetch, its failure-reading helper,
 *     and the shared TTL'd GET (ADR 0004's resource cache); the same
 *     plumbing shape as the Matchup and Standings entities' below-island
 *     edges.
 *
 * This docblock is the audit surface for the slice's below-island edges until
 * the boundary lint rule ADR 0020 names as a follow-up exists. Everything
 * else in this folder is internal.
 */
export { gameModel, gamePhase } from './model/gameModel';
export {
  favoriteFromLine,
  gameDetailModel,
  recordsDisplayModel,
  weatherDisplayModel,
} from './model/gameDetailModel';
export { KICKOFF_WINDOWS, groupByKickoffWindow, kickoffWindowFor } from './model/kickoffWindow';
export { default as usePickemWeek } from './model/usePickemWeek';
export { clearPickemSettingsCache, setPickemSettings, usePickemSettings } from './model/usePickemSettings';
