import {
  LEAGUE_TEMPLATES, DEFAULT_ROSTER_SLOTS, SIM_BENCH_SLOTS, IDP_POSITIONS,
  templateFor, roundsForTemplate, starterCount, draftablePositions,
} from './templates';

// Slot-eligibility itself (POSITION_GROUPS/expandEligibility/accepts) is no
// longer implemented or exported here (#1501: the Draft Simulator's own copy,
// the one that omitted IR, is deleted). That coverage lives on the Roster
// template entity's own test, src/entities/roster/model/rosterTemplateModel.test.js;
// this file only covers what still lives here - the league shapes and the
// derived IDP_POSITIONS/draftablePositions helpers.
describe('IDP_POSITIONS (derived from the entity, not a re-declared group table)', () => {
  it('is every DL/LB/DB member code', () => {
    expect([...IDP_POSITIONS].sort()).toEqual(
      ['CB', 'DB', 'DE', 'DL', 'DT', 'FS', 'ILB', 'LB', 'NT', 'OLB', 'S', 'SS'].sort()
    );
  });
});

describe('league templates (mirror of CommissionerTools LINEUP_TEMPLATES)', () => {
  it('exposes standard, superflex and idp', () => {
    expect(LEAGUE_TEMPLATES.map((t) => t.id)).toEqual(['standard', 'superflex', 'idp']);
  });

  it('starts Standard from the server default slot shape', () => {
    expect(templateFor('standard').slots).toEqual(DEFAULT_ROSTER_SLOTS);
  });

  it('adds exactly SFLX to Standard for superflex', () => {
    const superflex = templateFor('superflex');
    expect(superflex.slots.map((s) => s.key)).toEqual([
      'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'SFLX',
    ]);
    expect(superflex.slots.find((s) => s.key === 'SFLX').eligiblePositions).toContain('QB');
  });

  it('adds DL/LB/DB to Standard for IDP', () => {
    expect(templateFor('idp').slots.map((s) => s.key)).toEqual([
      'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'DL', 'LB', 'DB',
    ]);
  });

  it('falls back to Standard for an unknown or missing type', () => {
    expect(templateFor('dynasty-superflex-idp').id).toBe('standard');
    expect(templateFor(undefined).id).toBe('standard');
  });

  it('runs starters + 6 bench rounds: 15 / 16 / 18', () => {
    expect(SIM_BENCH_SLOTS).toBe(6);
    expect(starterCount(templateFor('standard'))).toBe(9);
    expect(roundsForTemplate(templateFor('standard'))).toBe(15);
    expect(roundsForTemplate(templateFor('superflex'))).toBe(16);
    expect(roundsForTemplate(templateFor('idp'))).toBe(18);
  });

  it('only calls individual defenders draftable in the IDP template', () => {
    expect(draftablePositions(templateFor('standard')).has('LB')).toBe(false);
    expect(draftablePositions(templateFor('idp')).has('LB')).toBe(true);
    expect(draftablePositions(templateFor('idp')).has('CB')).toBe(true);
  });
});
