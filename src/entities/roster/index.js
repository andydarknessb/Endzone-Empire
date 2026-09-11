/**
 * Public surface of the Roster entity (ADR 0029: the FSD island's entities
 * layer, following the Matchup and Standings slices' shape). Widgets, pages
 * and the legacy `src/components` surfaces read a team's Lineup from HERE and
 * never from an internal path; the entity itself never imports a feature, a
 * widget, a page or another entity. Within the island it depends on `shared`
 * (`shared/lib`'s `useEndpoint` and `parseRosterSlots`, the same plain reads
 * the Matchup and Standings slices use). Everything else in this folder is
 * internal.
 *
 * `pairStartersBySlot`, `lineupEntries`, `eligibleSlots` and `locked` are
 * this entity's below-Roster edge for `entities/matchup`: since #1207 that
 * entity's `matchupModel.js` re-exports `pairStartersBySlot` from HERE for
 * one release (ADR 0029's directional import rule extended to the first
 * entity-to-entity edge - pairing starters by slot is a Roster/Lineup fact,
 * not a Matchup one).
 */
export { lineupModel, pairStartersBySlot, lineupEntries, eligibleSlots, locked } from './model/lineupModel';
export { useTeamLineup } from './model/useTeamLineup';
