const crypto = require('crypto');
const pool = require('../modules/pool');
const encryptLib = require('../modules/encryption');
const { deleteAvatarObjects } = require('./avatar.service');

class PrivacyError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

async function exportUserData(userId) {
  const [
    profile,
    memberships,
    ownedLeagues,
    notifications,
    chatMessages,
    chatReads,
    privacyRequests,
  ] = await Promise.all([
    pool.query(
      `SELECT "id", "username", "email", "email_verified", "created_at", "updated_at"
       FROM "users" WHERE "id" = $1 AND "deleted_at" IS NULL`,
      [userId]
    ),
    pool.query(
      `SELECT "teams"."id" AS "team_id", "teams"."name" AS "team_name",
              "teams"."league_id", "leagues"."name" AS "league_name", "teams"."created_at"
       FROM "teams" JOIN "leagues" ON "leagues"."id" = "teams"."league_id"
       WHERE "teams"."owner_id" = $1 ORDER BY "teams"."created_at"`,
      [userId]
    ),
    pool.query(
      `SELECT "id", "name", "created_at" FROM "leagues"
       WHERE "owner_id" = $1 ORDER BY "created_at"`,
      [userId]
    ),
    pool.query(
      `SELECT "league_id", "type", "message", "read", "created_at"
       FROM "notifications" WHERE "user_id" = $1 ORDER BY "created_at"`,
      [userId]
    ),
    pool.query(
      `SELECT "league_id", "message", "created_at"
       FROM "chat_messages" WHERE "user_id" = $1 ORDER BY "created_at"`,
      [userId]
    ),
    pool.query(
      `SELECT "league_id", "last_read_at"
       FROM "chat_reads" WHERE "user_id" = $1 ORDER BY "league_id"`,
      [userId]
    ),
    pool.query(
      `SELECT "request_type", "status", "created_at", "completed_at"
       FROM "data_privacy_requests" WHERE "user_id" = $1 ORDER BY "created_at"`,
      [userId]
    ),
  ]);

  if (!profile.rows[0]) throw new PrivacyError(404, 'USER_NOT_FOUND', 'User not found');
  await pool.query(
    `INSERT INTO "data_privacy_requests"
       ("user_id", "request_type", "status", "details", "completed_at")
     VALUES ($1, 'export', 'completed', '{"format":"json"}', now())`,
    [userId]
  );

  return {
    generatedAt: new Date().toISOString(),
    profile: profile.rows[0],
    memberships: memberships.rows,
    ownedLeagues: ownedLeagues.rows,
    notifications: notifications.rows,
    chatMessages: chatMessages.rows,
    chatReads: chatReads.rows,
    privacyRequests: privacyRequests.rows,
  };
}

async function deleteUserAccount({ userId, confirmation }) {
  const client = await pool.connect();
  let avatars = [];
  try {
    await client.query('BEGIN');
    const userResult = await client.query(
      `SELECT "id", "username" FROM "users"
       WHERE "id" = $1 AND "deleted_at" IS NULL FOR UPDATE`,
      [userId]
    );
    const user = userResult.rows[0];
    if (!user) throw new PrivacyError(404, 'USER_NOT_FOUND', 'User not found');
    if (confirmation !== user.username) {
      throw new PrivacyError(
        400,
        'CONFIRMATION_MISMATCH',
        'Type your username exactly to confirm account deletion'
      );
    }

    const owned = await client.query(
      `SELECT "leagues"."id", "leagues"."name", count("teams"."id")::int AS "team_count"
       FROM "leagues"
       LEFT JOIN "teams" ON "teams"."league_id" = "leagues"."id"
       WHERE "leagues"."owner_id" = $1
       GROUP BY "leagues"."id", "leagues"."name"
       ORDER BY "leagues"."name"`,
      [userId]
    );
    if (owned.rows.length) {
      throw new PrivacyError(
        409,
        'ACCOUNT_OWNS_LEAGUES',
        'Delete your commissioned leagues before deleting your account',
        { leagues: owned.rows }
      );
    }

    const avatarResult = await client.query(
      `SELECT "avatar_url", "avatar_static_url" FROM "teams" WHERE "owner_id" = $1`,
      [userId]
    );
    avatars = avatarResult.rows;
    await client.query(
      `UPDATE "teams" SET "avatar_url" = NULL, "avatar_static_url" = NULL
       WHERE "owner_id" = $1`,
      [userId]
    );
    await client.query('DELETE FROM "chat_messages" WHERE "user_id" = $1', [userId]);
    await client.query('DELETE FROM "chat_reads" WHERE "user_id" = $1', [userId]);
    await client.query('DELETE FROM "notifications" WHERE "user_id" = $1', [userId]);
    await client.query('DELETE FROM "notification_prefs" WHERE "user_id" = $1', [userId]);
    await client.query('DELETE FROM "push_subscriptions" WHERE "user_id" = $1', [userId]);
    await client.query('DELETE FROM "auth_tokens" WHERE "user_id" = $1', [userId]);
    await client.query('DELETE FROM "refresh_tokens" WHERE "user_id" = $1', [userId]);

    const anonymousId = crypto.randomUUID();
    const password = await encryptLib.encryptPassword(crypto.randomBytes(48).toString('base64url'));
    await client.query(
      `UPDATE "users" SET
         "username" = $2,
         "email" = $3,
         "password" = $4,
         "email_verified" = false,
         "deleted_at" = now(),
         "updated_at" = now()
       WHERE "id" = $1`,
      [userId, `deleted-user-${userId}`, `deleted+${anonymousId}@endzone.invalid`, password]
    );
    await client.query(
      `INSERT INTO "data_privacy_requests"
         ("user_id", "request_type", "status", "details", "completed_at")
       VALUES ($1, 'deletion', 'completed', '{"method":"anonymization"}', now())`,
      [userId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  await Promise.all(avatars.map((avatar) => deleteAvatarObjects(avatar)));
  return { ok: true };
}

module.exports = { PrivacyError, deleteUserAccount, exportUserData };
