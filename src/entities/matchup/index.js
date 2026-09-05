/**
 * Public surface of the Matchup entity (ADR 0029: the FSD island's entities
 * layer, first slice). Widgets, pages and the legacy `src/components` surfaces
 * import a Matchup from HERE and never from an internal path; the entity itself
 * never imports a feature, a widget, a page or another entity. Within the island
 * it depends on `shared` (the score feed, `shared/lib`); it also reaches the
 * legacy tree below the island for two things the brief and precedent settle -
 * the existing generic Team profile helper (`src/lib/teamProfileEvents`, which
 * the issue mandated) and a plain fetch (`src/api/apiClient`, the same module
 * `shared/lib/useEndpoint` reads). Everything else in this folder is internal.
 */
export {
  matchupFromListRow,
  matchupFromDetailBody,
  applyScoreEvent,
  applyIdentityPatch,
  matchupStatusView,
} from './model/matchupModel';
export { useLeagueMatchups } from './model/useLeagueMatchups';
export { useMatchup } from './model/useMatchup';
