/**
 * Shared numeric-presence predicate for `server/` (issue #1555).
 *
 * Six call sites (`decisionCardContext.service.js`, `espnOdds.provider.js`,
 * `nwsWeather.service.js`, `projectionFeatures.js`, `projectionModel.js`,
 * `vegasOdds.provider.js`) each carried a byte-identical local `isNum` /
 * `isRealNumber` guarding against the same trap: `Number(null)`, `Number('')`
 * and `Number(undefined-ish)` all coerce to `0`, so a naive
 * `Number.isFinite(Number(v))` turns a missing measurement into a confident
 * zero. None of the six copies trimmed before testing for emptiness, so a
 * whitespace-only string (`' '`, `'\t'`) or an empty array (`[]`) — both of
 * which also coerce to `0` — slipped through as "present" too.
 *
 * This module is the one place that guard lives now. It has zero `require`s
 * on purpose: it is a leaf, so binding it from a service costs that service
 * nothing beyond the four lines it used to duplicate — the isolation those
 * six copies documented (no model dependency, no cross-provider dependency)
 * is unaffected by depending on a leaf with no dependencies of its own.
 */

/**
 * Is `v` a real, present number? Rejects `null`, `undefined`, booleans, and
 * anything whose string form is empty after trimming (`''`, `' '`, `'\t'`,
 * and `[]`, whose `String([])` is `''`). Everything else is tested with
 * `Number.isFinite(Number(v))`, so a genuine `0` (including `'0'` and `' 0 '`)
 * is accepted.
 *
 * @param {*} v
 * @returns {boolean}
 */
function isPresentNumber(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return false;
  if (String(v).trim() === '') return false;
  return Number.isFinite(Number(v));
}

module.exports = { isPresentNumber };
