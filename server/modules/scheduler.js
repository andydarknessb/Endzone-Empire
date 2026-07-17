const pool = require('./pool');
const { processAllDueWaivers } = require('../services/waiver.service');
const { processDueTrades } = require('../services/trade.service');
const { processExpiredPickClocks } = require('../services/autopick.service');
const { processScheduledDrafts } = require('../services/draftSchedule.service');

/**
 * In-process job runner for time-based league mechanics (waiver clearing,
 * trade review windows, live stat sync + scoring). Each job's DB work is
 * transactional with row locks, so a manual commissioner trigger racing the
 * schedule is safe.
 */
const INTERVAL_MS = 5 * 60 * 1000;
const DRAFT_CLOCK_MS = 10 * 1000; // pick timers need much finer granularity
const SYNC_EVERY_TICKS = 6; // stat sync at most every ~30 min

let timer = null;
let draftTimer = null;
let running = false;
let draftRunning = false;
let ticksSinceSync = SYNC_EVERY_TICKS; // sync on the first eligible tick

// Minimal health-check state for /api/health — updated by tick() and
// syncAndScoreLiveWeeks() below, read via getSchedulerStatus().
let lastTickAt = null;
let lastTickError = null;
let lastSyncAt = null;
// Stat-correction pass runs once per calendar day on Tue/Wed (the NFL's
// correction window). In-process only: a restart may repeat the pass the
// same day, which is safe — the whole pipeline is idempotent.
let lastCorrectionDay = null;

async function tick() {
  if (running) return; // don't overlap slow runs
  running = true;
  try {
    const waivers = await processAllDueWaivers();
    if (waivers.length > 0) {
      console.log(`scheduler: processed waivers for ${waivers.length} league(s)`);
      // Owners get an email summary of their just-resolved claims
      const digest = require('../services/digest.service');
      for (const processed of waivers) {
        const leagueId = processed.leagueId != null ? processed.leagueId : processed;
        try {
          await digest.sendWaiverResultsDigest({ leagueId });
        } catch (err) {
          console.error(`waiver digest failed for league ${leagueId}:`, err.message);
        }
      }
    }
    try {
      const digest = require('../services/digest.service');
      await digest.sendLineupReminders(); // self-limits to the pre-kickoff window
    } catch (err) {
      console.error('lineup reminders failed:', err.message);
    }
    const trades = await processDueTrades();
    if (trades.length > 0) console.log(`scheduler: settled ${trades.length} trade(s)`);
    try {
      const draftActions = await processScheduledDrafts();
      if (draftActions.length > 0) {
        console.log(`scheduler: ran ${draftActions.length} scheduled-draft action(s)`);
      }
    } catch (err) {
      console.error('scheduled drafts failed:', err.message);
    }
    ticksSinceSync += 1;
    if (ticksSinceSync >= SYNC_EVERY_TICKS) {
      const synced = await syncAndScoreLiveWeeks();
      if (synced) ticksSinceSync = 0;
    }
    await runDailyStatCorrections();
    lastTickError = null;
  } catch (err) {
    console.error('scheduler tick failed:', err.message);
    lastTickError = err.message;
  } finally {
    lastTickAt = new Date().toISOString();
    running = false;
  }
}

/**
 * Live scoring: if we're inside a game window (an NFL game kicked off within
 * the last 8 hours), pull fresh stats for each active (season, week) and
 * re-score every league sitting on that week. Requires RapidAPI credentials;
 * silently skipped otherwise (the commissioner manual trigger still works).
 * Returns true if a sync ran.
 */
async function syncAndScoreLiveWeeks() {
  if (!process.env.RAPID_API_KEY || !process.env.RAPID_API_HOST) return false;
  const scoring = require('../services/scoring.service');
  const leaguesResult = await pool.query(
    `SELECT "id", "current_season", "current_week" FROM "leagues"
     WHERE "season_status" != 'complete' AND "draft_status" = 'complete'`
  );
  if (leaguesResult.rows.length === 0) return false;

  const weeks = new Map(); // 'season:week' -> { season, week, leagueIds: [] }
  for (const league of leaguesResult.rows) {
    const key = `${league.current_season}:${league.current_week}`;
    if (!weeks.has(key)) {
      weeks.set(key, { season: league.current_season, week: league.current_week, leagueIds: [] });
    }
    weeks.get(key).leagueIds.push(league.id);
  }

  let ranAny = false;
  for (const { season, week, leagueIds } of weeks.values()) {
    const live = await pool.query(
      `SELECT 1 FROM "nfl_games"
       WHERE "season" = $1 AND "week" = $2
         AND "kickoff_at" BETWEEN now() - interval '8 hours' AND now()
       LIMIT 1`,
      [season, week]
    );
    if (!live.rows[0]) continue; // no game window right now
    ranAny = true;
    try {
      await scoring.syncWeekStats({ season, week });
      for (const leagueId of leagueIds) {
        const { scored } = await scoring.scoreMatchups({ leagueId, season, week }); // emits scores:updated
        await alertCloseMatchups({ leagueId, week, scored });
      }
      console.log(`scheduler: live-scored ${leagueIds.length} league(s) for ${season} week ${week}`);
    } catch (err) {
      console.error(`live scoring failed for ${season} week ${week}:`, err.message);
    }
  }
  if (ranAny) lastSyncAt = new Date().toISOString();
  return ranAny;
}

/**
 * Tue/Wed stat-correction pass: re-pull last week's stats and re-score any
 * league whose scores moved (see correction.service). Runs at most once per
 * calendar day; no-ops without RapidAPI credentials.
 */
async function runDailyStatCorrections() {
  const correction = require('../services/correction.service');
  if (!correction.isCorrectionDay()) return;
  // Local calendar date, matching isCorrectionDay's local day-of-week — a
  // UTC date key could double-run within one local Tue/Wed in TZs ahead of UTC.
  const today = new Date().toLocaleDateString('en-CA');
  if (lastCorrectionDay === today) return;
  const result = await correction.resyncPriorWeeks();
  // Stamp the day only after a successful pass: a transient failure (bubbling
  // to tick()'s catch) retries on the next 5-minute tick instead of silently
  // skipping the rest of a correction day.
  lastCorrectionDay = today;
  if (result.corrected && result.corrected.length > 0) {
    console.log(`scheduler: stat corrections changed scores in ${result.corrected.length} league(s)`);
  }
}

// "Your matchup is close" alerts: at most one per matchup per week (in-process
// set — a restart may re-alert once, acceptable for best-effort nudges).
const closeAlertedMatchups = new Set();
const CLOSE_MARGIN = 10;

/**
 * During live scoring windows, push-alert both owners of any matchup within
 * CLOSE_MARGIN points — but only late in the window (both teams have points
 * on the board), so week-opening 0-0 "ties" don't fire.
 */
async function alertCloseMatchups({ leagueId, week, scored }) {
  const push = require('../services/push.service');
  for (const m of scored || []) {
    const key = `${m.matchupId}:${week}`;
    if (closeAlertedMatchups.has(key)) continue;
    const margin = Math.abs(Number(m.homeScore) - Number(m.awayScore));
    if (m.homeScore <= 0 || m.awayScore <= 0 || margin > CLOSE_MARGIN) continue;
    closeAlertedMatchups.add(key);
    try {
      const owners = await pool.query(
        `SELECT "owner_id" FROM "teams" WHERE "id" = ANY($1::int[])`,
        [[m.homeTeamId, m.awayTeamId]]
      );
      const { usersWanting } = require('../services/prefs.service');
      await push.sendPushToUsers(
        await usersWanting(owners.rows.map((r) => r.owner_id), 'closeMatchups'),
        {
          title: 'Your matchup is close!',
          body: `Week ${week}: separated by just ${Math.round(margin * 10) / 10} points — keep watching.`,
          url: `/#/league/${leagueId}/matchups`,
        }
      );
    } catch (err) {
      console.error('close matchup alert failed:', err.message);
    }
  }
}

/** Fast loop: expired draft pick clocks -> server-side auto-pick. */
async function draftTick() {
  if (draftRunning) return;
  draftRunning = true;
  try {
    const picks = await processExpiredPickClocks();
    if (picks.length > 0) console.log(`scheduler: auto-picked for ${picks.length} league(s)`);
  } catch (err) {
    console.error('draft clock tick failed:', err.message);
  } finally {
    draftRunning = false;
  }
}

function startScheduler() {
  if (timer) return timer;
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref(); // never keep the process alive just for the scheduler
  draftTimer = setInterval(draftTick, DRAFT_CLOCK_MS);
  draftTimer.unref();
  setTimeout(tick, 15 * 1000).unref(); // first pass shortly after boot
  return timer;
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  if (draftTimer) clearInterval(draftTimer);
  timer = null;
  draftTimer = null;
}

/** Snapshot of scheduler health for the /api/health endpoint. */
function getSchedulerStatus() {
  return { lastTickAt, lastTickError, lastSyncAt };
}

module.exports = {
  startScheduler,
  stopScheduler,
  tick,
  draftTick,
  getSchedulerStatus,
  INTERVAL_MS,
  DRAFT_CLOCK_MS,
};
