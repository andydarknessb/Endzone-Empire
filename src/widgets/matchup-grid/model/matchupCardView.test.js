import { matchupFromListRow } from '../../../entities/matchup';
import { matchupCardView, formatKickoff, formatPoints, formatCount } from './matchupCardView';
import { lookupRecord, recordsFromStandings } from '../lib/records';

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

describe('formatKickoff', () => {
  test('reads "Sun 7:20 PM" for an instant in the given zone', () => {
    expect(formatKickoff('2026-09-14T00:20:00Z', { timeZone: 'America/Chicago', locale: 'en-US' })).toBe('Sun 7:20 PM');
    expect(formatKickoff('2026-09-14T00:20:00Z', { timeZone: 'UTC', locale: 'en-US' })).toBe('Mon 12:20 AM');
  });

  test('an absent or unparseable instant reads as null', () => {
    expect(formatKickoff(null)).toBeNull();
    expect(formatKickoff('')).toBeNull();
    expect(formatKickoff('not a date')).toBeNull();
  });
});

describe('figures', () => {
  test('points print to one decimal and a count as a whole number, a dash when unknown', () => {
    expect(formatPoints('92.1')).toBe('92.1');
    expect(formatPoints(118)).toBe('118.0');
    expect(formatPoints(0)).toBe('0.0');
    expect(formatPoints(null)).toBe('-');
    expect(formatCount(9)).toBe('9');
    expect(formatCount(null)).toBe('-');
  });
});

describe('matchupCardView', () => {
  test('live: scores as figures, the two percentages and the week', () => {
    const v = matchupCardView(model());
    expect(v.started).toBe(true);
    expect(v.scheduled).toBe(false);
    expect(v.chipLabel).toBe('LIVE');
    expect(v.chipVariant).toBe('live');
    expect(v.headerNote).toBe('Week 3');
    expect(v.homePct).toBe(49);
    expect(v.awayPct).toBe(51);
    expect(v.footer).toBe('Win probability 49% · 51%');
    expect(v.home.figure).toBe('92.1');
    expect(v.home.figureTier).toBe('ink');
    expect(v.home.note).toBe('EF 118.0 · PMR 2');
    expect(v.home.leads).toBe(true);
    expect(v.home.check).toBe(false);
    expect(v.away.leads).toBe(false);
  });

  test('scheduled: projected totals in the faint tier, the kickoff line, no share', () => {
    const v = matchupCardView(
      model({ status: 'scheduled', home_score: '0', away_score: '0', first_kickoff_at: '2026-09-14T00:20:00Z' }),
      { timeZone: 'America/Chicago', locale: 'en-US' }
    );
    expect(v.scheduled).toBe(true);
    expect(v.homeShare).toBeNull();
    expect(v.headerNote).toBe('Kicks off Sun 7:20 PM');
    expect(v.footer).toBe('Projected totals shown until kickoff');
    expect(v.home.figure).toBe('118.0');
    expect(v.home.figureTier).toBe('faint');
    expect(v.home.rowFigure).toBe('');
    expect(v.home.rowNote).toBe('Proj 118.0');
    expect(v.home.leads).toBe(false);
  });

  test('played and final: the leader is checked and the note keeps only the record', () => {
    const played = matchupCardView(
      model({ status: 'played', home_expected_final: null, away_expected_final: null }),
      { records: { 1: '2-0', 2: '1-1' } }
    );
    expect(played.footer).toBe('Waiting on the score of record');
    expect(played.home.check).toBe(true);
    expect(played.away.check).toBe(false);
    expect(played.home.note).toBe('2-0');
    expect(played.home.rowNote).toBe('2-0');
    expect(played.chipLabel).toBe('Awaiting final');

    const final = matchupCardView(model({ status: 'final', home_score: '80', away_score: '90' }));
    expect(final.footer).toBe('Score of record');
    expect(final.away.check).toBe(true);
    expect(final.home.check).toBe(false);
    expect(final.home.note).toBe('');
  });

  test('an unknown status asserts neither started nor scheduled', () => {
    const v = matchupCardView(model({ status: null }));
    expect(v.started).toBe(false);
    expect(v.scheduled).toBe(false);
    expect(v.chipLabel).toBeNull();
    expect(v.homeShare).toBeNull();
    expect(v.footer).toBe('');
    expect(v.headerNote).toBe('Week 3');
    expect(v.home.figure).toBe('92.1');
    expect(v.home.leads).toBe(false);
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

  test('recordsFromStandings prints ties only when one has happened', () => {
    const map = recordsFromStandings([
      { teamId: 1, wins: 3, losses: 1, ties: 0 },
      { teamId: 2, wins: '1', losses: '2', ties: '1' },
      { teamId: null, wins: 9, losses: 9 },
      null,
    ]);
    expect(map.get(1)).toBe('3-1');
    expect(map.get(2)).toBe('1-2-1');
    expect(map.size).toBe(2);
    expect(recordsFromStandings(undefined).size).toBe(0);
  });
});
