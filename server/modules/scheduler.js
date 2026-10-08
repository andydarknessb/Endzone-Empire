const pool = require('./pool');
const { processAllDueWaivers, holdKickedOffPlayers } = require('../services/waiver.service');
const { processDueTrades } = require('../services/trade.service');
const { startSitAdvice } = require('../services/decision.service');
const { captureOverrides } = require('../services/lineupOverride.service');
const { processExpiredPickClocks, cancelAllExpiryTimers } = require('../services/pickClock.service');
const draftSweepLiveness = require('./draftSweepLiveness');
const { processScheduledDrafts } = require('../services/draftSchedule.service');
const { withAdvisoryLock } = require('./advisoryLock');
const { fantasySeasonLiveWhereSql } = require('../services/leaguePhase');
const { lastRun, runSyncJob } = require('./syncRun');
const cadence = require('./cadence');

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
// A failed run (fetch_failed, bad_response, write_failed) is retried on the next
// tick unless the job passes `retryMs` to cadence.due; only adp and
// stat-corrections do, below. A refused run is not retried: it settles the job's
// cadence period (a UTC day for `utc-day` jobs, the interval for `{ ms }` jobs).
const STAT_CORRECTIONS_RETRY_MS = 60 * 60 * 1000;
const ADP_RETRY_MS = 15 * 60 * 1000;
let lastRetentionDay = null;
// The Tank01 injury refresh keeps its once-a-day stamp in data_sync_runs, not
// here (#1188): see runDailyInjurySync.
// ADP market refresh (#747): the once-a-day decision is now the cadence gate's
// own concern (#1509) - see runDailyAdpSync below.
// Nightly projection fill (#1305): same once-a-day stamp pattern as the ADP
// and correction passes above.
let lastProjectionFillDay = null;
// Nightly player_stats integrity scan (week 1 2026 audit): the once-a-day
// decision is the cadence gate's own concern now (#1509), with this stamp
// kept as a same-process short-circuit ahead of that read - the same shape
// runDailyStatCorrections keeps its own in-memory stamp in. A thrown scan
// does not stamp, so the next tick retries.
let lastIntegrityScanDay = null;

/**
 * One tick: take the declared job list (`TICK_JOBS`, below) and run it. Every
 * job is contained by `runJobs`, so a throw never reaches this function; the
 * catch is a last guard around the runner itself.
 */
async function tickUnlocked(jobs = TICK_JOBS) {
  if (running) return; // don't overlap slow runs
  running = true;
  try {
    // Only the scheduler's own duties (no `syncRun`) reach lastTickError, and so
    // the worker heartbeat and its Critical page (#2058). A feed job's failure
    // stays on the console and in its Sync run row.
    const feedNames = new Set(jobs.filter((job) => job.syncRun).map((job) => job.name));
    const failures = (await runJobs(jobs)).filter((f) => !feedNames.has(f.name));
    const last = failures[failures.length - 1];
    lastTickError = last ? `${last.name}: ${last.message}` : null;
  } catch (err) {
    console.error('scheduler tick failed:', err.message);
    lastTickError = err.message;
  } finally {
    lastTickAt = new Date().toISOString();
    running = false;
  }
}

/**
 * The one runner: each job in list order, each in its own containment. A throw
 * is logged to the console and the next job runs, so one failing duty (or one
 * that retries every tick because its stamp never lands) cannot skip the duties
 * after it. The console stays the log; each contained throw is also returned
 * as `{ name, message }` (empty when nothing failed) so the tick can record the
 * last one in `lastTickError` (#2058).
 */
async function runJobs(jobs) {
  const failures = [];
  for (const job of jobs) {
    try {
      await job.run();
    } catch (err) {
      console.error('scheduler: job %s failed:', job.name, err.message);
      failures.push({ name: job.name, message: err.message });
    }
  }
  return failures;
}

/** The Sync run names a job list declares through `syncRun`, once each, in list order. */
function syncRunJobs(jobs) {
  return [...new Set(jobs.flatMap((job) => job.syncRun || []))];
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
 * Pure: should the injury sync run right now, INSIDE a game window - every
 * `windowMs` (#1188)? Outside a window the once-a-day decision is the
 * cadence gate's own concern now (server/modules/cadence.js, spec #1492 step
 * two, #1509, spec #1493 "UTC day everywhere") - see `runDailyInjurySync`
 * below, which only consults this function when `inWindow` is true.
 *
 * @param {{ now: Date, lastRunAt: ?Date, inWindow: boolean, windowMs: number }} args
 */
function injurySyncDue({ now, lastRunAt, inWindow, windowMs }) {
  if (!lastRunAt) return true;
  return inWindow && now.getTime() - lastRunAt.getTime() >= windowMs;
}

/**
 * Tank01 injury refresh: daily, and every INJURY_GAME_WINDOW_MS during a game
 * window. Inside a window, `injurySyncDue` above decides off the last
 * successful `injuries` run (`lastInjurySyncAt`, data_sync_runs); outside one,
 * the cadence gate decides instead (`cadence.due({ job: 'injuries', every:
 * 'utc-day' })`, #1509) - `syncInjuries` already records one `data_sync_runs`
 * row per run through `runSyncJob`, so the gate reads that same row and this
 * adds no second one. Either way a worker restart cannot re-run it (#1188),
 * and a thrown run records ok=false and does not move either gate, so the
 * next tick retries.
 */
async function runDailyInjurySync({ now = new Date() } = {}) {
  if (!process.env.RAPID_API_KEY || !process.env.RAPID_API_HOST) return null;
  const inWindow = await inGameWindow();
  let due;
  if (inWindow) {
    let quotaMode = 'ok';
    try {
      quotaMode = (await require('./tank01Client').getQuotaState()).mode;
    } catch (err) {
      quotaMode = 'ok';
    }
    const lastRunAt = await lastInjurySyncAt();
    due = injurySyncDue({ now, lastRunAt, inWindow, windowMs: injuryGameWindowMs(quotaMode) });
  } else {
    ({ due } = await cadence.due({ job: 'injuries', every: 'utc-day', now }));
  }
  if (!due) return null;
  const scoring = require('../services/feedSyncRuns.service');
  return scoring.syncInjuries({ now });
}

/**
 * Daily ADP market refresh (#747). Runs at most once per UTC calendar day,
 * all year - FFC is free and keyless, so unlike the injury sync there is no
 * credential gate. The due/not-due decision is the cadence gate's own concern
 * (server/modules/cadence.js, spec #1492 step two, #1509), reading the job's
 * own `data_sync_runs` rows (job: 'adp') - `adp.syncAdp` already records one
 * row through `runSyncJob`, so this adds no second, scheduler-level row,
 * mirroring `runHourlyOddsSync`'s `job: 'odds'` gate above. The gate reads
 * the latest run's typed outcome: a thin-market/thin-match `refused` run
 * settles the UTC day (otherwise every five-minute tick would re-hit FFC for
 * the rest of the day while the market stays thin), a failed one retries
 * after `ADP_RETRY_MS`. No in-memory
 * once-a-day stamp remains: the gate's own read survives a worker restart,
 * where the old in-memory stamp reset on every one. The wipe guard still
 * lives inside `adp.syncAdp` and is unaffected by this gate.
 */
async function runDailyAdpSync({ now = new Date() } = {}) {
  const gate = await cadence.due({ job: 'adp', every: 'utc-day', retryMs: ADP_RETRY_MS, now });
  if (!gate.due) return null;
  const adp = require('../services/adp.service');
  return adp.syncAdp({ now });
}

/**
 * The daily ESPN depth-chart and Ownership Sync runs' once-a-day decision
 * (#1509, #1308, spec #1493 "UTC day everywhere"): the cadence gate's own
 * concern (server/modules/cadence.js, spec #1492 step two), each reading its
 * own job's `data_sync_runs` rows - `espnFactsSync.runDepthChartSync`/
 * `runOwnershipSync` already record one through `runSyncJob`, so neither
 * function below adds a second, scheduler-level row, mirroring
 * `runHourlyOddsSync`'s `job: 'odds'` gate above. No in-memory once-a-day
 * stamp remains for either job: the gate's own read survives a worker
 * restart, where an in-memory stamp would not have (a deploy or a second
 * worker mid-slate would otherwise repeat the whole 32-team sweep or the
 * ~4000-player Ownership pull - the exact hazard #1308's original
 * `lastEspnFactsSyncAt` was built to avoid, by reading `data_sync_runs`
 * directly rather than module state; #1509 only changes which calendar the
 * day comparison runs on, UTC instead of local).
 */
async function runDailyEspnDepthChartSync({ now = new Date() } = {}) {
  const gate = await cadence.due({ job: 'espn-depth-chart', every: 'utc-day', now });
  if (!gate.due) return null;
  return require('./espnFactsSync').runDepthChartSync({ now });
}
async function runDailyEspnOwnershipSync({ now = new Date() } = {}) {
  const gate = await cadence.due({ job: 'espn-ownership', every: 'utc-day', now });
  if (!gate.due) return null;
  return require('./espnFactsSync').runOwnershipSync({ now });
}

const ROSTER_STATUS_JOB = 'espn-roster-status';
const PRE_HOLDOUT_RETRY_MS = 30 * 60 * 1000;
const ELEVATION_DEADLINE_HOUR_ET = 16;
const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/**
 * The NFL roster-status Sync run (#1766, ADR 0041 amendment), four triggers on
 * one job (daily, Saturday, pre-capture, and the game-day run of #1995), all ordered before what reads or follows them. The daily run is the
 * plain cadence gate, exactly like the depth-chart run it precedes.
 */
async function runDailyEspnRosterStatusSync({ now = new Date() } = {}) {
  const gate = await cadence.due({ job: ROSTER_STATUS_JOB, every: 'utc-day', now });
  if (!gate.due) return null;
  return require('./espnFactsSync').runRosterStatusSync({ now });
}

/**
 * Pure: the 4pm ET Saturday elevation deadline `now` is at or past, as an
 * instant, or null when `now` is not on an ET Saturday from 16:00. (Practice
 * squad elevations for the weekend's games lock at 4pm ET Saturday.) The
 * wall-clock parts are read in America/New_York, so the instant is DST-correct:
 * a clock change never falls between Saturday 16:00 and midnight.
 */
function saturdayElevationDeadline(now) {
  const parts = Object.fromEntries(ET_PARTS.formatToParts(now).map((p) => [p.type, p.value]));
  if (parts.weekday !== 'Sat' || Number(parts.hour) < ELEVATION_DEADLINE_HOUR_ET) return null;
  const sinceDeadlineMs =
    (((Number(parts.hour) - ELEVATION_DEADLINE_HOUR_ET) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 +
    now.getMilliseconds();
  return new Date(now.getTime() - sinceDeadlineMs);
}

/**
 * The Saturday run: due once the ET Saturday elevation deadline has passed and
 * no successful run finished after it, so the day's earlier run cannot stand in
 * for a status an elevation just changed. Not gated by the daily cadence - the
 * daily run has usually already succeeded that UTC day.
 */
async function runSaturdayEspnRosterStatusSync({ now = new Date() } = {}) {
  const deadline = saturdayElevationDeadline(now);
  if (!deadline) return null;
  const { latestOk } = await require('./syncRun').lastRun(ROSTER_STATUS_JOB);
  if (latestOk && latestOk.finishedAt.getTime() >= deadline.getTime()) return null;
  return require('./espnFactsSync').runRosterStatusSync({ now });
}

/**
 * Pure: when the most recently opened holdout capture window opened, or null
 * when none is open. A window is the CAPTURE_WINDOW_HOURS before a week's
 * manifest deadline (the same rule `holdout.captureDueSnapshots` selects on).
 * Manifest deadlines only: an observed kickoff earlier than its manifest
 * deadline opens the real window sooner, in which case the run this gates fires
 * on the manifest's schedule instead (nothing reads roster status for a
 * snapshot yet).
 */
function holdoutWindowOpenedAt(now) {
  const holdout = require('../services/holdout.service');
  const windowMs = holdout.CAPTURE_WINDOW_HOURS * 3600 * 1000;
  const windowEnd = now.getTime() + windowMs;
  let opened = null;
  for (const season of holdout.SEASON_MANIFESTS.keys()) {
    for (let week = 1; week <= holdout.SEASON_WEEKS; week += 1) {
      const deadline = holdout.captureNotAfterFor(season, week);
      if (!deadline || deadline.getTime() <= now.getTime() || deadline.getTime() > windowEnd) continue;
      const openedAt = deadline.getTime() - windowMs;
      if (opened === null || openedAt > opened) opened = openedAt;
    }
  }
  return opened === null ? null : new Date(opened);
}

/**
 * The pre-capture run: due once per open holdout capture window, before any
 * roster-status success inside it, so the capture that follows in the same tick
 * sees a status no older than the window. Never runs outside a window.
 */
async function runPreHoldoutEspnRosterStatusSync({ now = new Date() } = {}) {
  const openedAt = holdoutWindowOpenedAt(now);
  if (!openedAt) return null;
  const { latest, latestOk } = await require('./syncRun').lastRun(ROSTER_STATUS_JOB);
  if (latestOk && latestOk.finishedAt.getTime() >= openedAt.getTime()) return null;
  // A failed attempt holds this trigger off for PRE_HOLDOUT_RETRY_MS: the gate
  // reads latestOk only, so without this a dead ESPN host would put its
  // timeouts ahead of the capture on every five-minute tick for the whole
  // window (#1766 risk review). The daily and Saturday runs keep their own
  // retry-next-tick behaviour at the end of the tick, where they delay nothing.
  // This trigger and runGameDayEspnRosterStatusSync both back off on any non-ok
  // latest run, a refusal included, because runRosterStatusSync has no refusal
  // path (ADR 0036, #2060); read `latest.outcome` in both the day one is added.
  if (latest && latest.ok === false && latest.finishedAt &&
      now.getTime() - latest.finishedAt.getTime() < PRE_HOLDOUT_RETRY_MS) return null;
  return require('./espnFactsSync').runRosterStatusSync({ now });
}

const GAME_DAY_RUN_INTERVAL_MS = 60 * 60 * 1000;
const GAME_DAY_KICKOFF_BEHIND_MS = 4 * 60 * 60 * 1000;
const GAME_DAY_KICKOFF_AHEAD_MS = 6 * 60 * 60 * 1000;

/**
 * The game-day run (#1995): due when any `nfl_games` kickoff falls between 4
 * hours ago and 6 hours ahead and no successful run finished in the last hour,
 * so an elevation ESPN flips overnight or on game day is read within the hour
 * up to kickoff and corrected during the game. After a failed attempt it holds
 * off PRE_HOLDOUT_RETRY_MS like the pre-capture run, so a dead ESPN host cannot
 * put its timeouts into every game-day tick. A player ESPN has not flipped by
 * kickoff still reads Practice squad until the next run (ADR 0041, accepted).
 */
async function runGameDayEspnRosterStatusSync({ now = new Date() } = {}) {
  const kickoff = await pool.query(
    `SELECT 1 FROM "nfl_games" WHERE "kickoff_at" BETWEEN $1 AND $2 LIMIT 1`,
    [new Date(now.getTime() - GAME_DAY_KICKOFF_BEHIND_MS), new Date(now.getTime() + GAME_DAY_KICKOFF_AHEAD_MS)]
  );
  if (!kickoff.rows[0]) return null;
  const { latest, latestOk } = await require('./syncRun').lastRun(ROSTER_STATUS_JOB);
  if (latestOk && now.getTime() - latestOk.finishedAt.getTime() < GAME_DAY_RUN_INTERVAL_MS) return null;
  if (latest && latest.ok === false && latest.finishedAt &&
      now.getTime() - latest.finishedAt.getTime() < PRE_HOLDOUT_RETRY_MS) return null;
  return require('./espnFactsSync').runRosterStatusSync({ now });
}

const ODDS_SYNC_INTERVAL_MS = 60 * 60 * 1000; // hourly (#1234, ADR 0036/0037)

/**
 * Hourly Line refresh (#1234, ADR 0036/0037, #1510): ESPN's scoreboard needs
 * no key and is not quota-metered, so unlike the injury sync this job has no
 * credential gate. The due/not-due decision is the cadence gate's own concern
 * (server/modules/cadence.js, spec #1492 step two), reading the job's own
 * `data_sync_runs` rows (job: 'odds', ADR 0036 - `syncOdds` below already
 * records them through `runSyncJob`, so this adds no second, scheduler-level
 * row) rather than the in-memory epoch this used to keep: the gate's source
 * of truth survives a worker restart, so a restart inside the hour cannot
 * cause a double fetch (#1510 AC2). Runs the odds Sync run
 * (services/espnOdds.provider.js) once per distinct (season, week) slate any
 * live fantasy league is currently on, read with the same
 * `fantasySeasonLiveWhereSql()` predicate `syncAndScoreLiveWeeks` uses below
 * (that function then dedupes in JS and keeps each league's id; this one only
 * needs the distinct pairs, so it lets SQL do the DISTINCT and discards ids) -
 * so a league mid-transition to a new week still gets both weeks' slates
 * priced.
 *
 * A single week's throw is logged and does not stop the other weeks' syncs.
 * `lastRun('odds')` is per JOB, not per week, so a failed week's own row never
 * becomes the job's `latestOk` - but a SIBLING week's successful row still
 * does, and that moves the gate for every week alike. So a failed week waits
 * out the full hour behind a live sibling's success; only when EVERY week on
 * the tick fails does no row become `latestOk`, and the gate is still due on
 * the very next (five minute) tick instead - the retry spec #1493 story 5
 * wants. When no live league is on any slate this tick, the loop below never
 * runs and no `odds` row is written at all, so the gate answers due again on
 * every following tick too; the only recurring cost is this function's own
 * leagues read, same as a read failure here (caught and logged by
 * `runJobs`) retrying next tick same as everywhere else in this module.
 */
async function runHourlyOddsSync({ now = new Date() } = {}) {
  const gate = await cadence.due({ job: 'odds', every: { ms: ODDS_SYNC_INTERVAL_MS }, now });
  if (!gate.due) return null;
  const leaguesResult = await pool.query(
    `SELECT DISTINCT "current_season", "current_week" FROM "leagues"
     WHERE ${fantasySeasonLiveWhereSql()}`
  );
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

/**
 * Hourly game-context Sync run (#1262, ADR 0038): Record, Venue and
 * Broadcast for every live fantasy league's current slate(s), same
 * cadence gate (`cadence.due({ job: 'game-context', every: { ms } })`, which
 * reads the run row `syncGameContext` already writes) and per-week isolation
 * shape as `runHourlyOddsSync` above (and the same
 * `fantasySeasonLiveWhereSql()` predicate, so a league mid-transition to a
 * new week still gets both weeks' slates updated). No in-memory epoch: a
 * worker restart with a recent successful row does not refetch on its first
 * tick. A single week's throw is logged and does not stop the others.
 *
 * Named for what it writes, not "Line" (pl-endzone formal review, #1262 f1):
 * CONTEXT.md's Line is the spread/total Sync run `runHourlyOddsSync` already
 * runs above. A second hourly scoreboard fetch alongside that one is
 * deliberate, not an oversight — see services/gameContextSync.service.js's
 * own module doc for why the two are not folded together.
 */
async function runHourlyGameContextSync({ now = new Date() } = {}) {
  const gate = await cadence.due({ job: 'game-context', every: { ms: GAME_CONTEXT_SYNC_INTERVAL_MS }, now });
  if (!gate.due) return null;
  const leaguesResult = await pool.query(
    `SELECT DISTINCT "current_season", "current_week" FROM "leagues"
     WHERE ${fantasySeasonLiveWhereSql()}`
  );
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

// One horizon bucket (nwsWeather.service HORIZON_BUCKET_HOURS = 6): a run that
// follows an ok run lands in each game's next bucket, so a snapshot is never
// refetched into the bucket it already filled and never skipped past one
// (#1883).
const WEATHER_SNAPSHOT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Weather snapshots Sync run (#1883, ADR 0036): refreshes
 * `game_weather_snapshots` for every game kicking off in the future and at
 * most `MAX_HORIZON_HOURS` (168) away, on its own 6-hour cadence
 * (`cadence.due({ job: 'weather-snapshots', every: { ms } })`, which reads the
 * run row this job records).
 *
 * Why it exists: the only other writer of that table is a projection run being
 * GENERATED, and `getWeeklyProjections` returns a cached week without
 * generating, so once a week was cached nothing refreshed its forecast and the
 * Decision card showed whatever the last generation left behind. The
 * projection path still calls `getForecastsForGames`; with this job in place
 * it normally reads the bucket this job already filled.
 *
 * Games are read by kickoff window rather than by season literal: a game in
 * the next 168 hours is by definition the current slate (and is grouped by its
 * own `season`/`week` because the snapshot cache is keyed that way). An
 * `nfl_games` row exists per team, so the read is DISTINCT per `game_key`.
 *
 * Tick safety: it runs after live scoring in `TICK_JOBS`, and it waits out
 * an open game window (`inGameWindow`, as the owed nightly refill does)
 * because the worst case is two sequential 3.5 s NWS requests per outdoor game
 * and a slow run holds the tick (and its 5-minute live-scoring cadence) for
 * its whole duration. Waiting costs nothing: no row is written, so the gate is
 * still due on the first tick after the window closes. It never throws: a
 * failed run is already recorded by `runSyncJob` and is retried next tick (a
 * failed row never moves the gate). `getForecastsForGames` fails open per
 * game, so one dead NWS lookup does not fail the run on its own; `apply`
 * fails the unit when it asked NWS and got nothing (`requests > 0` and
 * `fetched === 0`) or fetched forecasts and saved none, so an outage records
 * ok: false and retries on the next tick instead of holding the gate for 6
 * hours. A partial result stays an ok run, and an unset `NWS_USER_AGENT` stays
 * an ok run whose row carries the `reason`.
 *
 * The job runs with `transaction: false` (#1913): `apply` gets no client and
 * the unit runs with no transaction and no lock, so the week's sequential NWS
 * requests never sit inside one (ADR 0036, "a feed call never runs inside a
 * transaction"). That is also what the weather lookup and its snapshot write
 * need: they log-and-continue on a failed query, which only holds in
 * autocommit.
 */
async function runWeatherSnapshotSync({ now = new Date() } = {}) {
  try {
    const gate = await cadence.due({
      job: 'weather-snapshots', every: { ms: WEATHER_SNAPSHOT_INTERVAL_MS }, now,
    });
    if (!gate.due) return null;
    if (await inGameWindow()) return null;
    const { getForecastsForGames, MAX_HORIZON_HOURS } = require('../services/nwsWeather.service');
    const horizonEnd = new Date(now.getTime() + MAX_HORIZON_HOURS * 3600000);
    return await runSyncJob({
      job: 'weather-snapshots',
      transaction: false,
      fetch: async () => {
        const result = await pool.query(
          `SELECT DISTINCT ON ("game_key") "game_key", "season", "week", "kickoff_at", "roof", "venue"
             FROM "nfl_games"
            WHERE "game_key" IS NOT NULL AND "kickoff_at" > $1 AND "kickoff_at" <= $2
            ORDER BY "game_key", "kickoff_at"`,
          [now, horizonEnd]
        );
        const byWeek = new Map();
        for (const row of result.rows) {
          const key = `${row.season}:${row.week}`;
          if (!byWeek.has(key)) byWeek.set(key, { season: row.season, week: row.week, games: [] });
          byWeek.get(key).games.push({
            gameKey: row.game_key, kickoffAt: row.kickoff_at, roof: row.roof, venue: row.venue,
          });
        }
        return [...byWeek.values()];
      },
      apply: async (_client, { season, week, games }) => {
        const { coverage } = await getForecastsForGames({ season, week, games, now });
        const requests = coverage.requests || 0;
        const fetched = coverage.fetched || 0;
        const saved = coverage.saved || 0;
        // A unit that asked NWS and got nothing, or got forecasts and saved
        // none, did not do its job: throw so `runSyncJob` records ok: false,
        // the gate stays due and the next tick retries (a game already saved
        // in its horizon bucket is read from the cache only while it is still
        // in that bucket, so only the missing games are asked again). A
        // partial result (one forecast fetched and saved) stays an ok run.
        // The no-forecast throw is tagged `fetch_failed` so the unit's
        // `detail.failed[].reason` says the feed failed; the run-level
        // `detail.reason` stays `write_failed` (ADR 0036).
        if (requests > 0 && fetched === 0) {
          const error = new Error(`NWS returned no forecast for any of ${requests} request(s) for ${season} week ${week}`);
          error.syncFailureReason = 'fetch_failed';
          throw error;
        }
        if (fetched > 0 && saved === 0) {
          throw new Error(`fetched ${fetched} NWS forecast(s) for ${season} week ${week} and saved none`);
        }
        return {
          season,
          week,
          games: games.length,
          requests,
          fetched,
          saved,
          // An unset NWS_USER_AGENT is an unconfigured optional integration,
          // an ok run: the row says why nothing was fetched.
          ...(coverage.reason ? { reason: coverage.reason } : {}),
          ...(coverage.reason === NWS_UNCONFIGURED_REASON ? { unconfigured: true } : {}),
        };
      },
    });
  } catch (err) {
    console.error('weather snapshot sync failed (will retry next tick):', err.message);
    return null;
  }
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

/**
 * Nightly player_stats integrity scan: records any row whose stored points
 * disagree with its stats (playerStatsIntegrity.service). A Sync run per ADR
 * 0036 with one unit and no lock (nothing else writes the anomalies table),
 * so its data_sync_runs row is the freshness the health route reads. Runs at
 * most once per UTC calendar day (#1509, spec #1493 "UTC day everywhere"),
 * gated by the cadence gate (server/modules/cadence.js, spec #1492 step two)
 * reading the scan's own Sync run row (job: `player-stats-integrity`) - with
 * the in-memory `lastIntegrityScanDay` stamp as a same-process short-circuit
 * ahead of that read, the same shape `runDailyStatCorrections` above keeps
 * its own in-memory stamp in - and only inside the same off-peak UTC hour as
 * the projection fill: it pages every player_stats row, and the tick lock it
 * holds while doing so must never sit inside a game window. The UTC day is
 * computed once at the start of the run and carried as `detail.day` on the
 * recorded row; both the in-memory stamp and that row are written only after
 * a scan that did not throw, so a transient database failure retries on the
 * next tick inside the window.
 */
async function runNightlyStatsIntegrityScan({ now = new Date() } = {}) {
  if (now.getUTCHours() !== NIGHTLY_PROJECTION_FILL_UTC_HOUR) return null;
  const integrity = require('../services/playerStatsIntegrity.service');
  const today = cadence.utcDateKey(now);
  if (lastIntegrityScanDay === today) return null;
  const gate = await cadence.due({ job: integrity.JOB, every: 'utc-day', now });
  if (!gate.due) {
    lastIntegrityScanDay = today;
    return null;
  }
  const { results: [result] } = await runSyncJob({
    job: integrity.JOB,
    fetch: async () => ({ units: [{}], detail: { day: today } }),
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
 * the cadence gate (server/modules/cadence.js, spec #1492 step two) reading
 * the pass's own Sync run row (`stat-corrections`) so a worker restart cannot
 * repeat it, with the in-memory stamp as a same-process short-circuit ahead
 * of that read. Source is nflverse — free and, by Tuesday, more accurate than
 * Tank01 — so this pass costs no quota and needs no credentials. The first
 * job on the cadence gate; every other job in this file keeps its own
 * hand-rolled once-a-day check for now.
 *
 * A Sync run (ADR 0036) with one unit, `transaction: false`: a BEGIN'd client
 * sitting idle for the minutes this pass takes - while `correctLeagueWeek`
 * opens its own transaction per league on other clients, beside the tick's
 * session-level advisory lock - is the idle-in-transaction shape #839 already
 * bit this repo with under the pooler. The row carries the UTC `day` the pass
 * ran for. A thrown pass (including the aggregate cache-maintenance error
 * resyncPriorWeeks raises after finishing) records a failed row, does not move
 * the gate, and bubbles to runJobs's catch. A pass that finishes with failed
 * week syncs records a failed row with them in its detail and stamps nothing,
 * without throwing. Either way the day stays due and the gate (which reads the
 * latest run's typed outcome) holds the pass back until the failed row is
 * STAT_CORRECTIONS_RETRY_MS old, instead of silently skipping the rest of a
 * correction day. A gate read that fails reads as "never run": the pass is
 * idempotent, so running it is the safe side of skipping a correction day.
 */
async function runDailyStatCorrections({ now = new Date() } = {}) {
  const correction = require('../services/correction.service');
  if (!correction.isCorrectionDay(now)) return null;
  const today = cadence.utcDateKey(now);
  if (lastCorrectionDay === today) return null;
  let gate;
  try {
    gate = await cadence.due({ job: 'stat-corrections', every: 'utc-day', retryMs: STAT_CORRECTIONS_RETRY_MS, now });
  } catch (err) {
    console.warn('runDailyStatCorrections: data_sync_runs read failed, treating as never run:', err.message);
    gate = { due: true };
  }
  if (!gate.due) {
    // A retry wait is not a settled day: unstamped, the window reopens on its own.
    if (!gate.backoff) lastCorrectionDay = today;
    return null;
  }
  let result;
  let failedWeeks = [];
  try {
    ({ results: [result] } = await runSyncJob({
      job: 'stat-corrections',
      transaction: false,
      fetch: async () => ({ units: [{}], detail: { day: today } }),
      apply: async () => {
        let run;
        try {
          run = await correction.resyncPriorWeeks();
        } catch (err) {
          if (err && typeof err === 'object') {
            err.syncDetail = {
              invalidated: err.invalidated || [],
              ...(err.failed && err.failed.length > 0 ? { failedWeeks: err.failed } : {}),
            };
          }
          throw err;
        }
        const summary = { corrected: (run.corrected || []).length, invalidated: run.invalidated || [] };
        const failed = run.failed || [];
        if (failed.length > 0) {
          const error = new Error(`stat corrections failed for ${failed.length} week(s)`);
          error.syncDetail = { ...summary, failedWeeks: failed };
          error.partial = { ...summary, failedWeeks: failed };
          throw error;
        }
        return summary;
      },
    }));
  } catch (err) {
    if (!err || !err.partial) throw err;
    result = err.partial;
    failedWeeks = err.partial.failedWeeks;
  }
  if (failedWeeks.length === 0) {
    lastCorrectionDay = today;
  } else {
    console.warn(
      `scheduler: stat corrections failed for ${failedWeeks
        .map((w) => `${w.season} week ${w.week}`)
        .join(', ')}; retrying after ${STAT_CORRECTIONS_RETRY_MS / 60000} minutes`
    );
  }
  if (result.corrected > 0) {
    console.log(`scheduler: stat corrections changed scores in ${result.corrected} league(s)`);
  }
  if (result.invalidated.length > 0) {
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
  // #2081: Render logs are the only place the engine's cost is observable, so the
  // success line carries the wall time of the whole span, ESPN sync included.
  const startedAt = process.hrtime.bigint();
  const holdout = require('../services/holdout.service');
  // Roster status refreshed once as a capture window opens (#1766), contained
  // so an ESPN failure never skips the capture: the breaker in the sweep bounds
  // a dead host to three timeouts.
  try {
    await runPreHoldoutEspnRosterStatusSync();
  } catch (err) {
    console.error('pre-holdout ESPN roster-status sync failed (capture continues):', err.message);
  }
  const { captured, failures } = await holdout.captureDueSnapshots();
  const written = captured.filter((c) => !c.skipped);
  if (written.length > 0) {
    const elapsedMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    console.log(
      `scheduler: captured ${written.length} holdout snapshot(s): ` +
      written.map((c) => `${c.season} w${c.week} ${c.profileName} (${c.inserted} rows)`).join(', ') +
      ` in ${elapsedMs} ms`
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
 * nothing here needs the unit's transaction anyway. The job runs with
 * `transaction: false` (#1913), so the unit runs with no transaction and no
 * lock and the weather provider's HTTP fetches never sit inside one (ADR
 * 0036, "a feed call never runs inside a transaction").
 *
 * Runs at most once per UTC calendar day inside
 * `NIGHTLY_PROJECTION_FILL_UTC_HOUR` (unconditionally there, same as before:
 * a brand-new deployment or a mid-week draft must not sit blocked on a
 * stat-correction pass that has never run) - and, outside that window,
 * whenever a refill is owed. Owed-ness used to be its own hand-rolled
 * `data_sync_runs` comparison; it is now the cadence gate's own concern
 * (server/modules/cadence.js, spec #1492 step two, #1511):
 * `cadence.due({ job: 'nightly-projection-run', every: 'utc-day', after:
 * 'stat-corrections' })` is due whenever the stat-correction pass - which
 * wipes every Weekly projection run from week+1 onward, correction.service -
 * has succeeded more recently than this job's own last success, EVEN when
 * this job has already succeeded once today: `after`'s override (cadence.js,
 * fleet#1511 f2) is what makes a same-UTC-day correction (one that succeeds
 * after the 09:00 window has already run once) refill immediately rather
 * than sitting cold until tomorrow's window - the exact #1447 incident class
 * this gate exists to prevent. The off-peak hour window itself has no gate
 * equivalent (it is unique to this one job), so it stays a plain caller-side
 * check beside the gate call, same as the Mon-Thu/Tue-Wed day filters beside
 * `runNflverseFinalization`/`runDailyStatCorrections` below.
 */
async function runNightlyProjectionFill({ now = new Date() } = {}) {
  // #2081: Render logs are the only place the engine's cost is observable.
  const startedAt = process.hrtime.bigint();
  const today = cadence.utcDateKey(now);
  const inWindow = now.getUTCHours() === NIGHTLY_PROJECTION_FILL_UTC_HOUR && lastProjectionFillDay !== today;
  if (!inWindow) {
    const gate = await cadence.due({ job: 'nightly-projection-run', every: 'utc-day', after: 'stat-corrections', now });
    if (!gate.due) return null;
    // An owed refill never starts while a game window is open: the Tuesday
    // 00:00 UTC correction pass lands during Monday Night Football, and a
    // multi-minute fill here would hold the tick (and live scoring behind it)
    // for its whole duration. It runs on the first tick after the slate goes
    // final, still hours ahead of the off-peak window.
    if (await inGameWindow()) return null;
  }

  let outcome;
  try {
    outcome = await runSyncJob({
      job: 'nightly-projection-run',
      transaction: false,
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
      // `transaction: false` hands no client (#1305 f5, see docblock above):
      // getWeeklyProjections must run against the pool, in autocommit.
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
        // Matchup previews (ADR 0060): the current week's projections are
        // cached by now. Best-effort display text; never fails the fill.
        try {
          await require('../services/matchupNarrative.service').writePreviews({ league, now });
        } catch (err) {
          console.error('nightly projection fill: matchup previews failed for league %s:', league.id, err.message);
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
  // #1789: belt and braces after the fill itself - a day both the injury
  // sync and the roster-status sync fail still owes a fresh verdict for the
  // 48h practice-squad expiry and a No NFL team clear, and this job runs
  // regardless of either. A full sweep (no id list: the fill just touched
  // every live league's players, not a "who changed" set) on the pool, after
  // `runSyncJob` has already finished every unit above (none ran in a
  // transaction, #1913) - same reasoning as the roster-status sync's sweep, no ambient transaction
  // to protect with a SAVEPOINT. Logged and swallowed, never thrown: a
  // reconcile failure must not turn a real fill into a failed run the
  // cadence gate retries.
  try {
    const projection = require('../services/projection.service');
    const scope = await projection.liveReconcileScope();
    if (scope) await projection.reconcileAvailability({ ...scope, now });
  } catch (err) {
    console.error('nightly projection fill: availability reconcile failed, continuing:', err.message);
  }
  // One result per league's unit (`fetch` above has no refusal path).
  const perLeague = outcome.results;
  const weeksGenerated = perLeague.reduce((sum, r) => sum + (r.weeksGenerated || 0), 0);
  const weeksSkipped = perLeague.reduce((sum, r) => sum + (r.weeksSkipped || 0), 0);
  const elapsedMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
  if (weeksGenerated > 0 || weeksSkipped > 0) {
    console.log(
      `scheduler: nightly projection fill generated ${weeksGenerated} week(s), ` +
      `skipped ${weeksSkipped} already-cached week(s) across ${perLeague.length} league(s) in ${elapsedMs} ms`
    );
  }
  return { weeksGenerated, weeksSkipped, leagues: perLeague.length, elapsedMs };
}

/**
 * Mon-Thu nflverse IDP-finalization pass (also runs the snap-counts Sync run
 * per week, `finalizePriorWeeks`): patch in sack/TFL/fumble-return
 * yardage and individual safety for the prior week's defenders (see
 * nflverseSync.service) and re-score any league whose scores moved. The
 * second consumer of the cadence gate (server/modules/cadence.js, spec #1492
 * step two, #1511): `cadence.due({ job: 'nflverse-week', every: 'utc-day' })`
 * reads `nflverse-week`'s own `data_sync_runs` rows - `syncNflverseWeek`
 * (nflverseSync.service.js) already writes one through `runSyncJob` for
 * every (season, week) `finalizePriorWeeks` processes, on every run
 * regardless of outcome (ADR 0036), so this adds no second, scheduler-level
 * row, mirroring `runHourlyOddsSync`'s `job: 'odds'` gate above. The Mon-Thu
 * window is `isNflverseFinalizationDay`'s own day filter, not a cadence:
 * nothing in cadence.js expresses "these four weekdays only", so it stays a
 * plain check beside the gate rather than inside it - the same split
 * `runDailyStatCorrections` already uses for its Tue/Wed window. No
 * in-memory once-per-day stamp remains (#1510 removed the odds sync's
 * `lastOddsSyncAt` the same way): the gate's own `data_sync_runs` read
 * survives a worker restart, where an in-memory stamp reset on every one.
 *
 * Deliberately no `after: 'stat-corrections'` (pl-endzone formal review f1,
 * #1511): this pass never depended on the correction pass before, runs on
 * FOUR days a week (Mon-Thu) where corrections only ever succeeds on TWO
 * (Tue/Wed), and spec #1493's Out of Scope rules out changing any job's
 * cadence. An `after` dependency here would starve Monday and Thursday
 * outright - on those days `stat-corrections`' last success is never fresher
 * than this job's own (both last moved on Wednesday), so `due()` would
 * answer "waiting on stat-corrections to succeed again" forever on exactly
 * the two days the Mon-Thu window exists to cover that Tue/Wed does not.
 */
async function runNflverseFinalization({ now = new Date() } = {}) {
  const nflverseSync = require('../services/nflverseSync.service');
  if (!nflverseSync.isNflverseFinalizationDay(now)) return null;
  const gate = await cadence.due({ job: 'nflverse-week', every: 'utc-day', now });
  if (!gate.due) return null;
  const result = await nflverseSync.finalizePriorWeeks();
  if (result.finalized && result.finalized.length > 0) {
    console.log(`scheduler: nflverse finalization updated IDP stats for ${result.finalized.length} week(s)`);
  }
  return result;
}

/**
 * Daily nflverse game-context fill (#1725, follow-up to #1707): run the
 * existing `syncScheduleFromNflverse` for the CURRENT season so `nfl_games`
 * `venue`, `roof`, `surface` and `rest_days` are populated. The Tank01 schedule
 * insert never writes them, so without this pass `venue` stays NULL, the
 * venue-keyed coordinate table (services/venueCoordinates.js) resolves nothing
 * and the NWS weather job is starved, and `roof` NULL reads a dome as outdoors.
 * This schedules the one sync that exists, not a new path; the manual
 * `POST /scoring/sync-schedule { source: 'nflverse' }` stays as the fallback.
 *
 * Gated by `cadence.due({ job: 'schedule-nflverse', every: 'utc-day' })`, the
 * job `runSyncJob` already writes a run row for on every run, so a worker
 * restart cannot double-fetch and a manual run today also satisfies the gate.
 * The gate reads the job, not the season: a manual backfill of ANOTHER season
 * (2024, 2025) that succeeded today also counts, so the current-season fill
 * then waits for the next UTC day. Bounded to one day and self-correcting, so
 * accepted rather than a second run-row read beside the gate.
 * A failed run is never `latestOk`, so a failing fill is due again next tick
 * (one games.csv fetch per 5-minute tick until it succeeds, the same retry
 * `runNflverseFinalization` has). The sync is COALESCE-only on the context
 * columns and INSERT-safe on kickoffs, so running it any day is harmless.
 * A throw propagates to `runJobs`, which logs it and carries on.
 * Current season only: 2024 and 2025 are not backfilled automatically.
 */
async function runNflverseGameContextFill({ now = new Date() } = {}) {
  const gate = await cadence.due({ job: 'schedule-nflverse', every: 'utc-day', now });
  if (!gate.due) return null;
  const nflSeason = require('../services/nflSeason.service');
  const season = await nflSeason.upcomingNflSeason();
  if (season == null) return null;
  const nflverseSync = require('../services/nflverseSync.service');
  return nflverseSync.syncScheduleFromNflverse({ season });
}

// How often to ask nflverse whether it has republished (a HEAD per season,
// nflverseSync.patchCurrentWeeks). nflverse republishes about an hour after
// each night's last game - 04:25-04:50 UTC after every 2026 prime-time game
// through week 3 - and the live-scoring window stays open 8 hours from the
// latest kickoff (about 08:15 UTC), so a 15-minute check lands the patch with
// hours of window to spare.
const NFLVERSE_CURRENT_WEEK_CHECK_MS = 15 * 60 * 1000;
let lastNflverseCurrentWeekCheckAt = null; // epoch ms

/**
 * nflverse current-week pass: every 15 minutes, any hour of any day, ask
 * `nflverseSync.patchCurrentWeeks` to patch nflverse-only stats onto the week
 * each in-season league is sitting on now. That call does a HEAD per season
 * and downloads only when nflverse has republished since its last patch of
 * that week, so a check that finds nothing new costs one small request. It
 * sits beside `runNflverseFinalization` above, which keeps its Mon-Thu
 * prior-week window unchanged.
 *
 * No cadence gate: the thing being rate-limited is the HEAD, not a Sync run
 * (a run row is only written when there is something to patch), so an
 * in-memory stamp is the whole throttle. It is stamped BEFORE the call, so a
 * failing nflverse is retried every 15 minutes, not every tick. A worker
 * restart just checks once early. No game-window deferral either: nflverse
 * publishes Sunday's afternoon games while the night game is still on, and a
 * patch that lands inside a live window is exactly what gets it re-scored.
 */
async function runNflverseCurrentWeek({ now = new Date() } = {}) {
  const elapsed = lastNflverseCurrentWeekCheckAt === null ? null : now.getTime() - lastNflverseCurrentWeekCheckAt;
  if (elapsed !== null && elapsed >= 0 && elapsed < NFLVERSE_CURRENT_WEEK_CHECK_MS) return null;
  lastNflverseCurrentWeekCheckAt = now.getTime();
  const nflverseSync = require('../services/nflverseSync.service');
  const result = await nflverseSync.patchCurrentWeeks();
  const updated = (result.patched || []).filter((p) => p.playersUpdated > 0);
  if (updated.length > 0) {
    console.log(`scheduler: nflverse current-week pass updated stats for ${updated.length} week(s)`);
  }
  return result;
}

// How often to ask nflverse whether its injury report was republished
// (practiceParticipation.syncCurrentWeeks: one timestamp.json request per
// season). Practice reports land through the week and nflverse republishes
// them within hours, so the same 15 minutes as the stats pass is plenty.
const NFLVERSE_PRACTICE_CHECK_MS = 15 * 60 * 1000;
let lastNflversePracticeCheckAt = null; // epoch ms

/**
 * nflverse practice-participation poll (#1922): every 15 minutes, any hour of
 * any day, ask `practiceParticipation.syncCurrentWeeks` to capture the injury
 * report's practice and report statuses for the NFL week in play (read off
 * nfl_games kickoffs, never a league's current_week). It downloads only when
 * nflverse's timestamp.json changed since the last capture, so a check that
 * finds nothing new is one small request and writes no run row. Same throttle
 * shape as `runNflverseCurrentWeek` above: an in-memory stamp, taken BEFORE
 * the call so a failing nflverse is retried every 15 minutes, not every tick.
 * The service logs a failed poll itself and loses only that poll. Ordered in
 * `TICK_JOBS` after every deadline duty.
 */
async function runNflversePractice({ now = new Date() } = {}) {
  const elapsed = lastNflversePracticeCheckAt === null ? null : now.getTime() - lastNflversePracticeCheckAt;
  if (elapsed !== null && elapsed >= 0 && elapsed < NFLVERSE_PRACTICE_CHECK_MS) return null;
  lastNflversePracticeCheckAt = now.getTime();
  const practiceParticipation = require('../services/practiceParticipation.service');
  const result = await practiceParticipation.syncCurrentWeeks({ now });
  const written = (result.synced || []).filter((s) => s.inserted > 0);
  if (written.length > 0) {
    console.log(`scheduler: nflverse practice poll recorded ${written.reduce((n, s) => n + s.inserted, 0)} observation(s)`);
  }
  return result;
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
 * Waiver clearing, then the owners' email summary of their just-resolved claims.
 */
async function runWaiverClearing() {
  const waivers = await processAllDueWaivers();
  if (waivers.length === 0) return;
  console.log(`scheduler: processed waivers for ${waivers.length} league(s)`);
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

/** The tick-counted live sync: paced by `ticksSinceSync` while a game window is open. */
async function runLiveSync() {
  ticksSinceSync += 1;
  if (ticksSinceSync >= (await syncEveryTicks())) {
    const synced = await syncAndScoreLiveWeeks();
    if (synced) ticksSinceSync = 0;
  }
}

/**
 * The tick, as data: `{ name, tier, run, syncRun? }` in the order the duties
 * run. `tier` says why a job sits where it does: `deadline` duties have a hard
 * real-world deadline or feed one (corrections and finalization so the holdout
 * captures corrected inputs, then the capture, then kickoff hold, waivers,
 * reminders, trades, drafts, live scoring, Override capture); `housekeeping`
 * runs after every deadline duty and may run long; `trailing` is the slow
 * outside-host syncs that must never delay anything above them. Tiers never go
 * backwards down the list. `syncRun` names the Sync run rows (ADR 0036) a job
 * writes, and `SYNC_RUN_JOBS` is derived from them.
 *
 * Throttles differ by job and live in the jobs, not here: most Sync runs ask
 * `cadence.due`; the stat-correction pass keeps a day stamp beside it (a
 * same-process short-circuit ahead of the gate's read); the nflverse HEAD polls throttle in memory (a check
 * that finds nothing writes no run row); retention has a day stamp (no run row);
 * the live sync is tick-counted.
 */
const TICK_JOBS = [
  { name: 'stat-corrections', tier: 'deadline', syncRun: ['stat-corrections', 'nflverse-correction'], run: () => runDailyStatCorrections() },
  { name: 'nflverse-finalization', tier: 'deadline', syncRun: ['nflverse-week', 'nflverse-snaps'], run: () => runNflverseFinalization() },
  { name: 'nflverse-game-context-fill', tier: 'deadline', syncRun: ['schedule-nflverse'], run: () => runNflverseGameContextFill() },
  { name: 'nflverse-current-week', tier: 'deadline', syncRun: ['nflverse-current-week'], run: () => runNflverseCurrentWeek() },
  { name: 'injuries', tier: 'deadline', syncRun: ['injuries'], run: () => runDailyInjurySync() },
  { name: 'adp', tier: 'deadline', syncRun: ['adp'], run: () => runDailyAdpSync() },
  { name: 'odds', tier: 'deadline', syncRun: ['odds'], run: () => runHourlyOddsSync() },
  { name: 'game-context', tier: 'deadline', syncRun: ['game-context'], run: () => runHourlyGameContextSync() },
  { name: 'holdout-snapshots', tier: 'deadline', run: () => runHoldoutSnapshots() },
  // Kickoff hold (#1375, ADR 0043): before claim processing, so a claim submitted
  // this tick already sees a player his kicked-off team put on waivers this tick.
  { name: 'kickoff-waiver-hold', tier: 'deadline', run: () => holdKickedOffPlayers() },
  { name: 'waivers', tier: 'deadline', run: () => runWaiverClearing() },
  // Self-limits to the pre-kickoff window.
  { name: 'lineup-reminders', tier: 'deadline', run: () => require('../services/digest.service').sendLineupReminders() },
  // Pick'em-only leagues follow the NFL calendar: point them at the right week
  // BEFORE the reminders read current_week, and complete any whose week-18 slate
  // has finalized right after.
  { name: 'pickem-week-sync', tier: 'deadline', run: () => runPickemWeekSync() },
  { name: 'pickem-reminders', tier: 'deadline', run: () => require('../services/digest.service').sendPickemReminders() },
  { name: 'pickem-season-completion', tier: 'deadline', run: () => runPickemSeasonCompletion() },
  {
    name: 'trades',
    tier: 'deadline',
    run: async () => {
      const trades = await processDueTrades();
      if (trades.length > 0) console.log(`scheduler: settled ${trades.length} trade(s)`);
    },
  },
  {
    name: 'scheduled-drafts',
    tier: 'deadline',
    run: async () => {
      const draftActions = await processScheduledDrafts();
      if (draftActions.length > 0) console.log(`scheduler: ran ${draftActions.length} scheduled-draft action(s)`);
    },
  },
  { name: 'live-sync', tier: 'deadline', syncRun: ['week-stats'], run: () => runLiveSync() },
  // Override capture (#1862, ADR 0054): each kickoff once, the advice as of a
  // minute before it. After every time-sensitive duty above, since it asks for
  // advice per team and its run time must never delay them; it logs per league.
  { name: 'override-capture', tier: 'deadline', run: () => captureOverrides({ loadAdvice: startSitAdvice }) },
  // nflverse practice-participation poll (#1922): a poll that finds a new file is
  // up to a minute and a half of serial downloads that must never delay a
  // deadline duty. Nothing above reads what it writes within the same tick.
  { name: 'nflverse-practice', tier: 'housekeeping', syncRun: ['nflverse-practice'], run: () => runNflversePractice() },
  // A throw leaves the retention day unstamped, so it retries every tick.
  { name: 'retention', tier: 'housekeeping', run: () => runRetention() },
  // Weather snapshots (#1883): after live scoring and every deadline duty, ahead
  // of the multi-minute nightly fill; it never throws.
  { name: 'weather-snapshots', tier: 'housekeeping', syncRun: ['weather-snapshots'], run: () => runWeatherSnapshotSync() },
  // Beside the other once-a-day housekeeping pass, never ahead of a time-sensitive
  // duty: this can run long (every in-season league's whole roster), so it only
  // starts inside its own off-peak window (#1305 f2).
  { name: 'nightly-projection-fill', tier: 'housekeeping', run: () => runNightlyProjectionFill() },
  { name: 'nightly-stats-integrity', tier: 'housekeeping', run: () => runNightlyStatsIntegrityScan() },
  // ESPN syncs (#1308, risk review): up to 32 sequential ESPN calls each with its
  // own ESPN_TIMEOUT_MS, so a slow or hanging host must never delay anything
  // above. Free and keyless, so no off-peak hour of their own. Roster status
  // (#1766) BEFORE the depth chart: the daily run, then the Saturday run after
  // the 4pm ET elevation deadline, then the game-day run (#1995). The
  // pre-holdout-capture run lives in runHoldoutSnapshots, ahead of the capture.
  { name: 'espn-roster-status-daily', tier: 'trailing', syncRun: [ROSTER_STATUS_JOB], run: () => runDailyEspnRosterStatusSync() },
  { name: 'espn-roster-status-saturday', tier: 'trailing', syncRun: [ROSTER_STATUS_JOB], run: () => runSaturdayEspnRosterStatusSync() },
  { name: 'espn-roster-status-game-day', tier: 'trailing', syncRun: [ROSTER_STATUS_JOB], run: () => runGameDayEspnRosterStatusSync() },
  { name: 'espn-depth-chart', tier: 'trailing', syncRun: ['espn-depth-chart'], run: () => runDailyEspnDepthChartSync() },
  { name: 'espn-ownership', tier: 'trailing', syncRun: ['espn-ownership'], run: () => runDailyEspnOwnershipSync() },
];

// Sync runs only a commissioner trigger writes (feedSyncRuns.service.js); no tick
// job does, so the list cannot declare them.
const MANUAL_SYNC_RUN_JOBS = ['schedule', 'players', 'season-stats', 'team-defenses'];

/**
 * Every feed-sync job the Sync run module records (ADR 0036), in the order
 * `syncRuns` below reports them: the tick list's `syncRun` names, then the
 * commissioner-only ones (#1205). `live-box` is deliberately excluded: its
 * data_sync_runs row is a source-switch signal, not a Sync run (#1197 R5,
 * ADR 0035).
 */
const SYNC_RUN_JOBS = [...syncRunJobs(TICK_JOBS), ...MANUAL_SYNC_RUN_JOBS];

// An ok run that wrote nothing because NWS_USER_AGENT is unset (#1930): it stays
// ok (a failed row would not move the cadence gate), but the report names it.
const NWS_UNCONFIGURED_REASON = 'NWS_USER_AGENT not configured';

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
  const failedWeeks = isDetailObject && Array.isArray(detail.failedWeeks) ? detail.failedWeeks.length : null;
  return {
    finishedAt: latest.finishedAt,
    ok: latest.ok,
    outcome: latest.outcome ?? null,
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
  tickUnlocked,
  draftTick,
  alertCloseMatchups,
  getSchedulerStatus,
  SYNC_RUN_JOBS,
  MANUAL_SYNC_RUN_JOBS,
  TICK_JOBS,
  runJobs,
  syncRunJobs,
  syncAndScoreLiveWeeks,
  syncEveryTicks,
  runDailyInjurySync,
  injurySyncDue,
  injuryGameWindowMs,
  runDailyAdpSync,
  runDailyEspnDepthChartSync,
  runDailyEspnOwnershipSync,
  runDailyEspnRosterStatusSync,
  runSaturdayEspnRosterStatusSync,
  runGameDayEspnRosterStatusSync,
  runPreHoldoutEspnRosterStatusSync,
  saturdayElevationDeadline,
  holdoutWindowOpenedAt,
  runHourlyOddsSync,
  runHourlyGameContextSync,
  runWeatherSnapshotSync,
  WEATHER_SNAPSHOT_INTERVAL_MS,
  runHoldoutSnapshots,
  runDailyStatCorrections,
  runNightlyProjectionFill,
  runNflverseFinalization,
  runNflverseGameContextFill,
  runNflverseCurrentWeek,
  runNflversePractice,
  runNightlyStatsIntegrityScan,
  runPickemWeekSync,
  runPickemSeasonCompletion,
  INTERVAL_MS,
  DRAFT_CLOCK_MS,
  SYNC_EVERY_TICKS,
  ODDS_SYNC_INTERVAL_MS,
  GAME_CONTEXT_SYNC_INTERVAL_MS,
};
