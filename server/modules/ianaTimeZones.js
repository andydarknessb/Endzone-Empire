/**
 * IANA timezone validation, shared by every write path that accepts a Draft
 * timezone (league create and league settings): the one place deciding what
 * counts as a real zone, so the two callers cannot drift on which strings
 * they accept. Backed by the host ICU database (Node 18+), not a hand-kept
 * list, so it stays current with tzdata the runtime ships.
 *
 * 'UTC' is added explicitly: it is a real tz database zone (and the honest
 * fallback CONTEXT.md's Draft timezone entry displays for a legacy,
 * zone-less schedule), but V8's supportedValuesOf('timeZone') omits it even
 * though Intl.DateTimeFormat itself accepts and resolves it fine — without
 * this, no commissioner could ever pick "UTC" from the list.
 */
const VALID_TIME_ZONES = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

/** True for a canonical IANA zone name exactly as Intl reports it (case-sensitive). */
function isValidIanaTimeZone(value) {
  return typeof value === 'string' && VALID_TIME_ZONES.has(value);
}

module.exports = { isValidIanaTimeZone, VALID_TIME_ZONES };
