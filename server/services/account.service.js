const crypto = require('crypto');
const pool = require('../modules/pool');
const encryptLib = require('../modules/encryption');

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
 * Deliver an account email. With SMTP_URL configured, nodemailer (optional
 * dependency) sends it; otherwise the link is logged so local/dev flows stay
 * usable end to end without an email provider.
 */
async function deliverEmail({ to, subject, text }) {
  if (process.env.SMTP_URL) {
    try {
      // Optional dependency — only required when SMTP is actually configured
      // eslint-disable-next-line global-require
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport(process.env.SMTP_URL);
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'no-reply@endzone-empire.local',
        to,
        subject,
        text,
      });
      return { delivered: 'smtp' };
    } catch (err) {
      console.error('SMTP delivery failed, falling back to console:', err.message);
    }
  }
  console.log(`[email to ${to}] ${subject}\n${text}`);
  return { delivered: 'console' };
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
    `SELECT "id", "email", "username" FROM "users" WHERE "email" = $1`,
    [email]
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
  if (!newPassword || String(newPassword).length < 8) {
    throw new AccountError(400, 'password must be at least 8 characters');
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
      [encryptLib.encryptPassword(newPassword), row.user_id]
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

/** Send (or resend) the email-verification link for a logged-in user. */
async function requestEmailVerification({ userId, appOrigin }) {
  const result = await pool.query(
    `SELECT "id", "email", "username", "email_verified" FROM "users" WHERE "id" = $1`,
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
  requestPasswordReset,
  resetPassword,
  requestEmailVerification,
  verifyEmail,
};
