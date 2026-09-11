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
 * `pairStartersBySlot`, `lineupEntries`, `eligibleSlots` and `locked` are all
 * exported from HERE, but only `pairStartersBySlot` is read by another
 * entity: since #1207, `entities/matchup`'s `matchupModel.js` re-exports it
 * from HERE for one release. ADR 0029 itself forbids an entity importing
 * another entity (lines 31 and 78); this is a temporary exception to that
 * rule, authorized by #1198 R1's one-release move (pairing starters by slot
 * is a Roster/Lineup fact, not a Matchup one), and #1210 removes it.
 */
export { lineupModel, pairStartersBySlot, lineupEntries, eligibleSlots, locked } from './model/lineupModel';
export { useTeamLineup } from './model/useTeamLineup';
