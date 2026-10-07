/**
 * apply-advice (#1238, ADR 0037 AC2): applies the Start/sit advice's own move
 * plan as one Lineup write. `apply(movePlan)` takes a `movePlan` in the advice
 * response's shape (`[{ playerId, fromSlot, toSlot }]`,
 * `server/services/decision.service.js`) and converts it to the write
 * endpoint's `moves` shape (`[{ playerId, slot }]`) with no re-derivation of
 * its own, then hands it to `useLineupWrite`'s `submit` (spec #2042), which owns
 * the patch, rollback, Undo, toasts and cache invalidation. The caller may pass
 * the response's plan reduced by the suggestions the manager dismissed; this
 * hook never re-assigns a slot the advice did not name (AC2), because the only
 * slots it writes are the ones the plan already names.
 */
export function useApplyAdvice({ submit }) {
  const apply = async (movePlan) => {
    const moves = (movePlan || [])
      .filter((m) => m && m.playerId != null && m.toSlot != null)
      .map((m) => ({ playerId: m.playerId, slot: m.toSlot }));
    if (moves.length === 0) return;
    await submit(moves);
  };

  return { apply };
}

export default useApplyAdvice;
