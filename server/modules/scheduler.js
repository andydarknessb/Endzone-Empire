const pool = require('./pool');
const { processAllDueWaivers } = require('../services/waiver.service');
const { processDueTrades } = require('../services/trade.service');
const { processExpiredPickClocks, cancelAllExpiryTimers } = require('../services/pickClock.service');
const { processScheduledDrafts } = require('../services/draftSchedule.service');
const { withAdvisoryLock } = require('./advisoryLock');
const { fantasySeasonLiveWhereSql } = require('../services/leaguePhase');

/**
 * In-process job runner for time-based league mechanics (waiver clearing,
 * trade review windows, live stat sync + scoring). Each job's DB work is
 * transactional with row locks, so a manual commissioner trigger racing the
 * schedule is safe.
 */
const INTERVAL_MS = 5 * 60 * 1000;
const DRAFT_CLOCK_MS = 10 * 1000; // pick timers need much finer granularity
// Stat sync at most every ~30 min (6 ticks). This is the Tank01 box-score
// cadence during live windows and the single biggest lever on monthly spend, so
// it's env-tunable and doubles automatically once quota goes degraded.
const SYNC_EVERY_TICKS = Number(process.env.SYNC_EVERY_TICKS) || 6;

async function syncEveryTicks() {
  try {
    const { getQuotaState } = require('./tank01Client');
    const { mode } = await getQuotaState();
    return mode === 'degraded' ? SYNC_EVERY_TICKS * 2 : SYNC_EVERY_TICKS;
  } catch (err) {
    return SYNC_EVERY_TICKS;
  }
}

let timer = null;
let draftTimer = null;
let bootTimer = null;
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
// nflverse IDP finalization pass runs once per calendar day on Mon-Thu
// (nflverse's own "cleanest by Thursday" publishing window). Same
// in-process, idempotent, repeat-safe pattern as the stat-correction pass.
let lastNflverseDay = null;
let lastRetentionDay = null;
// Tank01 injury refresh uses the same successful-run day stamp: failures retry
// next tick, while an ineligible designation already committed cannot re-flag.
let lastInjurySyncDay = null;
// ADP market refresh (#747): same successful-run day stamp. No credential gate -
// FFC is free and keyless, so it runs all year. A thrown run does not stamp, so
// the next tick retries; a thin-market run (recorded ok = false, market left
// intact by the wipe guard) does stamp, so it does not hammer FFC all day - the
// stale freshness signal is what surfaces the problem instead.
let lastAdpSyncDay = null;

async function tickUnlocked() {
  if (running) return; // don't overlap slow runs
  running = true;
  try {
    // Data-freshness and deadline duties FIRST, each in its own containment:
    // corrections and finalization so the holdout captures corrected inputs,
    // then the holdout capture itself — a duty with a hard real-world
    // deadline must not sit behind waivers, trades, or live scoring, any of
    // which can throw and abort the rest of a tick.
    try {
      await runDailyStatCorrections();
    } catch (err) {
      // The throw already did its real job: it fired before the correction day
      // was stamped, so the next 5-minute tick retries the pass. Containing it
      // here keeps one bad correction day from also skipping every other duty.
      console.error('daily stat corrections failed (will retry next tick):', err.message);
    }
    try {
      await runNflverseFinalization();
    } catch (err) {
      console.error('nflverse finalization failed (will retry next tick):', err.message);
    }
    try {
      await runDailyInjurySync();
    } catch (err) {
      console.error('daily injury sync failed (will retry next tick):', err.message);
    }
    try {
      await runDailyAdpSync();
    } catch (err) {
      console.error('daily adp sync failed (will retry next tick):', err.message);
    }
    try {
      await runHoldoutSnapshots();
    } catch (err) {
      console.error('holdout snapshot pass failed (will retry next tick):', err.message);
    }
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
          console.error('waiver digest failed for league %s:', leagueId, err.message);
        }
      }
    }
    try {
      const digest = require('../services/digest.service');
      await digest.sendLineupReminders(); // self-limits to the pre-kickoff window
    } catch (err) {
      console.error('lineup reminders failed:', err.message);
    }
    // Pick'em-only leagues follow the NFL calendar: point them at the right
    // week BEFORE the reminders read current_week, and complete any whose
    // week-18 slate has finalized right after.
    try {
      await runPickemWeekSync();
    } catch (err) {
      console.error("pick'em week sync failed:", err.message);
    }
    try {
      const digest = require('../services/digest.service');
      await digest.sendPickemReminders(); // same pre-kickoff window, Pick'em leagues only
    } catch (err) {
      console.error("pick'em reminders failed:", err.message);
    }
    try {
      await runPickemSeasonCompletion();
    } catch (err) {
      console.error("pick'em season completion failed:", err.message);
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
    if (ticksSinceSync >= (await syncEveryTicks())) {
      const synced = await syncAndScoreLiveWeeks();
      if (synced) ticksSinceSync = 0;
    }
    await runRetention();
    lastTickError = null;
  } catch (err) {
    console.error('scheduler tick failed:', err.message);
    lastTickError = err.message;
  } finally {
    lastTickAt = new Date().toISOString();
    running = false;
  }
}

async function runRetention() {
  const today = new Date().toLocaleDateString('en-CA');
  if (lastRetentionDay === today) return;
  const { enforceRetention } = require('../services/retention.service');
  const counts = await enforceRetention();
  lastRetentionDay = today;
  if (Object.values(counts).some((count) => count > 0)) {
    console.log('scheduler: retention cleanup completed', counts);
  }
}

async function runDailyInjurySync({ now = new Date() } = {}) {
  if (!process.env.RAPID_API_KEY || !process.env.RAPID_API_HOST) return null;
  const today = now.toLocaleDateString('en-CA');
  if (lastInjurySyncDay === today) return null;
  const scoring = require('../services/scoring.service');
  const result = await scoring.syncInjuries();
  lastInjurySyncDay = today;
  return result;
}

/**
 * Daily ADP market refresh (#747). Runs at most once per local calendar day,
 * all year - FFC is free and keyless, so unlike the injury sync there is no
 * credential gate. The wipe guard and the data_sync_runs record live inside
 * adp.syncAdp(); this wrapper only enforces once-a-day and stamps the day after
 * a run that did not throw, so a transient upstream failure retries next tick.
 */
async function runDailyAdpSync({ now = new Date() } = {}) {
  const today = now.toLocaleDateString('en-CA');
  if (lastAdpSyncDay === today) return null;
  const adp = require('../services/adp.service');
  const result = await adp.syncAdp();
  lastAdpSyncDay = today;
  return result;
}

async function tick() {
  return withAdvisoryLock(23001, 'league-scheduler', tickUnlocked);
}

/**
 * Live scoring: if we're inside a game window (an NFL game kicked off within
 * the last 8 hours), pull fresh stats for each active (season, week) and
 * re-score every league sitting on that week. Requires RapidAPI credentials;
 * silently skipped otherwise (the commissioner manual trigger still works).
 * Returns true if a sync ran.
 *
 * Scoring is deliberately decoupled from syncing: scoreMatchups reads only
 * Postgres, so it runs on every eligible in-window tick even when the sync
 * fetched nothing (every game final and already ingested, or quota exhausted).
 * Finals ingested through the recap path still get scored promptly that way,
 * and `scores:updated` still emits — with an empty `plays` list, which is fine.
 */
async function syncAndScoreLiveWeeks() {
  if (!process.env.RAPID_API_KEY || !process.env.RAPID_API_HOST) return false;
  const scoring = require('../services/scoring.service');
  const leaguesResult = await pool.query(
    `SELECT "id", "current_season", "current_week" FROM "leagues"
     WHERE ${fantasySeasonLiveWhereSql()}`
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

    // A failed or fully-shed sync must not stop the DB-only re-score below.
    let plays = [];
    try {
      // Typed touchdown events from this sync ride the scores:updated emit so
      // the live matchup UI can fire team-accurate cutscenes.
      const synced = await scoring.syncWeekStats({ season, week });
      plays = synced.plays || [];
    } catch (err) {
      console.error('live stat sync failed for %s week %s:', season, week, err.message);
    }

    try {
      for (const leagueId of leagueIds) {
        const { scored } = await scoring.scoreMatchups({ leagueId, season, week, plays }); // emits scores:updated
        await alertCloseMatchups({ leagueId, week, scored });
      }
      console.log(`scheduler: live-scored ${leagueIds.length} league(s) for ${season} week ${week}`);
    } catch (err) {
      console.error('live scoring failed for %s week %s:', season, week, err.message);
    }
  }
  if (ranAny) lastSyncAt = new Date().toISOString();
  return ranAny;
}

/**
 * Tue/Wed stat-correction pass: re-pull last week's stats and re-score any
 * league whose scores moved (see correction.service). Runs at most once per
 * calendar day. Source is nflverse — free and, by Tuesday, more accurate than
 * Tank01 — so this pass costs no quota and needs no credentials.
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
  // to the caller's catch in tickUnlocked) retries on the next 5-minute tick
  // instead of silently skipping the rest of a correction day. This covers
  // projection-cache maintenance too — resyncPriorWeeks finishes the whole
  // pass and then throws an aggregate error if any cache operation failed.
  lastCorrectionDay = today;
  if (result.corrected && result.corrected.length > 0) {
    console.log(`scheduler: stat corrections changed scores in ${result.corrected.length} league(s)`);
  }
}

/**
 * Prospective-holdout capture: when any week's first kickoff is inside the
 * capture window, write the append-only pre-kickoff snapshot for each
 * predeclared scoring profile (see holdout.service). No day-stamp on
 * purpose: the snapshot's unique identity makes every retry idempotent, a
 * completed snapshot costs one SELECT to skip, and outside the window the
 * due-weeks query returns nothing. Failures are logged per profile with
 * season/week context — a single line can be transient, REPEATED lines are
 * actionable (the DB cutoff will eventually fail the week closed).
 */
async function runHoldoutSnapshots() {
  const holdout = require('../services/holdout.service');
  const { captured, failures } = await holdout.captureDueSnapshots();
  const written = captured.filter((c) => !c.skipped);
  if (written.length > 0) {
    console.log(
      `scheduler: captured ${written.length} holdout snapshot(s): ` +
      written.map((c) => `${c.season} w${c.week} ${c.profileName} (${c.inserted} rows)`).join(', ')
    );
  }
  for (const f of failures) {
    console.error(
      'holdout snapshot failed for %s week %s profile %s:',
      f.season, f.week, f.profileName, f.message
    );
  }
}

/**
 * Mon-Thu nflverse IDP-finalization pass: patch in sack/TFL/fumble-return
 * yardage and individual safety for the prior week's defenders (see
 * nflverseSync.service) and re-score any league whose scores moved. Runs at
 * most once per calendar day; needs no credentials (nflverse is public).
 */
async function runNflverseFinalization() {
  const nflverseSync = require('../services/nflverseSync.service');
  if (!nflverseSync.isNflverseFinalizationDay()) return;
  const today = new Date().toLocaleDateString('en-CA');
  if (lastNflverseDay === today) return;
  const result = await nflverseSync.finalizePriorWeeks();
  lastNflverseDay = today;
  if (result.finalized && result.finalized.length > 0) {
    console.log(`scheduler: nflverse finalization updated IDP stats for ${result.finalized.length} week(s)`);
  }
}

/**
 * Pick'em-only leagues follow the NFL calendar (they have no matchups, so the
 * commissioner advance-week action can never run for them). Point each one at
 * the week it should be on; runs right BEFORE the pick'em reminders so the
 * reminders read the fresh week in the same tick.
 */
async function runPickemWeekSync({ now = new Date() } = {}) {
  const pickemSeason = require('../services/pickemSeason.service');
  const changes = await pickemSeason.syncPickemOnlyWeeks({ now });
  if (changes.length > 0) {
    console.log(
      `scheduler: pick'em week sync moved ${changes.length} league(s): ` +
      changes.map((c) => (
        c.toSeason
          ? `${c.leagueId} ${c.fromSeason} w${c.from}->${c.toSeason} w${c.to}`
          : `${c.leagueId} w${c.from}->w${c.to}`
      )).join(', ')
    );
  }
  return changes;
}

/**
 * Complete any pick'em-only league whose week-18 slate has finalized: freeze
 * standings (season_status = complete), award the pick'em champion trophy or
 * co-champion trophies, and tell the league. Idempotent: a completed league
 * is no longer a candidate, and the trophy write is ON CONFLICT DO NOTHING.
 */
async function runPickemSeasonCompletion({ now = new Date() } = {}) {
  const pickemSeason = require('../services/pickemSeason.service');
  const completed = await pickemSeason.completePickemSeasons({ now });
  if (completed.length > 0) {
    console.log(
      `scheduler: completed the pick'em season for ${completed.length} league(s): ` +
      completed.map((c) => `${c.leagueId} (${c.season}, ${c.champions.length} champion(s))`).join(', ')
    );
  }
  return completed;
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
          body: `Week ${week}: separated by just ${Math.round(margin * 10) / 10} points. Keep watching.`,
          url: `/#/league/${leagueId}/game-center`,
        }
      );
    } catch (err) {
      console.error('close matchup alert failed:', err.message);
    }
  }
}

/** Fast loop: expired draft pick clocks -> server-side auto-pick. */
async function draftTickUnlocked() {
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

async function draftTick() {
  // The sweep contains its own failures (pickClock.processExpiredPickClocks);
  // this catch is the backstop for the advisory-lock acquisition itself (the
  // pool connect or the try-lock query), so a bad tick can never reach
  // setInterval as an unhandled rejection and take the worker - and the live
  // draft's clock - down for minutes (#600).
  try {
    return await withAdvisoryLock(23002, 'draft-clock', draftTickUnlocked);
  } catch (err) {
    console.error('draft clock tick failed to acquire its lock:', err.message);
    return undefined;
  }
}

function startScheduler() {
  if (timer) return timer;
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref(); // never keep the process alive just for the scheduler
  draftTimer = setInterval(draftTick, DRAFT_CLOCK_MS);
  draftTimer.unref();
  bootTimer = setTimeout(tick, 15 * 1000);
  bootTimer.unref(); // first pass shortly after boot
  return timer;
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  if (draftTimer) clearInterval(draftTimer);
  if (bootTimer) clearTimeout(bootTimer);
  timer = null;
  draftTimer = null;
  bootTimer = null;
  // Tear down every in-process Pick-clock expiry timer with the scheduler, so a
  // test run or a worker shutdown cannot leak a late Autopick (#601, ADR 0018).
  cancelAllExpiryTimers();
}

/**
 * Snapshot of scheduler health for the /api/health and /api/admin endpoints.
 * Async because it also reports the latest ADP market sync (#747), read from
 * data_sync_runs. It must NEVER throw: health probes and the worker heartbeat
 * call it, so a read failure degrades to lastAdpSync: null, not an exception.
 */
async function getSchedulerStatus() {
  let lastAdpSync = null;
  try {
    const res = await pool.query(
      `SELECT "finished_at", "ok", "detail" FROM "data_sync_runs"
       WHERE "job" = 'adp' ORDER BY "finished_at" DESC, "id" DESC LIMIT 1`
    );
    const row = res.rows[0];
    if (row) {
      lastAdpSync = {
        finishedAt: row.finished_at,
        ok: row.ok,
        matched: row.detail && row.detail.matched != null ? row.detail.matched : null,
      };
    }
  } catch (err) {
    // Never throw (health probes and the worker heartbeat depend on it), but do
    // not degrade silently: a permanently broken read (dropped table, a
    // permission change) would otherwise be indistinguishable from "no run yet"
    // (#747 review 750-f4).
    console.warn('getSchedulerStatus: data_sync_runs read failed, reporting lastAdpSync=null:', err.message);
    lastAdpSync = null;
  }
  return { lastTickAt, lastTickError, lastSyncAt, lastAdpSync };
}

module.exports = {
  startScheduler,
  stopScheduler,
  tick,
  draftTick,
  alertCloseMatchups,
  getSchedulerStatus,
  syncAndScoreLiveWeeks,
  syncEveryTicks,
  runDailyInjurySync,
  runDailyAdpSync,
  runHoldoutSnapshots,
  runPickemWeekSync,
  runPickemSeasonCompletion,
  INTERVAL_MS,
  DRAFT_CLOCK_MS,
  SYNC_EVERY_TICKS,
};
