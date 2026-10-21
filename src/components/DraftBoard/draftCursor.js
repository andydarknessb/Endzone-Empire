/**
 * The player id the Draft room's one cursor sits on, or null (spec #2432).
 * `rows` are the pool rows on screen, in their current sort and filter, each
 * `{ id, isDrafted }`; `queue` is the viewer's queued players, in order.
 * `onTheClock` is the room's `isMyTurn`, so a commissioner picking for another
 * team never gets a cursor.
 */
export function draftCursorPlayerId({
  onTheClock, canPick, queue, rows,
}) {
  if (!onTheClock || !canPick) return null;
  const open = new Set(rows.filter((r) => !r.isDrafted).map((r) => r.id));
  const queued = queue.find((p) => open.has(p.id));
  if (queued) return queued.id;
  const first = rows.find((r) => !r.isDrafted);
  return first ? first.id : null;
}
