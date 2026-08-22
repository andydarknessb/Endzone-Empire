/**
 * Display and calendar-export helpers for an unambiguous Draft time (#117,
 * parent spec #108). The Draft instant itself is never ambiguous - it is
 * always a UTC timestamp on the wire - only its *display* can be, when a
 * viewer has no way to tell whose clock a bare "8:00 PM" belongs to. See
 * CONTEXT.md: Draft timezone, Kickoff.
 *
 * `viewerTimeZone` on the two format functions below is optional and exists
 * only so tests can pin a zone deterministically; production callers omit it
 * and get the browser's own zone via Intl's runtime default.
 */
import { isValidIanaTimeZone } from './draftTimezone';

// Intl.DateTimeFormat throws a RangeError for a zone name it doesn't
// recognize. `timeZone` on a league row is written through validated paths
// (league create/settings), but this module has no way to guarantee every
// value it's ever handed came from one of them - a stale row from before an
// ICU/tzdata update dropped a zone name, say. Falling back rather than
// throwing keeps a bad zone value a display quirk instead of a crash.
function safeTimeZone(timeZone) {
  return timeZone && isValidIanaTimeZone(timeZone) ? timeZone : null;
}

// Short weekday, no seconds, explicit zone abbreviation - "Thu, Sep 3, 1:00
// PM CDT" - so a viewer never has to guess whose clock a bare time belongs
// to (#117 AC1).
const SCHEDULE_FORMAT_OPTIONS = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

function toDate(dateLike) {
  return dateLike instanceof Date ? dateLike : new Date(dateLike);
}

/**
 * The Draft instant as the viewer should read it first: their own zone,
 * short weekday, no seconds, with an explicit zone abbreviation (#117 AC1).
 */
export function formatViewerLocalSchedule(dateLike, viewerTimeZone) {
  const date = toDate(dateLike);
  if (Number.isNaN(date.getTime())) return '';
  const zone = safeTimeZone(viewerTimeZone);
  const options = zone ? { ...SCHEDULE_FORMAT_OPTIONS, timeZone: zone } : SCHEDULE_FORMAT_OPTIONS;
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

/**
 * The same instant as it reads in the league's Draft timezone, or UTC for a
 * legacy schedule with no zone confirmed (#117 AC2). `timeZone` is a
 * league's nullable `draft_timezone` column value.
 */
export function formatDraftTimezoneSchedule(dateLike, timeZone) {
  const date = toDate(dateLike);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { ...SCHEDULE_FORMAT_OPTIONS, timeZone: safeTimeZone(timeZone) || 'UTC' }).format(date);
}

/**
 * The hover/tap detail string pairing the league Draft timezone (or the
 * honest "no zone set" UTC fallback) with the formatted instant (#117 AC2).
 * An unrecognized zone value is treated the same as "not set" rather than
 * displayed verbatim - see safeTimeZone above.
 */
export function draftTimezoneDetail(dateLike, timeZone) {
  const formatted = formatDraftTimezoneSchedule(dateLike, timeZone);
  if (!formatted) return '';
  const zone = safeTimeZone(timeZone);
  return zone
    ? `League draft time zone (${zone}): ${formatted}`
    : `No draft time zone set - shown in UTC: ${formatted}`;
}

/** The authenticated, HashRouter Draft route for a league (#117 AC3). */
export function authenticatedDraftUrl(leagueId) {
  const origin = typeof window !== 'undefined' && window.location ? window.location.origin : '';
  return `${origin}/#/league/${leagueId}/draft`;
}

/**
 * A stable per-league UID so re-exporting (or re-importing) the same
 * league's Draft updates one calendar entry rather than duplicating it.
 */
export function draftIcsUid(leagueId) {
  return `draft-${leagueId}@endzone-empire.app`;
}

// RFC 5545 TEXT escaping: backslash first, then the characters it introduces.
function icsEscapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

// "YYYYMMDDTHHmmssZ" - the UTC form every calendar app expects for DTSTAMP/DTSTART.
function toIcsUtcStamp(date) {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * A minimal .ics VCALENDAR/VEVENT for a league's Draft (#117 AC3): UTC start,
 * a stable UID, the current timestamp, the league title, and a link back to
 * the authenticated Draft route. Deliberately has no DTEND or DURATION - the
 * actual length of a draft depends on team count, pick clock and pauses,
 * none of which a static export can know, so inventing one would just be a
 * second, more confident-looking wrong answer than having none at all.
 *
 * Returns null for a missing league id/name or an unparseable start date
 * rather than emitting a broken calendar file.
 */
export function buildDraftIcs({ leagueId, leagueName, startDate, now = new Date() }) {
  if (leagueId == null || !leagueName) return null;
  const start = toDate(startDate);
  if (Number.isNaN(start.getTime())) return null;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Endzone Empire//Draft//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${icsEscapeText(draftIcsUid(leagueId))}`,
    `DTSTAMP:${toIcsUtcStamp(toDate(now))}`,
    `DTSTART:${toIcsUtcStamp(start)}`,
    `SUMMARY:${icsEscapeText(`${leagueName} Draft`)}`,
    `URL:${icsEscapeText(authenticatedDraftUrl(leagueId))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}
