import { formatKickoff } from './kickoff';

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
