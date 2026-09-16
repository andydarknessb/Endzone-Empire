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
 *
 * `parseRosterTemplate`, `accepts`, `slotsFor`, `rosterablePositions` and
 * `DEFAULT_ROSTER_SLOTS` (#1500, `model/rosterTemplateModel.js`) are the
 * Roster template's one rule (CONTEXT.md's Roster template glossary entry):
 * "may this position sit in this Slot" (`accepts`) and "which Slots fit this
 * player" (`slotsFor`) answered off the same template. `DEFAULT_ROSTER_SLOTS`
 * moved here from `src/lib/draftSim/templates.js`, which now imports it from
 * this index rather than declaring its own copy - templates.js's own
 * POSITION_GROUPS/expandEligibility/slotEligible stay put for now (the
 * Draft Simulator's existing hand-mirrored copy, unaffected by this move).
 */
export { lineupModel, pairStartersBySlot, lineupEntries, eligibleSlots, locked, isQuestionable } from './model/lineupModel';
export { useTeamLineup } from './model/useTeamLineup';
export {
  parseRosterTemplate,
  accepts,
  slotsFor,
  rosterablePositions,
  DEFAULT_ROSTER_SLOTS,
} from './model/rosterTemplateModel';
