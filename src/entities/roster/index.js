/**
 * Public surface of the Roster entity (ADR 0029: the FSD island's entities
 * layer, following the Matchup and Standings slices' shape). Widgets, pages
 * and the legacy `src/components` surfaces read a team's Lineup from HERE and
 * never from an internal path; the entity itself never imports a feature, a
 * widget, a page or another entity. Within the island it depends only on
 * `shared` (`shared/lib`'s `useEndpoint`, the same plain read the Matchup and
 * Standings slices use). Everything else in this folder is internal.
 */
export { lineupModel } from './model/lineupModel';
export { useTeamLineup } from './model/useTeamLineup';
