const pool = require('./pool');
const { processAllDueWaivers, holdKickedOffPlayers } = require('../services/waiver.service');
const { processDueTrades } = require('../services/trade.service');
const { processExpiredPickClocks, cancelAllExpiryTimers } = require('../services/pickClock.service');
const draftSweepLiveness = require('./draftSweepLiveness');
const { processScheduledDrafts } = require('../services/draftSchedule.service');
const { withAdvisoryLock } = require('./advisoryLock');
const { fantasySeasonLiveWhereSql } = require('../services/leaguePhase');
const { lastRun, runSyncJob, recordDataSyncRun } = require('./syncRun');

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
// Stat-correction pass runs once per UTC calendar day on Tue/Wed (the NFL's
// correction window). The durable gate is the pass's own `stat-corrections`
// Sync run row (see runDailyStatCorrections); this in-memory stamp only
// saves the read on later ticks of the same process. It used to be the ONLY
// gate, and a restart repeating the pass was called safe because the
// corrections are idempotent - but the pass also wipes the Weekly projection
// cache from week+1 onward, and repeating THAT on every release of a
// correction day is what put a cold cache under every list page.
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
// Nightly projection fill (#1305): same once-a-day stamp pattern as the ADP
// and correction passes above.
let lastProjectionFillDay = null;
// Nightly player_stats integrity scan (week 1 2026 audit): same once-a-day
// stamp pattern. A thrown scan does not stamp, so the next tick retries.
let lastIntegrityScanDay = null;

async function tickUnlocked() {
  if (running) return; // don't overlap slow runs
  running = true;
  try {
    // Data-freshness and deadline duties FIRST, each in its own containment:
    // corrections and finalization so the holdout captures corrected inputs,
    // then the holdout capture itself — a duty with a hard real-world
    // deadline must not sit behind waivers, trades, or live scoring, any of
    // which can throw and abort the rest of a tick. The nightly projection
    // fill is neither a freshness nor a deadline duty (#1305 f2) — it runs
    // last, beside runRetention, and only inside its own off-peak window.
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
      await runHourlyGameContextSync();
    } catch (err) {
      console.error('hourly game context sync failed (will retry next tick):', err.message);
    }
    try {
      await runHoldoutSnapshots();
    } catch (err) {
      console.error('holdout snapshot pass failed (will retry next tick):', err.message);
    }
    // Kickoff hold (#1375, ADR 0043): before claim processing, so a claim
    // submitted this tick already sees a player his kicked-off team put on
    // waivers this same tick.
    try {
      await holdKickedOffPlayers();
    } catch (err) {
      console.error('kickoff waiver hold failed (will retry next tick):', err.message);
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
    // Last, beside the other once-a-day housekeeping pass, and never ahead of
    // a time-sensitive duty above: this can run long (every in-season
    // league's whole roster), so it only starts inside its own off-peak
    // window, never at the first tick after midnight (#1305 f2).
    try {
      await runNightlyProjectionFill();
    } catch (err) {
      console.error('nightly projection fill failed (will retry next tick):', err.message);
    }
    try {
      await runNightlyStatsIntegrityScan();
    } catch (err) {
      console.error('nightly stats integrity scan failed (will retry next tick):', err.message);
    }
    // ESPN depth-chart/Ownership syncs (#1308, risk review): LAST, after every
    // time-sensitive duty above (holdout capture, kickoff hold, waivers,
    // reminders, pick'em, trades, live scoring) - up to 32 sequential ESPN
    // calls each with its own ESPN_TIMEOUT_MS, so a slow or hanging host must
    // never delay any of those. Both jobs are free and keyless, so unlike the
    // nightly projection fill above they need no off-peak hour of their own.
    try {
      await runDailyEspnDepthChartSync();
    } catch (err) {
      console.error('daily ESPN depth-chart sync failed (will retry next tick):', err.message);
    }
    try {
      await runDailyEspnOwnershipSync();
    } catch (err) {
      console.error('daily ESPN ownership sync failed (will retry next tick):', err.message);
    }
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
  const scoring = require('../services/feedSyncRuns.service');
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

/**
 * The last SUCCESSFUL run of an ESPN facts job, read via `lastRun(job)`
 * rather than an in-memory day stamp (#1308 risk review, mirroring
 * `lastInjurySyncAt` above / #1188): an in-memory stamp resets on every
 * worker restart AND is per-process, so a deploy or a second worker would
 * repeat the whole 32-team sweep (or the ~4000-player Ownership pull) outside
 * this file's control over when - possibly mid-slate, ahead of the
 * time-sensitive duties these jobs already run after (see the call site
 * below). Reading `data_sync_runs` is durable across both. Deliberately
 * `latestOk`, not `latest`: a failed run must not move the once-a-day gate,
 * so the next tick retries it - same rule as the injury sync.
 */
async function lastEspnFactsSyncAt(job) {
  try {
    const { latestOk } = await lastRun(job);
    return latestOk ? latestOk.finishedAt : null;
  } catch (err) {
    console.warn('lastEspnFactsSyncAt: data_sync_runs read failed, treating as never run:', err.message);
    return null;
  }
}

/**
 * Builds a once-a-day wrapper for one ESPN facts job (#1308, ADR 0041/0036;
 * formal review f4 - the two callers below were identical apart from the job
 * name and which `espnFactsSync` export they call, so a later fix to the
 * gate only had to land once). Runs at most once per local calendar day
 * (gate: `lastEspnFactsSyncAt` above); the job itself owns its own
 * `data_sync_runs` row and the row-level idempotency (ON CONFLICT DO
 * NOTHING). A thrown run (including a `fetch_failed` from an ESPN outage,
 * formal review f3) records `ok: false` and does not move the gate, so the
 * next tick retries.
 */
function dailyEspnFactsSyncRunner(job, runJob) {
  return async function runDailyEspnSync({ now = new Date() } = {}) {
    const lastRunAt = await lastEspnFactsSyncAt(job);
    if (lastRunAt && lastRunAt.toLocaleDateString('en-CA') === now.toLocaleDateString('en-CA')) return null;
    return runJob({ now });
  };
}

const runDailyEspnDepthChartSync = dailyEspnFactsSyncRunner('espn-depth-chart', (opts) => require('./espnFactsSync').runDepthChartSync(opts));
const runDailyEspnOwnershipSync = dailyEspnFactsSyncRunner('espn-ownership', (opts) => require('./espnFactsSync').runOwnershipSync(opts));

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

const GAME_CONTEXT_SYNC_INTERVAL_MS = 60 * 60 * 1000; // hourly (#1262, ADR 0038)
let lastGameContextSyncAt = 0; // epoch ms; 0 forces a sync on the first eligible tick

/**
 * Hourly game-context Sync run (#1262, ADR 0038): Record, Venue and
 * Broadcast for every live fantasy league's current slate(s), same
 * interval-gate and per-week isolation shape as `runHourlyOddsSync` above
 * (and the same `fantasySeasonLiveWhereSql()` predicate, so a league
 * mid-transition to a new week still gets both weeks' slates updated). A
 * single week's throw is logged and does not stop the others; the interval
 * is stamped once the set of weeks is known, so a read failure here retries
 * next tick.
 *
 * Named for what it writes, not "Line" (pl-endzone formal review, #1262 f1):
 * CONTEXT.md's Line is the spread/total Sync run `runHourlyOddsSync` already
 * runs above. A second hourly scoreboard fetch alongside that one is
 * deliberate, not an oversight — see services/gameContextSync.service.js's
 * own module doc for why the two are not folded together.
 */
async function runHourlyGameContextSync({ now = new Date() } = {}) {
  if (now.getTime() - lastGameContextSyncAt < GAME_CONTEXT_SYNC_INTERVAL_MS) return null;
  const leaguesResult = await pool.query(
    `SELECT DISTINCT "current_season", "current_week" FROM "leagues"
     WHERE ${fantasySeasonLiveWhereSql()}`
  );
  lastGameContextSyncAt = now.getTime();
  const gameContextSync = require('../services/gameContextSync.service');
  const results = [];
  for (const row of leaguesResult.rows) {
    const season = row.current_season;
    const week = row.current_week;
    try {
      results.push(await gameContextSync.syncGameContext({ season, week }));
    } catch (err) {
      console.error('game context sync failed for %s week %s:', season, week, err.message);
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
  const feedSyncRuns = require('../services/feedSyncRuns.service');
  const matchupScoring = require('../services/matchupScoring.service');
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
      const synced = await feedSyncRuns.syncWeekStats({ season, week });
      plays = synced.plays || [];
    } catch (err) {
      console.error('live stat sync failed for %s week %s:', season, week, err.message);
    }

    try {
      for (const leagueId of leagueIds) {
        const { scored } = await matchupScoring.scoreMatchups({ leagueId, season, week, plays }); // emits scores:updated
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

/** UTC calendar date key, the same day boundary `isCorrectionDay` uses. */
function utcDayKey(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * The last successful stat-correction pass, read via `lastRun` the way the
 * injury sync's gate is (#1188): the in-memory day stamp alone reset on every
 * worker restart, so on a correction day with three releases (2026-09-15) the
 * pass ran three times, and each run wiped every Weekly projection run from
 * week+1 onward (correction.service) that the nightly fill had just rebuilt.
 * Null when no successful pass exists or the read fails, which then runs the
 * pass: the safe direction for the corrections themselves (idempotent), and
 * the refill owed after the wipe is what `runNightlyProjectionFill` covers.
 */
async function lastStatCorrectionsDay() {
  try {
    const { latestOk } = await lastRun('stat-corrections');
    if (!latestOk) return null;
    // The day the pass ran FOR, recorded in detail when it started - never
    // derived from finished_at: a pass that starts at 23:58 UTC Tuesday and
    // finishes at 00:01 Wednesday would otherwise read as Wednesday's, and
    // Wednesday's own pass would be skipped for the week (QA finding on
    // #1449). finished_at is the fallback only for a row with no `day`.
    if (latestOk.detail && typeof latestOk.detail.day === 'string') return latestOk.detail.day;
    return latestOk.finishedAt ? utcDayKey(latestOk.finishedAt) : null;
  } catch (err) {
    console.warn('runDailyStatCorrections: data_sync_runs read failed, treating as never run:', err.message);
    return null;
  }
}

/**
 * Nightly player_stats integrity scan: records any row whose stored points
 * disagree with its stats (playerStatsIntegrity.service). A Sync run per ADR
 * 0036 with one unit and no lock (nothing else writes the anomalies table),
 * so its data_sync_runs row is the freshness the health route reads. Runs at
 * most once per local calendar day and only inside the same off-peak UTC
 * hour as the projection fill: it pages every player_stats row, and the tick
 * lock it holds while doing so must never sit inside a game window. The day
 * is stamped only after a scan that did not throw, so a transient database
 * failure retries on the next tick inside the window.
 */
async function runNightlyStatsIntegrityScan({ now = new Date() } = {}) {
  if (now.getUTCHours() !== NIGHTLY_PROJECTION_FILL_UTC_HOUR) return null;
  const today = now.toLocaleDateString('en-CA');
  if (lastIntegrityScanDay === today) return null;
  const integrity = require('../services/playerStatsIntegrity.service');
  const result = await runSyncJob({
    job: integrity.JOB,
    fetch: async () => [{}],
    apply: (client) => integrity.scanPlayerStats({ db: client }),
  });
  lastIntegrityScanDay = today;
  if (result.open > 0) {
    console.warn(`scheduler: player_stats integrity scan found ${result.open} open anomaly(ies) over ${result.scanned} rows`);
  }
  return result;
}

/**
 * Tue/Wed stat-correction pass: re-pull last week's stats and re-score any
 * league whose scores moved (see correction.service). Runs at most once per
 * UTC calendar day - the window `isCorrectionDay` is defined on - gated by
 * the pass's own Sync run row (`stat-corrections`) so a worker restart
 * cannot repeat it, with the in-memory stamp as a same-process short-circuit.
 * Source is nflverse — free and, by Tuesday, more accurate than Tank01 — so
 * this pass costs no quota and needs no credentials.
 *
 * Recorded with `recordDataSyncRun` directly rather than through
 * `runSyncJob`: that wrapper runs its unit inside one `withTransaction`, and
 * a BEGIN'd client sitting idle for the minutes this pass takes - while
 * `correctLeagueWeek` opens its own transaction per league on other clients,
 * beside the tick's session-level advisory lock - is the idle-in-transaction
 * shape #839 already bit this repo with under the pooler. The row carries the
 * UTC `day` the pass ran for (see lastStatCorrectionsDay). A thrown pass
 * (including the aggregate cache-maintenance error resyncPriorWeeks raises
 * after finishing) records ok=false, does not move the gate, and bubbles to
 * tickUnlocked's catch, so the next 5-minute tick retries instead of
 * silently skipping the rest of a correction day.
 */
async function runDailyStatCorrections({ now = new Date() } = {}) {
  const correction = require('../services/correction.service');
  if (!correction.isCorrectionDay(now)) return null;
  const today = utcDayKey(now);
  if (lastCorrectionDay === today) return null;
  if ((await lastStatCorrectionsDay()) === today) {
    lastCorrectionDay = today;
    return null;
  }
  const startedAt = new Date();
  let result;
  try {
    result = await correction.resyncPriorWeeks();
  } catch (err) {
    await recordDataSyncRun({
      job: 'stat-corrections',
      startedAt,
      ok: false,
      detail: {
        day: today,
        reason: 'write_failed',
        message: err && err.message ? err.message : String(err),
        invalidated: (err && err.invalidated) || [],
      },
    });
    throw err;
  }
  await recordDataSyncRun({
    job: 'stat-corrections',
    startedAt,
    ok: true,
    detail: {
      day: today,
      corrected: (result.corrected || []).length,
      invalidated: result.invalidated || [],
    },
  });
  lastCorrectionDay = today;
  if (result.corrected && result.corrected.length > 0) {
    console.log(`scheduler: stat corrections changed scores in ${result.corrected.length} league(s)`);
  }
  if (result.invalidated && result.invalidated.length > 0) {
    console.log(
      `scheduler: stat corrections invalidated weekly projection runs (${result.invalidated
        .map((w) => `${w.season} from week ${w.fromWeek}: ${w.deletedRuns} run(s)`)
        .join('; ')}); refill runs at the end of this tick`
    );
  }
  return result;
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

// Off-peak only (#1305 f2): an early-morning UTC hour with no NFL game in
// progress on any day of the week (Thursday/Sunday/Monday night windows all
// fall between roughly 00:00 and 04:00 UTC the following calendar day; this
// sits well clear of that and of the Sunday slate, which starts at 17:00
// UTC). `render.yaml` sets no TZ, so this is deliberately a UTC hour, never
// "local" or "the first tick after midnight".
const NIGHTLY_PROJECTION_FILL_UTC_HOUR = 9;

/**
 * Is a projection refill owed right now? True when the last successful
 * stat-correction pass (which wipes every Weekly projection run from week+1
 * onward, correction.service) finished AFTER the last nightly fill ATTEMPT -
 * or when a pass exists and no fill ever has. Read from the two jobs' own
 * Sync run rows rather than an in-memory flag, so a worker restarted between
 * the wipe and the refill still knows it owes one.
 *
 * The fill side reads `latest`, not `latestOk`, on purpose: one owed attempt
 * per wipe. A fill that failed on one league still committed every other
 * league's weeks (runSyncJob attempts every unit), and retrying the failing
 * one every five minutes for the rest of the day would be the worker's whole
 * afternoon; the off-peak window's own retry loop covers it from there. A
 * failed read answers false for the same reason: the window still covers
 * the night, and the next tick re-asks.
 */
async function projectionRefillOwed() {
  try {
    const [corrections, fill] = await Promise.all([
      lastRun('stat-corrections'),
      lastRun('nightly-projection-run'),
    ]);
    const wipedAt = corrections.latestOk ? corrections.latestOk.finishedAt : null;
    if (!wipedAt) return false;
    const filledAt = fill.latest ? fill.latest.finishedAt : null;
    return !filledAt || wipedAt.getTime() > filledAt.getTime();
  } catch (err) {
    console.warn('runNightlyProjectionFill: data_sync_runs read failed, treating no refill as owed:', err.message);
    return false;
  }
}

/**
 * Nightly projection run (#1305): for every fantasy league whose season is
 * live (`fantasySeasonLiveWhereSql` — draft complete, season not yet
 * complete, the same eligibility the hourly odds/game-context syncs above
 * use), generate `free_baseline_v2` Weekly projections for EVERY player in
 * `players` (#1403; it was every currently rostered player until then, which
 * left every unrostered row the Players list and Waivers page show - most of
 * the pool - to be generated on demand, page by page, 17 weeks at a time),
 * for every week from the league's current week through its last playoff
 * week (`season.service.lastPlayoffWeek`). `getWeeklyProjections`
 * (projection.service.js) owns the cache itself: a (season, week,
 * scoring_hash, model_version) run that already has every player's row is a
 * cache hit and is never regenerated here, which is what lets this run every
 * night at no cost once a season's weeks are filled. A full-pool week is
 * ~12 s to generate and ~0.5 s to confirm cached, so a cold season is a few
 * minutes per league and a warm one seconds.
 *
 * A Sync run per ADR 0036: `runSyncJob` owns the one `data_sync_runs` row for
 * the whole pass, exactly as every other feed sync in this module does.
 * `fetch()` reads the eligible leagues and the player pool once (no
 * transaction, no lock: nothing else bulk-writes these rows); `apply(client,
 * unit)` fills one league's remaining weeks, one per unit. One league
 * throwing does not stop another's: `runSyncJob` attempts every unit and only
 * rethrows the first failure after every unit has been tried, so a prior
 * unit's weeks are already committed regardless. That rethrow is caught here
 * and the day is deliberately left UNSTAMPED whenever it fires, success-path
 * stamp only: a transient failure gets retried inside the same off-peak
 * window rather than losing the whole night, and a league that keeps failing
 * just means the other, now-cached leagues are cheap no-ops on the retry.
 *
 * `apply` deliberately never passes its `client` argument into
 * `getWeeklyProjections` (#1305 f5): that function's cache writer
 * (`saveProjections`) and the weather lookup it calls both log-and-continue on
 * a failed query, a contract that only holds in autocommit. Hosted inside
 * `runSyncJob`'s per-unit transaction, a swallowed failure either aborts the
 * transaction so the NEXT week's query throws a misleading 25P02 (rolling
 * back every earlier week for that league too), or - worse, when the failure
 * lands on the unit's LAST query - leaves nothing left to run, so
 * `withTransaction`'s own COMMIT is answered with a silent ROLLBACK and no
 * error: `ok: true` gets recorded with real-looking `weeksGenerated` counts
 * for a league that persisted nothing. Calling it with no `client` runs it
 * against the pool instead, autocommitting per statement exactly as it does
 * on the live request path and as it did before this file routed through
 * `runSyncJob`; each week's cache row is already an idempotent upsert, so
 * nothing here needs the unit's transaction anyway. The weather provider's
 * own HTTP fetches also stay off that transaction this way, matching ADR
 * 0036's "fetch outside any transaction" for the same reason.
 *
 * Runs at most once per local calendar day inside
 * `NIGHTLY_PROJECTION_FILL_UTC_HOUR` - and, outside that window, whenever a
 * refill is owed (`projectionRefillOwed` below): the stat-correction pass has
 * wiped every run from week+1 onward more recently than this fill last
 * completed, so without this every list page until the next 09:00 UTC
 * window (a whole Tuesday evening) rebuilt 25 players x 17 weeks on demand.
 * A successful owed refill stamps the day too: the window's own run would
 * only confirm rows this one just wrote.
 */
async function runNightlyProjectionFill({ now = new Date() } = {}) {
  const today = now.toLocaleDateString('en-CA');
  const inWindow = now.getUTCHours() === NIGHTLY_PROJECTION_FILL_UTC_HOUR && lastProjectionFillDay !== today;
  // An owed refill never starts while a game window is open: the Tuesday
  // 00:00 UTC correction pass lands during Monday Night Football, and a
  // multi-minute fill here would hold the tick (and live scoring behind it)
  // for its whole duration. It runs on the first tick after the slate goes
  // final, still hours ahead of the off-peak window.
  if (!inWindow) {
    if (!(await projectionRefillOwed())) return null;
    if (await inGameWindow()) return null;
  }

  let outcome;
  try {
    outcome = await runSyncJob({
      job: 'nightly-projection-run',
      fetch: async () => {
        // The WHOLE row, not an enumerated column list: getWeeklyProjections
        // hashes `rulesForLeague(league)` to pick the run it fills, and a
        // league row without `scoring_rules` hashes to the DEFAULT profile.
        // With five named columns the fill wrote 3,702 rows a week under a
        // hash no custom-scoring league ever looks up, and reported the
        // second league's weeks "already cached" off the first league's
        // default run - it had never warmed either (found verifying #1447).
        const leaguesResult = await pool.query(
          `SELECT * FROM "leagues" WHERE ${fantasySeasonLiveWhereSql()}`
        );
        const units = [];
        if (leaguesResult.rows.length === 0) return units;
        // Every player, once, shared by every league's unit (#1403).
        const playersResult = await pool.query(`SELECT "id" FROM "players"`);
        const playerIds = playersResult.rows.map((r) => r.id);
        if (playerIds.length === 0) return units;
        for (const league of leaguesResult.rows) units.push({ league, playerIds });
        return units;
      },
      // The unit's transactional client is intentionally unused here (#1305
      // f5, see docblock above): getWeeklyProjections must run against the
      // pool, in autocommit, not inside this transaction.
      apply: async (_client, { league, playerIds }) => {
        const projection = require('../services/projection.service');
        const { lastPlayoffWeek } = require('../services/season.service');
        const throughWeek = lastPlayoffWeek(league);
        let weeksGenerated = 0;
        let weeksSkipped = 0;
        for (let week = league.current_week; week <= throughWeek; week++) {
          const run = await projection.getWeeklyProjections({
            season: league.current_season, week, league, playerIds,
          });
          // A week is a cache HIT only when every player's row came
          // back already cached (getWeeklyProjections's own hit/miss rule,
          // mirrored here rather than re-decided); any generation at all,
          // partial included, counts this week as generated.
          const allCached = playerIds.every((id) => {
            const p = run.projections.get(id);
            return !!p && p.cached === true;
          });
          if (allCached) weeksSkipped += 1; else weeksGenerated += 1;
        }
        return { leagueId: league.id, weeksGenerated, weeksSkipped };
      },
    });
  } catch (err) {
    // Unstamped on purpose (see docblock): a same-day retry is owed.
    console.error('nightly projection fill failed (will retry within the window):', err.message);
    return null;
  }

  lastProjectionFillDay = today;
  // `runSyncJob` resolves to the single unit's own return value when exactly
  // one unit ran, or `{ results: [...] }` for zero or more than one (never
  // a refusal: `fetch` above has no refusal path).
  const perLeague = outcome && Array.isArray(outcome.results) ? outcome.results : (outcome ? [outcome] : []);
  const weeksGenerated = perLeague.reduce((sum, r) => sum + (r.weeksGenerated || 0), 0);
  const weeksSkipped = perLeague.reduce((sum, r) => sum + (r.weeksSkipped || 0), 0);
  if (weeksGenerated > 0 || weeksSkipped > 0) {
    console.log(
      `scheduler: nightly projection fill generated ${weeksGenerated} week(s), ` +
      `skipped ${weeksSkipped} already-cached week(s) across ${perLeague.length} league(s)`
    );
  }
  return { weeksGenerated, weeksSkipped, leagues: perLeague.length };
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
  'players', 'season-stats', 'team-defenses', 'nflverse-week', 'odds', 'game-context',
  'espn-depth-chart', 'espn-ownership',
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
  runDailyEspnDepthChartSync,
  runDailyEspnOwnershipSync,
  runHourlyOddsSync,
  runHourlyGameContextSync,
  runHoldoutSnapshots,
  runDailyStatCorrections,
  runNightlyProjectionFill,
  projectionRefillOwed,
  runNightlyStatsIntegrityScan,
  runPickemWeekSync,
  runPickemSeasonCompletion,
  INTERVAL_MS,
  DRAFT_CLOCK_MS,
  SYNC_EVERY_TICKS,
};
