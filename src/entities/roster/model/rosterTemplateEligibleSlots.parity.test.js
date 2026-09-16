/**
 * Formal review f2 (#1500 PR): the swap feature's production path now runs
 * real entries through `slotsFor` (the Roster template entity) whenever the
 * league's own `roster_slots` is non-empty - which it is for every real
 * league - so the PR's earlier claim that Lineup/swap-select behaviour was
 * "unaffected, same untouched code path" was neither verified nor true: it
 * is exactly as true as `slotsFor` agrees with `lineupModel.js`'s
 * `eligibleSlots(entry, league)`, the function that still builds
 * `entries[].eligibleSlots` for every other consumer (the Ledger, the
 * Decision card, `slotActions.js`).
 *
 * This pins that agreement across the standard, superflex and IDP templates,
 * every canonical position (including every IDP group member code), and
 * every injury designation the feed can produce (null, Q, D, O, IR) - so a
 * future change to either implementation that drifts them apart fails here
 * rather than only showing up as a live Lineup bug.
 */
import { eligibleSlots } from './lineupModel';
import { slotsFor, DEFAULT_ROSTER_SLOTS } from './rosterTemplateModel';

const SUPERFLEX_TEMPLATE = [
  ...DEFAULT_ROSTER_SLOTS,
  { key: 'SFLX', label: 'SFLX', count: 1, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] },
];

const IDP_TEMPLATE = [
  ...DEFAULT_ROSTER_SLOTS,
  { key: 'DL', label: 'DL', count: 1, eligiblePositions: ['DL'] },
  { key: 'LB', label: 'LB', count: 1, eligiblePositions: ['LB'] },
  { key: 'DB', label: 'DB', count: 1, eligiblePositions: ['DB'] },
];

const TEMPLATES = {
  standard: DEFAULT_ROSTER_SLOTS,
  superflex: SUPERFLEX_TEMPLATE,
  idp: IDP_TEMPLATE,
};

// Every canonical position, including every IDP group's member codes.
const POSITIONS = [
  'QB', 'RB', 'WR', 'TE', 'K', 'DEF',
  'DL', 'DE', 'DT', 'NT',
  'LB', 'ILB', 'OLB',
  'DB', 'CB', 'S', 'FS', 'SS',
];

// The feed's four non-null injury_status codes, plus healthy (null).
const DESIGNATIONS = [null, 'Q', 'D', 'O', 'IR'];

describe.each(Object.entries(TEMPLATES))('%s template', (templateName, template) => {
  describe.each(POSITIONS)('position %s', (position) => {
    it.each(DESIGNATIONS)('agrees with lineupModel.eligibleSlots for injuryStatus %s', (injuryStatus) => {
      const entry = { position, injuryStatus };
      const expected = eligibleSlots(entry, { roster_slots: template });
      expect(slotsFor(template, entry)).toEqual(expected);
    });
  });
});
