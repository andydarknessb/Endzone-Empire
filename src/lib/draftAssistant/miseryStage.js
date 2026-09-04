/**
 * Ruling 8 (issue #784, ADR 0027): the Misery Meter is the manager's running
 * Net vs ADP over their OWN picks — not a win probability, not a projection,
 * just how the draft has gone against market so far. `netVsAdp` is the sum
 * of each pick's draftValueScore (src/lib/stealReach.js's companion figure,
 * computed the same way analysis.js's pickValues() does): NEGATIVE means
 * picks came in later than their market ADP (steals accumulate), POSITIVE
 * means picks came in earlier than ADP (reaches accumulate).
 *
 * Four bands, ordered best (most negative netVsAdp) to worst (most
 * positive), with original names per ruling 3 — no borrowed characters, just
 * the persona's own shoe-store-and-1966 vocabulary. Boundaries are round
 * numbers chosen to bracket a "quiet" middle around zero, symmetric either
 * side: nothing scientific claimed, this is flavor text banding, not a
 * projection.
 */
const BANDS = [
  { max: -15, name: '1966 Form' },
  { max: 0, name: 'Holding Serve' },
  { max: 15, name: 'Rebuilding Year' },
  { max: Infinity, name: 'Selling Insoles' },
];

/**
 * netVsAdp (number) -> one of the four original Misery Meter band names. A
 * boundary value itself (exactly -15, 0 or 15) always earns the better
 * (lower) of its two neighboring bands, so every real number has exactly one
 * band and there is no double coverage at a boundary.
 */
export function miseryStage(netVsAdp) {
  const value = Number(netVsAdp) || 0;
  const band = BANDS.find((b) => value <= b.max);
  return band.name;
}

export const MISERY_BANDS = BANDS.map((b) => b.name);
