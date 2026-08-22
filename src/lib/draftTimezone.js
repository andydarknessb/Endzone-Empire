/**
 * Draft timezone (#116): the client-side half of converting a commissioner's
 * wall-clock pick between an arbitrary IANA zone and the UTC instant the
 * server stores. See CONTEXT.md: Draft timezone.
 *
 * The browser's Date/Intl APIs have no "parse this wall time as if it were
 * in zone X" primitive — only "format this instant as it reads in zone X".
 * zonedWallTimeToUtcIso inverts that with the standard guess-and-correct
 * technique: assume the wall time is UTC, ask what that instant reads as in
 * the target zone, and shift by the difference. One correction converges for
 * every zone (a fixed UTC offset, or one DST jump inside the loop's single
 * step); a second is cheap insurance and costs nothing extra in practice.
 */

/** The viewer's own IANA zone, exactly as Intl resolves it. */
export function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Built once: Intl.supportedValuesOf ships in every browser this app
// targets (Chrome 99+, Firefox 102+, Safari 15.4+) and in the Node/jsdom
// test environment (Node 18+), matching the server's validator. 'UTC' is
// added explicitly for the same reason it is on the server (see
// server/modules/ianaTimeZones.js): supportedValuesOf omits it even though
// it is a real zone Intl.DateTimeFormat resolves without complaint.
const VALID_TIME_ZONES = new Set([
  ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []),
  'UTC',
]);

/** True for a canonical IANA zone name exactly as Intl reports it (case-sensitive). */
export function isValidIanaTimeZone(value) {
  return typeof value === 'string' && VALID_TIME_ZONES.has(value);
}

/** Every IANA zone name the runtime knows, for a picker's option list. */
export function listIanaTimeZones() {
  return [...VALID_TIME_ZONES].sort();
}

/** The instant's wall-clock offset from UTC in `timeZone`, in milliseconds. */
function offsetMs(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = Number(part.value);
    return acc;
  }, {});
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - instant.getTime();
}

/**
 * A "YYYY-MM-DDTHH:mm" wall-clock string (a datetime-local input's value) as
 * read in `timeZone`, converted to the UTC instant it names — the correct
 * instant regardless of the viewer's own browser zone (#116 AC4). Returns
 * null for a malformed string or an unrecognized zone rather than guessing.
 */
export function zonedWallTimeToUtcIso(wallTime, timeZone) {
  if (typeof wallTime !== 'string' || !isValidIanaTimeZone(timeZone)) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wallTime);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number);
  const wallAsUtcMs = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  if (Number.isNaN(wallAsUtcMs)) return null;
  let instant = new Date(wallAsUtcMs);
  // Two corrections: the first lands within one zone transition, the second
  // cleans up the rare case where that landing crossed another boundary.
  for (let i = 0; i < 2; i++) {
    instant = new Date(wallAsUtcMs - offsetMs(instant, timeZone));
  }
  return instant.toISOString();
}

/**
 * The inverse: a UTC instant (ISO string or Date) as wall-clock digits in
 * `timeZone`, in "YYYY-MM-DDTHH:mm" shape for a datetime-local input. Used to
 * redisplay a stored draft instant + its stored zone for editing without
 * silently substituting the viewer's own browser zone.
 */
export function utcIsoToZonedWallTime(utcValue, timeZone) {
  if (!utcValue || !isValidIanaTimeZone(timeZone)) return '';
  const instant = utcValue instanceof Date ? utcValue : new Date(utcValue);
  if (Number.isNaN(instant.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
