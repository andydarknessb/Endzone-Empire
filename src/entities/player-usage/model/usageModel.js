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
 * airYards, targetShare, fantasyPoints }`; a week his team played but he did
 * not carries a real `season`/`week` with every other field null.
 * `seasonAverage` is the same five stat fields averaged over his weeks with
 * a stats row, or `null` when he has none. Snap counts are not usage
 * (CONTEXT.md's Usage entry) and are never read here.
 *
 * This module is pure: it imports nothing at all.
 */

/** The `usage` field off the wire body, defaulting a malformed or absent body to null. */
export function usageFromResponse(data) {
  const body = data && typeof data === 'object' ? data : {};
  return body.usage ?? null;
}
