import { formatInstant, formatKickoff } from './instantFormat';

describe('formatKickoff', () => {
  test('reads "Sun 7:20 PM" for an instant in the given zone', () => {
    expect(formatKickoff('2026-09-14T00:20:00Z', { timeZone: 'America/Chicago', locale: 'en-US' })).toBe('Sun 7:20 PM');
    expect(formatKickoff('2026-09-14T00:20:00Z', { timeZone: 'UTC', locale: 'en-US' })).toBe('Mon 12:20 AM');
  });

  test('accepts a Date the same as its ISO string', () => {
    const iso = '2026-09-14T00:20:00Z';
    expect(formatKickoff(new Date(iso), { timeZone: 'America/Chicago', locale: 'en-US' })).toBe('Sun 7:20 PM');
  });

  test('production callers may omit options and get the runtime default zone/locale', () => {
    const iso = '2026-09-20T23:20:00.000Z';
    const expected = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
    expect(formatKickoff(iso)).toBe(expected);
  });

  test('an absent, empty or invalid value reads as null', () => {
    expect(formatKickoff(null)).toBeNull();
    expect(formatKickoff(undefined)).toBeNull();
    expect(formatKickoff('')).toBeNull();
    expect(formatKickoff('not a date')).toBeNull();
  });
});

// One named format per way the app shows an instant (spec #1737). Output is
// pinned by zone and locale so the literals below hold on any machine.
describe('formatInstant', () => {
  const at = '2026-10-11T05:00:00Z'; // Sun Oct 11 12:00 AM in Chicago, 1:00 AM in New York, Sat Oct 10 in Los Angeles
  const pinned = { timeZone: 'America/Chicago', locale: 'en-US' };

  test('weekdayTime reads weekday and clock time; an unknown name, even kickoff, is null', () => {
    expect(formatInstant(at, 'weekdayTime', pinned)).toBe('Sun 12:00 AM');
    // Kickoff is an NFL game's start (CONTEXT.md), so the format is not named
    // for it; formatKickoff is the Kickoff-specific name.
    expect(formatInstant(at, 'kickoff', pinned)).toBeNull();
    expect(formatKickoff(at, pinned)).toBe('Sun 12:00 AM');
  });

  test('time, day, schedule and zone each read their own part', () => {
    expect(formatInstant(at, 'time', pinned)).toBe('12:00 AM');
    expect(formatInstant(at, 'day', pinned)).toBe('Oct 11');
    expect(formatInstant(at, 'schedule', pinned)).toBe('Sun, Oct 11, 12:00 AM CDT');
    expect(formatInstant(at, 'zone', pinned)).toBe('CDT');
  });

  test('the zone decides the day', () => {
    expect(formatInstant(at, 'day', { timeZone: 'America/Los_Angeles', locale: 'en-US' })).toBe('Oct 10');
    expect(formatInstant(at, 'time', { timeZone: 'America/New_York', locale: 'en-US' })).toBe('1:00 AM');
  });

  test('follows the locale it is given (the viewer\'s own in production)', () => {
    expect(formatInstant('2026-10-11T18:00:00Z', 'time', { timeZone: 'America/Chicago', locale: 'en-GB' })).toBe('13:00');
  });

  test('a zone the runtime does not know falls back to the viewer\'s zone instead of throwing', () => {
    expect(formatInstant(at, 'time', { timeZone: 'Mars/Olympus_Mons', locale: 'en-US' }))
      .toBe(formatInstant(at, 'time', { locale: 'en-US' }));
  });

  test('absent, empty or unparseable input, or an unknown format, reads as null', () => {
    expect(formatInstant(null, 'time')).toBeNull();
    expect(formatInstant('', 'time')).toBeNull();
    expect(formatInstant('not a date', 'time')).toBeNull();
    expect(formatInstant(new Date(NaN), 'time')).toBeNull();
    expect(formatInstant(at, 'fortnight')).toBeNull();
  });
});
