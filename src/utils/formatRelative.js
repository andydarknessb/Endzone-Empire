const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Compact relative time for waiver-clear-style timestamps: minutes/hours close
// in, weekday+time within the week, a short date beyond that (year included
// only when it isn't the current one).
export function formatRelative(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);

  if (abs < MINUTE) {
    return 'just now';
  }
  if (abs < HOUR) {
    const minutes = Math.round(abs / MINUTE);
    return diff > 0 ? `in ${minutes}m` : `${minutes}m ago`;
  }
  if (abs < DAY) {
    const hours = Math.round(abs / HOUR);
    return diff > 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  if (abs < WEEK) {
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

export default formatRelative;
