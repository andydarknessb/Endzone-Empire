const pool = require('./pool');
const { processAllDueWaivers, holdKickedOffPlayers } = require('../services/waiver.service');
const { processDueTrades } = require('../services/trade.service');
const { startSitAdvice } = require('../services/decision.service');
const { captureOverrides } = require('../services/lineupOverride.service');
const { setCpuLineups } = require('../services/cpuLineup.service');
const { processExpiredPickClocks, cancelAllExpiryTimers } = require('../services/pickClock.service');
const draftSweepLiveness = require('./draftSweepLiveness');
const { processScheduledDrafts } = require('../services/draftSchedule.service');
const { withAdvisoryLock } = require('./advisoryLock');
const { fantasySeasonLiveWhereSql } = require('../services/leaguePhase');
const { lastRun, runSyncJob } = require('./syncRun');
const cadence = require('./cadence');
const { JOB: STATS_INTEGRITY_JOB } = require('../services/playerStatsIntegrity.service');

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

// Minimal health-check state for /api/health — updated by tick() and
// syncAndScoreLiveWeeks() below, read via getSchedulerStatus().
let lastTickAt = null;
let lastTickError = null;
let lastSyncAt = null;
// A failed run (fetch_failed, bad_response, write_failed) is retried on the next
// tick unless the job passes `retryMs` to cadence.due; adp, stat-corrections,
// players and schedule do, below. A refused run is not retried: it settles the job's
// cadence period (a UTC day for `utc-day` jobs, the interval for `{ ms }` jobs).
const STAT_CORRECTIONS_RETRY_MS = 60 * 60 * 1000;
const PLAYER_SYNC_RETRY_MS = 60 * 60 * 1000;
// ESPN schedule sync (#2216): hourly, so a game-day move lands before the new
// kickoff; a failed run (18 sequential scoreboard calls) backs off 15 minutes.
const ESPN_SCHEDULE_INTERVAL_MS = 60 * 60 * 1000;
const ESPN_SCHEDULE_RETRY_MS = 15 * 60 * 1000;
const ADP_RETRY_MS = 15 * 60 * 1000;

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
 * The one runner: each job in list order, each in its own containment, all
 * handed one `now` taken at the start of the tick. A job runs when its `when`
 * (if any) is truthy and its `gate` says it is due; the gate then gets the
 * run's result to `settle` on. A throw from `when`, `due` or `run` is logged to
 * the console and the next job runs, so one failing duty (or one that retries
 * every tick because its stamp never lands) cannot skip the duties after it.
 * The console stays the log; each contained throw is also returned as
 * `{ name, message }` (empty when nothing failed) so the tick can record the
 * last one in `lastTickError` (#2058).
 */
async function runJobs(jobs) {
  const failures = [];
  const now = new Date();
  for (const job of jobs) {
    try {
      if (job.when && !(await job.when(now))) continue;
      const verdict = await job.gate.due(now);
      if (!verdict.due) continue;
      const result = await job.run({ now });
      if (job.gate.settle) await job.gate.settle(result);
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

/**
 * Gate kinds (#2230). A gate is `{ due(now) -> { due, reason }, settle?(result) }`:
 * the tick asks `due`, runs the row when it is due, then hands the run's result
 * to `settle`. A row's gate is built once, at module load, so what it
 * remembers (a day, a tick count, a stamp) lasts as long as the process.
 */

/**
 * `cadenceGate({ job, every, retryMs, after })`: the Sync run cadence
 * (server/modules/cadence.js), read off the job's own `data_sync_runs` rows, so
 * a worker restart cannot repeat a run. `every` is `'utc-day'`, `{ ms }`, or
 * `{ ms: () => number }` (read each tick, for an env-tunable interval).
 *
 * Same-process memo: when a `'utc-day'` job without `after` answers not due and
 * that answer is not a retry `backoff`, the UTC day is settled (it succeeded or
 * was refused) and the rest of that day answers not due without a read. A
 * backoff is a wait, not a settled day, and `after` is a standing "something
 * changed" signal, so neither is remembered; nor is a run's result (the next
 * tick's read says whether it counted).
 *
 * A failed read (or an invalid `every`) fails closed: the throw leaves `due()`,
 * the tick contains and logs it as this row's failure, and the row is skipped
 * this tick and asked again next tick. A database blip must not turn every
 * daily feed row into a run on every tick.
 */
function cadenceGate({ job, every, retryMs, after }) {
  let settledDay = null;
  return {
    async due(now) {
      const today = cadence.utcDateKey(now);
      if (settledDay === today) return { due: false, reason: 'already ran today' };
      const window = typeof every.ms === 'function' ? { ms: every.ms() } : every;
      const verdict = await cadence.due({ job, every: window, after, retryMs, now });
      if (!verdict.due && every === 'utc-day' && !after && !verdict.backoff) settledDay = today;
      return verdict;
    },
  };
}

/**
 * `everyTicks(n)`: due on every nth tick. `n` is a number or an async function
 * (live-sync passes `syncEveryTicks`, which doubles under degraded quota). The
 * count starts at the resolved `n` so the first tick is due, grows on every
 * tick, and resets only when `settle` gets a truthy result: a run that did
 * nothing (no game window, no credentials) does not push the next one out.
 */
function everyTicks(n) {
  let count = null;
  return {
    async due() {
      const every = typeof n === 'function' ? await n() : n;
      count = (count === null ? every : count) + 1;
      return { due: count >= every, reason: `${count} ticks, every ${every}` };
    },
    settle(result) {
      if (result) count = 0;
    },
  };
}

/**
 * `memory({ ms })`: an in-process interval, for a poll whose cheap check is the
 * thing being rate-limited, so it writes no Sync run row. The stamp is taken
 * BEFORE the run, so a failing host is retried every `ms`, not every tick. A
 * clock that stepped backwards reads as due.
 */
function memory({ ms }) {
  let stamp = null;
  return {
    due(now) {
      const elapsed = stamp === null ? null : now.getTime() - stamp;
      if (elapsed !== null && elapsed >= 0 && elapsed < ms) {
        return { due: false, reason: `${elapsed}ms since the last check, every ${ms}ms` };
      }
      stamp = now.getTime();
      return { due: true, reason: elapsed === null ? 'never checked' : `${elapsed}ms since the last check, every ${ms}ms` };
    },
  };
}

/** `none()`: always due, for a duty that limits itself (a window, a due-row query). Declared on the row so the table shows it. */
function none() {
  return { due: () => ({ due: true, reason: 'self-limiting' }) };
}

/**
 * `anyOf(...members)`: due when any member is. A member is `{ gate, when? }`,
 * and one whose `when` is falsy is not asked. `settle` reaches every member.
 */
function anyOf(...members) {
  return {
    async due(now) {
      for (const { gate, when } of members) {
        if (when && !(await when(now))) continue;
        const verdict = await gate.due(now);
        if (verdict.due) return verdict;
      }
      return { due: false, reason: 'no member is due' };
    },
    async settle(result) {
      for (const { gate } of members) {
        if (gate.settle) await gate.settle(result);
      }
    },
  };
}

/**
 * Daily retention pass: expired auth and refresh tokens, old notifications and
 * chat. A Sync run (ADR 0036) with one unit and no lock, `transaction: false`:
 * `enforceRetention` deletes through the module pool in autocommit batches, and
 * a BEGIN'd client sitting idle beside them is the #839 shape. The row carries
 * the UTC `day` and the deleted counts, and the row's cadence gate keeps it to
 * once per UTC day across restarts. A throw records a failed run, leaves the day
 * due, and is retried next tick.
 */
async function runRetention({ now }) {
  const { enforceRetention } = require('../services/retention.service');
  return runSyncJob({
    job: 'retention',
    lock: null,
    transaction: false,
    fetch: async () => ({ units: [{}], detail: { day: cadence.utcDateKey(now) } }),
    apply: async () => {
      const counts = await enforceRetention();
      if (Object.values(counts).some((count) => count > 0)) {
        console.log('scheduler: retention cleanup completed', counts);
      }
      return counts;
    },
  });
}

/** Cadence of the injury sync (#2115, ADR 0060); env-tunable. ESPN is free, so no quota doubling and no game-window split. */
function injurySyncMs() {
  const parsed = Number(process.env.INJURY_SYNC_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15 * 60 * 1000;
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
    console.warn('inGameWindow: game-window read failed, treating as outside a window:', err.message);
    return false;
  }
}

/**
 * ESPN injury refresh (#2115, ADR 0060): every INJURY_SYNC_MS (15 min), inside
 * and outside game windows alike. The row's cadence gate reads the last
 * successful `injuries` run from data_sync_runs, so a worker restart cannot
 * re-run it (#1188), and a thrown run records ok=false and does not move the
 * gate, so the next tick retries. ESPN's document is free and keyless: no
 * credential gate and no quota mode.
 */
async function runDailyInjurySync({ now }) {
  return require('../services/feedSyncRuns.service').syncInjuries({ now });
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
 * after `ADP_RETRY_MS`. The row's gate reads
 * `data_sync_runs`, which survives a worker restart, where the old in-memory
 * once-a-day stamp reset on every one (the gate's only memory is a same-process
 * short-circuit for a settled UTC day, which a restart merely loses). The wipe guard still
 * lives inside `adp.syncAdp` and is unaffected by this gate.
 */
async function runDailyAdpSync({ now }) {
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
 * `runHourlyOddsSync`'s `job: 'odds'` gate above. The only in-memory
 * state is the gate's same-process short-circuit for a settled UTC day: the
 * decision itself survives a worker restart, where an in-memory stamp would not have (a deploy or a second
 * worker mid-slate would otherwise repeat the whole 32-team sweep or the
 * ~4000-player Ownership pull - the exact hazard #1308's original
 * `lastEspnFactsSyncAt` was built to avoid, by reading `data_sync_runs`
 * directly rather than module state; #1509 only changes which calendar the
 * day comparison runs on, UTC instead of local).
 */
async function runDailyEspnDepthChartSync({ now }) {
  return require('./espnFactsSync').runDepthChartSync({ now });
}
async function runDailyEspnOwnershipSync({ now }) {
  return require('./espnFactsSync').runOwnershipSync({ now });
}

/**
 * The daily player sync (#2115, #2117, ADR 0060): keeps `players` (name,
 * position, nfl_team, departures) current unattended, once per UTC day by the
 * cadence gate on the 'players' Sync run's own rows, which a hand-run sync also
 * writes. It reads the 32 ESPN team rosters (the sweep the roster-status run
 * shares), which is free and keyless, so it is not gated on Tank01 credentials.
 * A failed run retries after PLAYER_SYNC_RETRY_MS, like stat-corrections, so an
 * ESPN outage does not spend a 32-call sweep every tick.
 */
async function runDailyPlayerSync({ now }) {
  return require('../services/feedSyncRuns.service').syncPlayers({ season: now.getUTCFullYear(), now });
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
async function runDailyEspnRosterStatusSync({ now }) {
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
async function runHourlyOddsSync() {
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
 * cadence gate (the `game-context` job, hourly, which reads the run row
 * `syncGameContext` already writes) and per-week isolation
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
async function runHourlyGameContextSync() {
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
 * Weather snapshots Sync run (#1883, ADR 0036): the body is in
 * weatherSnapshots.service (see its docblock); its row gates it on its own
 * 6-hour cadence and waits out an open game window (`inGameWindow`). Its run
 * never throws (a gate read failure is the tick's to contain): a failed run is already recorded by `runSyncJob` and is retried next
 * tick (a failed row never moves the gate).
 */
async function runWeatherSnapshotSync({ now }) {
  try {
    return await require('../services/weatherSnapshots.service').runWeatherSnapshots({ now });
  } catch (err) {
    console.error('weather snapshot sync failed (will retry next tick):', err.message);
    return null;
  }
}

async function tick(jobs = TICK_JOBS) {
  // The lock acquisition itself (the pool connect and the try-lock query) runs
  // before tickUnlocked, so a database blip there used to reach setInterval as
  // an unhandled rejection and exit the worker (processHandlers.js, #2541).
  // Same guard the draft-clock tick has held since #600.
  try {
    return await withAdvisoryLock(23001, 'league-scheduler', () => tickUnlocked(jobs));
  } catch (err) {
    console.error('scheduler tick failed to acquire its lock:', err.message);
    lastTickError = err.message;
    return undefined;
  }
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
  const { sendAlert } = require('../services/pushAlerts.service');
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
        await sendAlert({ kind: 'close-matchup', leagueId, week, scored });
        await sendAlert({ kind: 'score-lead', leagueId, season, week, scored });
        await sendAlert({ kind: 'score-played', leagueId, season, week, scored });
        await sendAlert({ kind: 'big-play', leagueId, season, week, scored, plays });
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
 * so its data_sync_runs row is the freshness the health route reads. The row
 * runs it at most once per UTC calendar day (#1509, spec #1493 "UTC day
 * everywhere") through the cadence gate on the scan's own Sync run row, and
 * only inside the same off-peak UTC hour as the projection fill: it pages
 * every player_stats row, and the tick lock it holds while doing so must never
 * sit inside a game window. The UTC day is computed once at the start of the
 * run and carried as `detail.day` on the recorded row, which is written only
 * after a scan that did not throw, so a transient database failure retries on
 * the next tick inside the window.
 */
async function runNightlyStatsIntegrityScan({ now }) {
  return require('../services/playerStatsIntegrity.service').runIntegrityScan({ now });
}

/**
 * Tue/Wed stat-correction pass: re-pull last week's stats and re-score any
 * league whose scores moved (see correction.service). The row runs it on a UTC
 * Tue/Wed (`isCorrectionDay`, the NFL's correction window) at most once per
 * UTC calendar day, through the cadence gate on the pass's own Sync run row
 * (`stat-corrections`) so a worker restart cannot repeat it: the pass also
 * wipes the Weekly projection cache from week+1 onward, and repeating THAT on
 * every release of a correction day is what put a cold cache under every list
 * page. Source is nflverse - free and, by Tuesday, more accurate than Tank01 -
 * so this pass costs no quota and needs no credentials.
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
 * correction day.
 */
async function runDailyStatCorrections({ now }) {
  const result = await require('../services/correction.service').runStatCorrections({ now });
  const failedWeeks = result.failedWeeks || [];
  if (failedWeeks.length > 0) {
    console.warn(
      `scheduler: stat corrections failed for ${failedWeeks
        .map((w) => `${w.season} week ${w.week}`)
        .join(', ')}; retrying after ${STAT_CORRECTIONS_RETRY_MS / 60000} minutes`
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
  // One fresh instant for both calls, taken here rather than the tick's start
  // `now`: an earlier row can run for minutes, and a capture window that opens
  // meanwhile must be seen by the roster refresh and the capture alike.
  const now = new Date();
  // Roster status refreshed once as a capture window opens (#1766), contained
  // so an ESPN failure never skips the capture: the breaker in the sweep bounds
  // a dead host to three timeouts.
  try {
    await runPreHoldoutEspnRosterStatusSync({ now });
  } catch (err) {
    console.error('pre-holdout ESPN roster-status sync failed (capture continues):', err.message);
  }
  const { captured, failures } = await holdout.captureDueSnapshots({ now });
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
 * Nightly projection run (#1305): the body is in projectionFill.service (see
 * its docblock) and the row's gate decides when it runs: at most once per UTC
 * calendar day inside `NIGHTLY_PROJECTION_FILL_UTC_HOUR` (unconditionally
 * there: a brand-new deployment or a mid-week draft must not sit blocked on a
 * stat-correction pass that has never run) - and, outside that window,
 * whenever a refill is owed. Owed-ness is the cadence gate's own concern
 * (server/modules/cadence.js, spec #1492 step two, #1511): `after:
 * 'stat-corrections'` is due whenever the stat-correction pass - which wipes
 * every Weekly projection run from week+1 onward, correction.service - has
 * succeeded more recently than this job's own last success, EVEN when this job
 * has already succeeded once today: `after`'s override (cadence.js, fleet#1511
 * f2) is what makes a same-UTC-day correction (one that succeeds after the
 * 09:00 window has already run once) refill immediately rather than sitting
 * cold until tomorrow's window - the exact #1447 incident class this gate
 * exists to prevent. An owed refill never starts while a game window is open:
 * the Tuesday 00:00 UTC correction pass lands during Monday Night Football,
 * and a multi-minute fill here would hold the tick (and live scoring behind
 * it) for its whole duration. It runs on the first tick after the slate goes
 * final, still hours ahead of the off-peak window.
 *
 * A failed run records ok=false, which does not settle the day, so a transient
 * failure is retried inside the same off-peak window; the throw is contained
 * here (logged, not rethrown) because the fill is no Sync-run row of the tick's
 * and its failure must not reach `lastTickError`.
 */
async function runNightlyProjectionFill({ now }) {
  try {
    return await require('../services/projectionFill.service').runNightlyFill({ now });
  } catch (err) {
    console.error('nightly projection fill failed (will retry within the window):', err.message);
    return null;
  }
}

/**
 * Mon-Thu nflverse IDP-finalization pass (also runs the snap-counts Sync run
 * per week, `finalizePriorWeeks`): patch in sack/TFL/fumble-return
 * yardage and individual safety for the prior week's defenders (see
 * nflverseSync.service) and re-score any league whose scores moved. The
 * second consumer of the cadence gate (server/modules/cadence.js, spec #1492
 * step two, #1511): the row's gate is `nflverse-week` once per UTC day,
 * reading `nflverse-week`'s own `data_sync_runs` rows - `syncNflverseWeek`
 * (nflverseSync.service.js) already writes one through `runSyncJob` for
 * every (season, week) `finalizePriorWeeks` processes, on every run
 * regardless of outcome (ADR 0036), so this adds no second, scheduler-level
 * row, mirroring `runHourlyOddsSync`'s `job: 'odds'` gate above. The Mon-Thu
 * window is `isNflverseFinalizationDay`, the row's `when`, not a cadence:
 * nothing in cadence.js expresses "these four weekdays only", so it stays a
 * plain check ahead of the gate - the same split `runDailyStatCorrections`
 * uses for its Tue/Wed window.
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
async function runNflverseFinalization() {
  const result = await require('../services/nflverseSync.service').finalizePriorWeeks();
  if (result.finalized && result.finalized.length > 0) {
    console.log(`scheduler: nflverse finalization updated IDP stats for ${result.finalized.length} week(s)`);
  }
  return result;
}

/**
 * Daily nflverse game-context fill (#1725, follow-up to #1707): run the
 * existing `syncScheduleFromNflverse` for the CURRENT season so `nfl_games`
 * `venue`, `roof`, `surface` and `rest_days` are populated. The ESPN schedule
 * sync (`runEspnSchedule` below) never writes them, so without this pass `venue` stays NULL, the
 * venue-keyed coordinate table (services/venueCoordinates.js) resolves nothing
 * and the NWS weather job is starved, and `roof` NULL reads a dome as outdoors.
 * This schedules the one sync that exists, not a new path; the manual
 * `POST /scoring/sync-schedule { source: 'nflverse' }` stays as the fallback.
 *
 * Gated by the `schedule-nflverse` job's `utc-day` cadence, the
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
async function runNflverseGameContextFill() {
  const nflSeason = require('../services/nflSeason.service');
  const season = await nflSeason.upcomingNflSeason();
  if (season == null) return null;
  const nflverseSync = require('../services/nflverseSync.service');
  return nflverseSync.syncScheduleFromNflverse({ season });
}

/**
 * Hourly ESPN schedule sync: `syncSchedule` (feedSyncRuns.service.js, job
 * 'schedule') for the current season. It is the only writer that moves an
 * existing kickoff; the nflverse fill never does. Until this ran it was
 * manual-only, so a game moved after its first insert kept its old slot and
 * the lineup lock opened late (CHI@GB 2026 wk5). Hourly rather than daily so
 * a game-day move lands before the new kickoff. It skips ESPN's
 * timeValid:false placeholders, so a TBD kickoff never overwrites a real one.
 * The gate reads the job, not the season (a manual sync of another season
 * settles it for an hour), and a run with some failedWeeks is ok; both cost
 * at most one interval. A throw propagates to `runJobs`.
 */
async function runEspnSchedule() {
  const nflSeason = require('../services/nflSeason.service');
  const season = await nflSeason.upcomingNflSeason();
  if (season == null) return null;
  const feedSyncRuns = require('../services/feedSyncRuns.service');
  return feedSyncRuns.syncSchedule({ season });
}

// How often to ask nflverse whether it has republished (a HEAD per season,
// nflverseSync.patchCurrentWeeks). nflverse republishes about an hour after
// each night's last game - 04:25-04:50 UTC after every 2026 prime-time game
// through week 3 - and the live-scoring window stays open 8 hours from the
// latest kickoff (about 08:15 UTC), so a 15-minute check lands the patch with
// hours of window to spare.
const NFLVERSE_CURRENT_WEEK_CHECK_MS = 15 * 60 * 1000;

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
 * (a run row is only written when there is something to patch), so the row's
 * `memory` gate is the whole throttle. It is stamped BEFORE the call, so a
 * failing nflverse is retried every 15 minutes, not every tick. A worker
 * restart just checks once early. No game-window deferral either: nflverse
 * publishes Sunday's afternoon games while the night game is still on, and a
 * patch that lands inside a live window is exactly what gets it re-scored.
 */
async function runNflverseCurrentWeek() {
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

/**
 * nflverse practice-participation poll (#1922): every 15 minutes, any hour of
 * any day, ask `practiceParticipation.syncCurrentWeeks` to capture the injury
 * report's practice and report statuses for the NFL week in play (read off
 * nfl_games kickoffs, never a league's current_week). It downloads only when
 * nflverse's timestamp.json changed since the last capture, so a check that
 * finds nothing new is one small request and writes no run row. Same throttle
 * shape as `runNflverseCurrentWeek` above: a `memory` gate, stamped BEFORE
 * the call so a failing nflverse is retried every 15 minutes, not every tick.
 * The service logs a failed poll itself and loses only that poll. Ordered in
 * `TICK_JOBS` after every deadline duty.
 */
async function runNflversePractice({ now }) {
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
async function runPickemWeekSync({ now }) {
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
async function runPickemSeasonCompletion({ now }) {
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

/**
 * The tick, as data: `{ name, tier, syncRun?, when?, gate, run }` in the order
 * the duties run. `tier` says why a job sits where it does: `deadline` duties
 * have a hard real-world deadline or feed one (corrections and finalization so
 * the holdout captures corrected inputs, then the capture, then kickoff hold,
 * waivers, reminders, trades, drafts, live scoring, Override capture);
 * `housekeeping` runs after every deadline duty and may run long; `trailing` is
 * the slow outside-host syncs that must never delay anything above them. Tiers
 * never go backwards down the list. `syncRun` names the Sync run rows (ADR
 * 0036) a job writes, and `SYNC_RUN_JOBS` is derived from them.
 *
 * Every row declares its throttle as `gate`, and the tick reads it (see
 * `runJobs`): `cadenceGate` (the job's own `data_sync_runs` rows, via
 * server/modules/cadence.js), `everyTicks(n)` (counted ticks, reset by a run
 * that did something), `memory({ ms })` (an in-process interval for a poll
 * that writes no run row), `none()` (a duty that limits itself) and
 * `anyOf(...)` (due when any `{ gate, when? }` member is). A row's optional
 * `when(now)` is checked first and is a plain predicate (a weekday, a UTC
 * hour, no game window open): a false `when` skips the row without reading
 * its gate (a `when` may itself read, as weather-snapshots' game-window check does). `run({ now })` is the body, with no gate of its own.
 */
const TICK_JOBS = [
  {
    name: 'stat-corrections',
    tier: 'deadline',
    syncRun: ['stat-corrections', 'nflverse-correction'],
    when: (now) => require('../services/correction.service').isCorrectionDay(now),
    gate: cadenceGate({ job: 'stat-corrections', every: 'utc-day', retryMs: STAT_CORRECTIONS_RETRY_MS }),
    run: ({ now }) => runDailyStatCorrections({ now }),
  },
  {
    name: 'nflverse-finalization',
    tier: 'deadline',
    syncRun: ['nflverse-week', 'nflverse-snaps'],
    when: (now) => require('../services/nflverseSync.service').isNflverseFinalizationDay(now),
    gate: cadenceGate({ job: 'nflverse-week', every: 'utc-day' }),
    run: () => runNflverseFinalization(),
  },
  {
    name: 'nflverse-game-context-fill',
    tier: 'deadline',
    syncRun: ['schedule-nflverse'],
    gate: cadenceGate({ job: 'schedule-nflverse', every: 'utc-day' }),
    run: () => runNflverseGameContextFill(),
  },
  {
    name: 'nflverse-current-week',
    tier: 'deadline',
    syncRun: ['nflverse-current-week'],
    gate: memory({ ms: NFLVERSE_CURRENT_WEEK_CHECK_MS }),
    run: () => runNflverseCurrentWeek(),
  },
  {
    name: 'injuries',
    tier: 'deadline',
    syncRun: ['injuries'],
    gate: cadenceGate({ job: 'injuries', every: { ms: injurySyncMs } }),
    run: ({ now }) => runDailyInjurySync({ now }),
  },
  {
    name: 'adp',
    tier: 'deadline',
    syncRun: ['adp'],
    gate: cadenceGate({ job: 'adp', every: 'utc-day', retryMs: ADP_RETRY_MS }),
    run: ({ now }) => runDailyAdpSync({ now }),
  },
  {
    name: 'odds',
    tier: 'deadline',
    syncRun: ['odds'],
    gate: cadenceGate({ job: 'odds', every: { ms: ODDS_SYNC_INTERVAL_MS } }),
    run: () => runHourlyOddsSync(),
  },
  {
    name: 'game-context',
    tier: 'deadline',
    syncRun: ['game-context'],
    gate: cadenceGate({ job: 'game-context', every: { ms: GAME_CONTEXT_SYNC_INTERVAL_MS } }),
    run: () => runHourlyGameContextSync(),
  },
  { name: 'holdout-snapshots', tier: 'deadline', gate: none(), run: () => runHoldoutSnapshots() },
  // Kickoff hold (#1375, ADR 0043): before claim processing, so a claim submitted
  // this tick already sees a player his kicked-off team put on waivers this tick.
  { name: 'kickoff-waiver-hold', tier: 'deadline', gate: none(), run: () => holdKickedOffPlayers() },
  { name: 'waivers', tier: 'deadline', gate: none(), run: () => runWaiverClearing() },
  // Self-limits to the pre-kickoff window.
  { name: 'lineup-reminders', tier: 'deadline', gate: none(), run: () => require('../services/digest.service').sendLineupReminders() },
  // Pick'em-only leagues follow the NFL calendar: point them at the right week
  // BEFORE the reminders read current_week, and complete any whose week-18 slate
  // has finalized right after.
  { name: 'pickem-week-sync', tier: 'deadline', gate: none(), run: ({ now }) => runPickemWeekSync({ now }) },
  { name: 'pickem-reminders', tier: 'deadline', gate: none(), run: () => require('../services/digest.service').sendPickemReminders() },
  { name: 'pickem-season-completion', tier: 'deadline', gate: none(), run: ({ now }) => runPickemSeasonCompletion({ now }) },
  {
    name: 'trades',
    tier: 'deadline',
    gate: none(),
    run: async () => {
      const trades = await processDueTrades();
      if (trades.length > 0) console.log(`scheduler: settled ${trades.length} trade(s)`);
    },
  },
  {
    name: 'scheduled-drafts',
    tier: 'deadline',
    gate: none(),
    run: async () => {
      const draftActions = await processScheduledDrafts();
      if (draftActions.length > 0) console.log(`scheduler: ran ${draftActions.length} scheduled-draft action(s)`);
    },
  },
  // Paced by tick count, not by a Sync run row: a count that resets only after a
  // sync that happened, so the first tick of a new game window syncs at once.
  { name: 'live-sync', tier: 'deadline', syncRun: ['week-stats'], gate: everyTicks(syncEveryTicks), run: () => syncAndScoreLiveWeeks() },
  // CPU manager: sets the lineup of every CPU-managed team (a banned manager's
  // team after the draft). Before live-sync's neighbour override-capture so a
  // lineup is in place ahead of the kickoff it is captured at; cheap when no
  // CPU team exists (one query), and it logs per team.
  { name: 'cpu-lineups', tier: 'deadline', gate: none(), run: () => setCpuLineups() },
  // Override capture (#1862, ADR 0054): each kickoff once, the advice as of a
  // minute before it. After every time-sensitive duty above, since it asks for
  // advice per team and its run time must never delay them; it logs per league.
  { name: 'override-capture', tier: 'deadline', gate: none(), run: () => captureOverrides({ loadAdvice: startSitAdvice }) },
  // nflverse practice-participation poll (#1922): a poll that finds a new file is
  // up to a minute and a half of serial downloads that must never delay a
  // deadline duty. Nothing above reads what it writes within the same tick.
  // #2216: not deadline duties, so after override-capture and live-sync.
  {
    name: 'espn-schedule',
    tier: 'housekeeping',
    syncRun: ['schedule'],
    gate: cadenceGate({ job: 'schedule', every: { ms: ESPN_SCHEDULE_INTERVAL_MS }, retryMs: ESPN_SCHEDULE_RETRY_MS }),
    run: () => runEspnSchedule(),
  },
  { name: 'stale-kickoff-alert', tier: 'housekeeping', gate: none(), run: () => require('./liveGameEngine').reportStaleKickoffs() },
  {
    name: 'nflverse-practice',
    tier: 'housekeeping',
    syncRun: ['nflverse-practice'],
    gate: memory({ ms: NFLVERSE_PRACTICE_CHECK_MS }),
    run: ({ now }) => runNflversePractice({ now }),
  },
  // Daily retention (#2230): a Sync run, once per UTC day. A throw leaves the day
  // due, so it retries every tick.
  { name: 'retention', tier: 'housekeeping', syncRun: ['retention'], gate: cadenceGate({ job: 'retention', every: 'utc-day' }), run: ({ now }) => runRetention({ now }) },
  // Daily player sync (#2115, #2117, ADR 0060): the only writer of nfl_team and
  // of departures now that the injuries job reads ESPN. It reads the ESPN team
  // rosters (shared with the roster-status run's sweep), so it needs no Tank01
  // credentials. Still hand-runnable (admin dashboard, /api/scoring/sync-players).
  {
    name: 'player-sync',
    tier: 'housekeeping',
    syncRun: ['players'],
    gate: cadenceGate({ job: 'players', every: 'utc-day', retryMs: PLAYER_SYNC_RETRY_MS }),
    run: ({ now }) => runDailyPlayerSync({ now }),
  },
  // Weather snapshots (#1883): after live scoring and every deadline duty, ahead
  // of the multi-minute nightly fill; its run never throws, though its gate read can (the tick contains that).
  {
    name: 'weather-snapshots',
    tier: 'housekeeping',
    syncRun: ['weather-snapshots'],
    when: async () => !(await inGameWindow()),
    gate: cadenceGate({ job: 'weather-snapshots', every: { ms: WEATHER_SNAPSHOT_INTERVAL_MS } }),
    run: ({ now }) => runWeatherSnapshotSync({ now }),
  },
  // Beside the other once-a-day housekeeping pass, never ahead of a time-sensitive
  // duty: this can run long (every in-season league's whole roster), so it only
  // starts inside its own off-peak window (#1305 f2), or when a refill is owed
  // (a stat-correction pass wiped the cache) and no game window is open.
  {
    name: 'nightly-projection-fill',
    tier: 'housekeeping',
    gate: anyOf(
      {
        when: (now) => now.getUTCHours() === NIGHTLY_PROJECTION_FILL_UTC_HOUR,
        gate: cadenceGate({ job: 'nightly-projection-run', every: 'utc-day' }),
      },
      {
        when: async () => !(await inGameWindow()),
        gate: cadenceGate({ job: 'nightly-projection-run', every: 'utc-day', after: 'stat-corrections' }),
      }
    ),
    run: ({ now }) => runNightlyProjectionFill({ now }),
  },
  {
    name: 'nightly-stats-integrity',
    tier: 'housekeeping',
    when: (now) => now.getUTCHours() === NIGHTLY_PROJECTION_FILL_UTC_HOUR,
    gate: cadenceGate({ job: STATS_INTEGRITY_JOB, every: 'utc-day' }),
    run: ({ now }) => runNightlyStatsIntegrityScan({ now }),
  },
  // ESPN syncs (#1308, risk review): up to 32 sequential ESPN calls each with its
  // own ESPN_TIMEOUT_MS, so a slow or hanging host must never delay anything
  // above. Free and keyless, so no off-peak hour of their own. Roster status
  // (#1766) BEFORE the depth chart: the daily run, then the Saturday run after
  // the 4pm ET elevation deadline, then the game-day run (#1995). The
  // pre-holdout-capture run lives in runHoldoutSnapshots, ahead of the capture.
  {
    name: 'espn-roster-status-daily',
    tier: 'trailing',
    syncRun: [ROSTER_STATUS_JOB],
    gate: cadenceGate({ job: ROSTER_STATUS_JOB, every: 'utc-day' }),
    run: ({ now }) => runDailyEspnRosterStatusSync({ now }),
  },
  { name: 'espn-roster-status-saturday', tier: 'trailing', syncRun: [ROSTER_STATUS_JOB], gate: none(), run: ({ now }) => runSaturdayEspnRosterStatusSync({ now }) },
  { name: 'espn-roster-status-game-day', tier: 'trailing', syncRun: [ROSTER_STATUS_JOB], gate: none(), run: ({ now }) => runGameDayEspnRosterStatusSync({ now }) },
  {
    name: 'espn-depth-chart',
    tier: 'trailing',
    syncRun: ['espn-depth-chart'],
    gate: cadenceGate({ job: 'espn-depth-chart', every: 'utc-day' }),
    run: ({ now }) => runDailyEspnDepthChartSync({ now }),
  },
  {
    name: 'espn-ownership',
    tier: 'trailing',
    syncRun: ['espn-ownership'],
    gate: cadenceGate({ job: 'espn-ownership', every: 'utc-day' }),
    run: ({ now }) => runDailyEspnOwnershipSync({ now }),
  },
];

// Sync runs only a commissioner trigger writes (feedSyncRuns.service.js); no tick
// job does, so the list cannot declare them.
const MANUAL_SYNC_RUN_JOBS = ['season-stats', 'team-defenses'];

/**
 * Every feed-sync job the Sync run module records (ADR 0036), in the order
 * `syncRuns` below reports them: the tick list's `syncRun` names, then the
 * commissioner-only ones (#1205). `live-box` is deliberately excluded: its
 * data_sync_runs row is a source-switch signal, not a Sync run (#1197 R5,
 * ADR 0035).
 */
const SYNC_RUN_JOBS = [...syncRunJobs(TICK_JOBS), ...MANUAL_SYNC_RUN_JOBS];

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
  getSchedulerStatus,
  tick,
  tickUnlocked,
  TICK_JOBS,
  SYNC_RUN_JOBS,
  MANUAL_SYNC_RUN_JOBS,
};
