import {
  parseRosterTemplate,
  accepts,
  slotsFor,
  rosterablePositions,
  DEFAULT_ROSTER_SLOTS,
  expandEligibility,
  POSITION_GROUPS,
} from './rosterTemplateModel';

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

const EMPTY_TEMPLATE = [];

describe('parseRosterTemplate', () => {
  it('passes an array through unchanged', () => {
    expect(parseRosterTemplate(DEFAULT_ROSTER_SLOTS)).toBe(DEFAULT_ROSTER_SLOTS);
  });

  it('parses a JSON string of slots', () => {
    expect(parseRosterTemplate(JSON.stringify(DEFAULT_ROSTER_SLOTS))).toEqual(DEFAULT_ROSTER_SLOTS);
  });

  it.each([null, undefined, 'not json', '{"not":"an array"}', {}, 42])(
    'reads %p as an empty template, never throws',
    (raw) => {
      expect(parseRosterTemplate(raw)).toEqual([]);
    }
  );
});

describe('accepts', () => {
  it.each([
    ['default', DEFAULT_ROSTER_SLOTS, 'QB', 'QB', true],
    ['default', DEFAULT_ROSTER_SLOTS, 'RB', 'RB', true],
    ['default', DEFAULT_ROSTER_SLOTS, 'RB', 'WR', false],
    ['default', DEFAULT_ROSTER_SLOTS, 'FLEX', 'RB', true],
    ['default', DEFAULT_ROSTER_SLOTS, 'FLEX', 'WR', true],
    ['default', DEFAULT_ROSTER_SLOTS, 'FLEX', 'TE', true],
    ['default', DEFAULT_ROSTER_SLOTS, 'FLEX', 'QB', false],
    ['default', DEFAULT_ROSTER_SLOTS, 'QB', 'RB', false],
    ['superflex', SUPERFLEX_TEMPLATE, 'SFLX', 'QB', true],
    ['superflex', SUPERFLEX_TEMPLATE, 'SFLX', 'RB', true],
    ['superflex', SUPERFLEX_TEMPLATE, 'SFLX', 'DEF', false],
    // Group-key expansion: a slot whose eligiblePositions names the group key
    // (DL/LB/DB) accepts every member code, not just the literal group key.
    ['idp', IDP_TEMPLATE, 'DL', 'DE', true],
    ['idp', IDP_TEMPLATE, 'DL', 'DT', true],
    ['idp', IDP_TEMPLATE, 'DL', 'NT', true],
    ['idp', IDP_TEMPLATE, 'DL', 'DL', true],
    ['idp', IDP_TEMPLATE, 'LB', 'ILB', true],
    ['idp', IDP_TEMPLATE, 'LB', 'OLB', true],
    ['idp', IDP_TEMPLATE, 'DB', 'CB', true],
    ['idp', IDP_TEMPLATE, 'DB', 'S', true],
    ['idp', IDP_TEMPLATE, 'DB', 'FS', true],
    ['idp', IDP_TEMPLATE, 'DB', 'SS', true],
    ['idp', IDP_TEMPLATE, 'DL', 'LB', false],
    // BENCH and IR always accept, whatever the template and position.
    ['default', DEFAULT_ROSTER_SLOTS, 'BENCH', 'QB', true],
    ['default', DEFAULT_ROSTER_SLOTS, 'BENCH', 'DL', true],
    ['default', DEFAULT_ROSTER_SLOTS, 'IR', 'QB', true],
    ['empty', EMPTY_TEMPLATE, 'BENCH', 'QB', true],
    ['empty', EMPTY_TEMPLATE, 'IR', 'QB', true],
    // Empty template: no starting slot exists to accept anything.
    ['empty', EMPTY_TEMPLATE, 'QB', 'QB', false],
    ['empty', EMPTY_TEMPLATE, 'FLEX', 'RB', false],
    // A slot the template does not carry at all never accepts anything.
    ['default', DEFAULT_ROSTER_SLOTS, 'SFLX', 'QB', false],
  ])('%s template: accepts(template, %s, %s) === %s', (_label, template, slotKey, position, expected) => {
    expect(accepts(template, slotKey, position)).toBe(expected);
  });

  // Green for the wrong reason: a naive implementation might special-case
  // FLEX to always mean RB/WR/TE regardless of what the template actually
  // configures. A template whose FLEX slot accepts only RB must refuse a WR.
  it('refuses a WR at FLEX when the template configures FLEX for RB only', () => {
    const narrowedTemplate = DEFAULT_ROSTER_SLOTS.map((slot) =>
      slot.key === 'FLEX' ? { ...slot, eligiblePositions: ['RB'] } : slot
    );
    expect(accepts(narrowedTemplate, 'FLEX', 'RB')).toBe(true);
    expect(accepts(narrowedTemplate, 'FLEX', 'WR')).toBe(false);
  });
});

describe('slotsFor', () => {
  it('includes BENCH and every default starting slot a QB fits, never TE/RB/WR-only slots', () => {
    const qb = { position: 'QB', injuryStatus: null };
    expect(slotsFor(DEFAULT_ROSTER_SLOTS, qb)).toEqual(['BENCH', 'QB']);
  });

  it('includes FLEX alongside its own slot for a flex-eligible position', () => {
    const rb = { position: 'RB', injuryStatus: null };
    expect(slotsFor(DEFAULT_ROSTER_SLOTS, rb)).toEqual(['BENCH', 'RB', 'FLEX']);
  });

  it.each(['O', 'IR'])('includes IR for an IR-eligible designation (%s)', (designation) => {
    const rb = { position: 'RB', injuryStatus: designation };
    expect(slotsFor(DEFAULT_ROSTER_SLOTS, rb)).toEqual(['BENCH', 'IR', 'RB', 'FLEX']);
  });

  it.each(['Q', 'D', null])('never includes IR for a non-IR-eligible designation (%s)', (designation) => {
    const rb = { position: 'RB', injuryStatus: designation };
    expect(slotsFor(DEFAULT_ROSTER_SLOTS, rb)).toEqual(['BENCH', 'RB', 'FLEX']);
  });

  it('expands a group-key slot for an IDP template', () => {
    const de = { position: 'DE', injuryStatus: null };
    expect(slotsFor(IDP_TEMPLATE, de)).toEqual(['BENCH', 'DL']);
  });

  it('is BENCH-only for an empty template', () => {
    const qb = { position: 'QB', injuryStatus: null };
    expect(slotsFor(EMPTY_TEMPLATE, qb)).toEqual(['BENCH']);
  });

  it('is BENCH-only for a null/undefined entry, never throws', () => {
    expect(slotsFor(DEFAULT_ROSTER_SLOTS, null)).toEqual(['BENCH']);
    expect(slotsFor(DEFAULT_ROSTER_SLOTS, undefined)).toEqual(['BENCH']);
  });
});

// #1501: this table and expand-group loop moved here from the Draft
// Simulator's own hand-mirrored copy (src/lib/draftSim/templates.js), which
// now imports both from here rather than declaring its own (along with
// analysis.js, cpuBrain.js, engine.js, src/lib/rosterAssignment.js and
// shared/lib/positionChips.js) - this coverage moved with the implementation.
describe('expandEligibility / POSITION_GROUPS (mirror of lineup.service.js)', () => {
  it('expands DL/LB/DB group keys to every member position', () => {
    expect([...expandEligibility(['DL'])].sort()).toEqual(['DE', 'DL', 'DT', 'NT']);
    expect([...expandEligibility(['RB', 'WR', 'TE'])].sort()).toEqual(['RB', 'TE', 'WR']);
  });

  it('keeps POSITION_GROUPS identical to the server groups', () => {
    expect(POSITION_GROUPS).toEqual({
      DL: ['DL', 'DE', 'DT', 'NT'],
      LB: ['LB', 'ILB', 'OLB'],
      DB: ['DB', 'CB', 'S', 'FS', 'SS'],
    });
  });
});

describe('rosterablePositions', () => {
  it('is the default template\'s starting positions, FLEX expanded, no BENCH/IR', () => {
    expect(rosterablePositions(DEFAULT_ROSTER_SLOTS)).toEqual(new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']));
  });

  it('adds every superflex position on top of the default set', () => {
    expect(rosterablePositions(SUPERFLEX_TEMPLATE)).toEqual(new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']));
  });

  it('expands DL/LB/DB group keys to their member codes for an IDP template', () => {
    expect(rosterablePositions(IDP_TEMPLATE)).toEqual(
      new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'FS', 'SS'])
    );
  });

  it('is empty for an empty template', () => {
    expect(rosterablePositions(EMPTY_TEMPLATE)).toEqual(new Set());
  });
});
