import { playersRemaining, yetToPlay } from './playersRemaining';

// live_game_states rows, as useLiveGameStates hands them down.
const games = [
  { tank01_game_id: 'g1', away_team: 'PIT', home_team: 'CLE', game_status: 'final' },
  { tank01_game_id: 'g2', away_team: 'JAX', home_team: 'LAR', game_status: 'in_progress' },
  { tank01_game_id: 'g3', away_team: 'SF', home_team: 'ARI', game_status: 'scheduled' },
];
const p = (nflTeam, over = {}) => ({ playerId: nflTeam, nflTeam, injuryStatus: null, ...over });

// Spec #2334 AC 6l: one definition of "players remaining", everywhere it prints.
describe('playersRemaining', () => {
  test('counts the live and not-started starters, not the final one, the Out one or the empty slot', () => {
    const starters = [
      p('PIT'), // game final
      p('JAX'), // game live
      p('SF'), // not started
      p('LAR', { injuryStatus: 'Out' }), // live game, but Out
      null, // empty slot
    ];
    expect(playersRemaining(starters, games)).toBe(2);
  });

  test('an Out starter in a game not yet started still does not count, whatever the case of his status', () => {
    expect(playersRemaining([p('SF', { injuryStatus: 'OUT' }), p('ARI', { injuryStatus: 'out' })], games)).toBe(0);
  });

  test('the wire designation code O is Out too', () => {
    expect(playersRemaining([p('SF', { injuryStatus: 'O' }), { id: 9, nfl_team: 'ARI', injury_status: 'O' }, p('JAX')], games)).toBe(1);
  });

  test('other injury designations (Questionable, Doubtful) still count', () => {
    expect(playersRemaining([p('SF', { injuryStatus: 'Questionable' }), p('ARI', { injuryStatus: 'Doubtful' })], games)).toBe(2);
  });

  test('a starter on bye or without a team does not count', () => {
    const starters = [p('BAL', { availability: { available: false, reason: 'bye' } }), p('FA', { availability: { available: false, reason: 'no_team' } })];
    expect(playersRemaining(starters, games)).toBe(0);
  });

  test('reads the wire shape the detail starters arrive in as well as the normalised one', () => {
    const starters = [
      { id: 1, nfl_team: 'JAX', injury_status: null },
      { id: 2, nfl_team: 'LAR', injury_status: 'Out' },
      { id: 3, nfl_team: 'PIT', injury_status: null },
    ];
    expect(playersRemaining(starters, games)).toBe(1);
  });

  test('with no live row for his team a starter falls back to his own game state', () => {
    const starters = [p('DAL', { gameState: 'final' }), p('MIA', { gameState: 'in_progress' }), p('NYG', { gameState: 'scheduled' })];
    expect(playersRemaining(starters, games)).toBe(2);
  });

  test('a live row wins over the starter\'s own, staler, game state', () => {
    expect(playersRemaining([p('PIT', { gameState: 'in_progress' })], games)).toBe(0);
  });

  test('with no row and no state a starter is not final, so he counts', () => {
    expect(playersRemaining([p('DAL')], games)).toBe(1);
    expect(playersRemaining([p('DAL')], undefined)).toBe(1);
  });

  test('no starters is zero', () => {
    expect(playersRemaining([], games)).toBe(0);
    expect(playersRemaining(undefined, games)).toBe(0);
    expect(playersRemaining([null, null], games)).toBe(0);
  });

  test('the same count for the same starters wherever it prints', () => {
    const starters = [p('JAX'), p('SF'), p('PIT')];
    expect(playersRemaining(starters, games)).toBe(playersRemaining([...starters], [...games].reverse()));
  });
});

describe('yetToPlay', () => {
  test('counts only the remaining starters whose game has not started', () => {
    const starters = [p('PIT'), p('JAX'), p('SF'), p('ARI'), p('SF', { injuryStatus: 'Out' }), null];
    expect(playersRemaining(starters, games)).toBe(3);
    expect(yetToPlay(starters, games)).toBe(2);
  });

  test('a starter with no row falls back to his own state, and an unknown one is not claimed as not started', () => {
    expect(yetToPlay([p('DAL', { gameState: 'scheduled' }), p('MIA', { gameState: 'in_progress' }), p('NYG')], games)).toBe(1);
  });

  test('is never more than players remaining', () => {
    const starters = [p('SF'), p('JAX'), p('DAL')];
    expect(yetToPlay(starters, games)).toBeLessThanOrEqual(playersRemaining(starters, games));
  });
});
