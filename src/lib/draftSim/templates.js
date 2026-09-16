/**
 * Roster shapes for the Draft Simulator.
 *
 * SYNC OBLIGATION (repo convention — see src/lib/positionCapsFeasibility.js):
 *   - The Draft Simulator's own slot-eligibility rule (POSITION_GROUPS,
 *     expandEligibility, slotEligible - the copy that omitted IR) is deleted
 *     (#1501). This module, `analysis.js`, `cpuBrain.js` and `engine.js`, plus
 *     `src/lib/rosterAssignment.js` and `shared/lib/positionChips.js`, now
 *     import `expandEligibility`/`POSITION_GROUPS` (and `accepts` in place of
 *     `slotEligible`) from the Roster template entity's concrete model file,
 *     `src/entities/roster/model/rosterTemplateModel.js`, the same narrow
 *     edge this module already used for `DEFAULT_ROSTER_SLOTS` below -
 *     documented in that entity's own index docblock.
 *   - DEFAULT_ROSTER_SLOTS (#1500) moved into the Roster template entity,
 *     `src/entities/roster`'s `model/rosterTemplateModel.js`, and is
 *     imported from there rather than declared here. The entity's own copy
 *     is hand-mirrored from the pure leaf server/services/rosterSlots.js,
 *     the server's single source for this shape, for the same
 *     ModuleScopePlugin reason the other three constants above are, and is
 *     pinned equal to the leaf by templates.parity.test.js (which still
 *     imports `DEFAULT_ROSTER_SLOTS` from THIS module, re-exported below
 *     unchanged) - if the server's default roster shape changes, change the
 *     entity's copy; the test will catch a miss.
 *   - LEAGUE_TEMPLATES mirrors LINEUP_TEMPLATES in
 *     src/components/LeagueDashboard/CommissionerTools.jsx (Standard /
 *     Superflex / IDP starter) so a mock draft's roster shape is one a
 *     commissioner could actually stamp into a real league.
 *
 * The simulator never talks to the server about roster settings — it is fully
 * client-side — so these are the only definitions it has.
 */

// Imported from the entity's concrete model file, not its index (ADR 0029
// normally requires the index): the index also re-exports `lineupModel.js`,
// which reaches the `shared/lib` barrel - and that barrel exports
// `chipsForRosterSlots` (`shared/lib/positionChips.js`), which imports THIS
// module for `DEFAULT_ROSTER_SLOTS`/`templateFor`. Going through the index
// would close that cycle (this module -> entities/roster index ->
// lineupModel -> shared barrel -> positionChips -> this module,
// mid-evaluation) and read `DEFAULT_ROSTER_SLOTS` as `undefined` at the far
// end (#1500). The narrower edge below avoids it without losing the pin.
// `expandEligibility` is imported the same narrow way (#1501): this module no
// longer keeps its own slot-eligibility copy (see the file docblock).
import { DEFAULT_ROSTER_SLOTS, expandEligibility, rosterablePositions } from '../../entities/roster/model/rosterTemplateModel';

export { DEFAULT_ROSTER_SLOTS };

/**
 * Every specific position code that belongs to an IDP group (#1501: derived
 * from the entity's `expandEligibility`, not a re-declared group table).
 */
export const IDP_POSITIONS = Array.from(expandEligibility(['DL', 'LB', 'DB']));

const STANDARD_LINEUP = DEFAULT_ROSTER_SLOTS;

const SUPERFLEX_LINEUP = [
  ...STANDARD_LINEUP,
  { key: 'SFLX', label: 'SFLX', count: 1, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] },
];

const IDP_LINEUP = [
  ...STANDARD_LINEUP,
  { key: 'DL', label: 'DL', count: 1, eligiblePositions: ['DL'] },
  { key: 'LB', label: 'LB', count: 1, eligiblePositions: ['LB'] },
  { key: 'DB', label: 'DB', count: 1, eligiblePositions: ['DB'] },
];

/** Bench depth every simulated roster carries on top of its starting slots. */
export const SIM_BENCH_SLOTS = 6;

/**
 * The three league shapes a mock draft can run. `id` is what the config form
 * and persisted state store; `needsIdp` drives the `?idp=1` pool fetch.
 */
export const LEAGUE_TEMPLATES = [
  {
    id: 'standard',
    name: 'Standard',
    description: 'QB / 2 RB / 2 WR / TE / FLEX / K / DEF',
    slots: STANDARD_LINEUP,
    needsIdp: false,
  },
  {
    id: 'superflex',
    name: 'Superflex',
    description: 'Standard plus a SFLX slot, so a second QB is startable',
    slots: SUPERFLEX_LINEUP,
    needsIdp: false,
  },
  {
    id: 'idp',
    name: 'IDP',
    description: 'Standard plus DL / LB / DB starters',
    slots: IDP_LINEUP,
    needsIdp: true,
  },
];

/** The template for an id, falling back to Standard for an unknown/absent id. */
export function templateFor(leagueType) {
  return LEAGUE_TEMPLATES.find((t) => t.id === leagueType) || LEAGUE_TEMPLATES[0];
}

/** Total starting slots in a template. */
export function starterCount(template) {
  return template.slots.reduce((sum, slot) => sum + (Number(slot.count) || 0), 0);
}

/**
 * Rounds a mock draft of this shape runs: every starting slot plus the fixed
 * bench. Standard 15, Superflex 16, IDP 18.
 */
export function roundsForTemplate(template) {
  return starterCount(template) + SIM_BENCH_SLOTS;
}

/**
 * Every position code a template's slots can start (group keys expanded).
 * Delegates to the entity's `rosterablePositions` (#1501) rather than
 * re-walking `template.slots` here: none of the simulator's own templates
 * carry a BENCH/IR entry, so the two answer identically.
 */
export function draftablePositions(template) {
  return rosterablePositions(template.slots);
}
