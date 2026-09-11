/**
 * The Live box source switch (#1184, ADR 0035).
 *
 * One Live box per in-progress game is read through the Box source seam. ESPN
 * (services/espnBoxSource, free) is the default; Tank01 (services/tank01BoxSource,
 * metered) is the fallback. The rules, all of them here and nowhere else:
 *
 *  - Three consecutive ESPN failures switch the Live box to Tank01. The counter
 *    is this module's own, separate from the clock's `espnConsecutiveFailures`
 *    in liveGameEngine: the scoreboard can be healthy while the summary is not,
 *    and the other way round. An HTTP failure, a timeout, and a 200 whose parse
 *    yields no player rows for a game in progress all count.
 *  - ESPN is retried on every tick while in fallback and taken back on the
 *    first success. Below the threshold a failure skips the tick (no paid call
 *    for one bad response).
 *  - In fallback the Tank01 box is read at LIVE_FAST_POLL_MS per game (default
 *    10 min, doubled while quota is degraded) at standard priority.
 *  - `LIVE_BOX_SOURCE` (espn | tank01, default espn) pins the source without a
 *    deploy, mirroring LIVE_CLOCK_SOURCE.
 *  - Every switch, either direction, writes a data_sync_runs row (job
 *    `live-box`, ok false entering fallback, true on recovery) and a Sentry
 *    message where SENTRY_DSN is set. Nothing pages anyone (spec ruling).
 *  - The first apply after any source change writes stats but emits no Scoring
 *    plays (the switch-pass rule), so a source that is a poll behind cannot
 *    replay a touchdown cutscene. The Final box handoff reuses the same option
 *    on applyGameBoxScore.
 */
const axios = require('axios');
const { tank01Get, getQuotaState } = require('./tank01Client');
const { captureMessage } = require('./sentry');
const espnBoxSource = require('../services/espnBoxSource');
const tank01BoxSource = require('../services/tank01BoxSource');
const { tank01Body } = require('../services/scoring.service');
const { recordDataSyncRun } = require('./syncRun');

const ESPN_SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';
const ESPN_BOX_FAILURE_THRESHOLD = 3;

function config() {
  const num = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    timeoutMs: num(process.env.ESPN_TIMEOUT_MS, 10000),
    fastPollMs: num(process.env.LIVE_FAST_POLL_MS, 10 * 60 * 1000),
  };
}

/** Configured source; 'tank01' pins the paid path, anything else means ESPN. */
function configuredBoxSource() {
  return String(process.env.LIVE_BOX_SOURCE || 'espn').toLowerCase() === 'tank01' ? 'tank01' : 'espn';
}

let espnBoxFailures = 0;
let lastFailureKind = null;
const lastSourceByGame = new Map(); // gameId -> source of the last apply
const lastTank01FetchAt = new Map(); // gameId -> epoch ms of the last paid box read

/** The source this tick would read. */
function activeBoxSource() {
  if (configuredBoxSource() === 'tank01') return 'tank01';
  return espnBoxFailures >= ESPN_BOX_FAILURE_THRESHOLD ? 'tank01' : 'espn';
}

/**
 * The operator signal for a source switch: one data_sync_runs row and one
 * Sentry message. Best-effort, never throws (the recorder swallows its own).
 */
async function signalSwitch({ direction, gameId, failureKind, consecutiveFailures, now }) {
  const detail = {
    direction,
    from: direction === 'fallback' ? 'espn' : 'tank01',
    to: direction === 'fallback' ? 'tank01' : 'espn',
    gameId,
    failureKind: failureKind || null,
    consecutiveFailures,
  };
  await recordDataSyncRun({ job: 'live-box', startedAt: new Date(now), ok: direction === 'recovery', detail });
  const message = direction === 'fallback'
    ? `live-box: ESPN summary failed ${consecutiveFailures} times (${failureKind}); Live box reads Tank01 from ${gameId}`
    : `live-box: ESPN summary recovered; Live box back on ESPN from ${gameId}`;
  console.error(message);
  captureMessage(message, detail);
}

async function fetchEspn({ gameId, espnEventId, inProgress, transport, timeoutMs }) {
  if (!espnEventId) {
    const err = new Error('no espn_event_id for this game');
    err.failureKind = 'no_event_id';
    throw err;
  }
  const client = transport || axios;
  let response;
  try {
    response = await client.get(ESPN_SUMMARY_URL, { params: { event: String(espnEventId) }, timeout: timeoutMs });
  } catch (err) {
    err.failureKind = err.code === 'ECONNABORTED' || /timeout/i.test(String(err.message)) ? 'timeout' : 'fetch_failed';
    throw err;
  }
  const box = espnBoxSource.fromSummary(response && response.data, { gameId });
  if (inProgress && box.players.length === 0) {
    const err = new Error('ESPN summary parsed to zero player rows for a game in progress');
    err.failureKind = 'empty_box';
    throw err;
  }
  return box;
}

async function fetchTank01({ gameId, transport }) {
  const response = await tank01Get('/getNFLBoxScore', {
    params: { gameID: gameId, playByPlay: 'true', fantasyPoints: 'false' },
    priority: 'standard',
    transport,
  });
  return tank01BoxSource.fromBox(tank01Body(response.data) || {});
}

/**
 * Read one game's Live box from the active source.
 *
 * @param {object} args
 * @param {string} args.gameId          tank01_game_id
 * @param {?string} args.espnEventId    live_game_states.espn_event_id
 * @param {boolean} args.inProgress     the scoreboard says the game is live
 * @param {number} [args.now]           epoch ms (tests inject)
 * @param {object} [args.transport]     axios-like client for ESPN (tests inject)
 * @param {object} [args.tank01Transport] Tank01 client (tests inject; uncounted)
 * @param {string} [args.quotaMode]     from tank01Client.getQuotaState()
 * @returns {Promise<{liveBox: ?object, source: string, skipped: boolean, reason?: string}>}
 */
async function fetchLiveBox({ gameId, espnEventId, inProgress = true, now = Date.now(), transport, tank01Transport, quotaMode }) {
  const { timeoutMs, fastPollMs } = config();
  const configured = configuredBoxSource();

  if (configured === 'espn') {
    const wasInFallback = espnBoxFailures >= ESPN_BOX_FAILURE_THRESHOLD;
    try {
      const box = await fetchEspn({ gameId, espnEventId, inProgress, transport, timeoutMs });
      if (wasInFallback) {
        await signalSwitch({ direction: 'recovery', gameId, failureKind: lastFailureKind, consecutiveFailures: espnBoxFailures, now });
      }
      espnBoxFailures = 0;
      lastFailureKind = null;
      return { liveBox: box, source: 'espn', skipped: false };
    } catch (err) {
      espnBoxFailures += 1;
      lastFailureKind = err.failureKind || 'fetch_failed';
      console.error('liveBox: ESPN summary failed for %s (%d consecutive, %s):', gameId, espnBoxFailures, lastFailureKind, err.message);
      if (espnBoxFailures < ESPN_BOX_FAILURE_THRESHOLD) {
        return { liveBox: null, source: 'espn', skipped: true, reason: lastFailureKind };
      }
      if (espnBoxFailures === ESPN_BOX_FAILURE_THRESHOLD) {
        await signalSwitch({ direction: 'fallback', gameId, failureKind: lastFailureKind, consecutiveFailures: espnBoxFailures, now });
      }
    }
  }

  // Tank01 path: pinned, or ESPN has failed three times running.
  let mode = quotaMode;
  if (!mode) {
    mode = await getQuotaState().then((q) => q.mode).catch(() => 'ok');
  }
  const cadence = mode === 'degraded' ? fastPollMs * 2 : fastPollMs;
  const last = lastTank01FetchAt.get(gameId);
  if (last != null && now - last < cadence) {
    return { liveBox: null, source: 'tank01', skipped: true, reason: 'fast-poll-cadence' };
  }
  const box = await fetchTank01({ gameId, transport: tank01Transport });
  lastTank01FetchAt.set(gameId, now);
  return { liveBox: box, source: 'tank01', skipped: false };
}

/**
 * Apply one Live box, honouring the switch-pass rule: when this game's last
 * apply came from a different source, stats are written and no Scoring play is
 * emitted. Delegates the write and the Final box guard to applyGameBoxScore.
 */
async function applyLiveBox({ liveBox, season, week, maps }) {
  const scoring = require('../services/scoring.service');
  const previous = lastSourceByGame.get(liveBox.gameId);
  const suppressPlays = previous !== undefined && previous !== liveBox.source;
  const result = await scoring.applyGameBoxScore({ liveBox, season, week, maps, suppressPlays });
  if (!result.skipped) lastSourceByGame.set(liveBox.gameId, liveBox.source);
  return { ...result, suppressedPlays: suppressPlays };
}

/** The Final box has landed for this game: any later Live box is a switch. */
function noteFinalBoxApplied(gameId) {
  lastSourceByGame.set(gameId, 'tank01-final');
}

/** Snapshot for the worker heartbeat. */
function getLiveBoxStatus() {
  return {
    boxSource: activeBoxSource(),
    configuredBoxSource: configuredBoxSource(),
    espnBoxFailures,
    lastFailureKind,
  };
}

module.exports = {
  fetchLiveBox,
  applyLiveBox,
  noteFinalBoxApplied,
  configuredBoxSource,
  activeBoxSource,
  getLiveBoxStatus,
  ESPN_BOX_FAILURE_THRESHOLD,
  ESPN_SUMMARY_URL,
  // test seam
  __resetLiveBoxState() {
    espnBoxFailures = 0;
    lastFailureKind = null;
    lastSourceByGame.clear();
    lastTank01FetchAt.clear();
  },
};
