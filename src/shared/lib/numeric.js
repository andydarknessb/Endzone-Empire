// Shared numeric contracts for the island (#1120, ADR 0031): a single finite-
// value coercion and the one-decimal points formatter built on it. Promoted
// from private copies in the matchup-hero, matchup-grid, around-the-league and
// matchup-preview models, which had begun to diverge (one formatter read an
// empty string as `0.0`; every other copy read it as unknown).

/**
 * A finite number from a wire value, else null. Handles numbers and
 * PostgreSQL DECIMAL columns (which node-postgres hands back as strings, #864)
 * alike. `null`, `undefined`, `''` and any non-finite result (`NaN`, either
 * infinity) are all unknown, not zero.
 */
export function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A points figure to one decimal ("92.1"), or a dash when unknown. Built on
 * `finite`, so an empty string reads as unknown (the dash) rather than `0.0`;
 * numeric zero is a known value and renders as `0.0`.
 */
export function formatPoints(value) {
  const n = finite(value);
  return n != null ? n.toFixed(1) : '-';
}
