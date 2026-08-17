const pool = require('../modules/pool');
const { logTransaction, notify } = require('./activity.service');

/**
 * League roles — the one module answering "who is this manager to this
 * league". The roles form an ordered set, member < commissioner < owner:
 *
 * - "Member" means the manager holds a Team in the league (`teams` row with
 *   their `owner_id`, ADR 0002); the Team is the only record of membership.
 *   Every league-scoped read and write is gated on it and should authorize
 *   through this module: `isMember` when a yes/no is enough (the caller keeps
 *   its own refusal), or `requireMember` when the caller wants the Team row
 *   or the standard refusal. `requireMember` refuses by throwing the coded
 *   403 ("not a member of this league"), so call it only where the surrounding
 *   catch renders `error.statusCode`; a route that maps every error to 500
 *   should use `isMember`.
 * - "Commissioner" means the league owner (`leagues.owner_id`) OR anyone the
 *   owner has granted a row in `league_commissioners`. Every commissioner-gated
 *   action should authorize through `isLeagueCommissioner` or
 *   `commissionerPredicate`, so adding a co-commissioner grants powers
 *   everywhere at once instead of one endpoint at a time.
 * - "Owner" is the creator alone. Two things stay owner-only and must keep
 *   checking `owner_id` directly: deleting the league, and granting/revoking
 *   co-commissioners.
 *
 * Invariant: a commissioner is always a member. Removing a Team already
 * revokes any co-commissioner grant, and the creator's Team cannot be removed.
 * The next role-shaped question belongs here, not in a new predicate.
 */

class LeagueRoleError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * SQL predicate — true when user $n is the owner or a co-commissioner of the
 * `leagues` row in scope. Takes the parameter index so a call site can drop it
 * into an existing query without renumbering its other parameters. Written as
 * an EXISTS subquery rather than a join so it stays legal under FOR UPDATE.
 */
function commissionerPredicate(n) {
  return `("leagues"."owner_id" = $${n} OR EXISTS (
      SELECT 1 FROM "league_commissioners"
      WHERE "league_commissioners"."league_id" = "leagues"."id"
        AND "league_commissioners"."user_id" = $${n}))`;
}

/** Accepts a pool or a checked-out client — both expose .query(). */
async function isLeagueCommissioner(db, leagueId, userId) {
  if (!leagueId || !userId) return false;
  const result = await db.query(
    `SELECT 1 FROM "leagues" WHERE "id" = $1 AND ${commissionerPredicate(2)}`,
    [leagueId, userId]
  );
  return !!result.rows[0];
}

async function isLeagueOwner(db, leagueId, userId) {
  if (!leagueId || !userId) return false;
  const result = await db.query(
    `SELECT 1 FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2`,
    [leagueId, userId]
  );
  return !!result.rows[0];
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
 * Team row for callers about to mutate it (mirrors `requireOwner`).
 */
async function requireMember(db, { leagueId, userId, forUpdate = false }) {
  if (!leagueId || !userId) throw new LeagueRoleError(403, NOT_A_MEMBER);
  const result = await db.query(
    `SELECT * FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [leagueId, userId]
  );
  const team = result.rows[0];
  if (!team) throw new LeagueRoleError(403, NOT_A_MEMBER);
  return team;
}

/** The co-commissioners of a league, oldest grant first. */
async function listCoCommissioners(db, leagueId) {
  const result = await db.query(
    `SELECT "league_commissioners"."user_id", "users"."username"
       FROM "league_commissioners"
       JOIN "users" ON "users"."id" = "league_commissioners"."user_id"
      WHERE "league_commissioners"."league_id" = $1
      ORDER BY "league_commissioners"."created_at", "league_commissioners"."user_id"`,
    [leagueId]
  );
  return result.rows;
}

/** Owner-only: load the league for a mutation, or throw 403/404. */
async function requireOwner(client, { leagueId, userId, forUpdate = false }) {
  const result = await client.query(
    `SELECT * FROM "leagues" WHERE "id" = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [leagueId]
  );
  const league = result.rows[0];
  if (!league) throw new LeagueRoleError(404, 'league not found');
  if (league.owner_id !== userId) {
    throw new LeagueRoleError(403, 'only the league owner can manage co-commissioners');
  }
  return league;
}

/** Owner grants commissioner powers to another member of the league. */
async function grantCoCommissioner({ leagueId, userId, targetUserId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const league = await requireOwner(client, { leagueId, userId, forUpdate: true });
    if (targetUserId === league.owner_id) {
      throw new LeagueRoleError(400, 'the league owner is already the commissioner');
    }
    const member = await client.query(
      `SELECT "teams"."id", "users"."username"
         FROM "teams" JOIN "users" ON "users"."id" = "teams"."owner_id"
        WHERE "teams"."league_id" = $1 AND "teams"."owner_id" = $2`,
      [leagueId, targetUserId]
    );
    if (!member.rows[0]) throw new LeagueRoleError(400, 'that user is not a member of this league');
    const { id: teamId, username } = member.rows[0];

    const inserted = await client.query(
      `INSERT INTO "league_commissioners" ("league_id", "user_id", "granted_by")
       VALUES ($1, $2, $3) ON CONFLICT ("league_id", "user_id") DO NOTHING
       RETURNING "user_id"`,
      [leagueId, targetUserId, userId]
    );
    if (!inserted.rows[0]) throw new LeagueRoleError(409, 'that user is already a co-commissioner');

    await logTransaction(client, {
      leagueId,
      teamId,
      type: 'commissioner',
      detail: { action: 'grant_co_commissioner', userId: targetUserId, username },
    });
    await notify(client, {
      userId: targetUserId,
      leagueId,
      type: 'league',
      message: `You were made a co-commissioner of ${league.name}`,
    });
    const coCommissioners = await listCoCommissioners(client, leagueId);
    await client.query('COMMIT');
    return { leagueId, userId: targetUserId, coCommissioners };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Owner removes a co-commissioner's powers. */
async function revokeCoCommissioner({ leagueId, userId, targetUserId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const league = await requireOwner(client, { leagueId, userId, forUpdate: true });
    const removed = await client.query(
      `DELETE FROM "league_commissioners"
        WHERE "league_id" = $1 AND "user_id" = $2 RETURNING "user_id"`,
      [leagueId, targetUserId]
    );
    if (!removed.rows[0]) throw new LeagueRoleError(404, 'that user is not a co-commissioner');

    const team = await client.query(
      `SELECT "id" FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
      [leagueId, targetUserId]
    );
    await logTransaction(client, {
      leagueId,
      teamId: team.rows[0]?.id ?? null,
      type: 'commissioner',
      detail: { action: 'revoke_co_commissioner', userId: targetUserId },
    });
    await notify(client, {
      userId: targetUserId,
      leagueId,
      type: 'league',
      message: `You are no longer a co-commissioner of ${league.name}`,
    });
    const coCommissioners = await listCoCommissioners(client, leagueId);
    await client.query('COMMIT');
    return { leagueId, userId: targetUserId, coCommissioners };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  LeagueRoleError,
  commissionerPredicate,
  isLeagueCommissioner,
  isLeagueOwner,
  isMember,
  listCoCommissioners,
  requireMember,
  requireOwner,
  grantCoCommissioner,
  revokeCoCommissioner,
};
