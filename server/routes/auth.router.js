const express = require('express');
const pool = require('../modules/pool');
const encryptLib = require('../modules/encryption');
const { signToken, requireAuth } = require('../modules/auth');
const account = require('../services/account.service');
const tokens = require('../services/token.service');
const {
  clearRefreshCookie,
  getRefreshToken,
  requireTrustedOrigin,
  setRefreshCookie,
} = require('../modules/refreshCookie');
const { logger } = require('../modules/logger');

const router = express.Router();

function appOrigin(req) {
  return process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

router.post('/register', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const { password } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }
  if (username.length > 80 || email.length > 255) {
    return res.status(400).json({ error: 'username or email is too long' });
  }
  if (String(password).length < 8 || String(password).length > 128) {
    return res.status(400).json({ error: 'password must be between 8 and 128 characters' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT 1 FROM "users"
       WHERE lower("username") = lower($1) OR lower("email") = lower($2)`,
      [username, email]
    );
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'username or email already in use' });
    }
    const hash = await encryptLib.encryptPassword(password);
    const result = await client.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, $3) RETURNING "id", "username", "email"`,
      [username, email, hash]
    );
    const user = result.rows[0];
    const refreshToken = await tokens.issueRefreshToken({ userId: user.id }, client);
    await client.query('COMMIT');
    setRefreshCookie(res, refreshToken);
    return res.status(201).json({ token: signToken(user), user });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ error: 'username or email already in use' });
    }
    logger.error({ err: error }, 'registration failed');
    return res.status(500).json({ error: 'registration failed' });
  } finally {
    client.release();
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  try {
    const result = await pool.query(
      `SELECT "id", "username", "email", "password" FROM "users"
       WHERE lower("username") = lower($1) AND "deleted_at" IS NULL`,
      [String(username).trim()]
    );
    const user = result.rows[0];
    if (!user || !(await encryptLib.comparePassword(password, user.password))) {
      return res.status(401).json({ error: 'invalid username or password' });
    }
    delete user.password;
    const refreshToken = await tokens.issueRefreshToken({ userId: user.id });
    setRefreshCookie(res, refreshToken);
    return res.json({ token: signToken(user), user });
  } catch (error) {
    logger.error({ err: error }, 'login failed');
    return res.status(500).json({ error: 'login failed' });
  }
});

router.post('/refresh', requireTrustedOrigin, async (req, res) => {
  const refreshToken = getRefreshToken(req);
  try {
    const rotated = await tokens.rotateRefreshToken({ token: refreshToken });
    const result = await pool.query(
      `SELECT "id", "username", "email" FROM "users"
       WHERE "id" = $1 AND "deleted_at" IS NULL`,
      [rotated.userId]
    );
    const user = result.rows[0];
    if (!user) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'invalid refresh token' });
    }
    setRefreshCookie(res, rotated.refreshToken);
    return res.json({
      token: signToken(user, { authenticatedAt: rotated.authenticatedAt }),
      user,
    });
  } catch (error) {
    if (error.code !== 'REFRESH_RACE') clearRefreshCookie(res);
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    logger.error({ err: error }, 'token refresh failed');
    return res.status(500).json({ error: 'token refresh failed' });
  }
});

router.post('/logout', requireTrustedOrigin, async (req, res) => {
  try {
    await tokens.revokeRefreshToken({ token: getRefreshToken(req) });
  } catch (error) {
    logger.error({ err: error }, 'logout revocation failed');
  }
  clearRefreshCookie(res);
  return res.json({ ok: true });
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }
  try {
    await account.requestPasswordReset({ email, appOrigin: appOrigin(req) });
    return res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (error) {
    logger.error({ err: error }, 'forgot password failed');
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'failed to start password reset',
    });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  try {
    await account.resetPassword({ token, newPassword: password });
    return res.json({ ok: true });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    logger.error({ err: error }, 'password reset failed');
    return res.status(500).json({ error: 'password reset failed' });
  }
});

router.post('/send-verification', requireAuth, async (req, res) => {
  try {
    const result = await account.requestEmailVerification({
      userId: req.user.id,
      appOrigin: appOrigin(req),
    });
    return res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    logger.error({ err: error }, 'send verification failed');
    return res.status(500).json({ error: 'failed to send verification email' });
  }
});

router.post('/verify-email', async (req, res) => {
  const { token } = req.body || {};
  try {
    const result = await account.verifyEmail({ token });
    return res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    logger.error({ err: error }, 'email verification failed');
    return res.status(500).json({ error: 'email verification failed' });
  }
});

module.exports = router;
