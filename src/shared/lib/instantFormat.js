// Named formats for showing an instant (spec #1737). The kickoff format began
// as the island's shared "Sun 7:20 PM" (#1120, ADR 0031), promoted from three
// private copies whose signatures had drifted; the other formats joined it for
// the same reason, so a surface picks a name here instead of writing a seventh
// Intl.DateTimeFormat of its own.
//
// Every format follows the viewer's own locale and time zone. `timeZone` and
// `locale` exist so a caller can name a zone (a league's Draft timezone) and a
// test can pin output; production callers otherwise omit them.

const FORMATS = {
  kickoff: { weekday: 'short', hour: 'numeric', minute: '2-digit' }, // Sun 7:20 PM
  time: { hour: 'numeric', minute: '2-digit' }, // 7:20 PM
  day: { month: 'short', day: 'numeric' }, // Oct 11
  schedule: { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }, // Sun, Oct 11, 7:20 PM CDT
  zone: { timeZoneName: 'short' }, // CDT (the zone name alone)
};

function build(locale, options, timeZone) {
  if (!timeZone) return new Intl.DateTimeFormat(locale, options);
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone });
  } catch (err) {
    // An unknown zone name (a stale row after a tzdata update, say) is a
    // RangeError; it reads in the viewer's zone rather than breaking the page.
    return new Intl.DateTimeFormat(locale, options);
  }
}

/**
 * An instant (ISO string or Date) in one of the named formats: 'kickoff',
 * 'time', 'day', 'schedule' or 'zone'. Absent, empty or unparseable input, or
 * an unknown format name, reads as null, never "Invalid Date".
 */
export function formatInstant(dateLike, format, { timeZone, locale } = {}) {
  const options = FORMATS[format];
  if (!options || dateLike == null || dateLike === '') return null;
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const formatter = build(locale, options, timeZone);
  if (format === 'zone') {
    const part = formatter.formatToParts(date).find((p) => p.type === 'timeZoneName');
    return part ? part.value : null;
  }
  return formatter.format(date);
}

/** "Sun 7:20 PM" for an NFL Kickoff: the island's shared name for formatInstant(at, 'kickoff'). */
export function formatKickoff(dateLike, options) {
  return formatInstant(dateLike, 'kickoff', options);
}
