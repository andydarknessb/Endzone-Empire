/**
 * English ordinal for a positive integer rank: 1 -> "1st", 2 -> "2nd",
 * 3 -> "3rd", 6 -> "6th", 11 -> "11th", 21 -> "21st". A non-finite or
 * non-positive input yields null so a caller renders no rank rather than
 * "0th" or "NaNth".
 *
 * Promoted (#1272 Addendum, ADR 0031's second-island-consumer threshold)
 * once a third private copy (src/widgets/pickem-standings/lib/ordinal.js,
 * #1296) joined the my-team-summary widget's own copy and matchup-hero's
 * inline export - past the precedent TeamAvatar and initialsFor were
 * promoted at (their second island consumer). A widget composes entities and
 * `shared/ui` and never another widget's lib (ADR 0038), so each earlier copy
 * was the only move available inside its own ticket's fence.
 */
export function ordinal(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return null;
  const value = Math.trunc(n);
  const mod100 = value % 100;
  let suffix = 'th';
  if (mod100 < 11 || mod100 > 13) {
    switch (value % 10) {
      case 1:
        suffix = 'st';
        break;
      case 2:
        suffix = 'nd';
        break;
      case 3:
        suffix = 'rd';
        break;
      default:
        suffix = 'th';
    }
  }
  return `${value}${suffix}`;
}

export default ordinal;
