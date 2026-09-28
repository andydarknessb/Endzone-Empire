const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// How long ago something happened: "just now", minutes and hours close in,
// weekday and time within the week, a short date beyond that (year included
// only when it isn't the current one). Past only (spec #1737): an instant not
// yet passed, a record stamped a little ahead of the viewer's clock, reads
// "just now"; a real future instant goes through shared/lib/timeUntil.
export function formatTimeSince(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const elapsed = Date.now() - date.getTime();

  if (elapsed < MINUTE) {
    return 'just now';
  }
  if (elapsed < HOUR) {
    return `${Math.round(elapsed / MINUTE)}m ago`;
  }
  if (elapsed < DAY) {
    return `${Math.round(elapsed / HOUR)}h ago`;
  }
  if (elapsed < WEEK) {
    const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${weekday} ${time}`;
  }

  const sameYear = date.getFullYear() === new Date(Date.now()).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export default formatTimeSince;
