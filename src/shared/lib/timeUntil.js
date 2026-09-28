import { useEffect, useRef, useState } from 'react';

// Time until an instant, in the house style every countdown and deadline in
// the app shares (spec #1737): the top two units, rounded down so the text
// never claims more time than is left, the second unit padded ("2d 03h",
// "14h 05m"), and no leading zero unit ("59m", not "0h 59m"). Callers own the
// words around it ("in", "Clears", "Locks") and what an arrived instant says
// ("Now", "Clearing now", "Live now"); this module owns the duration and the
// instant its text next changes, so a page repaints exactly then.

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const pad = (n) => String(n).padStart(2, '0');

function toMs(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return value;
  return (value instanceof Date ? value : new Date(value)).getTime();
}

/**
 * The time from `now` until `at` (each an ISO string, Date or epoch ms).
 *
 * `precision` is 'minute' (the default: the last minute reads "Under 1m") or
 * 'second' (a live ticking countdown: "14m 09s" inside the last hour, then
 * "30s"). Above an hour both read the same.
 *
 * Returns `{ text, passed, imminent, changesAt }`, or null for an unreadable
 * `at`. `passed` is true once `at` has arrived (text null, changesAt null).
 * `imminent` marks the last step before it does ("Under 1m", or the final
 * second). `changesAt` is the first instant at which the text differs, in
 * epoch ms. An exact boundary reads in the coarser unit: exactly one hour is
 * "1h 00m".
 */
export function timeUntil(at, now, { precision = 'minute' } = {}) {
  const atMs = toMs(at);
  if (Number.isNaN(atMs)) return null;
  const remaining = atMs - toMs(now);
  if (!(remaining > 0)) return { text: null, passed: true, imminent: false, changesAt: null };

  // `floorTo` is the step the text is rounded down to; the text changes the
  // moment the remaining time drops below the whole steps it shows.
  let text;
  let floorTo;
  let imminent = false;
  if (remaining >= DAY_MS) {
    const hours = Math.floor(remaining / HOUR_MS);
    text = `${Math.floor(hours / 24)}d ${pad(hours % 24)}h`;
    floorTo = HOUR_MS;
  } else if (remaining >= HOUR_MS || precision !== 'second') {
    const minutes = Math.floor(remaining / MINUTE_MS);
    if (minutes === 0) {
      text = 'Under 1m';
      imminent = true;
    } else if (minutes >= 60) {
      text = `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
    } else {
      text = `${minutes}m`;
    }
    floorTo = MINUTE_MS;
  } else {
    const seconds = Math.floor(remaining / SECOND_MS);
    const minutes = Math.floor(seconds / 60);
    text = minutes > 0 ? `${minutes}m ${pad(seconds % 60)}s` : `${seconds}s`;
    imminent = seconds === 0;
    floorTo = SECOND_MS;
  }
  const shown = Math.floor(remaining / floorTo) * floorTo;
  return { text, passed: false, imminent, changesAt: atMs - shown + 1 };
}

// setTimeout fires almost at once past a 32-bit delay (~24.8 days), so a
// longer wait repaints once at the cap and schedules the rest.
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * The current time, repainting once at the earliest instant any time-until
 * text on the surface changes. `nextChangeOf` is that instant (epoch ms), or
 * a function from the current time to it, since a surface measures its rows'
 * `changesAt` (and its own display rules) from the time it renders with.
 * One timer per surface, not one per row, and no fixed interval; null means
 * nothing on the surface will change. A change of `refreshKey` (new rows from
 * a refetch, say) re-reads the clock at once, so new rows are never measured
 * from a stale time.
 */
export function useNow(nextChangeOf, refreshKey) {
  const [now, setNow] = useState(() => Date.now());
  const next = typeof nextChangeOf === 'function' ? nextChangeOf(now) : nextChangeOf;

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setNow(Date.now());
  }, [refreshKey]);

  useEffect(() => {
    if (next == null || !Number.isFinite(next)) return undefined;
    const delay = Math.min(Math.max(0, next - Date.now()), MAX_TIMEOUT_MS);
    const id = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(id);
  }, [next, now]);
  return now;
}
