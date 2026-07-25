const express = require('express');
const pool = require('../modules/pool');
const { requireAuth, isPlatformAdmin } = require('../modules/auth');
const { isLeagueCommissioner, commissionerPredicate } = require('../services/leagueRole.service');

const router = express.Router();
router.use(requireAuth);

router.get('/blocks', async (req, res) => {
  const result = await pool.query(
    `SELECT "users"."id", "users"."username", "user_blocks"."created_at"
     FROM "user_blocks"
     JOIN "users" ON "users"."id" = "user_blocks"."blocked_id"
     WHERE "user_blocks"."blocker_id" = $1 ORDER BY "users"."username"`,
    [req.user.id]
  );
  res.json(result.rows);
});

router.post('/blocks', async (req, res) => {
  const blockedId = Number(req.body?.userId);
  if (!Number.isInteger(blockedId) || blockedId === req.user.id) {
    return res.status(400).json({ error: 'a different userId is required' });
  }
  const sharedLeague = await pool.query(
    `SELECT 1
     FROM "teams" mine
     JOIN "teams" theirs ON theirs."league_id" = mine."league_id"
     WHERE mine."owner_id" = $1 AND theirs."owner_id" = $2 LIMIT 1`,
    [req.user.id, blockedId]
  );
  if (!sharedLeague.rows[0]) return res.status(404).json({ error: 'user not found' });
  await pool.query(
    `INSERT INTO "user_blocks" ("blocker_id", "blocked_id")
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [req.user.id, blockedId]
  );
  return res.status(201).json({ ok: true });
});

router.delete('/blocks/:userId', async (req, res) => {
  const blockedId = Number(req.params.userId);
  if (!Number.isInteger(blockedId)) return res.status(400).json({ error: 'userId is required' });
  await pool.query(
    `DELETE FROM "user_blocks" WHERE "blocker_id" = $1 AND "blocked_id" = $2`,
    [req.user.id, blockedId]
  );
  return res.json({ ok: true });
});

router.post('/reports', async (req, res) => {
  const leagueId = Number(req.body?.leagueId);
  const messageId = req.body?.messageId == null ? null : Number(req.body.messageId);
  const reason = String(req.body?.reason || '').trim();
  if (!Number.isInteger(leagueId) || (messageId != null && !Number.isInteger(messageId))) {
    return res.status(400).json({ error: 'valid leagueId and messageId are required' });
  }
  if (reason.length < 10 || reason.length > 500) {
    return res.status(400).json({ error: 'reason must be between 10 and 500 characters' });
  }
  const allowed = await pool.query(
    `SELECT 1 FROM "teams"
     WHERE "league_id" = $1 AND "owner_id" = $2
       AND ($3::int IS NULL OR EXISTS (
         SELECT 1 FROM "chat_messages"
         WHERE "id" = $3 AND "league_id" = $1
       ))`,
    [leagueId, req.user.id, messageId]
  );
  if (!allowed.rows[0]) return res.status(403).json({ error: 'report target is unavailable' });
  const result = await pool.query(
    `INSERT INTO "content_reports" ("reporter_id", "league_id", "message_id", "reason")
     VALUES ($1, $2, $3, $4) RETURNING "id", "status", "created_at"`,
    [req.user.id, leagueId, messageId, reason]
  );
  return res.status(201).json(result.rows[0]);
});

router.get('/reports/:leagueId', async (req, res) => {
  const leagueId = Number(req.params.leagueId);
  const isCommissioner = await isLeagueCommissioner(pool, leagueId, req.user.id);
  if (!isCommissioner && !isPlatformAdmin(req.user.id)) {
    return res.status(403).json({ error: 'moderator access required' });
  }
  const result = await pool.query(
    `SELECT "content_reports".*, "users"."username" AS "reporter_username"
     FROM "content_reports"
     JOIN "users" ON "users"."id" = "content_reports"."reporter_id"
     WHERE "content_reports"."league_id" = $1
     ORDER BY "content_reports"."created_at" DESC`,
    [leagueId]
  );
  return res.json(result.rows);
});

router.put('/reports/:id', async (req, res) => {
  const reportId = Number(req.params.id);
  const status = String(req.body?.status || '');
  if (!Number.isInteger(reportId) || !['resolved', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'valid report id and status are required' });
  }
  const result = await pool.query(
    `UPDATE "content_reports" SET
       "status" = $1, "resolved_by" = $2, "resolved_at" = now(), "updated_at" = now()
     WHERE "id" = $3 AND (
       EXISTS (
         SELECT 1 FROM "leagues"
         WHERE "leagues"."id" = "content_reports"."league_id"
           AND ${commissionerPredicate(2)}
       )
       OR $4::boolean = true
     )
     RETURNING "id", "status", "resolved_at"`,
    [status, req.user.id, reportId, isPlatformAdmin(req.user.id)]
  );
  if (!result.rows[0]) return res.status(403).json({ error: 'moderator access required' });
  return res.json(result.rows[0]);
});

module.exports = router;
