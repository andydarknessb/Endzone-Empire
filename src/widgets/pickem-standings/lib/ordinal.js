/**
 * English ordinal for a positive integer rank: 1 -> "1st", 2 -> "2nd",
 * 3 -> "3rd", 11 -> "11th". Used by the "Your rank" header tile.
 *
 * A small local copy rather than a shared/ui import: widgets/my-team-summary
 * has the same helper, but a widget composes only entities and shared/ui
 * (ADR 0038), never another widget's lib, so this stays its own tiny pure
 * function here.
 *
 * A non-finite or non-positive input yields null so the caller renders no
 * tile rather than "0th" or "NaNth".
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
