// Shared kickoff formatting for the island (#1120, ADR 0031): the reconciled
// contract for "Sun 7:20 PM" from an NFL kickoff instant. Promoted from three
// private copies (matchup-hero, matchup-grid, matchup-preview) whose signatures
// had already diverged: matchup-grid's took an ISO string or a `Date` plus
// optional `timeZone`/`locale`, the other two took an ISO string only. This
// signature wins; every consumer now shares it.

const KICKOFF_FORMAT = { weekday: 'short', hour: 'numeric', minute: '2-digit' };

/**
 * "Sun 7:20 PM" for an ISO instant or a `Date`, in the given zone/locale.
 * `timeZone` and `locale` exist so a test can pin the output; production
 * callers omit `options` entirely and get the viewer's runtime defaults. An
 * absent, empty or unparseable value reads as null, never "Invalid Date".
 */
export function formatKickoff(dateLike, { timeZone, locale } = {}) {
  if (dateLike == null || dateLike === '') return null;
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const options = timeZone ? { ...KICKOFF_FORMAT, timeZone } : KICKOFF_FORMAT;
  return new Intl.DateTimeFormat(locale, options).format(date);
}
