/**
 * Public surface of the Matchup entity (ADR 0029: the FSD island's entities
 * layer, first slice). Widgets, pages and the legacy `src/components` surfaces
 * import a Matchup from HERE and never from an internal path; the entity itself
 * imports `shared` only. Everything else in this folder is the slice's internals.
 */
export {
  matchupFromListRow,
  matchupFromDetailBody,
  applyScoreEvent,
  applyIdentityPatch,
  matchupStatusView,
} from './model/matchupModel';
export { useLeagueMatchups } from './model/useLeagueMatchups';
