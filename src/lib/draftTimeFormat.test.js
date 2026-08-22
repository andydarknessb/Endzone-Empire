import {
  authenticatedDraftUrl,
  buildDraftIcs,
  draftIcsUid,
  draftTimezoneDetail,
  formatDraftTimezoneSchedule,
  formatViewerLocalSchedule,
} from './draftTimeFormat';

describe('formatViewerLocalSchedule', () => {
  test('short weekday, no seconds, explicit zone abbreviation (#117 AC1)', () => {
    expect(formatViewerLocalSchedule('2026-09-03T18:00:00.000Z', 'America/Chicago')).toBe('Thu, Sep 3, 1:00 PM CDT');
  });

  test('a viewer in a different zone reads a different wall time for the same instant', () => {
    const instant = '2026-09-03T18:00:00.000Z';
    const chicago = formatViewerLocalSchedule(instant, 'America/Chicago');
    const tokyo = formatViewerLocalSchedule(instant, 'Asia/Tokyo');
    expect(chicago).not.toBe(tokyo);
    expect(chicago).toBe('Thu, Sep 3, 1:00 PM CDT');
    expect(tokyo).toMatch(/^Fri, Sep 4, 3:00 AM (JST|GMT\+9)$/);
  });

  test('a winter instant in a DST zone reads the standard-time abbreviation', () => {
    expect(formatViewerLocalSchedule('2026-01-15T18:00:00.000Z', 'America/Chicago')).toBe('Thu, Jan 15, 12:00 PM CST');
  });

  test('returns an empty string for an invalid date', () => {
    expect(formatViewerLocalSchedule('not a date', 'America/Chicago')).toBe('');
  });
});

describe('formatDraftTimezoneSchedule', () => {
  test('formats the same instant in the league Draft timezone', () => {
    expect(formatDraftTimezoneSchedule('2026-09-03T18:00:00.000Z', 'America/New_York')).toBe('Thu, Sep 3, 2:00 PM EDT');
  });

  test('falls back to UTC for a legacy null-zone schedule (#117 AC2)', () => {
    expect(formatDraftTimezoneSchedule('2026-09-03T18:00:00.000Z', null)).toBe('Thu, Sep 3, 6:00 PM UTC');
    expect(formatDraftTimezoneSchedule('2026-09-03T18:00:00.000Z', undefined)).toBe('Thu, Sep 3, 6:00 PM UTC');
  });
});

describe('draftTimezoneDetail', () => {
  test('names the league draft time zone when one is set', () => {
    expect(draftTimezoneDetail('2026-09-03T18:00:00.000Z', 'America/New_York'))
      .toBe('League draft time zone (America/New_York): Thu, Sep 3, 2:00 PM EDT');
  });

  test('is honest about a legacy schedule with no zone confirmed', () => {
    expect(draftTimezoneDetail('2026-09-03T18:00:00.000Z', null))
      .toBe('No draft time zone set - shown in UTC: Thu, Sep 3, 6:00 PM UTC');
  });
});

describe('authenticatedDraftUrl', () => {
  test('builds the HashRouter Draft route for a league', () => {
    expect(authenticatedDraftUrl(42)).toBe(`${window.location.origin}/#/league/42/draft`);
  });
});

describe('draftIcsUid', () => {
  test('is stable for the same league id', () => {
    expect(draftIcsUid(42)).toBe(draftIcsUid(42));
    expect(draftIcsUid(42)).not.toBe(draftIcsUid(43));
  });
});

describe('buildDraftIcs', () => {
  const startDate = '2026-09-03T18:00:00.000Z';
  const now = new Date('2026-08-22T12:00:00.000Z');

  test('contains a UTC start, a stable UID, the current timestamp, the league title, and the authenticated route', () => {
    const ics = buildDraftIcs({ leagueId: 42, leagueName: 'Harness League', startDate, now });

    expect(ics).toContain('DTSTART:20260903T180000Z');
    expect(ics).toContain(`UID:${draftIcsUid(42)}`);
    expect(ics).toContain('DTSTAMP:20260822T120000Z');
    expect(ics).toContain('SUMMARY:Harness League Draft');
    expect(ics).toContain(`URL:${authenticatedDraftUrl(42)}`);
  });

  test('never invents a DTEND or DURATION (#117 AC3)', () => {
    const ics = buildDraftIcs({ leagueId: 42, leagueName: 'Harness League', startDate, now });

    expect(ics).not.toMatch(/DTEND/);
    expect(ics).not.toMatch(/DURATION/);
  });

  test('escapes commas, semicolons, and backslashes in the league title', () => {
    const ics = buildDraftIcs({ leagueId: 7, leagueName: 'Ridge, Runners; Inc\\', startDate, now });

    expect(ics).toContain('SUMMARY:Ridge\\, Runners\\; Inc\\\\ Draft');
  });

  test('is parseable as one BEGIN:VEVENT/END:VEVENT block inside one VCALENDAR', () => {
    const ics = buildDraftIcs({ leagueId: 42, leagueName: 'Harness League', startDate, now });
    const lines = ics.split('\r\n').filter(Boolean);

    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines.at(-1)).toBe('END:VCALENDAR');
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(1);
    expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(1);
  });

  test('returns null rather than a broken calendar for a missing league or unparseable date', () => {
    expect(buildDraftIcs({ leagueId: null, leagueName: 'Harness League', startDate, now })).toBe(null);
    expect(buildDraftIcs({ leagueId: 42, leagueName: '', startDate, now })).toBe(null);
    expect(buildDraftIcs({ leagueId: 42, leagueName: 'Harness League', startDate: 'not a date', now })).toBe(null);
  });
});
