'use strict';

/**
 * Numeric reading with EXPLICIT missing-value rejection.
 *
 * This exists because one mistake kept recurring across the harness, in three
 * different modules, and each time it was the most flattering possible error:
 *
 *   `Number(null)` is `0`. `Number('')` is `0`. `Number('  ')` is `0`. And
 *   `Number.isFinite(0)` is `true`.
 *
 * So the natural-looking guard `Number.isFinite(Number(v)) ? Number(v) : null`
 * converts MISSING EVIDENCE into a MEASURED ZERO and reports it as valid. The
 * three places it bit, all caught by tests rather than in production:
 *
 *   - a blank game score became `pointsAllowed = 0`, a shutout, which is the
 *     TOP defensive scoring tier;
 *   - a stat row present in both sources but carrying no points became a
 *     scored zero, indistinguishable from a real zero-point game;
 *   - a NULL projection in the force-fill estimand became a `0` that outranked
 *     every negative projection - in the estimand whose entire definition is
 *     that null ranks strictly BELOW every finite value.
 *
 * Zero is a real measurement in this domain. "He touched the ball zero times",
 * "the defence allowed zero points", "he scored zero fantasy points" are all
 * findings. That is exactly why a missing value must never become one.
 *
 * Pure: no dependencies at all.
 */

/**
 * Pure: is this value ABSENT rather than a number?
 *
 * `null`, `undefined`, a string that is empty or only whitespace, and any
 * boolean. Whitespace counts as absent because a CSV cell containing spaces is
 * a blank cell, and the pinned injury sources demonstrably carry
 * whitespace-only placeholders (preregistration 2.3 records a literal newline
 * plus four spaces in `position` and `practice_status`).
 *
 * Booleans are absent because `Number(true)` is `1`: a boolean reaching a
 * numeric field means the caller has the wrong column, and silently scoring it
 * as one point would hide that.
 */
function isMissing(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'boolean') return true;
  // `String(v).trim()` rather than a string-only check, so an empty array -
  // which `Number()` also happily turns into 0 - is caught by the same rule.
  return String(value).trim() === '';
}

/**
 * Pure: a number that MUST be present, because zero is a meaningful
 * measurement of it rather than the absence of one.
 *
 * Throws on a missing value and on anything non-numeric. Use this wherever a
 * silent zero would be indistinguishable from a real reading - scores, points,
 * anything the scoring rules price through a tier table.
 */
function requiredNumber(value, { label = 'value', context = null } = {}) {
  const where = context ? `${label} (${context})` : label;
  if (isMissing(value)) {
    throw new Error(
      `${where} is ${JSON.stringify(value)}, which is missing rather than zero. A blank cannot be ` +
      'read as 0 here: zero is a real measurement in this field, so the two must stay distinguishable.'
    );
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${where} is ${JSON.stringify(value)}, which is not a finite number`);
  }
  return n;
}

/**
 * Pure: a number that may legitimately be absent. Missing yields `null`, never
 * `0`; anything present must still be a finite number.
 *
 * This is the "missing stays missing" rule the projection engine already
 * follows (`projectionFeatures.usageFromStats`): a player with no recorded
 * opportunity count has an unknown role, not a role of zero.
 */
function optionalNumber(value, { label = 'value', context = null } = {}) {
  if (isMissing(value)) return null;
  const where = context ? `${label} (${context})` : label;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${where} is ${JSON.stringify(value)}, which is not a finite number`);
  }
  return n;
}

/**
 * Pure: a COUNTING stat, where absence genuinely does mean zero.
 *
 * "No sacks recorded" really is no sacks. This is the one shape where the
 * zero-default is correct, and it is a separate function precisely so that
 * choosing it is a decision a reader can see rather than the default that
 * happens when nobody thought about it.
 */
function countingNumber(value, { label = 'value', context = null } = {}) {
  if (isMissing(value)) return 0;
  const where = context ? `${label} (${context})` : label;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${where} is ${JSON.stringify(value)}, which is not a finite number`);
  }
  return n;
}

/**
 * Pure: is this a usable finite number? (No coercion of missing values.)
 *
 * The predicate form of `optionalNumber`, for filters and guards that want a
 * boolean rather than a value.
 */
function isFiniteNumber(value) {
  return !isMissing(value) && Number.isFinite(Number(value));
}

/** Numeric ties are decided at 10 decimal places (preregistration 6.6). */
const TIE_DECIMALS = 10;
const TIE_SCALE = 10 ** TIE_DECIMALS;

/**
 * Pure: round to the preregistered tie precision, so a tie is a genuine tie and
 * not a floating-point artifact.
 */
function roundToTie(value) {
  return Math.round(Number(value) * TIE_SCALE) / TIE_SCALE;
}

/** Pure: are two numbers equal at the preregistered tie precision? */
function tiesWith(a, b) {
  return roundToTie(a) === roundToTie(b);
}

module.exports = {
  isMissing,
  requiredNumber,
  optionalNumber,
  countingNumber,
  isFiniteNumber,
  TIE_DECIMALS,
  roundToTie,
  tiesWith,
};
