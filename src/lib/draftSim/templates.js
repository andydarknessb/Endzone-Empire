/**
 * Roster shapes and slot-eligibility rules for the Draft Simulator.
 *
 * SYNC OBLIGATION (repo convention — see src/lib/positionCapsFeasibility.js):
 *   - POSITION_GROUPS, expandEligibility and slotEligible are hand-mirrored
 *     from server/services/lineup.service.js; if the server's group
 *     membership or slot-eligibility semantics change, change them here too.
 *     There is no shared module between client and server in this repo at
 *     runtime (react-scripts's ModuleScopePlugin confines runtime imports to
 *     src/), and these three carry no pin: nothing in the test suite would
 *     notice a miss.
 *   - DEFAULT_ROSTER_SLOTS is hand-mirrored from the pure leaf
 *     server/services/rosterSlots.js, the server's single source for this
 *     shape. It is likewise a hand-kept copy at runtime for the same
 *     ModuleScopePlugin reason, but unlike the three above it is pinned
 *     equal to the leaf by a test, templates.parity.test.js, which jest can
 *     run across that line even though the build can't. If the server's
 *     default roster shape changes, change it here too; the test will catch
 *     a miss.
 *   - LEAGUE_TEMPLATES mirrors LINEUP_TEMPLATES in
 *     src/components/LeagueDashboard/CommissionerTools.jsx (Standard /
 *     Superflex / IDP starter) so a mock draft's roster shape is one a
 *     commissioner could actually stamp into a real league.
 *
 * The simulator never talks to the server about roster settings — it is fully
 * client-side — so these are the only definitions it has.
 */

/**
 * Group keys usable in a slot's eligiblePositions alongside literal position
 * codes. Mirrors lineup.service.js POSITION_GROUPS.
 */
export const POSITION_GROUPS = {
  DL: ['DL', 'DE', 'DT', 'NT'],
  LB: ['LB', 'ILB', 'OLB'],
  DB: ['DB', 'CB', 'S', 'FS', 'SS'],
};

/** Every specific position code that belongs to an IDP group. */
export const IDP_POSITIONS = [
  ...POSITION_GROUPS.DL,
  ...POSITION_GROUPS.LB,
  ...POSITION_GROUPS.DB,
];

export const BENCH = 'BENCH';

/**
 * Mirrors server/services/rosterSlots.js DEFAULT_ROSTER_SLOTS, pinned equal
 * to it by templates.parity.test.js.
 */
export const DEFAULT_ROSTER_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', label: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

/** A slot's eligiblePositions with DL/LB/DB group keys expanded. Mirrors lineup.service.js. */
export function expandEligibility(eligiblePositions) {
  const out = new Set();
  for (const p of eligiblePositions || []) {
    if (POSITION_GROUPS[p]) POSITION_GROUPS[p].forEach((m) => out.add(m));
    else out.add(p);
  }
  return out;
}

/** Pure: may a player of this position sit in this named slot? Mirrors lineup.service.js. */
export function slotEligible(slotKey, position, rosterSlots = DEFAULT_ROSTER_SLOTS) {
  if (slotKey === BENCH) return true;
  const slot = rosterSlots.find((s) => s.key === slotKey);
  if (!slot) return false;
  return expandEligibility(slot.eligiblePositions).has(position);
}

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

/** Every position code a template's slots can start (group keys expanded). */
export function draftablePositions(template) {
  const out = new Set();
  for (const slot of template.slots) {
    expandEligibility(slot.eligiblePositions).forEach((p) => out.add(p));
  }
  return out;
}
