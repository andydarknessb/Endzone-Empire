import { nextPickGame } from './nextPickGame';

const view = (gameKey, kickoff, extra = {}) => ({
  gameKey, kickoff, lock: false, myPick: null, ...extra,
});

test('returns the earliest-kickoff unlocked unpicked game, whatever the board order', () => {
  const views = [
    view('LATE', '2026-10-18T20:25:00Z'),
    view('EARLY', '2026-10-18T17:00:00Z'),
    view('MID', '2026-10-18T20:00:00Z'),
  ];
  expect(nextPickGame(views).gameKey).toBe('EARLY');
});

test('skips locked and picked games', () => {
  const views = [
    view('LOCKED', '2026-10-18T17:00:00Z', { lock: true }),
    view('PICKED', '2026-10-18T17:30:00Z', { myPick: 'A' }),
    view('OPEN', '2026-10-18T20:25:00Z'),
  ];
  expect(nextPickGame(views).gameKey).toBe('OPEN');
});

test('a tie on kickoff goes to the earlier game in board order', () => {
  const views = [
    view('FIRST', '2026-10-18T20:25:00Z'),
    view('SECOND', '2026-10-18T20:25:00Z'),
  ];
  expect(nextPickGame(views).gameKey).toBe('FIRST');
});

test('returns null when nothing qualifies', () => {
  expect(nextPickGame([])).toBeNull();
  expect(nextPickGame(undefined)).toBeNull();
  expect(nextPickGame([
    view('A', '2026-10-18T17:00:00Z', { lock: true }),
    view('B', '2026-10-18T20:25:00Z', { myPick: 'B' }),
  ])).toBeNull();
});
