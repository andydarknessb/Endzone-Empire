const express = require('express');
const pool = require('../modules/pool');
const { getSchedulerStatus } = require('../modules/scheduler');

const router = express.Router();

// GET /api/health — liveness/readiness probe for uptime monitors and load
// balancers. Deliberately NOT behind auth or the strict auth limiter (only
// the general /api ceiling) so it stays reachable even while the auth
// limiter is throttling abusive callers.
router.get('/', async (req, res) => {
  const start = Date.now();
  let db;
  try {
    await pool.query('SELECT 1');
    db = { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    db = { ok: false, latencyMs: Date.now() - start };
  }

  res.status(db.ok ? 200 : 503).json({
    ok: db.ok,
    db,
    scheduler: getSchedulerStatus(),
    uptimeSec: Math.round(process.uptime()),
  });
});

module.exports = router;
