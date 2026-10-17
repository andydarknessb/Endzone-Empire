import { nextLineupSlot } from './lineupNote';

const NOW = new Date('2026-10-18T14:40:00Z').getTime();
const EARLY = '2026-10-18T17:00:00Z';
const LATE = '2026-10-18T20:25:00Z';
const entry = (over = {}) => ({
  playerId: 1, name: 'P. Nacua', nflTeam: 'LAR', injuryStatus: null, kickoff: EARLY, availability: { available: true, reason: null }, ...over,
});
const out = (over = {}) => entry({ injuryStatus: 'O', availability: { available: false, reason: 'out' }, ...over });
const slots = (...players) => players.map((player, i) => ({ slot: ['QB', 'WR 1', 'WR 2', 'FLEX'][i], player }));
const games = [
  { away_team: 'LAR', home_team: 'JAX', game_status: 'scheduled', kickoff_at: EARLY },
  { away_team: 'DEN', home_team: 'DAL', game_status: 'scheduled', kickoff_at: LATE },
];

describe('nextLineupSlot', () => {
  test('is the Out starter whose game locks first', () => {
    const list = slots(entry({ playerId: 9, nflTeam: 'DEN' }), out({ playerId: 2, nflTeam: 'DEN', kickoff: LATE }), out({ playerId: 3, nflTeam: 'LAR' }));
    expect(nextLineupSlot(list, games, NOW)).toEqual({ slot: 'WR 2', kind: 'out', lockAt: new Date(EARLY).getTime() });
  });

  test('is an empty slot, which locks at the next kickoff', () => {
    expect(nextLineupSlot(slots(entry(), null), games, NOW)).toEqual({ slot: 'WR 1', kind: 'empty', lockAt: new Date(EARLY).getTime() });
  });

  test('takes the issue that locks first when an empty slot and an Out starter both need the viewer', () => {
    const onlyLate = [games[1]];
    const list = slots(entry({ nflTeam: 'DEN' }), null, out({ nflTeam: 'DEN', kickoff: LATE }));
    const pick = nextLineupSlot(list, onlyLate, NOW);
    expect(pick.slot).toBe('WR 1');
  });

  test('is none when the lineup is set', () => {
    expect(nextLineupSlot(slots(entry(), entry({ playerId: 2 })), games, NOW)).toBeNull();
  });

  test('skips a locked slot: an Out starter whose game has started is nobody to act on', () => {
    const live = [{ ...games[0], game_status: 'in_progress' }, games[1]];
    expect(nextLineupSlot(slots(out({ nflTeam: 'LAR' })), live, NOW)).toBeNull();
    expect(nextLineupSlot(slots(out({ nflTeam: 'LAR' }), out({ playerId: 4, nflTeam: 'DEN', kickoff: LATE })), live, NOW).slot).toBe('WR 1');
  });

  test('an empty slot with every game started has no lock left to beat, so none', () => {
    const done = games.map((g) => ({ ...g, game_status: 'final' }));
    expect(nextLineupSlot(slots(entry(), null), done, NOW)).toBeNull();
  });

  test('an empty slot with no game rows read yet is still the one that needs the viewer', () => {
    expect(nextLineupSlot(slots(entry(), null), [], NOW)).toEqual({ slot: 'WR 1', kind: 'empty', lockAt: null });
  });

  test('a lock already past is not one anyone can beat', () => {
    expect(nextLineupSlot(slots(out({ nflTeam: 'LAR' })), games, new Date(EARLY).getTime() + 1)).toBeNull();
  });
});
