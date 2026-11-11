const express = require('express');
const pool = require('../modules/pool');
const { requireAuth } = require('../modules/auth');
const { createRateLimiter } = require('../modules/rateLimit');

const router = express.Router();
router.use(requireAuth);

// A commissioner's join alert stored before #2752 names the requester's account
// in `message` and carries `data.userId`. Only those rows are rewritten, by the
// proposed Team, read from the join request, or by the league alone once that
// request is gone. The requester's own approved and denied notices share the
// type but carry no userId, so they are served as stored. No row is changed.
const isLegacyJoinAlert = (row) => row.type === 'join_request' && 'userId' in (row.data || {});

async function servedJoinAlerts(rows) {
  const legacy = new Set(rows.filter(isLegacyJoinAlert));
  const requestIds = [...legacy].map((row) => row.data.requestId).filter(Number.isInteger);
  const teamNames = new Map();
  if (requestIds.length > 0) {
    const requests = await pool.query(
      `SELECT "id", "team_name" FROM "join_requests" WHERE "id" = ANY($1::int[])`,
      [requestIds]
    );
    for (const request of requests.rows) teamNames.set(request.id, request.team_name);
  }
  return rows.map((row) => {
    if (!legacy.has(row)) return row;
    const requestId = row.data?.requestId ?? null;
    const team = teamNames.get(requestId);
    return {
      ...row,
      message: team
        ? `${team} requested to join ${row.league_name}`
        : `A join request is waiting in ${row.league_name}`,
      data: { requestId },
    };
  });
}

// GET /api/notifications — the caller's newest notifications
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT "notifications".*, "leagues"."name" AS "league_name"
       FROM "notifications"
       LEFT JOIN "leagues" ON "leagues"."id" = "notifications"."league_id"
       WHERE "notifications"."user_id" = $1
       ORDER BY "notifications"."created_at" DESC LIMIT 50`,
      [req.user.id]
    );
    const unread = await pool.query(
      `SELECT COUNT(*)::int AS n FROM "notifications" WHERE "user_id" = $1 AND "read" = false`,
      [req.user.id]
    );
    res.json({ notifications: await servedJoinAlerts(result.rows), unread: unread.rows[0].n });
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

// POST /api/notifications/push-test — a Test alert to the caller's own devices
const pushTestLimiter = createRateLimiter({ name: 'push-test', windowMs: 60 * 1000, max: 5 });
router.post('/push-test', pushTestLimiter, async (req, res) => {
  try {
    res.json(await require('../services/pushAlerts.service').sendAlert({ kind: 'test', userId: req.user.id }));
  } catch (error) {
    console.error('Push test failed', error);
    res.status(500).json({ error: 'failed to send test alert' });
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
