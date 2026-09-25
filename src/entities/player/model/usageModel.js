/**
 * The Usage and Opponent-rank read models, pure (ADR 0029: the entities
 * layer), defensive shapes over the Decision-card payload
 * (`GET /api/players/:id/card`, `server/services/playerCard.service.js`;
 * one read since #1667), so a malformed or half-loaded body never reaches a
 * caller as a thrown property access.
 *
 * `usage` (the card's `decision.usage`) is `{ weeks, seasonAverage }` or
 * `null` (his team had no played week before the requested one, e.g. week 1).
 * `weeks` is up to three entries, most-recent-first, each `{ season, week,
 * targets, carries, airYards, snaps, snapShare, targetShare, fantasyPoints }`;
 * a week his team played but he did not carries a real `season`/`week` with
 * every other field null. `seasonAverage` is the same stat fields averaged
 * over his weeks with a stats row, or `null` when he has none.
 * `snaps`/`snapShare` (nflverse snap_counts) are the offense side, or the
 * defense side for an IDP player.
 *
 * `opponents` (#1609) is the card's next-opponents list, each `{ week,
 * opponent, rankVsPosition, allowedPerGame, games }`; rank 1 allows the most
 * points to the player's position (CONTEXT.md: Opponent rank vs position).
 *
 * This module is pure: it imports nothing at all.
 */

/** The `opponents` list off the card, lifted unchanged; anything but an array is []. */
export function opponentsFromResponse(data) {
  const body = data && typeof data === 'object' ? data : {};
  return Array.isArray(body.opponents) ? body.opponents : [];
}

/** The `decision.usage` field off the card, defaulting a malformed or absent body to null. */
export function usageFromResponse(data) {
  const body = data && typeof data === 'object' ? data : {};
  const decision = body.decision && typeof body.decision === 'object' ? body.decision : {};
  return decision.usage ?? null;
}
