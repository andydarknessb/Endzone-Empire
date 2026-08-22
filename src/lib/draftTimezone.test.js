import {
  browserTimeZone,
  isValidIanaTimeZone,
  listIanaTimeZones,
  utcIsoToZonedWallTime,
  zonedWallTimeToUtcIso,
} from './draftTimezone';

describe('isValidIanaTimeZone', () => {
  test('accepts canonical IANA names', () => {
    expect(isValidIanaTimeZone('America/New_York')).toBe(true);
    expect(isValidIanaTimeZone('Asia/Tokyo')).toBe(true);
    expect(isValidIanaTimeZone('UTC')).toBe(true);
  });

  test('rejects non-canonical casing, unknown names, and non-strings', () => {
    expect(isValidIanaTimeZone('america/new_york')).toBe(false);
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false);
    expect(isValidIanaTimeZone('EST')).toBe(false); // a legacy abbreviation, not an IANA zone
    expect(isValidIanaTimeZone(null)).toBe(false);
    expect(isValidIanaTimeZone(undefined)).toBe(false);
    expect(isValidIanaTimeZone(42)).toBe(false);
  });
});

test('listIanaTimeZones returns a large sorted, deduplicated list including common zones', () => {
  const zones = listIanaTimeZones();
  expect(zones.length).toBeGreaterThan(300);
  expect(new Set(zones).size).toBe(zones.length);
  expect([...zones].sort()).toEqual(zones);
  expect(zones).toContain('America/New_York');
  expect(zones).toContain('Asia/Tokyo');
});

test('browserTimeZone returns the runtime-resolved IANA zone', () => {
  expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(isValidIanaTimeZone(browserTimeZone())).toBe(true);
});

// #116 AC4: wall time in the selected zone converts to the correct UTC
// instant regardless of the viewer's own browser zone. These fixed instants
// are picked outside any DST transition window, so the expected UTC offset
// is unambiguous.
describe('zonedWallTimeToUtcIso', () => {
  test('a zone behind UTC in winter (EST, UTC-5)', () => {
    expect(zonedWallTimeToUtcIso('2026-01-15T20:00', 'America/New_York')).toBe('2026-01-16T01:00:00.000Z');
  });

  test('the same zone observing daylight time in summer (EDT, UTC-4)', () => {
    expect(zonedWallTimeToUtcIso('2026-08-15T20:00', 'America/New_York')).toBe('2026-08-16T00:00:00.000Z');
  });

  test('a zone ahead of UTC (JST, UTC+9, no DST)', () => {
    expect(zonedWallTimeToUtcIso('2026-08-15T20:00', 'Asia/Tokyo')).toBe('2026-08-15T11:00:00.000Z');
  });

  test('UTC itself is a no-op conversion', () => {
    expect(zonedWallTimeToUtcIso('2026-08-15T20:00', 'UTC')).toBe('2026-08-15T20:00:00.000Z');
  });

  // 'Asia/Calcutta' rather than 'Asia/Kolkata': both name the same India
  // zone, but this host's ICU/tzdata build canonicalizes to the older name
  // (Intl.supportedValuesOf('timeZone') lists 'Asia/Calcutta', not
  // 'Asia/Kolkata' — a real cross-runtime tzdata quirk, not a test typo).
  test('a half-hour offset zone (India, UTC+5:30)', () => {
    expect(zonedWallTimeToUtcIso('2026-08-15T20:00', 'Asia/Calcutta')).toBe('2026-08-15T14:30:00.000Z');
  });

  test('the same wall clock reading in two different zones yields two different instants', () => {
    const ny = zonedWallTimeToUtcIso('2026-09-01T20:00', 'America/New_York');
    const tokyo = zonedWallTimeToUtcIso('2026-09-01T20:00', 'Asia/Tokyo');
    expect(ny).not.toBe(tokyo);
  });

  test('an invalid or unrecognized zone returns null rather than guessing', () => {
    expect(zonedWallTimeToUtcIso('2026-08-15T20:00', 'Not/AZone')).toBe(null);
    expect(zonedWallTimeToUtcIso('2026-08-15T20:00', 'est')).toBe(null);
    expect(zonedWallTimeToUtcIso('2026-08-15T20:00', undefined)).toBe(null);
  });

  test('a malformed wall-time string returns null', () => {
    expect(zonedWallTimeToUtcIso('not a date', 'America/New_York')).toBe(null);
    expect(zonedWallTimeToUtcIso('', 'America/New_York')).toBe(null);
    expect(zonedWallTimeToUtcIso(null, 'America/New_York')).toBe(null);
  });
});

describe('utcIsoToZonedWallTime', () => {
  test('is the inverse of zonedWallTimeToUtcIso for a fixed instant', () => {
    const wall = '2026-08-15T20:00';
    const utc = zonedWallTimeToUtcIso(wall, 'America/New_York');
    expect(utcIsoToZonedWallTime(utc, 'America/New_York')).toBe(wall);
  });

  test('the same UTC instant reads as different wall times in different zones', () => {
    const utc = '2026-08-15T20:00:00.000Z';
    expect(utcIsoToZonedWallTime(utc, 'America/New_York')).toBe('2026-08-15T16:00');
    expect(utcIsoToZonedWallTime(utc, 'Asia/Tokyo')).toBe('2026-08-16T05:00');
  });

  test('a null/empty instant or an invalid zone returns an empty string', () => {
    expect(utcIsoToZonedWallTime(null, 'America/New_York')).toBe('');
    expect(utcIsoToZonedWallTime('', 'America/New_York')).toBe('');
    expect(utcIsoToZonedWallTime('2026-08-15T20:00:00.000Z', 'Not/AZone')).toBe('');
  });

  test('accepts a Date instance as well as an ISO string', () => {
    const date = new Date('2026-08-15T20:00:00.000Z');
    expect(utcIsoToZonedWallTime(date, 'UTC')).toBe('2026-08-15T20:00');
  });
});
