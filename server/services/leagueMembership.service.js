/**
 * League membership: who holds a Team in a league, and the refusal for
 * anyone who does not.
 *
 * Membership IS the Team row (ADR 0002): a `teams` row with the manager's
 * `owner_id` is the only record that they belong to the league, in a fantasy
 * league and a pick'em-only league alike. Every league-scoped read and write
 * is gated on it and should authorize through this module:
 *
 * - `isMember` when a yes/no is enough and the caller keeps its own refusal.
 * - `requireMember` when the caller wants the Team row or the standard
 *   refusal. It refuses by throwing the coded 403 ("not a member of this
 *   league"), so call it only where the surrounding catch renders
 *   `error.statusCode`; a route that maps every error to 500 uses `isMember`.
 *
 * `MembershipError` is the coded error for both this module and the roles
 * built on top of it (leagueRole.service.js: commissioner, owner). It carries
 * an optional `reason` in the same shape as DiscoveryError, so a route can
 * ship it through `serviceErrorBody`.
 *
 * The inverse write, a commissioner removing a Team, lives in
 * commissioner.service.js for now.
 */

class MembershipError extends Error {
  constructor(statusCode, message, { reason } = {}) {
    super(message);
    this.statusCode = statusCode;
    if (reason) this.reason = reason;
  }
}

const NOT_A_MEMBER = 'not a member of this league';

/** Accepts a pool or a checked-out client. True when the user holds a Team in the league. */
async function isMember(db, leagueId, userId) {
  if (!leagueId || !userId) return false;
  const result = await db.query(
    `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
    [leagueId, userId]
  );
  return !!result.rows[0];
}

/**
 * The member's Team row, or the standard 403 refusal. `forUpdate` locks the
 * Team row for callers about to mutate it (mirrors leagueRole.requireOwner).
 */
async function requireMember(db, { leagueId, userId, forUpdate = false }) {
  if (!leagueId || !userId) throw new MembershipError(403, NOT_A_MEMBER);
  const result = await db.query(
    `SELECT * FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [leagueId, userId]
  );
  const team = result.rows[0];
  if (!team) throw new MembershipError(403, NOT_A_MEMBER);
  return team;
}

module.exports = {
  MembershipError,
  isMember,
  requireMember,
};
