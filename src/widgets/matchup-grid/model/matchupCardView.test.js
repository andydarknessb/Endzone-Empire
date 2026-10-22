import { matchupFromListRow } from '../../../entities/matchup';
import { matchupCardView, formatCount } from './matchupCardView';
import { lookupRecord } from '../lib/records';

function model(overrides = {}) {
  return matchupFromListRow({
    id: 9,
    week: 3,
    status: 'live',
    first_kickoff_at: null,
    home_team_id: 1,
    home_team_name: 'Home',
    home_score: '92.1',
    home_expected_final: 118,
    home_players_remaining: 2,
    away_team_id: 2,
    away_team_name: 'Away',
    away_score: '88.7',
    away_expected_final: 119.4,
    away_players_remaining: 3,
    ...overrides,
  });
}

// formatKickoff and formatPoints are shared/lib's contracts now (src/shared/
// lib/kickoff(.test).js and numeric(.test).js, #1120, ADR 0031); this view
// model only consumes them, so their own unit tests live there.

describe('figures', () => {
  test('a count prints as a whole number, a dash when unknown', () => {
    expect(formatCount(9)).toBe('9');
    expect(formatCount(null)).toBe('-');
    // Empty string and undefined should render as unknown, not zero
    expect(formatCount('')).toBe('-');
    expect(formatCount(undefined)).toBe('-');
    expect(formatCount(NaN)).toBe('-');
    // Numeric zero and string numbers should render as their values
    expect(formatCount(0)).toBe('0');
    expect(formatCount('4')).toBe('4');
  });
});

describe('matchupCardView', () => {
  test('live: scores as figures, the two percentages, Exp final and players remaining on their own lines', () => {
    const v = matchupCardView(model());
    expect(v.state).toBe('live');
    expect(v.started).toBe(true);
    expect(v.scheduled).toBe(false);
    expect(v.firstPct).toBe(49);
    expect(v.secondPct).toBe(51);
    expect(v.favourite).toBe("second");
    expect(v.first.figure).toBe('92.1');
    expect(v.first.expectedLine).toBe('Exp final 118.0');
    expect(v.first.remainingLine).toBe('2 players remaining');
    expect(v.second.remainingLine).toBe('3 players remaining');
    expect(v.first.leads).toBe(true);
    expect(v.second.leads).toBe(false);
    expect(v.first.winner).toBe(false);
  });

  test('scheduled: Proj figures from the Expected final, starters set to play, the projections-only share, the kickoff', () => {
    const v = matchupCardView(
      model({ status: 'scheduled', home_score: '0', away_score: '0', first_kickoff_at: '2026-09-14T00:20:00Z', home_players_remaining: 1 }),
      { timeZone: 'America/Chicago', locale: 'en-US' }
    );
    expect(v.state).toBe('scheduled');
    expect(v.scheduled).toBe(true);
    expect(v.kickoff).toBe('Sun 7:20 PM');
    expect(v.first.figure).toBe('118.0');
    expect(v.first.expectedLine).toBe('');
    expect(v.first.remainingLine).toBe('1 starter set to play');
    expect(v.second.remainingLine).toBe('3 starters set to play');
    expect(v.firstPct).not.toBeNull();
    expect(v.first.leads).toBe(false);
  });

  test.each([
    ['both null', { home_expected_final: null, away_expected_final: null }],
    ['home null', { home_expected_final: null }],
    ['away null', { away_expected_final: null }],
  ])('live with %s Expected final: no probability, so no bar', (_name, overrides) => {
    const v = matchupCardView(model(overrides));
    expect(v.state).toBe('live');
    expect(v.firstShare).toBeNull();
    expect(v.firstPct).toBeNull();
    expect(v.favourite).toBeNull();
  });

  test('scheduled with one Expected final null: no probability, and the figure shows the dash', () => {
    const v = matchupCardView(model({ status: 'scheduled', away_expected_final: null }));
    expect(v.firstPct).toBeNull();
    expect(v.second.figure).toBe('-');
  });

  test('played: awaiting final with no probability and no forecast lines', () => {
    const v = matchupCardView(
      model({ status: 'played', home_expected_final: null, away_expected_final: null }),
      { records: { 1: '2-0', 2: '1-1' } }
    );
    expect(v.state).toBe('played');
    expect(v.firstShare).toBeNull();
    expect(v.first.record).toBe('2-0');
    expect(v.first.expectedLine).toBe('');
    expect(v.first.remainingLine).toBe('');
    expect(v.chipLabel).toBe('Awaiting final');
    expect(v.first.winner).toBe(false);
  });

  test('final: the winner in ink, no bar', () => {
    const v = matchupCardView(model({ status: 'final', home_score: '80', away_score: '90' }));
    expect(v.state).toBe('final');
    expect(v.chipLabel).toBe('Final');
    expect(v.firstPct).toBeNull();
    expect(v.second.winner).toBe(true);
    expect(v.first.winner).toBe(false);
  });

  test('an unknown status asserts neither started nor scheduled and draws no bar', () => {
    const v = matchupCardView(model({ status: null }));
    expect(v.state).toBe('unknown');
    expect(v.started).toBe(false);
    expect(v.scheduled).toBe(false);
    expect(v.chipLabel).toBeNull();
    expect(v.firstShare).toBeNull();
    expect(v.first.figure).toBe('92.1');
    expect(v.first.leads).toBe(false);
    expect(v.first.remainingLine).toBe('');
  });
});

describe('records', () => {
  test('lookupRecord reads a function, a Map or a plain object, and misses as null', () => {
    expect(lookupRecord((id) => (id === 1 ? '2-0' : null), 1)).toBe('2-0');
    expect(lookupRecord((id) => (id === 1 ? '2-0' : null), 2)).toBeNull();
    expect(lookupRecord(new Map([[1, '2-0']]), 1)).toBe('2-0');
    expect(lookupRecord(new Map([['1', '2-0']]), 1)).toBe('2-0');
    expect(lookupRecord({ 1: '2-0' }, 1)).toBe('2-0');
    expect(lookupRecord({ 1: '' }, 1)).toBeNull();
    expect(lookupRecord(null, 1)).toBeNull();
    expect(lookupRecord({ 1: '2-0' }, null)).toBeNull();
  });

  // The record-FORMAT case that stood here (ties printed only once one has
  // happened, a missing count read as zero, an id-less row skipped) is gone
  // with the builder itself: src/entities/standings owns `recordsByTeamId` and
  // asserts those cases with no render (#959), and the deletion is behind its
  // own red-tell in this PR - dropping the entity's id-less-row guard turns
  // the entity's lookup case red. This widget only READS a lookup, which is
  // what the case above pins.
});
