// Rows beside the viewer's that a phone keeps when a standings table folds.
const FOLD_SPAN = 2;

/**
 * The phone fold shared by the fantasy standings and the pick'em table: the viewer's row with FOLD_SPAN
 * teams either side, reaching down to the playoff line when `cutIndex` (the first Team outside the bracket,
 * -1 for none) lies further on. Returns the inclusive window of row indexes it keeps, or null when there is
 * nothing to fold (no viewer, or five rows or fewer).
 */
export function foldRows(count, viewerIndex, cutIndex = -1) {
  if (viewerIndex < 0 || count <= FOLD_SPAN * 2 + 1) return null;
  return {
    first: Math.max(0, viewerIndex - FOLD_SPAN),
    last: Math.min(count - 1, Math.max(viewerIndex + FOLD_SPAN, cutIndex > 0 ? cutIndex - 1 : 0)),
  };
}
