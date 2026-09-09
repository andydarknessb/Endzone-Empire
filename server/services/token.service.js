const crypto = require('crypto');
const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
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
  // withTransaction owns connect, BEGIN, COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). work returns a discriminated result so no exit
  // COMMITs or ROLLBACKs by hand:
  //   - reuse: revoke the family and RETURN, so the wrapper COMMITs the revoke;
  //     the caller throws the 401 after the commit (today's COMMIT-then-throw
  //     order, preserved).
  //   - invalid/race: THROW the same TokenErrors as before; the wrapper rolls
  //     the read-only transaction back and rethrows them untouched. There is no
  //     write to keep, so the old `instanceof TokenError` skip has nothing left
  //     to do and is gone.
  //   - rotate: mark used, issue the successor, and return the happy fields.
  const outcome = await withTransaction(
    pool,
    async (client) => {
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
        return { verdict: 'reuse', userId: row.user_id };
      }
      if (verdict === 'invalid') {
        throw new TokenError(401, 'invalid refresh token');
      }
      if (verdict === 'race') {
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
      return {
        verdict: 'rotate',
        userId: row.user_id,
        refreshToken,
        authenticatedAt: row.authenticated_at,
      };
    },
    { label: 'refresh-token' }
  );

  if (outcome.verdict === 'reuse') {
    logger.warn({ userId: outcome.userId }, 'refresh token reuse detected; family revoked');
    throw new TokenError(401, 'invalid refresh token');
  }
  return {
    userId: outcome.userId,
    refreshToken: outcome.refreshToken,
    authenticatedAt: outcome.authenticatedAt,
  };
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
