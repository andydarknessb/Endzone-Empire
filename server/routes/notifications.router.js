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

// GET /api/notifications/prefs — the caller's delivery preferences (defaults filled in)
router.get('/prefs', async (req, res) => {
  try {
    const prefs = require('../services/prefs.service');
    res.json(await prefs.getPrefs({ userId: req.user.id }));
  } catch (error) {
    console.error('Error fetching notification prefs', error);
    res.status(500).json({ error: 'failed to fetch notification preferences' });
  }
});

// PUT /api/notifications/prefs — partial update { prefs: { weeklyRecap: false, ... } }
router.put('/prefs', async (req, res) => {
  try {
    const prefs = require('../services/prefs.service');
    const updated = await prefs.setPrefs({ userId: req.user.id, prefs: (req.body || {}).prefs });
    res.json(updated);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Error updating notification prefs', error);
    res.status(500).json({ error: 'failed to update notification preferences' });
  }
});

// GET /api/notifications/push-public-key — VAPID public key (null = push unconfigured)
router.get('/push-public-key', (req, res) => {
  const push = require('../services/push.service');
  res.json({ publicKey: push.getPublicKey() });
});

// POST /api/notifications/push-subscribe — store this browser's subscription
router.post('/push-subscribe', async (req, res) => {
  try {
    const push = require('../services/push.service');
    res.status(201).json(
      await push.saveSubscription({ userId: req.user.id, subscription: (req.body || {}).subscription })
    );
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('Push subscribe failed', error);
    res.status(500).json({ error: 'failed to save push subscription' });
  }
});

// DELETE /api/notifications/push-subscribe — { endpoint? } removes one (or all) subscriptions
router.delete('/push-subscribe', async (req, res) => {
  try {
    const push = require('../services/push.service');
    res.json(await push.removeSubscription({ userId: req.user.id, endpoint: (req.body || {}).endpoint }));
  } catch (error) {
    console.error('Push unsubscribe failed', error);
    res.status(500).json({ error: 'failed to remove push subscription' });
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
