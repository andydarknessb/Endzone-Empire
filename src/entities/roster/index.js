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
 * moved here from `src/lib/draftSim/templates.js` - templates.js's own
 * POSITION_GROUPS/expandEligibility/slotEligible stayed put at the time
 * (#1500), the Draft Simulator's existing hand-mirrored copy, unaffected by
 * that move. #1501 below deletes that copy.
 *
 * TWO NAMED EXCEPTIONS to "through the index" (ADR 0029's 2026-09-05
 * amendment names the entity's own index docblock as the audit surface for
 * an entity's below-island/index edges, the same way the Matchup entity's
 * two below-island edges are named above their own index), both existing
 * to avoid one import cycle (formal review f3, #1500):
 *
 *   - `model/rosterTemplateModel.js` imports `parseRosterSlots` from the
 *     CONCRETE `shared/lib/rosterSlots` module, not the `shared/lib` barrel
 *     this file itself uses (line 7). The barrel also exports
 *     `chipsForRosterSlots` (`shared/lib/positionChips.js`), which imports
 *     `src/lib/draftSim/templates.js` for `DEFAULT_ROSTER_SLOTS` - so
 *     importing the barrel from the entity would read back into `shared`
 *     mid-evaluation of the very module supplying `DEFAULT_ROSTER_SLOTS` to
 *     it. `shared/lib/rosterSlots` is a leaf with no imports of its own, so
 *     this narrows the edge without losing anything the barrel offered.
 *   - `src/lib/draftSim/templates.js` imports `DEFAULT_ROSTER_SLOTS` from
 *     `model/rosterTemplateModel.js` directly, not from THIS index - going
 *     through this index would pull in `lineupModel.js` above (line 37),
 *     which reaches the `shared/lib` barrel, which reaches
 *     `positionChips.js`, which imports templates.js: the same cycle,
 *     closed a different way. templates.js is legacy `src/lib`, not one of
 *     the "page" consumers ADR 0029 names as the sanctioned index bridge;
 *     this is a narrower, additional exception for exactly this one import,
 *     documented at both ends (also in templates.js's own docblock).
 *
 * SIX MORE (#1501, same narrowing): the Draft Simulator's own slot-eligibility
 * copy (`POSITION_GROUPS`/`expandEligibility`/`slotEligible`) is deleted, and
 * every place that read it now reads `accepts`/`expandEligibility`/
 * `POSITION_GROUPS` from `model/rosterTemplateModel.js` directly rather than
 * through this index - none of `src/lib/draftSim/{templates,analysis,cpuBrain,
 * engine}.js`, `src/lib/rosterAssignment.js` or `shared/lib/positionChips.js`
 * is an ADR-0029 "page" consumer, so none was ever a sanctioned index bridge,
 * and `positionChips.js` additionally sits in the same cycle the two
 * exceptions above close (index -> lineupModel -> shared barrel ->
 * positionChips.js). Each import is a plain read of a pure function/table,
 * never a widened dependency: `POSITION_GROUPS` and `expandEligibility` are
 * exported from `rosterTemplateModel.js` for exactly these six modules.
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
