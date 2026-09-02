/**
 * English ordinal for a positive integer rank: 1 -> "1st", 2 -> "2nd",
 * 3 -> "3rd", 6 -> "6th", 11 -> "11th", 21 -> "21st". Used by the my-team
 * summary widget for the projected-finish tile and the standings-rank line,
 * both of which the mockup renders as an ordinal (dashboard-concept.html
 * ".stat .v" shows "6th").
 *
 * Returns the ordinal as `{ value, suffix }` so a caller can render the suffix
 * in a smaller/de-emphasized face (the mockup's `.stat .v small`) without
 * re-deriving it, and `toString()` for the plain "6th" form the tests assert.
 * A non-finite or non-positive input yields null so the caller renders no tile
 * rather than "0th" or "NaNth".
 */
export function ordinal(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return null;
  const value = Math.trunc(n);
  const suffix = ordinalSuffix(value);
  return {
    value: String(value),
    suffix,
    toString() {
      return `${value}${suffix}`;
    },
  };
}

function ordinalSuffix(value) {
  const mod100 = value % 100;
  // 11th, 12th, 13th are the exceptions to the units-digit rule.
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (value % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

export default ordinal;
