import { gameCellView } from './gameCell';

const entry = (overrides = {}) => ({
  nflTeam: 'BUF',
  opponent: 'KC',
  kickoff: '2026-09-14T17:00:00Z',
  availability: { available: true, reason: null },
  ...overrides,
});

test('an unavailable entry reads its reason regardless of any live row', () => {
  const view = gameCellView(entry({ availability: { available: false, reason: 'out' } }), {
    game_status: 'in_progress',
  });
  expect(view).toEqual({ kind: 'unavailable', reason: 'out', reasonLabel: 'out' });
});

test('no live row (or a scheduled one) reads as pre-kickoff: opponent and formatted kickoff', () => {
  const view = gameCellView(entry(), null);
  expect(view.kind).toBe('pre');
  expect(view.opponent).toBe('KC');
  expect(view.kickoff).not.toBeNull();
});

test('a null opponent (a bye or unsynced slate) passes through as null, never a guessed label', () => {
  const view = gameCellView(entry({ opponent: null }), null);
  expect(view.opponent).toBeNull();
});

test('a live row in progress reads the quarter/clock trailing and both scores, keyed to the entry\'s own team', () => {
  const view = gameCellView(entry(), {
    game_status: 'in_progress',
    home_team: 'KC',
    away_team: 'BUF',
    current_score_home: 10,
    current_score_away: 17,
    quarter: 'Q3',
    time_remaining: '6:42',
  });
  expect(view).toEqual({ kind: 'live', trailing: 'Q3 6:42', teamScore: 17, opponentScore: 10 });
});

test('a live row with no clock/quarter yet reads "Live"', () => {
  const view = gameCellView(entry(), {
    game_status: 'in_progress',
    home_team: 'BUF',
    away_team: 'KC',
    current_score_home: 0,
    current_score_away: 0,
    quarter: null,
    time_remaining: null,
  });
  expect(view.trailing).toBe('Live');
});

test('a final row reads both scores with no trailing clock', () => {
  const view = gameCellView(entry(), {
    game_status: 'final',
    home_team: 'BUF',
    away_team: 'KC',
    current_score_home: 27,
    current_score_away: 20,
  });
  expect(view).toEqual({ kind: 'final', teamScore: 27, opponentScore: 20 });
});

test('a live/final row that names neither side as the entry\'s team scores null rather than guessing', () => {
  const view = gameCellView(entry(), {
    game_status: 'final',
    home_team: 'SF',
    away_team: 'LAR',
    current_score_home: 27,
    current_score_away: 20,
  });
  expect(view.teamScore).toBeNull();
  expect(view.opponentScore).toBeNull();
});

test('a null entry never throws', () => {
  expect(gameCellView(null, null)).toBeNull();
});
