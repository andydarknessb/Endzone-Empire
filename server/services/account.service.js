const crypto = require('crypto');
const pool = require('../modules/pool');
const encryptLib = require('../modules/encryption');
const { logger } = require('../modules/logger');

class AccountError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const TOKEN_TTL_HOURS = { reset: 2, verify: 48 };

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Deliver account email through SMTP. Production fails closed when delivery is
 * unavailable; non-production suppresses delivery without logging recipient,
 * body, link, or token content.
 */
let transporter = null;

async function deliverEmail({ to, subject, text }) {
  if (process.env.SMTP_URL) {
    try {
      // Optional dependency — only required when SMTP is actually configured
      // eslint-disable-next-line global-require
      const nodemailer = require('nodemailer');
      if (!transporter) transporter = nodemailer.createTransport(process.env.SMTP_URL);
      const delivery = await transporter.sendMail({
        from: process.env.SMTP_FROM || 'no-reply@endzoneempire.gg',
        to,
        subject,
        text,
      });
      logger.info({ deliveryId: delivery.messageId }, 'account email delivered');
      return { delivered: 'smtp' };
    } catch (err) {
      logger.error({ err }, 'account email delivery failed');
      throw new AccountError(503, 'email delivery is temporarily unavailable');
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new AccountError(503, 'email delivery is not configured');
  }
  logger.info({ emailType: subject }, 'account email suppressed outside production');
  return { delivered: 'suppressed' };
}

/** Create a single-use token for a user; returns the raw token (hash stored). */
async function issueToken({ userId, type }) {
  const raw = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO "auth_tokens" ("user_id", "type", "token_hash", "expires_at")
     VALUES ($1, $2, $3, now() + make_interval(hours => $4))`,
    [userId, type, hashToken(raw), TOKEN_TTL_HOURS[type]]
  );
  return raw;
}

/**
 * Start a password reset. Always resolves the same way whether or not the
 * email exists (no account enumeration).
 */
async function requestPasswordReset({ email, appOrigin }) {
  const result = await pool.query(
    `SELECT "id", "email", "username" FROM "users"
     WHERE lower("email") = lower($1) AND "deleted_at" IS NULL`,
    [String(email).trim()]
  );
  const user = result.rows[0];
  if (user) {
    const token = await issueToken({ userId: user.id, type: 'reset' });
    const link = `${appOrigin || 'http://localhost:3000'}/#/reset-password?token=${token}`;
    await deliverEmail({
      to: user.email,
      subject: 'Endzone Empire password reset',
      text: `Hi ${user.username},\n\nReset your password here (valid for ${TOKEN_TTL_HOURS.reset} hours):\n${link}\n\nIf you didn't ask for this, ignore this email.`,
    });
  }
  return { ok: true };
}

/** Complete a password reset with a valid unexpired unused token. */
async function resetPassword({ token, newPassword }) {
  if (!token || typeof token !== 'string') throw new AccountError(400, 'token is required');
  if (
    !newPassword ||
    String(newPassword).length < 8 ||
    String(newPassword).length > 128
  ) {
    throw new AccountError(400, 'password must be between 8 and 128 characters');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tokenResult = await client.query(
      `SELECT * FROM "auth_tokens"
       WHERE "token_hash" = $1 AND "type" = 'reset' AND "used" = false AND "expires_at" > now()
       FOR UPDATE`,
      [hashToken(token)]
    );
    const row = tokenResult.rows[0];
    if (!row) throw new AccountError(400, 'invalid or expired reset token');
    await client.query(
      `UPDATE "users" SET "password" = $1, "updated_at" = now() WHERE "id" = $2`,
      [await encryptLib.encryptPassword(newPassword), row.user_id]
    );
    await client.query(
      `UPDATE "auth_tokens" SET "used" = true, "updated_at" = now() WHERE "id" = $1`,
      [row.id]
    );
    // A password reset invalidates every refresh session for the account
    await client.query(
      `UPDATE "refresh_tokens" SET "revoked" = true, "updated_at" = now()
       WHERE "user_id" = $1 AND "revoked" = false`,
      [row.user_id]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Send (or resend) the email-verification link for a logged-in user. */
async function requestEmailVerification({ userId, appOrigin }) {
  const result = await pool.query(
    `SELECT "id", "email", "username", "email_verified" FROM "users"
     WHERE "id" = $1 AND "deleted_at" IS NULL`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw new AccountError(404, 'user not found');
  if (user.email_verified) return { ok: true, alreadyVerified: true };
  const token = await issueToken({ userId: user.id, type: 'verify' });
  const link = `${appOrigin || 'http://localhost:3000'}/#/verify-email?token=${token}`;
  await deliverEmail({
    to: user.email,
    subject: 'Verify your Endzone Empire email',
    text: `Hi ${user.username},\n\nVerify your email here (valid for ${TOKEN_TTL_HOURS.verify} hours):\n${link}`,
  });
  return { ok: true };
}

/** Complete email verification. */
async function verifyEmail({ token }) {
  if (!token || typeof token !== 'string') throw new AccountError(400, 'token is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tokenResult = await client.query(
      `SELECT * FROM "auth_tokens"
       WHERE "token_hash" = $1 AND "type" = 'verify' AND "used" = false AND "expires_at" > now()
       FOR UPDATE`,
      [hashToken(token)]
    );
    const row = tokenResult.rows[0];
    if (!row) throw new AccountError(400, 'invalid or expired verification token');
    await client.query(
      `UPDATE "users" SET "email_verified" = true, "updated_at" = now() WHERE "id" = $1`,
      [row.user_id]
    );
    await client.query(
      `UPDATE "auth_tokens" SET "used" = true, "updated_at" = now() WHERE "id" = $1`,
      [row.id]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  AccountError,
  hashToken,
  deliverEmail,
  requestPasswordReset,
  resetPassword,
  requestEmailVerification,
  verifyEmail,
};
