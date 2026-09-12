import { gameModel, gamePhase } from './gameModel';

const game = (overrides = {}) => ({
  gameKey: 'DAL|WAS',
  homeTeam: 'DAL',
  awayTeam: 'WAS',
  kickoffAt: '2026-09-13T17:00:00.000Z',
  locked: false,
  status: 'scheduled',
  winner: null,
  isTie: false,
  ...overrides,
});

describe('gamePhase', () => {
  test('open: not yet locked', () => {
    expect(gamePhase(game({ locked: false }))).toBe('open');
  });

  test('live: locked, no winner, no tie, and the status is not final', () => {
    expect(gamePhase(game({ locked: true, status: 'in_progress' }))).toBe('live');
  });

  test('final: locked with a winner', () => {
    expect(gamePhase(game({ locked: true, status: 'in_progress', winner: 'DAL' }))).toBe('final');
  });

  test('final: locked and tied', () => {
    expect(gamePhase(game({ locked: true, status: 'in_progress', isTie: true }))).toBe('final');
  });

  test('final: locked with a final status even with no winner recorded yet', () => {
    expect(gamePhase(game({ locked: true, status: 'final' }))).toBe('final');
  });
});

describe('gameModel', () => {
  test('teams read in away@home order, the opposite of the gameKey spelling', () => {
    const model = gameModel(game(), []);
    expect(model.teams).toEqual(['WAS', 'DAL']);
  });

  test('carries gameKey, kickoff and lock straight from the wire row', () => {
    const model = gameModel(game({ locked: true }), []);
    expect(model.gameKey).toBe('DAL|WAS');
    expect(model.kickoff).toBe('2026-09-13T17:00:00.000Z');
    expect(model.lock).toBe(true);
  });

  test('finds the viewer\'s own pick and confidence by gameKey', () => {
    const myPicks = [
      { gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 7 },
      { gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 3 },
    ];
    const model = gameModel(game(), myPicks);
    expect(model.myPick).toBe('DAL');
    expect(model.confidence).toBe(7);
  });

  test('no pick yet reads as null for both fields', () => {
    const model = gameModel(game(), []);
    expect(model.myPick).toBeNull();
    expect(model.confidence).toBeNull();
  });

  test('a straight-mode pick with no confidence value reads confidence as null', () => {
    const model = gameModel(game(), [{ gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: null }]);
    expect(model.myPick).toBe('DAL');
    expect(model.confidence).toBeNull();
  });
});
