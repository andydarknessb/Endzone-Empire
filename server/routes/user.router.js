const express = require('express');
const pool = require('../modules/pool');
const { requireAuth, requireRecentAuth, isPlatformAdmin } = require('../modules/auth');
const { clearRefreshCookie, requireTrustedOrigin } = require('../modules/refreshCookie');
const privacy = require('../services/privacy.service');
const clock = require('../modules/clock');
const homeStatus = require('../services/homeStatus.service');
const postgameCutscene = require('../services/postgameCutscene.service');

const router = express.Router();

// GET /api/user — current user's profile (from JWT)
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT "id", "username", "email", "email_verified", "created_at"
       FROM "users" WHERE "id" = $1 AND "deleted_at" IS NULL`,
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'user not found' });
    // Display hint only — every /api/admin route re-checks server-side
    res.json({ ...result.rows[0], isPlatformAdmin: isPlatformAdmin(req.user.id) });
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ error: 'internal server error' });
  }
});

// GET /api/user/action-items?tz=America/Chicago — the caller's Home to-do
// list across every league they belong to (Home v2, contract A): live
// drafts, lineup problems, open picks, trade reviews and offers, open seats,
// join requests and pending waiver claims. `tz` is the viewer's IANA zone,
// required because dueToday is a calendar question and the server never
// guesses one. The builders and their batched, owner-scoped reads live in
// homeStatus.service; a builder that fails is named in `partial` and the
// rest still answer.
router.get('/action-items', requireAuth, async (req, res) => {
  const { tz } = req.query;
  if (!homeStatus.isValidTimeZone(tz)) {
    return res.status(400).json({ error: 'tz must be a valid IANA time zone' });
  }
  try {
    res.json(await homeStatus.actionItems(pool, { userId: req.user.id, now: clock.now(), tz }));
  } catch (error) {
    console.error('Error building action items:', error);
    res.status(500).json({ error: 'failed to build action items' });
  }
});

// GET /api/user/postgame-cutscenes — the caller's due Postgame cutscenes
// (ADR 0052): final Matchups of their Teams they have not seen and that have
// not expired, empty when they turned the preference off. Team identity only.
router.get('/postgame-cutscenes', requireAuth, async (req, res) => {
  try {
    const cutscenes = await postgameCutscene.listDue({ userId: req.user.id, now: clock.now(), db: pool });
    res.json({ cutscenes });
  } catch (error) {
    console.error('Error listing postgame cutscenes:', error);
    res.status(500).json({ error: 'failed to list postgame cutscenes' });
  }
});

// POST /api/user/postgame-cutscenes/:matchupId/seen — record that the caller
// has seen (or skipped) a Matchup's cutscene. Idempotent: 204 every time;
// 404 when they hold no Team in that Matchup; 400 on a non-integer id.
router.post('/postgame-cutscenes/:matchupId/seen', requireAuth, async (req, res) => {
  const { matchupId } = req.params;
  // A Postgres int column: an id past 2^31-1 could never name a Matchup.
  if (!/^[1-9]\d{0,9}$/.test(matchupId) || Number(matchupId) > 2147483647) {
    return res.status(400).json({ error: 'matchupId must be a positive integer' });
  }
  try {
    const stored = await postgameCutscene.markSeen({ userId: req.user.id, matchupId: Number(matchupId), db: pool });
    if (!stored) return res.status(404).json({ error: 'matchup not found' });
    return res.status(204).end();
  } catch (error) {
    console.error('Error marking postgame cutscene seen:', error);
    return res.status(500).json({ error: 'failed to mark postgame cutscene seen' });
  }
});

router.get('/export', requireAuth, async (req, res) => {
  try {
    const data = await privacy.exportUserData(req.user.id);
    const filename = `endzone-empire-export-${new Date().toISOString().slice(0, 10)}.json`;
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.set('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify(data, null, 2));
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
        requestId: req.id,
      });
    }
    return res.status(500).json({
      code: 'EXPORT_FAILED',
      message: 'Account export failed',
      requestId: req.id,
    });
  }
});

router.delete(
  '/',
  requireAuth,
  requireRecentAuth(),
  requireTrustedOrigin,
  async (req, res) => {
    try {
      const result = await privacy.deleteUserAccount({
        userId: req.user.id,
        confirmation: req.body?.confirmation,
      });
      clearRefreshCookie(res);
      return res.json(result);
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: req.id,
        });
      }
      return res.status(500).json({
        code: 'ACCOUNT_DELETION_FAILED',
        message: 'Account deletion failed',
        requestId: req.id,
      });
    }
  }
);

module.exports = router;
