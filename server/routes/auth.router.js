const express = require('express');
const pool = require('../modules/pool');
const encryptLib = require('../modules/encryption');
const { signToken } = require('../modules/auth');

const router = express.Router();

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

module.exports = router;
