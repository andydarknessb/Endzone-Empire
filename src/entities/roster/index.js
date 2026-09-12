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
 * `pairStartersBySlot`, `lineupEntries`, `eligibleSlots`, `locked` and
 * `isQuestionable` are all exported from HERE - `isQuestionable` (#1330) is
 * the one spelling of the questionable-class injury designation (Q, D), read
 * by the team-summary-strip widget rather than that widget inventing its own
 * designation list (ADR 0029: a widget reads an entity's public surface).
 * `pairStartersBySlot` used to be re-exported from
 * `entities/matchup`'s `matchupModel.js` too (#1207, one release, since
 * `useMatchup.js` paired starters itself): ADR 0029 forbids an entity
 * importing another entity (lines 31 and 78), and that re-export was the
 * temporary, authorized exception (#1198 R1's one-release move - pairing
 * starters by slot is a Roster/Lineup fact, not a Matchup one). #1210 closed
 * it: the pairing moved up to `pages/matchup/model/useMatchupPage.js`, which
 * imports `pairStartersBySlot` from HERE directly (ADR 0029 permits a page
 * importing an entity), and nothing under `entities/matchup` imports this
 * entity any more.
 */
export { lineupModel, pairStartersBySlot, lineupEntries, eligibleSlots, locked, isQuestionable } from './model/lineupModel';
export { useTeamLineup } from './model/useTeamLineup';
