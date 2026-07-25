/**
 * Free NFL game clock/score/status from ESPN's public scoreboard JSON.
 *
 * This is the DEFAULT source for the live clock (see liveGameEngine). Tank01's
 * `/getNFLScoresOnly` produced the same data but costs quota, and at a 20-30s
 * cadence a single Sunday burned ~1,500 of a ~1,000/MONTH allowance. ESPN's
 * scoreboard endpoint needs no key, no subscription, and is not metered — so
 * it never goes through modules/tank01Client and is deliberately a plain axios
 * call.
 *
 * Everything here produces the SAME row shape as
 * liveGameEngine.normalizeLiveGameEntry, including a Tank01-style
 * `tank01GameId` (`YYYYMMDD_AWAY@HOME`, dated in ET), because that id is the
 * unique key of live_game_states and the join key for recaps and box scores.
 * Getting that id right is the whole trick: ESPN dates events in UTC, so a
 * Sunday-night or Monday-night kickoff lands on the FOLLOWING UTC day and a
 * naive date slice would mint a second, permanently unmatchable row. We date
 * from ET, and
 * prefer the kickoff already stored in nfl_games (itself synced from Tank01's
 * own epoch) whenever we have it.
 */
const axios = require('axios');
const pool = require('./pool');

const ESPN_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const ESPN_TIMEOUT_MS = Number(process.env.ESPN_TIMEOUT_MS) || 10000;

/**
 * ESPN team code -> the code Tank01's live feed uses, which is what our
 * live-data tables store. Diffing ESPN's /teams list against nfl_games (itself
 * Tank01-synced) shows the two vocabularies already agree on all 32 codes,
 * INCLUDING Washington: both say WSH.
 *
 * Watch out for that one. scoring.service's NFL_TEAM_NAME_TO_ABBR maps
 * 'WASHINGTON COMMANDERS' -> 'WAS' because it exists to match full-name DEF
 * rows, and Postgres' fn_normalize_nfl_team folds WSH -> WAS for joins — but a
 * Tank01 gameID is spelled WSH, so normalizing to WAS here would build an id
 * that matches no box score and no recap. Hence WAS -> WSH, not the reverse.
 *
 * Everything else below is a historical or alternate code, mapped defensively
 * so a stale payload can't silently drop a game.
 */
const ESPN_TO_OUR_ABBR = {
  WAS: 'WSH',
  LA: 'LAR', // "Los Angeles" without a suffix always meant the Rams here
  STL: 'LAR',
  SD: 'LAC',
  OAK: 'LV',
  ARZ: 'ARI',
  BLT: 'BAL',
  CLV: 'CLE',
  HST: 'HOU',
  JAC: 'JAX',
};

/**
 * The 32 codes our live-data tables actually hold. Sourced from
 * scoring.service's team map so the lists can't drift, with WSH swapped in for
 * that map's join-oriented WAS (see ESPN_TO_OUR_ABBR above). Membership — not
 * just "looks like a code" — is what rejects ESPN's `TBD` placeholders for
 * flex-scheduled games, which would otherwise mint junk live_game_states rows.
 */
const OUR_TEAM_CODES = new Set(
  Object.values(require('../services/scoring.service').NFL_TEAM_NAME_TO_ABBR)
    .filter((code) => code !== 'WAS')
    .concat('WSH')
);

/** Pure: an ESPN abbreviation -> our abbreviation, or null when unusable. */
function espnAbbrToOurs(abbr) {
  const raw = String(abbr || '').trim().toUpperCase();
  if (!raw) return null;
  const mapped = ESPN_TO_OUR_ABBR[raw] || raw;
  return OUR_TEAM_CODES.has(mapped) ? mapped : null;
}

/**
 * Pure: an ISO instant -> 'YYYYMMDD' in US Eastern time, which is how Tank01
 * dates its game ids. en-CA gives ISO-ordered output and the TZ database
 * handles DST, so this is correct in both September and January.
 */
function etDateKey(value) {
  // `new Date(null)` is the epoch, not an error — reject empties explicitly so a
  // missing kickoff can never be dated 1969.
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date
    .toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    .replace(/-/g, '');
}

/** Pure: ESPN status -> our game_status enum. */
function mapEspnStatus(status) {
  const type = (status && status.type) || {};
  const state = String(type.state || '').toLowerCase();
  if (state === 'pre') return 'scheduled';
  if (state === 'post') return 'final';
  if (state === 'in') return 'in_progress';
  // Unknown state: err toward polling more, not less (same bias as
  // liveGameEngine.mapTank01Status).
  if (type.completed === true) return 'final';
  return 'in_progress';
}

/**
 * Pure: ESPN period/status -> the short quarter label the UI already renders
 * alongside the clock ('Q3', 'OT', 'Final', 'Half'). Kept under 10 chars to
 * match live_game_states.quarter.
 */
function mapEspnQuarter(status, gameStatus) {
  const type = (status && status.type) || {};
  const name = String(type.name || '').toUpperCase();
  if (name.includes('HALFTIME')) return 'Half';
  if (gameStatus === 'final') return 'Final';
  if (gameStatus === 'scheduled') return null;
  const period = Number(status && status.period);
  if (!Number.isFinite(period) || period <= 0) return null;
  if (period <= 4) return `Q${period}`;
  return period === 5 ? 'OT' : `OT${period - 4}`;
}

/**
 * Pure: one ESPN event -> our live_game_states row shape, or null when the
 * event is missing anything load-bearing (both teams, a usable kickoff, or
 * team codes we can't normalize). `tank01GameId` is built from the ET kickoff
 * date; `resolveGameIds` may later re-date it from nfl_games.
 */
function normalizeEspnEvent(event, { season, week }) {
  const competition = event && Array.isArray(event.competitions) ? event.competitions[0] : null;
  if (!competition) return null;
  const competitors = Array.isArray(competition.competitors) ? competition.competitors : [];
  const home = competitors.find((c) => c && c.homeAway === 'home');
  const away = competitors.find((c) => c && c.homeAway === 'away');
  if (!home || !away) return null;

  const homeTeam = espnAbbrToOurs(home.team && home.team.abbreviation);
  const awayTeam = espnAbbrToOurs(away.team && away.team.abbreviation);
  if (!homeTeam || !awayTeam) return null;

  const kickoff = competition.date || (event && event.date);
  const dateKey = etDateKey(kickoff);
  if (!dateKey) return null;

  const status = competition.status || (event && event.status) || {};
  const gameStatus = mapEspnStatus(status);
  const clock = status.displayClock ? String(status.displayClock) : null;

  return {
    tank01GameId: `${dateKey}_${awayTeam}@${homeTeam}`,
    season,
    week,
    homeTeam,
    awayTeam,
    gameStatus,
    startTime: new Date(kickoff),
    currentScoreHome: Number(home.score) || 0,
    currentScoreAway: Number(away.score) || 0,
    quarter: mapEspnQuarter(status, gameStatus),
    // A finished or unstarted game reports '0:00'; Tank01 reported '' there,
    // and the UI renders the clock verbatim, so keep it null off the field.
    timeRemaining: gameStatus === 'in_progress' ? clock : null,
  };
}

/**
 * Pure: a whole scoreboard payload -> { rows, dropped }. One malformed event
 * can never take out the rest of the slate.
 */
function normalizeEspnScoreboard(payload, { season, week }) {
  const events = payload && Array.isArray(payload.events) ? payload.events : [];
  const rows = [];
  const dropped = [];
  for (const event of events) {
    let row = null;
    try {
      row = normalizeEspnEvent(event, { season, week });
    } catch (err) {
      row = null;
    }
    if (row) rows.push(row);
    else dropped.push((event && (event.shortName || event.name || event.id)) || '?');
  }
  return { rows, dropped };
}

/**
 * Pure: re-date each row's game id from the kickoff we already have in
 * nfl_games, keyed by the unordered team pair (nfl_games stores one row per
 * team per week and carries no home/away marker, so ESPN supplies the
 * ordering). nfl_games came from Tank01's own kickoff epoch, so its ET date is
 * exactly what Tank01's gameID uses — this is what keeps ESPN-sourced rows and
 * Tank01-sourced box scores on the same key. Rows with no schedule match keep
 * their ESPN-derived id and are reported in `unmatched`.
 *
 * @param {Array<object>} rows normalized rows
 * @param {Map<string, Date>} kickoffByPair key `${a}|${b}` (sorted) -> kickoff
 */
function resolveGameIds(rows, kickoffByPair) {
  const unmatched = [];
  const out = rows.map((row) => {
    const key = [row.homeTeam, row.awayTeam].sort().join('|');
    const kickoff = kickoffByPair && kickoffByPair.get(key);
    if (!kickoff) {
      unmatched.push(row.tank01GameId);
      return row;
    }
    const dateKey = etDateKey(kickoff);
    if (!dateKey) return row;
    return { ...row, tank01GameId: `${dateKey}_${row.awayTeam}@${row.homeTeam}` };
  });
  return { rows: out, unmatched };
}

/** The (season, week) slate's kickoffs from nfl_games, keyed by team pair. */
async function loadKickoffsForWeek({ season, week }) {
  const res = await pool.query(
    `SELECT "nfl_team", "opponent", "kickoff_at" FROM "nfl_games"
      WHERE "season" = $1 AND "week" = $2 AND "kickoff_at" IS NOT NULL`,
    [season, week]
  );
  const map = new Map();
  for (const row of res.rows) {
    const a = String(row.nfl_team || '').toUpperCase();
    const b = String(row.opponent || '').toUpperCase();
    if (!a || !b) continue;
    map.set([a, b].sort().join('|'), new Date(row.kickoff_at));
  }
  return map;
}

/**
 * Fetch and normalize one week's scoreboard. Zero quota cost.
 *
 * @param {object} opts
 * @param {number} opts.season
 * @param {number} opts.week
 * @param {object} [opts.transport] axios-like client (tests inject)
 * @param {Map}    [opts.kickoffByPair] pre-loaded schedule (tests inject; when
 *                 omitted it's read from nfl_games)
 * @returns {Promise<{rows: Array<object>, dropped: string[], unmatched: string[]}>}
 */
async function fetchLiveRows({ season, week, transport, kickoffByPair }) {
  const client = transport || axios;
  const response = await client.get(ESPN_SCOREBOARD_URL, {
    params: { week, seasontype: 2, dates: season },
    timeout: ESPN_TIMEOUT_MS,
  });
  const { rows, dropped } = normalizeEspnScoreboard(response.data, { season, week });
  if (dropped.length > 0) {
    console.error('espnScoreboard: dropped %d unmatched event(s): %s', dropped.length, dropped.join(', '));
  }
  const schedule = kickoffByPair || (await loadKickoffsForWeek({ season, week }).catch(() => new Map()));
  const resolved = resolveGameIds(rows, schedule);
  if (resolved.unmatched.length > 0) {
    console.warn(
      'espnScoreboard: %d game(s) not in nfl_games for %s week %s, using ESPN kickoff dates: %s',
      resolved.unmatched.length,
      season,
      week,
      resolved.unmatched.join(', ')
    );
  }
  return { rows: resolved.rows, dropped, unmatched: resolved.unmatched };
}

module.exports = {
  fetchLiveRows,
  loadKickoffsForWeek,
  // pure — unit tested
  normalizeEspnEvent,
  normalizeEspnScoreboard,
  resolveGameIds,
  mapEspnStatus,
  mapEspnQuarter,
  espnAbbrToOurs,
  etDateKey,
  ESPN_SCOREBOARD_URL,
  ESPN_TO_OUR_ABBR,
  OUR_TEAM_CODES,
};
