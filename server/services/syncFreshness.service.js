const syncRun = require('../modules/syncRun');

const MINUTE_MS = 60 * 1000;

// Left out: season-only jobs (odds, game-context), jobs gated to certain days (stat-corrections, nflverse-week), adp (it refuses with thin_market every day in season), and the irregular nflverse jobs.
// shortcut: limits fitted to production's ok-run gaps on 2026-11-21 (in season: injuries 99th percentile 35 minutes, schedule longest 75, daily jobs up to 35 hours; a job gated per UTC day can run early one day and late the next, hence 48 hours), revisit after the first offseason
const MAX_AGE_MINUTES = {
  injuries: 120,
  schedule: 180,
  players: 2880,
  retention: 2880,
  'espn-roster-status': 2880,
  'espn-depth-chart': 2880,
  'espn-ownership': 2880,
  'schedule-nflverse': 2880,
};

/**
 * Every listed sync whose latest ok run is older than its limit, or that has
 * no ok run at all (`lastOkAt: null`). `ok` is true only when none is overdue.
 */
async function getSyncFreshness({ now = new Date() } = {}) {
  const jobs = Object.keys(MAX_AGE_MINUTES);
  const lastOk = await syncRun.lastOkAtByJob(jobs);
  const overdue = [];
  for (const job of jobs) {
    const lastOkAt = lastOk.get(job) ?? null;
    const maxAgeMinutes = MAX_AGE_MINUTES[job];
    if (lastOkAt === null || now.getTime() - lastOkAt.getTime() > maxAgeMinutes * MINUTE_MS) {
      overdue.push({ job, lastOkAt, maxAgeMinutes });
    }
  }
  return { ok: overdue.length === 0, checked: jobs.length, overdue };
}

module.exports = { getSyncFreshness, MAX_AGE_MINUTES };
