const express = require('express');
const pool = require('../modules/pool');
const { requireAuth, requireRecentAuth, isPlatformAdmin } = require('../modules/auth');
const { clearRefreshCookie, requireTrustedOrigin } = require('../modules/refreshCookie');
const privacy = require('../services/privacy.service');
const clock = require('../modules/clock');
const homeStatus = require('../services/homeStatus.service');

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
