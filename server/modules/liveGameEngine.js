/**
 * Adaptive-cadence worker that keeps `live_game_states` fresh so Supabase
 * Realtime can push real NFL game clock/status straight to the browser —
 * separate from the existing Socket.IO fantasy-score pipeline
 * (scoring.service.js / scheduler.js), which this does not touch.
 *
 * Live score/status/clock comes from Tank01's `/getNFLScoresOnly` endpoint,
 * queried with `{ gameWeek, season }` (NOT `{ week, seasonType, season }` —
 * that's `/getNFLGamesForWeek`'s shape, a schedule-only endpoint with no
 * score/clock fields at all). One `/getNFLScoresOnly` call returns every
 * game for that week keyed by gameID, so a live tick costs one Tank01 call
 * per active (season, week), not one per game.
 */
const pool = require('./pool');
const { rapidApiClient, tank01Body } = require('../services/scoring.service');
const gameRecap = require('../services/gameRecap.service');

const SLOW_POLL_MS = 5 * 60 * 1000; // idle cadence
const FAST_POLL_MS = 20 * 1000; // live cadence
const RECAP_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // reconciliation cadence (safety net, not a hot path)

let loopTimer = null;
let stopped = true;
let lastRunAt = null;
let lastError = null;
let lastRecapSweepAt = 0;

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
 * One `/getNFLScoresOnly` call for the week, normalized per-entry inside a
 * try/catch (one malformed Tank01 entry can't kill the rest of the tick),
 * then a single bulk `unnest(...) ... ON CONFLICT` upsert — not a per-row
 * loop — so a whole week's worth of games commits as one statement.
 * Returns whether any upserted row is currently in_progress.
 */
async function pollAndUpsert({ season, week }) {
  const api = rapidApiClient();
  const response = await api.get('/getNFLScoresOnly', { params: { gameWeek: week, season } });
  const body = tank01Body(response.data) || {};
  const rows = [];
  for (const raw of Object.values(body)) {
    try {
      const normalized = normalizeLiveGameEntry(raw, { season, week });
      if (normalized) rows.push(normalized);
    } catch (err) {
      console.error(
        `liveGameEngine: failed to normalize entry ${(raw && raw.gameID) || '?'}:`,
        err.message
      );
    }
  }
  if (rows.length === 0) return { hasInProgress: false };

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
  // break or delay the poll loop.
  for (const gameId of finalTransitions(priorStatus, result.rows)) {
    gameRecap.enqueueRecap(gameId);
  }

  const hasInProgress = result.rows.some((r) => r.game_status === 'in_progress');
  return { hasInProgress };
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
  let nextDelay = SLOW_POLL_MS;
  try {
    const windows = await findLiveWindowSeasonWeeks();
    let anyInProgress = false;
    for (const w of windows) {
      const { hasInProgress } = await pollAndUpsert(w);
      anyInProgress = anyInProgress || hasInProgress;
    }
    nextDelay = anyInProgress ? FAST_POLL_MS : SLOW_POLL_MS;
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
    lastError = err.message; // back off to slow cadence on failure
  } finally {
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
  return { lastRunAt, lastError };
}

module.exports = {
  startLiveGameEngine,
  stopLiveGameEngine,
  tick,
  normalizeLiveGameEntry,
  mapTank01Status,
  findLiveWindowSeasonWeeks,
  pollAndUpsert,
  finalTransitions,
  getLiveGameEngineStatus,
};
