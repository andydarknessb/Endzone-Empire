const express = require('express');
const pool = require('../modules/pool');
const encryptLib = require('../modules/encryption');
const { signToken, requireAuth } = require('../modules/auth');
const account = require('../services/account.service');

const router = express.Router();

function appOrigin(req) {
  return process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

// POST /api/auth/register — create an account and return a JWT
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  try {
    const hash = encryptLib.encryptPassword(password);
    const result = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, $3) RETURNING "id", "username", "email"`,
      [username, email, hash]
    );
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'username or email already in use' });
    }
    console.error('Registration failed:', error);
    res.status(500).json({ error: 'registration failed' });
  }
});

// POST /api/auth/login — verify credentials and return a JWT
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  try {
    const result = await pool.query(
      `SELECT "id", "username", "email", "password" FROM "users" WHERE "username" = $1`,
      [username]
    );
    const user = result.rows[0];
    if (!user || !encryptLib.comparePassword(password, user.password)) {
      return res.status(401).json({ error: 'invalid username or password' });
    }
    delete user.password;
    res.json({ token: signToken(user), user });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: 'login failed' });
  }
});

// POST /api/auth/forgot-password — start a reset; always 200 (no enumeration)
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }
  try {
    await account.requestPasswordReset({ email, appOrigin: appOrigin(req) });
    res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (error) {
    console.error('Forgot password failed:', error);
    res.status(500).json({ error: 'failed to start password reset' });
  }
});

// POST /api/auth/reset-password — { token, password }
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  try {
    await account.resetPassword({ token, newPassword: password });
    res.json({ ok: true });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Password reset failed:', error);
    res.status(500).json({ error: 'password reset failed' });
  }
});

// POST /api/auth/send-verification — logged-in user (re)sends their link
router.post('/send-verification', requireAuth, async (req, res) => {
  try {
    const result = await account.requestEmailVerification({
      userId: req.user.id,
      appOrigin: appOrigin(req),
    });
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Send verification failed:', error);
    res.status(500).json({ error: 'failed to send verification email' });
  }
});

// POST /api/auth/verify-email — { token }
router.post('/verify-email', async (req, res) => {
  const { token } = req.body || {};
  try {
    const result = await account.verifyEmail({ token });
    res.json(result);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Email verification failed:', error);
    res.status(500).json({ error: 'email verification failed' });
  }
});

module.exports = router;
