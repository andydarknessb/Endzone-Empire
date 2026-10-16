/**
 * The game the Picks board's cursor sits on (ADR 0067 wave 2, the One Cursor Rule): the
 * earliest-kickoff game that is unlocked and has no pick, or null when nothing qualifies.
 * `views` are in board order (kickoff window, then in-window order); a tie on kickoff goes
 * to the earlier one. Reads `lock`, `myPick` and `kickoff` of a `gameModel`.
 */
export function nextPickGame(views) {
  let best = null;
  let bestAt = Infinity;
  for (const view of views || []) {
    if (view.lock || view.myPick != null) continue;
    const at = new Date(view.kickoff).getTime();
    if (Number.isNaN(at)) continue;
    if (at < bestAt) {
      best = view;
      bestAt = at;
    }
  }
  return best;
}

export default nextPickGame;
