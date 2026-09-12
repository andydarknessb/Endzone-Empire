/**
 * The Bench what-if swap named in the query (#910, restated from
 * LineupScreen.jsx's `readRequestedSwap`): `?swapOut=<id>&swapIn=<id>`, built
 * by `src/features/bench-what-if`'s `swapLineupHref`. A missing, blank,
 * non-integer or self-referring pair reads as null rather than an error, so
 * a hand-edited or stale link renders exactly what an unparameterised mount
 * renders.
 */
export function readRequestedSwap(searchParams) {
  const rawOut = searchParams.get('swapOut');
  const rawIn = searchParams.get('swapIn');
  if (!rawOut || !rawIn) return null;
  const outId = Number(rawOut);
  const inId = Number(rawIn);
  if (!Number.isInteger(outId) || !Number.isInteger(inId)) return null;
  if (outId === inId) return null;
  return { outId, inId };
}

/**
 * Resolves a requested swap against the entries actually on screen: both ids
 * must name a lineup entry, and neither may be locked or spent (the same
 * floor `isEligibleTarget` applies for a manual swap, restated lightly here
 * since this offer is not bound to a `selectedEntry` - a genuinely illegal
 * pairing that slips past this light check is still refused server-side).
 * Returns `{ outEntry, inEntry }` or null.
 */
export function resolveRequestedSwap(requestedSwap, entries) {
  if (!requestedSwap || !Array.isArray(entries)) return null;
  const outEntry = entries.find((e) => e.playerId === requestedSwap.outId);
  const inEntry = entries.find((e) => e.playerId === requestedSwap.inId);
  if (!outEntry || !inEntry) return null;
  if (outEntry.locked || inEntry.locked || outEntry.spent || inEntry.spent) return null;
  return { outEntry, inEntry };
}
