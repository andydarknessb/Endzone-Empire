import { formatInstant } from './instantFormat';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// How long ago something happened, the app's one time-since ladder: "just
// now", minutes and hours close in (rounded down, like every countdown),
// weekday and time within the week, a short date beyond that (year included
// only when it isn't the current one). Past only (spec #1737): an instant not
// yet passed, a record stamped a little ahead of the viewer's clock, reads
// "just now"; a real future instant goes through shared/lib/timeUntil.
//
// Bucketed on elapsed time, not calendar days: a row 90 minutes old reads
// "1h ago" whether or not midnight fell in between.
//
// `compact` is the recent-activity card's shorter style: "Yesterday" for the
// day before, then the weekday alone. `now` and `locale` exist so a test can
// pin the output; production callers omit them. Absent or unreadable input
// is null, never the Unix epoch.
export function formatTimeSince(dateLike, { now = Date.now(), locale, compact = false } = {}) {
  if (dateLike == null || dateLike === '') return null;
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const nowMs = now instanceof Date ? now.getTime() : now;
  const elapsed = nowMs - date.getTime();

  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (compact && elapsed < 2 * DAY) return 'Yesterday';
  if (elapsed < WEEK) {
    return compact
      ? date.toLocaleDateString(locale, { weekday: 'short' })
      : formatInstant(date, 'weekdayTime', { locale });
  }

  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export default formatTimeSince;
