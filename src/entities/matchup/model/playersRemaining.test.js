import { playersRemaining, yetToPlay } from './playersRemaining';

// live_game_states rows, as useLiveGameStates hands them down.
const games = [
  { tank01_game_id: 'g1', away_team: 'PIT', home_team: 'CLE', game_status: 'final' },
  { tank01_game_id: 'g2', away_team: 'JAX', home_team: 'LAR', game_status: 'in_progress' },
  { tank01_game_id: 'g3', away_team: 'SF', home_team: 'ARI', game_status: 'scheduled' },
];
const p = (nflTeam, over = {}) => ({ playerId: nflTeam, nflTeam, injuryStatus: null, ...over });

const OUT = { available: false, reason: 'out' };
const OK = { available: true, reason: null };

// Spec #2334 AC 6l, ADR 0061: one definition of "players remaining". A starter counts when his NFL game is not final
// and his availability verdict (which the wire carries) is not unavailable: Out, IR, suspension and practice squad
// all drop out, and so does an empty slot.
describe('playersRemaining', () => {
  test('counts the live and not-started starters, not the final one, the unavailable one or the empty slot', () => {
    const starters = [
      p('PIT'), // game final
      p('JAX'), // game live
      p('SF'), // not started
      p('LAR', { availability: OUT }), // live game, but unavailable
      null, // empty slot
    ];
    expect(playersRemaining(starters, games)).toBe(2);
  });

  test.each(['out', 'ir', 'suspended', 'practice_squad', 'bye', 'no_team'])('an unavailable starter (%s) does not count, even with no injury status', (reason) => {
    expect(playersRemaining([p('SF', { injuryStatus: null, availability: { available: false, reason } })], games)).toBe(0);
  });

  test('an available starter counts whatever his injury designation says', () => {
    const starters = [
      p('SF', { injuryStatus: 'Questionable', availability: OK }),
      p('ARI', { injuryStatus: 'Doubtful', availability: OK }),
      p('JAX', { injuryStatus: 'O', availability: OK }), // the verdict, not the raw status, decides
    ];
    expect(playersRemaining(starters, games)).toBe(3);
  });

  test('reads the wire shape the detail starters arrive in as well as the normalised one', () => {
    const starters = [
      { id: 1, nfl_team: 'JAX', injury_status: null, availability: OK },
      { id: 2, nfl_team: 'LAR', injury_status: 'O', availability: { available: false, reason: 'out' } },
      { id: 3, nfl_team: 'PIT', injury_status: null, availability: OK },
    ];
    expect(playersRemaining(starters, games)).toBe(1);
  });

  test('a starter the wire gave no verdict for is not ruled out', () => {
    expect(playersRemaining([p('SF', { availability: null }), p('JAX')], games)).toBe(2);
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
    const starters = [p('PIT'), p('JAX'), p('SF'), p('ARI'), p('SF', { availability: OUT }), null];
    expect(playersRemaining(starters, games)).toBe(3);
    expect(yetToPlay(starters, games)).toBe(2);
  });

  test('a suspended starter in a game not started is neither remaining nor yet to play', () => {
    const starters = [p('SF', { injuryStatus: null, availability: { available: false, reason: 'suspended' } })];
    expect(playersRemaining(starters, games)).toBe(0);
    expect(yetToPlay(starters, games)).toBe(0);
  });

  test('a starter with no row falls back to his own state, and an unknown one is not claimed as not started', () => {
    expect(yetToPlay([p('DAL', { gameState: 'scheduled' }), p('MIA', { gameState: 'in_progress' }), p('NYG')], games)).toBe(1);
  });

  test('is never more than players remaining', () => {
    const starters = [p('SF'), p('JAX'), p('DAL')];
    expect(yetToPlay(starters, games)).toBeLessThanOrEqual(playersRemaining(starters, games));
  });
});
