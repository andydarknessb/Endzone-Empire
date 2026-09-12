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
  expect(view).toEqual({
    kind: 'live', trailing: 'Q3 6:42', teamScore: 17, opponentScore: 10,
    possession: null, downDistance: null, redZone: false, lastPlay: null,
  });
});

// AC1 (#1241, ADR 0037 ticket 9): Situation rides the same live_game_states
// row (ADR 0037's `possession`/`down_distance`/`is_red_zone`/`last_play`
// columns) already read for the clock and score. `possession` arrives
// already folded to a Team code (server/modules/espnScoreboard.js's own
// normalisation, the same one applied to home_team/away_team - confirmed:
// no client-side mapping needed, AC4), so this passes it through exactly as
// home_team/away_team already are - never re-derived here.
test('a live row carries the Situation fields verbatim: possession, down/distance, red zone, last play', () => {
  const view = gameCellView(entry(), {
    game_status: 'in_progress',
    home_team: 'KC',
    away_team: 'BUF',
    current_score_home: 10,
    current_score_away: 17,
    quarter: 'Q3',
    time_remaining: '6:42',
    possession: 'BUF',
    down_distance: '2nd & 7',
    is_red_zone: true,
    last_play: 'Allen pass complete to Diggs for 12 yards',
  });
  expect(view.possession).toBe('BUF');
  expect(view.downDistance).toBe('2nd & 7');
  expect(view.redZone).toBe(true);
  expect(view.lastPlay).toBe('Allen pass complete to Diggs for 12 yards');
});

// A missing/null Situation column (the poll landed before ESPN's own
// situation object did, or a legacy row) passes through as null - never a
// guessed value - and the red zone flag coerces to a real boolean rather
// than an absent/undefined column reading as truthy.
test('a live row with no Situation data yet reads every field as null/false, never guessed', () => {
  const view = gameCellView(entry(), {
    game_status: 'in_progress',
    home_team: 'KC',
    away_team: 'BUF',
    current_score_home: 0,
    current_score_away: 0,
    quarter: null,
    time_remaining: null,
  });
  expect(view.possession).toBeNull();
  expect(view.downDistance).toBeNull();
  expect(view.redZone).toBe(false);
  expect(view.lastPlay).toBeNull();
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
