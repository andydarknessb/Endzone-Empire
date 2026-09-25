/**
 * The Usage read model, pure (ADR 0029: the entities layer). It is the
 * defensive shape over `GET /api/team/lineup/:playerId/context`'s `usage`
 * field (server/services/decisionCardContext.service.js, #1236, ADR 0037),
 * so a malformed or half-loaded body never reaches a caller as a thrown
 * property access.
 *
 * `usage` is `{ weeks, seasonAverage }` or `null` (his team had no played
 * week before the requested one, e.g. week 1). `weeks` is up to three
 * entries, most-recent-first, each `{ season, week, targets, carries,
 * airYards, snaps, snapShare, targetShare, fantasyPoints }`; a week his team
 * played but he did not carries a real `season`/`week` with every other field
 * null. `seasonAverage` is the same stat fields averaged over his weeks with
 * a stats row, or `null` when he has none. `snaps`/`snapShare` (nflverse
 * snap_counts; offense side, or defense for IDP) ride through unchanged.
 *
 * `opponents` (#1609) is the same body's next-opponents list, each `{ week,
 * opponent, rankVsPosition, allowedPerGame, games }`; rank 1 allows the most
 * points to the player's position (CONTEXT.md: Opponent rank vs position).
 *
 * This module is pure: it imports nothing at all.
 */

/** The `opponents` list off the wire body, lifted unchanged; anything but an array is []. */
export function opponentsFromResponse(data) {
  const body = data && typeof data === 'object' ? data : {};
  return Array.isArray(body.opponents) ? body.opponents : [];
}

/** The `usage` field off the wire body, defaulting a malformed or absent body to null. */
export function usageFromResponse(data) {
  const body = data && typeof data === 'object' ? data : {};
  return body.usage ?? null;
}
