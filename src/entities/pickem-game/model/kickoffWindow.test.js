import { groupByKickoffWindow, kickoffWindowFor } from './kickoffWindow';

// 2026-09-13 is a Sunday; 2026-09-10 a Thursday; 2026-09-14 a Monday. Times
// are EDT (UTC-4) all week, comfortably inside daylight saving.
describe('kickoffWindowFor', () => {
  test('a Thursday kickoff is thursday-night', () => {
    expect(kickoffWindowFor('2026-09-10T20:15:00.000Z')).toBe('thursday-night');
  });

  test('a Sunday 1pm ET kickoff is sunday-early', () => {
    expect(kickoffWindowFor('2026-09-13T17:00:00.000Z')).toBe('sunday-early');
  });

  test('a Sunday 4:05pm ET kickoff is sunday-late', () => {
    expect(kickoffWindowFor('2026-09-13T20:05:00.000Z')).toBe('sunday-late');
  });

  test('a Sunday 8:20pm ET kickoff is sunday-night', () => {
    expect(kickoffWindowFor('2026-09-14T00:20:00.000Z')).toBe('sunday-night');
  });

  test('a Monday kickoff is monday-night', () => {
    expect(kickoffWindowFor('2026-09-15T00:15:00.000Z')).toBe('monday-night');
  });

  // The classification reads the instant through America/New_York explicitly
  // (Intl with an explicit timeZone), so it does not depend on the process's
  // own local zone the way a bare `Date#getDay`/`getHours` read would.
  test('zone-independent: a UTC instant that crosses midnight into the next UTC day still reads as the ET weekday', () => {
    // 8:20pm ET Sunday is already Monday in UTC, but it must still group with
    // Sunday night, not Monday night.
    expect(kickoffWindowFor('2026-09-14T00:20:00.000Z')).toBe('sunday-night');
    // 8:15pm ET Thursday is already Friday in UTC, but it must still group
    // with Thursday night.
    expect(kickoffWindowFor('2026-09-11T00:15:00.000Z')).toBe('thursday-night');
  });

  test('a day the board has no window for reads as null', () => {
    expect(kickoffWindowFor('2026-09-12T17:00:00.000Z')).toBeNull(); // a Saturday
  });

  test('an absent or unparseable kickoff reads as null', () => {
    expect(kickoffWindowFor(null)).toBeNull();
    expect(kickoffWindowFor('')).toBeNull();
    expect(kickoffWindowFor('not a date')).toBeNull();
  });
});

describe('groupByKickoffWindow', () => {
  test('groups games into their windows, in the glossary\'s order, omitting empty windows', () => {
    const games = [
      { gameKey: 'A', kickoffAt: '2026-09-14T00:20:00.000Z' }, // sunday-night
      { gameKey: 'B', kickoffAt: '2026-09-10T20:15:00.000Z' }, // thursday-night
      { gameKey: 'C', kickoffAt: '2026-09-13T17:00:00.000Z' }, // sunday-early
      { gameKey: 'D', kickoffAt: '2026-09-13T17:30:00.000Z' }, // sunday-early
    ];
    const groups = groupByKickoffWindow(games);
    expect(groups.map((group) => group.window)).toEqual(['thursday-night', 'sunday-early', 'sunday-night']);
    expect(groups.find((group) => group.window === 'sunday-early').games.map((g) => g.gameKey)).toEqual(['C', 'D']);
  });

  test('a game with no parseable kickoff is dropped rather than crashing', () => {
    const groups = groupByKickoffWindow([{ gameKey: 'A', kickoffAt: null }]);
    expect(groups).toEqual([]);
  });

  test('an empty or missing list groups to nothing', () => {
    expect(groupByKickoffWindow([])).toEqual([]);
    expect(groupByKickoffWindow(undefined)).toEqual([]);
  });

  test('reads a pre-modeled game\'s `kickoff` field as well as the wire\'s `kickoffAt`', () => {
    const groups = groupByKickoffWindow([{ gameKey: 'A', kickoff: '2026-09-10T20:15:00.000Z' }]);
    expect(groups).toEqual([{ window: 'thursday-night', games: [{ gameKey: 'A', kickoff: '2026-09-10T20:15:00.000Z' }] }]);
  });
});
