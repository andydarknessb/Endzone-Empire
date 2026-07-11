const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/notifications — the caller's newest notifications
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM "notifications" WHERE "user_id" = $1
       ORDER BY "created_at" DESC LIMIT 50`,
      [req.user.id]
    );
    const unread = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "notifications" WHERE "user_id" = $1 AND "read" = false`,
      [req.user.id]
    );
    res.json({ notifications: result.rows, unread: unread.rows[0].n });
  } catch (error) {
    console.error('Error fetching notifications', error);
    res.status(500).json({ error: 'failed to fetch notifications' });
  }
});

// PUT /api/notifications/read — mark some ({ ids: [] }) or all (no body) as read
router.put('/read', async (req, res) => {
  const { ids } = req.body || {};
  if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id)))) {
    return res.status(400).json({ error: 'ids must be an array of integers' });
  }
  try {
    if (ids) {
      await pool.query(
        `UPDATE "notifications" SET "read" = true
         WHERE "user_id" = $1 AND "id" = ANY($2::int[])`,
        [req.user.id, ids]
      );
    } else {
      await pool.query(
        `UPDATE "notifications" SET "read" = true WHERE "user_id" = $1 AND "read" = false`,
        [req.user.id]
      );
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('Error marking notifications read', error);
    res.status(500).json({ error: 'failed to update notifications' });
  }
});

module.exports = router;
