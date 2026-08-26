const pool = require('../modules/pool');
const { logTransaction, notify } = require('./activity.service');
const { MembershipError, requireMember } = require('./leagueMembership.service');
const { teamIdentityColumns, teamIdentityJoin } = require('./teamIdentity');

/** Every current commissioner's user id: the owner plus any co-commissioners. */
async function listCommissionerUserIds(db, leagueId, ownerId) {
  const coCommissioners = await listCoCommissioners(db, leagueId);
  return [...new Set([ownerId, ...coCommissioners.map((row) => row.user_id)])];
}

/**
 * Notify every CURRENT commissioner of a league — owner and co-commissioners
 * alike — the counterpart to activity.service's notifyLeague (every team
 * owner). A commissioner-only alert (a scheduled draft that could not
 * auto-start, say) must not reach the creator alone once co-commissioners
 * exist: they hold the same powers and need the same nudge.
 */
async function notifyCommissioners(db, { leagueId, ownerId, type, message, data = {} }) {
  const userIds = await listCommissionerUserIds(db, leagueId, ownerId);
  for (const userId of userIds) {
    await notify(db, { userId, leagueId, type, message, data });
  }
}

/**
 * League roles — the one module answering "who is this manager to this
 * league". The roles form an ordered set, member < commissioner < owner:
 *
 * - "Member" means the manager holds a Team in the league (`teams` row with
 *   their `owner_id`, ADR 0002). The membership reads (`isMember`,
 *   `requireMember`) and the coded `MembershipError` live in
 *   leagueMembership.service.js; this module imports them and adds the two
 *   roles above membership.
 * - "Commissioner" means the league owner (`leagues.owner_id`) OR anyone the
 *   owner has granted a row in `league_commissioners`. Every commissioner-gated
 *   action should authorize through `isLeagueCommissioner` or
 *   `commissionerPredicate`, so adding a co-commissioner grants powers
 *   everywhere at once instead of one endpoint at a time.
 * - "Owner" is the creator alone. Three things stay owner-shaped and must
 *   keep comparing `owner_id` directly: deleting the league, granting or
 *   revoking co-commissioners, and protecting the creator's Team from
 *   removal.
 *
 * A grant ends in three ways, and only the first is a deliberate revocation:
 * the owner revoking it here; the manager's Team being removed, which gives
 * up commissioner powers with it (commissioner.service's removeTeam); and
 * the account being deleted, which revokes every grant it holds inside the
 * deletion's own transaction (privacy.service, #275). Account deletion is a
 * SOFT delete, so no foreign key cascades and that third path has to be
 * written down rather than assumed.
 *
 * Invariant: a commissioner is always a member. Removing a Team already
 * revokes any co-commissioner grant. A deleted account keeps its Team and so
 * keeps its membership; it just stops being a commissioner. Two separate
 * rules bound removal, and only the second of them is an `owner_id`
 * comparison:
 *
 * - No commissioner of either kind may remove their own Team. That compares
 *   the target against the CALLER, never against the owner; see
 *   commissioner.service's removeTeam.
 * - Whoever the caller is, the creator's Team cannot be removed.
 *
 * The next role-shaped question belongs here, not in a new predicate.
 */

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

/**
 * Whether this user is the league's CREATOR, which is a narrower question than
 * `isLeagueCommissioner` and answers only the owner-shaped actions in the
 * header above.
 *
 * It has no call sites today (#188), and that is the thing worth knowing
 * before reaching for it: every commissioner-gated action must authorize
 * through `isLeagueCommissioner` or `commissionerPredicate`, and the three
 * owner-shaped actions each already compare `owner_id` where they stand.
 * Reaching for this is only right once you have decided the rule is genuinely
 * about the creator rather than about the commissioner or the caller, which is
 * precisely the decision #188 found people getting wrong.
 */
async function isLeagueOwner(db, leagueId, userId) {
  if (!leagueId || !userId) return false;
  const result = await db.query(
    `SELECT 1 FROM "leagues" WHERE "id" = $1 AND "owner_id" = $2`,
    [leagueId, userId]
  );
  return !!result.rows[0];
}

/**
 * The co-commissioners of a league, oldest grant first, as ROWS and not as a
 * payload. Each row carries the grant's account id, the account name and the
 * grantee's Team identity (#112, parent #108); who may see which of those is
 * `serializeCoCommissioners`' question, not this one. The join is LEFT because
 * a co-commissioner grant outlives the team briefly when a commissioner
 * removes the team before revoking the role.
 *
 * `user_id` stays in this projection and the split lives downstream for one
 * reason worth stating where the SELECT is: `listCommissionerUserIds` reads it
 * to fan commissioner notifications out (see the top of this file), and it is
 * the only thing that answers "which accounts get told". Narrowing the SQL to
 * what a member may read would stop those notifications and turn nothing red -
 * a commissioner would simply never hear about a trade again (#324).
 */
async function listCoCommissioners(db, leagueId) {
  const result = await db.query(
    `SELECT "league_commissioners"."user_id", "league_commissioners"."created_at",
            "users"."username",
            ${teamIdentityColumns()}
       FROM "league_commissioners"
       JOIN "users" ON "users"."id" = "league_commissioners"."user_id"
       ${teamIdentityJoin('"league_commissioners"."league_id"', '"league_commissioners"."user_id"')}
      WHERE "league_commissioners"."league_id" = $1
      ORDER BY "league_commissioners"."created_at", "league_commissioners"."user_id"`,
    [leagueId]
  );
  return result.rows;
}

/**
 * The co-commissioner roster as one viewer may read it (#324). Every path that
 * puts this roster on the wire goes through here - league detail, and the
 * grant and revoke responses below - so there is one answer to "what does a
 * co-commissioner entry look like" rather than one per route.
 *
 * CONTEXT.md's Team identity entry admits no exception for role disclosure:
 * that a manager holds commissioner power over you is a property of their
 * TEAM, and a member learns it by Team identity alone. So the member-visible
 * entry is Team identity and nothing else.
 *
 * A commissioner additionally gets `user_id`, because the endpoints behind the
 * grant and revoke UI are account-shaped (POST /co-commissioners takes a
 * `userId`, DELETE names one in the path) and a commissioner cannot revoke
 * without it. That is the same viewer test `invite_code` is stripped by on the
 * same response, decided on the same boolean an adjacent line below - though
 * by argument rather than by `delete`, which is the safer of the two forms
 * because it defaults NARROW: a caller that forgets to say who is asking gets
 * the view that leaks nothing, where a forgotten `delete` leaks everything.
 * The account NAME is not part of what grant and revoke need, so it rides for
 * nobody; the roster is rendered by Team on every surface.
 *
 * `grantedAt` rides with the id, and is the one thing besides the Team that
 * tells two grants apart. It has to exist because Team identity does NOT
 * guarantee uniqueness: `teams.name` carries no unique constraint and
 * CONTEXT.md blesses duplicates outright ("a duplicate Team name is still
 * valid identity"), so a roster CAN hold two entries a commissioner cannot
 * otherwise distinguish - and the ruling still requires that they see enough
 * to revoke the right one. It is a fact about the grant rather than about the
 * account, so it is no exception to the Team identity rule, and it is
 * commissioner-conditional only because a member has no revoke to aim.
 *
 * The two views also differ on a grant whose Team is gone. It has no Team
 * identity to show, so it cannot appear in a member-visible view at all - but
 * a commissioner still has to be able to see it in order to revoke it, so it
 * is filtered out of the member's view rather than dropped from both.
 */
function serializeCoCommissioners(rows, { isCommissioner = false } = {}) {
  return (rows || [])
    .filter((row) => isCommissioner || row.teamId != null)
    .map((row) => ({
      ...(isCommissioner ? { user_id: row.user_id, grantedAt: row.created_at ?? null } : {}),
      teamId: row.teamId == null ? null : row.teamId,
      teamName: row.teamName == null ? null : row.teamName,
    }));
}

/**
 * The Team IDs whose manager holds a co-commissioner grant, for flagging the
 * teams a league-shared payload already carries (#324).
 *
 * Read off the roster rows' own Team identity rather than off `owner_id`, so
 * the flag is derived the way every other league-shared fact is and does not
 * quietly depend on an account field that #115 removed. A grant whose Team is
 * gone contributes no id, which is the same reason it shows a member nothing:
 * there is no Team to flag.
 */
function coCommissionerTeamIds(rows) {
  return new Set((rows || []).map((row) => row.teamId).filter((teamId) => teamId != null));
}

/** Owner-only: load the league for a mutation, or throw 403/404. */
async function requireOwner(client, { leagueId, userId, forUpdate = false }) {
  const result = await client.query(
    `SELECT * FROM "leagues" WHERE "id" = $1${forUpdate ? ' FOR UPDATE' : ''}`,
    [leagueId]
  );
  const league = result.rows[0];
  if (!league) throw new MembershipError(404, 'league not found');
  if (league.owner_id !== userId) {
    throw new MembershipError(403, 'only the league owner can manage co-commissioners');
  }
  return league;
}

/**
 * Owner grants commissioner powers to another member of the league, named by
 * Team. The client identifies the grantee by `targetTeamId` (teams[] is Team
 * identity only now, #343); the account behind that team is resolved HERE, so
 * no shared payload ever carried it. Authorization stays account-shaped and
 * private: requireOwner and the creator check below both compare account ids.
 */
async function grantCoCommissioner({ leagueId, userId, targetTeamId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const league = await requireOwner(client, { leagueId, userId, forUpdate: true });
    // Resolve the Team to the account behind it, privately. The username rides
    // into the activity-log detail (the same projection the notification
    // fan-out reads), never onto a shared payload.
    const member = await client.query(
      `SELECT "teams"."owner_id", "users"."username"
         FROM "teams" JOIN "users" ON "users"."id" = "teams"."owner_id"
        WHERE "teams"."league_id" = $1 AND "teams"."id" = $2`,
      [leagueId, targetTeamId]
    );
    if (!member.rows[0]) throw new MembershipError(400, 'that team is not a member of this league');
    const { owner_id: targetUserId, username } = member.rows[0];
    // Sanctioned direct owner_id comparison, the second of the three in the
    // header: granting the role. The creator already holds it, so they can
    // never be a grantee, and the comparison genuinely is about the owner
    // rather than about the caller.
    if (targetUserId === league.owner_id) {
      throw new MembershipError(400, 'the league owner is already the commissioner');
    }

    const inserted = await client.query(
      `INSERT INTO "league_commissioners" ("league_id", "user_id", "granted_by")
       VALUES ($1, $2, $3) ON CONFLICT ("league_id", "user_id") DO NOTHING
       RETURNING "user_id"`,
      [leagueId, targetUserId, userId]
    );
    if (!inserted.rows[0]) throw new MembershipError(409, 'that user is already a co-commissioner');

    await logTransaction(client, {
      leagueId,
      teamId: targetTeamId,
      type: 'commissioner',
      detail: { action: 'grant_co_commissioner', userId: targetUserId, username },
    });
    await notify(client, {
      userId: targetUserId,
      leagueId,
      type: 'league',
      message: `You were made a co-commissioner of ${league.name}`,
    });
    // Serialized, not raw: this is a PAYLOAD, and the roster leaves the server
    // in one shape wherever it leaves from. `isCommissioner: true` because
    // requireOwner already gated this and the owner is one; that is what makes
    // the same call correct here and viewer-dependent on league detail.
    const coCommissioners = serializeCoCommissioners(
      await listCoCommissioners(client, leagueId),
      { isCommissioner: true }
    );
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
    if (!removed.rows[0]) throw new MembershipError(404, 'that user is not a co-commissioner');

    // A co-commissioner is always a member (header invariant; removing a Team
    // deletes the grant in the same transaction, see commissioner.service),
    // so the revoked user's Team is there to name in the log.
    const team = await requireMember(client, { leagueId, userId: targetUserId });
    await logTransaction(client, {
      leagueId,
      teamId: team.id,
      type: 'commissioner',
      detail: { action: 'revoke_co_commissioner', userId: targetUserId },
    });
    await notify(client, {
      userId: targetUserId,
      leagueId,
      type: 'league',
      message: `You are no longer a co-commissioner of ${league.name}`,
    });
    // Serialized for the same reason as the grant above, and owner-gated the
    // same way.
    const coCommissioners = serializeCoCommissioners(
      await listCoCommissioners(client, leagueId),
      { isCommissioner: true }
    );
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
  commissionerPredicate,
  isLeagueCommissioner,
  isLeagueOwner,
  listCoCommissioners,
  serializeCoCommissioners,
  coCommissionerTeamIds,
  listCommissionerUserIds,
  notifyCommissioners,
  requireOwner,
  grantCoCommissioner,
  revokeCoCommissioner,
};
