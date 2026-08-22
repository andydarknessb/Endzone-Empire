import {
  LEAGUE_TEMPLATES, POSITION_GROUPS, DEFAULT_ROSTER_SLOTS, SIM_BENCH_SLOTS,
  slotEligible, expandEligibility, templateFor, roundsForTemplate, starterCount,
  draftablePositions,
} from './templates';

describe('slot eligibility (mirror of lineup.service.js)', () => {
  it('expands DL/LB/DB group keys to every member position', () => {
    expect([...expandEligibility(['DL'])].sort()).toEqual(['DE', 'DL', 'DT', 'NT']);
    expect([...expandEligibility(['RB', 'WR', 'TE'])].sort()).toEqual(['RB', 'TE', 'WR']);
  });

  it('matches the server rule set on the default slots', () => {
    expect(slotEligible('QB', 'QB')).toBe(true);
    expect(slotEligible('QB', 'RB')).toBe(false);
    expect(slotEligible('FLEX', 'RB')).toBe(true);
    expect(slotEligible('FLEX', 'QB')).toBe(false);
    expect(slotEligible('BENCH', 'K')).toBe(true);
    expect(slotEligible('NOPE', 'RB')).toBe(false);
  });

  it('lets a specific defensive code start in its group slot', () => {
    const idp = templateFor('idp');
    expect(slotEligible('DL', 'DE', idp.slots)).toBe(true);
    expect(slotEligible('DB', 'CB', idp.slots)).toBe(true);
    expect(slotEligible('LB', 'CB', idp.slots)).toBe(false);
  });

  it('keeps POSITION_GROUPS identical to the server groups', () => {
    expect(POSITION_GROUPS).toEqual({
      DL: ['DL', 'DE', 'DT', 'NT'],
      LB: ['LB', 'ILB', 'OLB'],
      DB: ['DB', 'CB', 'S', 'FS', 'SS'],
    });
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
    expect(slotEligible('SFLX', 'QB', superflex.slots)).toBe(true);
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
