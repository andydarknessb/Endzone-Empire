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

  // A game on any other day groups under its day (CONTEXT.md, Kickoff window).
  test('a Wednesday kickoff is wednesday (Wed 8pm ET)', () => {
    expect(kickoffWindowFor('2026-11-26T01:00:00.000Z')).toBe('wednesday');
  });

  test('a Friday kickoff is friday (Fri 3pm ET)', () => {
    expect(kickoffWindowFor('2026-11-27T20:00:00.000Z')).toBe('friday');
  });

  test('a Saturday kickoff is saturday', () => {
    expect(kickoffWindowFor('2026-09-12T17:00:00.000Z')).toBe('saturday');
  });

  test('a Tuesday kickoff is tuesday (Tue 1pm ET)', () => {
    expect(kickoffWindowFor('2026-12-01T18:00:00.000Z')).toBe('tuesday');
  });

  test('a Thursday 8:20pm ET kickoff stays thursday-night though it is already Friday in UTC', () => {
    expect(kickoffWindowFor('2026-11-27T01:20:00.000Z')).toBe('thursday-night');
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

  test('a game on any other day groups under its day, in week order, and none is dropped', () => {
    const games = [
      { gameKey: 'SUN_NIGHT', kickoffAt: '2026-11-30T01:20:00.000Z' }, // Sun 8:20pm ET
      { gameKey: 'FRI', kickoffAt: '2026-11-27T20:00:00.000Z' }, // Fri 3pm ET
      { gameKey: 'THU', kickoffAt: '2026-11-26T18:00:00.000Z' }, // Thu 1pm ET, grouped as thursday-night
      { gameKey: 'WED', kickoffAt: '2026-11-26T01:00:00.000Z' }, // Wed 8pm ET
      { gameKey: 'SUN_EARLY', kickoffAt: '2026-11-29T18:00:00.000Z' }, // Sun 1pm ET
      { gameKey: 'MON', kickoffAt: '2026-12-01T01:15:00.000Z' }, // Mon 8:15pm ET
    ];
    const groups = groupByKickoffWindow(games);
    expect(groups.map((group) => group.window)).toEqual(['wednesday', 'thursday-night', 'friday', 'sunday-early', 'sunday-night', 'monday-night']);
    expect(groups.reduce((total, group) => total + group.games.length, 0)).toBe(6);
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
