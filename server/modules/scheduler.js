const pool = require('./pool');
const { processAllDueWaivers } = require('../services/waiver.service');
const { processDueTrades } = require('../services/trade.service');
const { processExpiredPickClocks, cancelAllExpiryTimers } = require('../services/pickClock.service');
const draftSweepLiveness = require('./draftSweepLiveness');
const { processScheduledDrafts } = require('../services/draftSchedule.service');
const { withAdvisoryLock } = require('./advisoryLock');
const { fantasySeasonLiveWhereSql } = require('../services/leaguePhase');
const { lastRun } = require('./syncRun');

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
// The Tank01 injury refresh keeps its once-a-day stamp in data_sync_runs, not
// here (#1188): see runDailyInjurySync.
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
      await runHourlyOddsSync();
    } catch (err) {
      console.error('hourly odds sync failed (will retry next tick):', err.message);
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

/** Cadence of the injury sync inside a game window (#1188); env-tunable, doubled while quota is degraded. */
function injuryGameWindowMs(quotaMode) {
  const parsed = Number(process.env.INJURY_GAME_WINDOW_MS);
  const base = Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
  return quotaMode === 'degraded' ? base * 2 : base;
}

/**
 * The last successful injury sync, read via `lastRun('injuries')`
 * (server/modules/syncRun.js, ADR 0036, #1205) rather than a hand-rolled
 * query: the in-memory day stamp reset on every worker restart, so "daily"
 * ran 3.4 times a day (#1188). Null when no successful run exists or the read
 * fails (which then runs the sync: the safe direction). Deliberately reads
 * `latestOk`, not `latest`: a failed run must not move the once-a-day gate,
 * so the next tick retries it.
 */
async function lastInjurySyncAt() {
  try {
    const { latestOk } = await lastRun('injuries');
    return latestOk ? latestOk.finishedAt : null;
  } catch (err) {
    console.warn('runDailyInjurySync: data_sync_runs read failed, treating as never run:', err.message);
    return null;
  }
}

/**
 * Is an NFL game window open right now? From first kickoff minus 90 minutes
 * until the last game of the slate goes final, read off live_game_states
 * (#1188). A slate three days out is not a window; a slate whose every game is
 * final is not either.
 */
async function inGameWindow() {
  try {
    const res = await pool.query(
      `SELECT 1 FROM "live_game_states"
        WHERE "game_status" <> 'final'
          AND "start_time" IS NOT NULL
          AND "start_time" <= now() + interval '90 minutes'
          AND "start_time" >= now() - interval '12 hours'
        LIMIT 1`
    );
    return Boolean(res.rows[0]);
  } catch (err) {
    console.warn('runDailyInjurySync: game-window read failed, treating as outside a window:', err.message);
    return false;
  }
}

/**
 * Pure: should the injury sync run now? Once per local day outside a game
 * window; every `windowMs` inside one (#1188).
 *
 * @param {{ now: Date, lastRunAt: ?Date, inWindow: boolean, windowMs: number }} args
 */
function injurySyncDue({ now, lastRunAt, inWindow, windowMs }) {
  if (!lastRunAt) return true;
  if (inWindow) return now.getTime() - lastRunAt.getTime() >= windowMs;
  return lastRunAt.toLocaleDateString('en-CA') !== now.toLocaleDateString('en-CA');
}

/**
 * Tank01 injury refresh: daily, and every INJURY_GAME_WINDOW_MS during a game
 * window. The once-a-day gate reads the last successful `injuries` run from
 * data_sync_runs (written by syncInjuries itself), so a worker restart cannot
 * re-run it (#1188). A thrown run records ok=false and does not move the gate,
 * so the next tick retries.
 */
async function runDailyInjurySync({ now = new Date() } = {}) {
  if (!process.env.RAPID_API_KEY || !process.env.RAPID_API_HOST) return null;
  const [lastRunAt, inWindow] = await Promise.all([lastInjurySyncAt(), inGameWindow()]);
  let quotaMode = 'ok';
  if (inWindow) {
    try {
      quotaMode = (await require('./tank01Client').getQuotaState()).mode;
    } catch (err) {
      quotaMode = 'ok';
    }
  }
  if (!injurySyncDue({ now, lastRunAt, inWindow, windowMs: injuryGameWindowMs(quotaMode) })) return null;
  const scoring = require('../services/scoring.service');
  return scoring.syncInjuries();
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

const ODDS_SYNC_INTERVAL_MS = 60 * 60 * 1000; // hourly (#1234, ADR 0036/0037)
let lastOddsSyncAt = 0; // epoch ms; 0 forces a sync on the first eligible tick

/**
 * Hourly Line refresh (#1234, ADR 0036/0037): ESPN's scoreboard needs no key
 * and is not quota-metered, so unlike the injury sync this job has no
 * credential gate, and an in-memory interval gate is safe even across a
 * worker restart - the worst case is one extra free, unmetered fetch, not a
 * wasted budget. Runs the odds Sync run (services/espnOdds.provider.js) once
 * per distinct (season, week) slate any live fantasy league is currently on,
 * read with the same `fantasySeasonLiveWhereSql()` predicate
 * `syncAndScoreLiveWeeks` uses below (that function then dedupes in JS and
 * keeps each league's id; this one only needs the distinct pairs, so it lets
 * SQL do the DISTINCT and discards ids) - so a league mid-transition to a new
 * week still gets both weeks' slates priced.
 * A single week's throw is logged and does not stop the other weeks' syncs;
 * the interval is stamped once the set of weeks is known, so a read failure
 * here retries next tick same as everywhere else in this module.
 */
async function runHourlyOddsSync({ now = new Date() } = {}) {
  if (now.getTime() - lastOddsSyncAt < ODDS_SYNC_INTERVAL_MS) return null;
  const leaguesResult = await pool.query(
    `SELECT DISTINCT "current_season", "current_week" FROM "leagues"
     WHERE ${fantasySeasonLiveWhereSql()}`
  );
  lastOddsSyncAt = now.getTime();
  const odds = require('../services/espnOdds.provider');
  const results = [];
  for (const row of leaguesResult.rows) {
    const season = row.current_season;
    const week = row.current_week;
    try {
      results.push(await odds.syncOdds({ season, week }));
    } catch (err) {
      console.error('odds sync failed for %s week %s:', season, week, err.message);
    }
  }
  return results;
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
    // The sweep ran (it contains its own failures, so returning IS running):
    // stamp the liveness key /api/health/worker reads (#842). Never throws.
    await draftSweepLiveness.recordDraftSweep();
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
 * Every feed-sync job the Sync run module records (ADR 0036), in the order
 * `syncRuns` below reports them. Declared once so `getSchedulerStatus` and any
 * future reader share one spelling (#1205). `live-box` is deliberately
 * excluded: its data_sync_runs row is a source-switch signal, not a Sync run
 * (#1197 R5, ADR 0035).
 */
const SYNC_RUN_JOBS = [
  'injuries', 'adp', 'week-stats', 'schedule', 'schedule-nflverse',
  'players', 'season-stats', 'team-defenses', 'nflverse-week', 'odds',
];

// The only outcomes runSyncJob ever tags a non-ok row with (server/modules/
// syncRun.js). Anything else - a legacy row written before that module
// existed, such as an old ADP row's `reason: 'thin_market'` - reports
// outcome: null rather than inventing a value (#1205).
const SYNC_RUN_OUTCOMES = new Set(['refused', 'fetch_failed', 'bad_response', 'write_failed']);

/**
 * `{ finishedAt, ok, outcome, failedWeeks }` for one `lastRun(job).latest`
 * row, or null. `failedWeeks` (#1242) is `detail.failedWeeks.length` when
 * `detail` is an object and `detail.failedWeeks` is an array, else `null` -
 * the key absent, present but not an array, or `detail` itself null, missing,
 * or not an object (a legacy row) all read as `null`, never a throw. It is
 * read-only and never feeds `outcome`: an `ok` run with 13 failed weeks still
 * reports `outcome: 'ok'`.
 */
function toLatestStatus(latest) {
  if (!latest) return null;
  const detail = latest.detail;
  const isDetailObject = detail !== null && typeof detail === 'object';
  const reason = isDetailObject && detail.reason;
  const failedWeeks = isDetailObject && Array.isArray(detail.failedWeeks) ? detail.failedWeeks.length : null;
  return {
    finishedAt: latest.finishedAt,
    ok: latest.ok,
    outcome: latest.ok ? 'ok' : (SYNC_RUN_OUTCOMES.has(reason) ? reason : null),
    failedWeeks,
  };
}

/** `{ finishedAt }` for one `lastRun(job).latestOk` row, or null. */
function toLatestOkStatus(latestOk) {
  return latestOk ? { finishedAt: latestOk.finishedAt } : null;
}

/**
 * One job's `lastRun` read, never rejecting: resolves `{ job, run, failed }`,
 * `run` being `null` on a failed read so the caller can degrade that job to
 * `{ latest: null, latestOk: null }` without a try/catch of its own.
 */
async function readSyncRunStatus(job) {
  try {
    return { job, run: await lastRun(job), failed: false };
  } catch (err) {
    return { job, run: null, failed: true, message: err.message };
  }
}

/**
 * Snapshot of scheduler health for the /api/health and /api/admin endpoints.
 * Async because it reads every feed-sync job's latest Sync run (ADR 0036) via
 * `lastRun(job)` (server/modules/syncRun.js): `lastRun` is the one round trip
 * every Sync run job reads back through, and each job gets its own read so
 * one job's failure cannot hide another's status. It must NEVER throw: health
 * probes and the worker heartbeat call it every 60s, so a read failure
 * degrades that job to nulls, not an exception - and however many of the
 * `SYNC_RUN_JOBS` reads fail in one call, at most one warning is logged for
 * it, not one per job (#1205).
 *
 * `lastAdpSync` reports the latest ADP run regardless of outcome (unchanged
 * behaviour since #747, still `{ finishedAt, ok, matched }`); `lastAdpSuccess`
 * reports the latest OK run - "last successful sync" (CONTEXT.md) - as
 * `{ finishedAt, matched }`, `ok` being implied true (#1201). Both are derived
 * from the same `lastRun('adp')` read `syncRuns.adp` uses, not a second query.
 *
 * `syncRuns` (#1205) is new: an object keyed by job literal (`SYNC_RUN_JOBS`),
 * each value `{ latest, latestOk }`. `latest` is
 * `{ finishedAt, ok, outcome, failedWeeks }` (`failedWeeks` added by #1242,
 * see `toLatestStatus`) or null when the job has never run (or its migration
 * has not landed:
 * nothing to read is indistinguishable from nothing recorded yet). `latestOk`
 * is `{ finishedAt }` or null. This widens only the admin route and the
 * worker heartbeat's job status - `publishSchedulerStatus`
 * (server/routes/health.router.js) keeps its existing whitelist, so the
 * public `/api/health` payload is unchanged.
 */
async function getSchedulerStatus() {
  const results = await Promise.all(SYNC_RUN_JOBS.map(readSyncRunStatus));

  const syncRuns = {};
  let warned = false;
  const byJob = {};
  for (const { job, run, failed, message } of results) {
    byJob[job] = run;
    if (failed) {
      if (!warned) {
        // Never throw (health probes and the worker heartbeat depend on it),
        // but do not degrade silently: a permanently broken read (dropped
        // table, a permission change) would otherwise be indistinguishable
        // from "no run yet" (#747 review 750-f4).
        console.warn('getSchedulerStatus: data_sync_runs read failed for job %s, reporting nulls:', job, message);
        warned = true;
      }
      syncRuns[job] = { latest: null, latestOk: null };
      continue;
    }
    syncRuns[job] = { latest: toLatestStatus(run.latest), latestOk: toLatestOkStatus(run.latestOk) };
  }

  let lastAdpSync = null;
  let lastAdpSuccess = null;
  const adp = byJob.adp;
  if (adp) {
    if (adp.latest) {
      lastAdpSync = {
        finishedAt: adp.latest.finishedAt,
        ok: adp.latest.ok,
        matched: adp.latest.detail && adp.latest.detail.matched != null ? adp.latest.detail.matched : null,
      };
    }
    if (adp.latestOk) {
      lastAdpSuccess = {
        finishedAt: adp.latestOk.finishedAt,
        matched: adp.latestOk.detail && adp.latestOk.detail.matched != null ? adp.latestOk.detail.matched : null,
      };
    }
  }

  return { lastTickAt, lastTickError, lastSyncAt, lastAdpSync, lastAdpSuccess, syncRuns };
}

module.exports = {
  startScheduler,
  stopScheduler,
  tick,
  draftTick,
  alertCloseMatchups,
  getSchedulerStatus,
  SYNC_RUN_JOBS,
  syncAndScoreLiveWeeks,
  syncEveryTicks,
  runDailyInjurySync,
  injurySyncDue,
  injuryGameWindowMs,
  runDailyAdpSync,
  runHourlyOddsSync,
  runHoldoutSnapshots,
  runPickemWeekSync,
  runPickemSeasonCompletion,
  INTERVAL_MS,
  DRAFT_CLOCK_MS,
  SYNC_EVERY_TICKS,
};
