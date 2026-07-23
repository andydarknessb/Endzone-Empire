const crypto = require('crypto');
const pool = require('../modules/pool');
const { hashToken } = require('./account.service');
const { logger } = require('../modules/logger');

class TokenError extends Error {
  constructor(statusCode, message, code = 'INVALID_REFRESH_TOKEN') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const REFRESH_TTL_DAYS = 30;
// Two browser tabs share one refresh cookie but can refresh independently; the
// loser of that race presents a just-rotated token. Within this window that is
// treated as a benign 401 instead of an attack that kills the token family.
const REUSE_GRACE_MS = 60 * 1000;

/**
 * Decide what to do with a presented refresh token row.
 * Pure so the security-critical branching is unit-testable:
 *   'rotate'  — valid, unexpired, never used: rotate it.
 *   'reuse'   — rotated away longer than the grace window ago: someone is
 *               replaying an old token. Caller must revoke the entire family.
 *   'race'    — a just-rotated token presented by another browser tab:
 *               plain 401, but the shared cookie must not be cleared.
 *   'invalid' — unknown, revoked, or expired: plain 401, nothing to revoke.
 */
function classifyRefreshToken(row, now = new Date()) {
  if (!row) return 'invalid';
  if (row.revoked) return 'invalid'; // family already dead (logout or prior reuse)
  if (row.used) {
    const rotatedAt = new Date(row.updated_at || 0);
    return now - rotatedAt <= REUSE_GRACE_MS ? 'race' : 'reuse';
  }
  if (new Date(row.expires_at) <= now) return 'invalid';
  return 'rotate';
}

/** Issue a refresh token for a user; returns the raw token (hash stored). */
async function issueRefreshToken({ userId, familyId, authenticatedAt }, client = pool) {
  const raw = crypto.randomBytes(32).toString('hex');
  const family = familyId || crypto.randomUUID();
  await client.query(
    `INSERT INTO "refresh_tokens"
       ("user_id", "family_id", "token_hash", "expires_at", "authenticated_at")
     VALUES ($1, $2, $3, now() + make_interval(days => $4), COALESCE($5, now()))`,
    [userId, family, hashToken(raw), REFRESH_TTL_DAYS, authenticatedAt || null]
  );
  return raw;
}

/**
 * Rotate a refresh token: mark the presented one used and issue a successor
 * in the same family. Reuse of an already-rotated token revokes the family.
 * Returns { userId, refreshToken } on success.
 */
async function rotateRefreshToken({ token }) {
  if (!token || typeof token !== 'string') {
    throw new TokenError(400, 'refreshToken is required');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT * FROM "refresh_tokens" WHERE "token_hash" = $1 FOR UPDATE`,
      [hashToken(token)]
    );
    const row = result.rows[0];
    const verdict = classifyRefreshToken(row);
    if (verdict === 'reuse') {
      await client.query(
        `UPDATE "refresh_tokens" SET "revoked" = true, "updated_at" = now()
         WHERE "family_id" = $1 AND "revoked" = false`,
        [row.family_id]
      );
      await client.query('COMMIT');
      logger.warn({ userId: row.user_id }, 'refresh token reuse detected; family revoked');
      throw new TokenError(401, 'invalid refresh token');
    }
    if (verdict === 'invalid') {
      await client.query('ROLLBACK');
      throw new TokenError(401, 'invalid refresh token');
    }
    if (verdict === 'race') {
      await client.query('ROLLBACK');
      throw new TokenError(401, 'invalid refresh token', 'REFRESH_RACE');
    }
    await client.query(
      `UPDATE "refresh_tokens" SET "used" = true, "updated_at" = now() WHERE "id" = $1`,
      [row.id]
    );
    const refreshToken = await issueRefreshToken(
      {
        userId: row.user_id,
        familyId: row.family_id,
        authenticatedAt: row.authenticated_at,
      },
      client
    );
    await client.query('COMMIT');
    return {
      userId: row.user_id,
      refreshToken,
      authenticatedAt: row.authenticated_at,
    };
  } catch (error) {
    if (!(error instanceof TokenError)) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Logout: revoke the presented token's whole family. Succeeds silently on unknown tokens. */
async function revokeRefreshToken({ token }) {
  if (!token || typeof token !== 'string') return { ok: true };
  await pool.query(
    `UPDATE "refresh_tokens" SET "revoked" = true, "updated_at" = now()
     WHERE "family_id" = (SELECT "family_id" FROM "refresh_tokens" WHERE "token_hash" = $1)
       AND "revoked" = false`,
    [hashToken(token)]
  );
  return { ok: true };
}

/** Kill every session for a user (password reset / commissioner action). */
async function revokeAllForUser({ userId }, client = pool) {
  await client.query(
    `UPDATE "refresh_tokens" SET "revoked" = true, "updated_at" = now()
     WHERE "user_id" = $1 AND "revoked" = false`,
    [userId]
  );
  return { ok: true };
}

module.exports = {
  TokenError,
  REFRESH_TTL_DAYS,
  REUSE_GRACE_MS,
  classifyRefreshToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};
