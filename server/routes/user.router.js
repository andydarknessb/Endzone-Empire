const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');

const router = express.Router();

// GET /api/user — current user's profile (from JWT)
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT "id", "username", "email", "created_at" FROM "users" WHERE "id" = $1`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'user not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ error: 'internal server error' });
  }
});

module.exports = router;
