/**
 * Adaptive-cadence worker that keeps `live_game_states` fresh so Supabase
 * Realtime can push real NFL game clock/status straight to the browser —
 * separate from the existing Socket.IO fantasy-score pipeline
 * (scoring.service.js / scheduler.js), which this does not touch.
 *
 * CLOCK SOURCE: ESPN's free public scoreboard (modules/espnScoreboard) by
 * default. Tank01 served this originally, but at a 20s cadence it burned
 * ~1,500-1,800 calls on a single Sunday against a ~1,000/MONTH allowance.
 * Tank01 remains the automatic fallback when ESPN fails repeatedly, at a much
 * slower cadence, and can be forced with LIVE_CLOCK_SOURCE=tank01.
 *
 * CADENCE: driven by `nextPollPlan`, a pure function of the current window's
 * statuses and the next kickoff. The old design polled every 5 minutes forever
 * and kept polling for 8 hours after the last game went final; now an idle tick
 * is a single cheap DB query and costs no API call at all — the loop only
 * reaches out when a game is actually in progress or a kickoff has just passed.
 *
 * Gotcha for anyone refactoring the Tank01 fallback: `/getNFLScoresOnly` takes
 * `{ gameWeek, season }`, NOT `{ week, seasonType, season }` — that's
 * `/getNFLGamesForWeek`'s shape, a schedule-only endpoint with no score/clock
 * fields at all. Don't "fix" it. One call returns every game for the week keyed
 * by gameID, so a fallback tick costs one call per active (season, week), not
 * one per game.
 */
const pool = require('./pool');
const { tank01Body } = require('../services/scoring.service');
const { tank01Get, getQuotaState, priorityAllowed } = require('./tank01Client');
const espnScoreboard = require('./espnScoreboard');
const gameRecap = require('../services/gameRecap.service');

const RECAP_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // reconciliation cadence (safety net, not a hot path)
const ESPN_FAILURE_THRESHOLD = 3; // consecutive failures before falling back to Tank01
const WINDOW_MS = 8 * 60 * 60 * 1000; // the same 8h kickoff window scheduler.js uses

/** Env is read per call so a value change needs no code change or restart. */
function config() {
  const num = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    espnPollMs: num(process.env.ESPN_POLL_MS, 30 * 1000),
    fastPollMs: num(process.env.LIVE_FAST_POLL_MS, 10 * 60 * 1000),
    idleCheckMs: num(process.env.LIVE_IDLE_CHECK_MS, 60 * 1000),
  };
}

/** Configured source; 'tank01' pins the paid path, anything else means ESPN. */
function configuredClockSource() {
  return String(process.env.LIVE_CLOCK_SOURCE || 'espn').toLowerCase() === 'tank01'
    ? 'tank01'
    : 'espn';
}

let loopTimer = null;
let stopped = true;
let lastRunAt = null;
let lastError = null;
let lastRecapSweepAt = 0;
let espnConsecutiveFailures = 0;
let lastSourceUsed = null;
let lastQuotaMode = null;

/**
 * Which source this tick will actually use. ESPN is retried on every tick even
 * while in fallback, so recovery is automatic and needs no operator action.
 */
function activeClockSource() {
  if (configuredClockSource() === 'tank01') return 'tank01';
  return espnConsecutiveFailures >= ESPN_FAILURE_THRESHOLD ? 'tank01' : 'espn';
}

/**
 * Pure: Tank01's gameStatusCode/gameStatus -> our enum. `0` is "Not Started
 * Yet" and `2` is "Completed"/"Final" (confirmed against real responses);
 * every other code (in progress, halftime, delayed, etc.) maps to
 * 'in_progress' so an unexpected code errs toward polling more, not less.
 */
function mapTank01Status(entry) {
  const code = String((entry && entry.gameStatusCode) ?? '');
  if (code === '2') return 'final';
  if (code === '0') return 'scheduled';
  const status = String((entry && entry.gameStatus) || '').toLowerCase();
  if (status.includes('final') || status.includes('completed')) return 'final';
  if (status.includes('not started') || status.includes('scheduled')) return 'scheduled';
  return 'in_progress';
}

/**
 * Pure: one `/getNFLScoresOnly` entry -> our row shape, or null when the
 * entry is missing anything load-bearing. `season`/`week` come from the
 * caller (this endpoint's response carries neither).
 *
 * espnScoreboard.normalizeEspnEvent produces this exact shape, by design.
 */
function normalizeLiveGameEntry(entry, { season, week }) {
  if (!entry || !entry.gameID || !entry.home || !entry.away) return null;
  const epoch = Number(entry.gameTime_epoch);
  return {
    tank01GameId: String(entry.gameID),
    season,
    week,
    homeTeam: String(entry.home),
    awayTeam: String(entry.away),
    gameStatus: mapTank01Status(entry),
    startTime: Number.isFinite(epoch) && epoch > 0 ? new Date(epoch * 1000) : null,
    currentScoreHome: Number(entry.homePts) || 0,
    currentScoreAway: Number(entry.awayPts) || 0,
    quarter: entry.lineScore && entry.lineScore.period ? String(entry.lineScore.period) : null,
    timeRemaining: entry.gameClock ? String(entry.gameClock) : null,
  };
}

/**
 * Season/weeks worth polling right now: nfl_games' kickoff-window heuristic
 * (same coarse gate scheduler.js already uses) UNIONed with any
 * live_game_states row still marked in_progress — a safety net so a game
 * that runs long (weather delay, overtime) keeps polling even after its
 * kickoff-window has aged out.
 */
async function findLiveWindowSeasonWeeks() {
  const result = await pool.query(`
    SELECT DISTINCT "season", "week" FROM "nfl_games"
     WHERE "kickoff_at" BETWEEN now() - interval '8 hours' AND now()
    UNION
    SELECT DISTINCT "season", "week" FROM "live_game_states"
     WHERE "game_status" = 'in_progress'
  `);
  return result.rows.map((r) => ({ season: r.season, week: r.week }));
}

/**
 * Everything `nextPollPlan` needs, in one round trip: the active (season, week)
 * windows, the current status + kickoff of every game in those windows, and the
 * next kickoff still in the future. An idle tick is exactly this one query.
 */
const POLL_STATE_SQL = `
  WITH "windows" AS (
    SELECT DISTINCT "season", "week" FROM "nfl_games"
     WHERE "kickoff_at" BETWEEN now() - interval '8 hours' AND now()
    UNION
    SELECT DISTINCT "season", "week" FROM "live_game_states"
     WHERE "game_status" = 'in_progress'
  )
  SELECT
    COALESCE((SELECT json_agg(json_build_object('season', "season", 'week', "week")) FROM "windows"), '[]'::json)
      AS "windows",
    COALESCE((SELECT json_agg(json_build_object('status', "l"."game_status", 'startTime', "l"."start_time"))
                FROM "live_game_states" "l"
                JOIN "windows" "w" ON "w"."season" = "l"."season" AND "w"."week" = "l"."week"), '[]'::json)
      AS "statuses",
    (SELECT MIN("kickoff_at") FROM "nfl_games" WHERE "kickoff_at" > now()) AS "next_kickoff"
`;

async function readPollState() {
  const result = await pool.query(POLL_STATE_SQL);
  const row = result.rows[0] || {};
  return {
    windows: (row.windows || []).map((w) => ({ season: w.season, week: w.week })),
    statuses: (row.statuses || []).map((s) => ({
      status: s.status,
      startTime: s.startTime ? new Date(s.startTime) : null,
    })),
    nextKickoffAt: row.next_kickoff ? new Date(row.next_kickoff) : null,
  };
}

/**
 * Pure: should this tick call the clock API, and when should the next tick run?
 *
 * This is the whole quota story for the live clock, so it's deliberately a
 * function of plain data:
 *  - a game in progress          -> poll at the source's cadence
 *  - a kickoff just passed       -> poll (catches the scheduled -> in_progress flip)
 *  - the next kickoff is ahead   -> no call; wake by then (or the idle beat)
 *  - everything final / no games -> no call; idle beat only
 *  - Tank01 path out of quota    -> no call (Realtime rows just stop updating)
 *
 * @param {object} opts
 * @param {Array<{status: string, startTime: ?Date}>} opts.statuses window games
 * @param {?Date} opts.nextKickoffAt next kickoff still in the future
 * @param {number} opts.now epoch ms
 * @param {string} opts.quotaMode from tank01Client.getQuotaState()
 * @param {'espn'|'tank01'} opts.clockSource source this tick would use
 * @param {boolean} opts.windowOpen a kickoff happened inside the 8h window
 * @returns {{callApi: boolean, nextDelayMs: number, reason: string}}
 */
function nextPollPlan({
  statuses = [],
  nextKickoffAt = null,
  now = Date.now(),
  quotaMode = 'ok',
  clockSource = 'espn',
  windowOpen,
} = {}) {
  const { espnPollMs, fastPollMs, idleCheckMs } = config();
  const open = windowOpen === undefined ? statuses.length > 0 : Boolean(windowOpen);

  // The clock is a 'standard' priority call, so it stops when standard stops.
  // ESPN costs nothing, so quota never gates it.
  if (clockSource === 'tank01' && !priorityAllowed('standard', quotaMode)) {
    return { callApi: false, nextDelayMs: idleCheckMs, reason: 'quota-blocked' };
  }

  const liveCadence = () => {
    if (clockSource === 'espn') return espnPollMs;
    // Stretch the paid path when we're into the soft limit; the free path has
    // no reason to slow down.
    return quotaMode === 'degraded' ? fastPollMs * 2 : fastPollMs;
  };

  if (statuses.some((s) => s.status === 'in_progress')) {
    return { callApi: true, nextDelayMs: liveCadence(), reason: 'in-progress' };
  }

  if (open) {
    // A window is open but nothing is marked live yet: either we've never seen
    // these games, or a kickoff has passed and the flip to in_progress is what
    // we're looking for.
    if (statuses.length === 0) {
      return { callApi: true, nextDelayMs: liveCadence(), reason: 'window-open-unseen' };
    }
    const kickedOff = statuses.some(
      (s) =>
        s.status === 'scheduled' &&
        s.startTime instanceof Date &&
        !Number.isNaN(s.startTime.getTime()) &&
        s.startTime.getTime() <= now &&
        now - s.startTime.getTime() <= WINDOW_MS
    );
    if (kickedOff) {
      return { callApi: true, nextDelayMs: liveCadence(), reason: 'kickoff-passed' };
    }
  }

  if (nextKickoffAt instanceof Date && !Number.isNaN(nextKickoffAt.getTime())) {
    const untilKickoff = nextKickoffAt.getTime() - now;
    if (untilKickoff > 0) {
      return {
        callApi: false,
        nextDelayMs: Math.max(Math.min(untilKickoff, idleCheckMs), 1000),
        reason: 'awaiting-kickoff',
      };
    }
  }

  // Everything in the window is final (this is what deletes the old 8-hour
  // post-final polling tail), or there's nothing scheduled at all.
  return { callApi: false, nextDelayMs: idleCheckMs, reason: 'idle' };
}

const UPSERT_SQL = `
  INSERT INTO "live_game_states"
    ("tank01_game_id", "season", "week", "home_team", "away_team", "game_status",
     "start_time", "current_score_home", "current_score_away", "quarter",
     "time_remaining", "last_updated")
  SELECT * FROM unnest(
    $1::text[], $2::int[], $3::int[], $4::text[], $5::text[],
    $6::text[]::game_status_type[], $7::timestamptz[], $8::int[], $9::int[],
    $10::text[], $11::text[], $12::timestamptz[]
  )
  ON CONFLICT ("tank01_game_id") DO UPDATE SET
    "season" = EXCLUDED."season",
    "week" = EXCLUDED."week",
    "home_team" = EXCLUDED."home_team",
    "away_team" = EXCLUDED."away_team",
    "game_status" = EXCLUDED."game_status",
    "start_time" = EXCLUDED."start_time",
    "current_score_home" = EXCLUDED."current_score_home",
    "current_score_away" = EXCLUDED."current_score_away",
    "quarter" = EXCLUDED."quarter",
    "time_remaining" = EXCLUDED."time_remaining",
    "last_updated" = EXCLUDED."last_updated",
    "updated_at" = now()
  RETURNING "tank01_game_id", "game_status"
`;

/**
 * One `/getNFLScoresOnly` call (the metered fallback path), normalized
 * per-entry inside a try/catch so one malformed Tank01 entry can't kill the
 * rest of the tick.
 */
async function fetchTank01Rows({ season, week }) {
  const response = await tank01Get('/getNFLScoresOnly', {
    params: { gameWeek: week, season },
    priority: 'standard',
  });
  const body = tank01Body(response.data) || {};
  const rows = [];
  for (const raw of Object.values(body)) {
    try {
      const normalized = normalizeLiveGameEntry(raw, { season, week });
      if (normalized) rows.push(normalized);
    } catch (err) {
      console.error(
        'liveGameEngine: failed to normalize entry %s:',
        (raw && raw.gameID) || '?',
        err.message
      );
    }
  }
  return rows;
}

/**
 * Rows for one (season, week) from the active source. ESPN first (free); after
 * ESPN_FAILURE_THRESHOLD consecutive failures the Tank01 path takes over while
 * ESPN keeps being retried every tick. A single ESPN failure just skips the
 * tick rather than immediately spending quota.
 *
 * @returns {Promise<{rows: ?Array<object>, source: string}>} rows === null
 *   means "nothing fetched this tick" (not "no games").
 */
async function fetchRowsForWeek({ season, week }) {
  if (configuredClockSource() === 'espn') {
    try {
      const { rows } = await espnScoreboard.fetchLiveRows({ season, week });
      espnConsecutiveFailures = 0;
      return { rows, source: 'espn' };
    } catch (err) {
      espnConsecutiveFailures += 1;
      console.error(
        'liveGameEngine: ESPN scoreboard failed (%d consecutive):',
        espnConsecutiveFailures,
        err.message
      );
      if (espnConsecutiveFailures < ESPN_FAILURE_THRESHOLD) {
        return { rows: null, source: 'espn' };
      }
      console.error('liveGameEngine: falling back to the Tank01 clock path');
    }
  }
  return { rows: await fetchTank01Rows({ season, week }), source: 'tank01' };
}

/**
 * Bulk-upsert a week's rows in a single `unnest(...) ... ON CONFLICT`
 * statement — not a per-row loop — and enqueue a recap for every game that
 * transitioned INTO final on this tick.
 * Returns whether any upserted row is currently in_progress.
 */
async function upsertRows(rows) {
  if (!rows || rows.length === 0) return { hasInProgress: false, upserted: 0 };

  // Pre-upsert statuses so we can detect games transitioning INTO 'final' on
  // this tick (and only this tick) — a recap is generated once, when the game
  // first goes final, never again for games already final on a prior tick.
  const gameIds = rows.map((r) => r.tank01GameId);
  const priorRes = await pool.query(
    `SELECT "tank01_game_id", "game_status" FROM "live_game_states"
     WHERE "tank01_game_id" = ANY($1)`,
    [gameIds]
  );
  const priorStatus = new Map(priorRes.rows.map((r) => [r.tank01_game_id, r.game_status]));

  const now = new Date();
  const result = await pool.query(UPSERT_SQL, [
    rows.map((r) => r.tank01GameId),
    rows.map((r) => r.season),
    rows.map((r) => r.week),
    rows.map((r) => r.homeTeam),
    rows.map((r) => r.awayTeam),
    rows.map((r) => r.gameStatus),
    rows.map((r) => r.startTime),
    rows.map((r) => r.currentScoreHome),
    rows.map((r) => r.currentScoreAway),
    rows.map((r) => r.quarter),
    rows.map((r) => r.timeRemaining),
    rows.map(() => now),
  ]);

  // Enqueue recap generation for freshly-final games. The queue bounds the
  // box-score fan-out (a burst of games going final at once becomes a short
  // sequence, not a thundering herd) and swallows failures, so it can never
  // break or delay the poll loop. That one box-score fetch also ingests the
  // game's final stats — see gameRecap.generateForGame.
  for (const gameId of finalTransitions(priorStatus, result.rows)) {
    gameRecap.enqueueRecap(gameId);
  }

  const hasInProgress = result.rows.some((r) => r.game_status === 'in_progress');
  return { hasInProgress, upserted: result.rows.length };
}

/** Fetch one (season, week) from the active source and upsert it. */
async function pollAndUpsert({ season, week }) {
  const { rows, source } = await fetchRowsForWeek({ season, week });
  lastSourceUsed = source;
  if (rows === null) return { hasInProgress: false, source, skipped: true };
  const { hasInProgress, upserted } = await upsertRows(rows);
  return { hasInProgress, source, upserted };
}

/**
 * Pure: which upserted games just transitioned INTO 'final' on this tick —
 * i.e. are now final but weren't final before. Games already final on a prior
 * tick are excluded, so a recap is generated exactly once per game.
 *
 * @param {Map<string,string>} priorStatus - game id -> pre-upsert status
 * @param {Array<{tank01_game_id: string, game_status: string}>} resultRows
 * @returns {string[]} game ids to generate a recap for
 */
function finalTransitions(priorStatus, resultRows) {
  const out = [];
  for (const r of resultRows) {
    if (r.game_status === 'final' && priorStatus.get(r.tank01_game_id) !== 'final') {
      out.push(r.tank01_game_id);
    }
  }
  return out;
}

async function tick() {
  if (stopped) return;
  let nextDelay = config().idleCheckMs;
  let lockClient = null;
  let lockHeld = false;
  try {
    lockClient = await pool.connect();
    const lockResult = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [23003]);
    lockHeld = Boolean(lockResult.rows[0]?.locked);
    if (!lockHeld) return;

    const { windows, statuses, nextKickoffAt } = await readPollState();
    const quota = await getQuotaState().catch(() => ({ mode: 'ok' }));
    lastQuotaMode = quota.mode;
    const clockSource = activeClockSource();
    const plan = nextPollPlan({
      statuses,
      nextKickoffAt,
      now: Date.now(),
      quotaMode: quota.mode,
      clockSource,
      windowOpen: windows.length > 0,
    });
    nextDelay = plan.nextDelayMs;

    if (plan.callApi) {
      let anyInProgress = false;
      for (const w of windows) {
        const { hasInProgress } = await pollAndUpsert(w);
        anyInProgress = anyInProgress || hasInProgress;
      }
      // A slate that just went live wants the live cadence immediately rather
      // than after one more idle beat.
      if (anyInProgress) {
        nextDelay = nextPollPlan({
          statuses: [{ status: 'in_progress', startTime: null }],
          now: Date.now(),
          quotaMode: quota.mode,
          clockSource: activeClockSource(),
          windowOpen: true,
        }).nextDelayMs;
      }
    }
    lastError = null;

    // Reconciliation sweep on a slower cadence than the live poll: heals games
    // that ended up with no recap (crash/deploy mid-window, or a dropped live
    // trigger). Fire-and-forget through the same bounded queue — never blocks
    // the tick.
    if (Date.now() - lastRecapSweepAt >= RECAP_SWEEP_INTERVAL_MS) {
      lastRecapSweepAt = Date.now();
      gameRecap
        .reconcileRecaps()
        .catch((err) => console.error('recap reconcile sweep failed:', err.message));
    }
  } catch (err) {
    console.error('liveGameEngine tick failed:', err.message);
    lastError = err.message;
    nextDelay = config().idleCheckMs; // back off to the cheap cadence on failure
  } finally {
    if (lockHeld) {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [23003]).catch(() => {});
    }
    if (lockClient) lockClient.release();
    lastRunAt = new Date().toISOString();
    if (!stopped) loopTimer = setTimeout(tick, nextDelay).unref();
  }
}

function startLiveGameEngine() {
  if (!stopped) return loopTimer;
  stopped = false;
  loopTimer = setTimeout(tick, 5 * 1000).unref(); // first pass shortly after boot
  return loopTimer;
}

function stopLiveGameEngine() {
  stopped = true;
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
}

/** Snapshot of worker health for the /api/health endpoint. */
function getLiveGameEngineStatus() {
  return {
    lastRunAt,
    lastError,
    clockSource: activeClockSource(),
    configuredClockSource: configuredClockSource(),
    lastSourceUsed,
    espnConsecutiveFailures,
    quotaMode: lastQuotaMode,
  };
}

module.exports = {
  startLiveGameEngine,
  stopLiveGameEngine,
  tick,
  normalizeLiveGameEntry,
  mapTank01Status,
  findLiveWindowSeasonWeeks,
  readPollState,
  nextPollPlan,
  fetchTank01Rows,
  fetchRowsForWeek,
  upsertRows,
  pollAndUpsert,
  finalTransitions,
  activeClockSource,
  configuredClockSource,
  getLiveGameEngineStatus,
  ESPN_FAILURE_THRESHOLD,
  // test seam: reset the ESPN failure counter between cases
  __resetClockSourceState() {
    espnConsecutiveFailures = 0;
    lastSourceUsed = null;
    lastQuotaMode = null;
  },
};
