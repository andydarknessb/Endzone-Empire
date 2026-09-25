const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The strip's countdown to a Clear time: "14h 22m", "1d 2h" from a day out,
 * "Under 1m" in the last minute and "Clearing now" once it has passed. Null
 * for a missing or unparseable time.
 */
export function countdownText(at, now = new Date()) {
  const t = at ? new Date(at).getTime() : NaN;
  if (Number.isNaN(t)) return null;
  const diff = t - now.getTime();
  if (diff <= 0) return 'Clearing now';
  if (diff < MINUTE) return 'Under 1m';
  if (diff >= DAY) return `${Math.floor(diff / DAY)}d ${Math.floor((diff % DAY) / HOUR)}h`;
  return `${Math.floor(diff / HOUR)}h ${Math.floor((diff % HOUR) / MINUTE)}m`;
}

export default countdownText;
