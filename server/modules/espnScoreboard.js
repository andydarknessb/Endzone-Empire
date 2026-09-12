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
 * Pure: resolve a situation block's `possession` (a team id, per ESPN, though
 * a stray abbreviation is accepted too) to one of our Team codes, by matching
 * it against the SAME competitors home/away already came from and folding it
 * through the same normalisation (#1233). Never the raw ESPN value; null when
 * it names no competitor here.
 */
function resolvePossession(possession, competitors) {
  if (possession == null || possession === '') return null;
  const raw = String(possession).trim();
  if (!raw) return null;
  if (!Array.isArray(competitors)) return null;
  const match = competitors.find(
    (c) =>
      c &&
      c.team &&
      (String(c.team.id) === raw || String(c.team.abbreviation || '').toUpperCase() === raw.toUpperCase())
  );
  return match ? espnAbbrToOurs(match.team.abbreviation) : null;
}

/**
 * Pure: a competition's `situation` block -> our five Situation fields, all
 * null when the block is absent (ADR 0037: a game not in progress, or an
 * in-progress game whose block is momentarily missing — a timeout, halftime —
 * clears the same way). `homeWinProbability` joins the other four under
 * #1262/ADR 0038: CONTEXT.md's Situation entry names it explicitly ("the home
 * side's win probability as the scoreboard computes it after that play"), so
 * it is read from the same block and clears with the rest, never COALESCEd.
 */
function normalizeEspnSituation(situation, competitors) {
  if (!situation) {
    return {
      possession: null,
      downDistance: null,
      isRedZone: null,
      lastPlay: null,
      homeWinProbability: null,
    };
  }
  return {
    possession: resolvePossession(situation.possession, competitors),
    downDistance: situation.shortDownDistanceText || situation.downDistanceText || null,
    // A present block missing the key is an unobserved fact, not "not in the
    // red zone" — null it like every other missing subfield, rather than
    // defaulting to false (pl-endzone formal review, #1233).
    isRedZone: typeof situation.isRedZone === 'boolean' ? situation.isRedZone : null,
    lastPlay: situation.lastPlay && situation.lastPlay.text ? String(situation.lastPlay.text) : null,
    homeWinProbability: normalizeHomeWinProbability(situation.lastPlay),
  };
}

/**
 * Pure: `situation.lastPlay.probability.homeWinPercentage` -> a 0..1 number,
 * or null when absent or not a finite number (#1262). Never a placeholder —
 * an unobserved probability is an unobserved fact, same treatment as the
 * other Situation subfields above.
 */
function normalizeHomeWinProbability(lastPlay) {
  const pct = lastPlay && lastPlay.probability ? lastPlay.probability.homeWinPercentage : undefined;
  return typeof pct === 'number' && Number.isFinite(pct) ? pct : null;
}

/**
 * Pure: a competition's `venue` block -> our three Venue fields (CONTEXT.md:
 * the stadium, whether it's indoor, whether it's a neutral site), all null
 * when the block is absent (#1262).
 */
function normalizeVenue(venue) {
  if (!venue) return { venueName: null, venueCity: null, isIndoor: null };
  return {
    venueName: venue.fullName ? String(venue.fullName) : null,
    venueCity: venue.address && venue.address.city ? String(venue.address.city) : null,
    isIndoor: typeof venue.indoor === 'boolean' ? venue.indoor : null,
  };
}

/**
 * Pure: `broadcasts[]` -> one Broadcast string (CONTEXT.md: the national
 * network or service carrying the game) — every entry's `names` flattened
 * and joined, or null when the block is absent or carries no name (#1262).
 */
function normalizeBroadcast(broadcasts) {
  if (!Array.isArray(broadcasts)) return null;
  const names = [];
  for (const entry of broadcasts) {
    if (entry && Array.isArray(entry.names)) {
      for (const name of entry.names) {
        if (name) names.push(String(name));
      }
    }
  }
  return names.length > 0 ? names.join(', ') : null;
}

/**
 * Pure: one competitor's `records[]` -> our Record shape (CONTEXT.md: three
 * cuts, each a "W-L" string) — `{ total, home, road }`, or null when nothing
 * usable is present. A neutral-site game drops the home/road split and keeps
 * only the total (CONTEXT.md's Venue entry: "a Venue that is neutral drops
 * the split and keeps the total"), since neither team is truly home or road
 * there (#1262).
 */
function normalizeRecord(records, { isNeutralSite } = {}) {
  if (!Array.isArray(records)) return null;
  let total = null;
  let home = null;
  let road = null;
  for (const record of records) {
    const type = record && record.type ? String(record.type).toLowerCase() : '';
    const summary = record && record.summary ? String(record.summary) : null;
    if (!summary) continue;
    if (type === 'total') total = summary;
    else if (type === 'home') home = summary;
    else if (type === 'road') road = summary;
  }
  if (total === null && home === null && road === null) return null;
  return isNeutralSite ? { total, home: null, road: null } : { total, home, road };
}

/**
 * Pure: one competitor's `linescores[]` -> an array of per-quarter values (a
 * missing value is null, not dropped, so the array stays quarter-indexed), or
 * null when the block is absent or empty (#1262).
 */
function normalizeLinescoreValues(linescores) {
  if (!Array.isArray(linescores) || linescores.length === 0) return null;
  return linescores.map((entry) => (entry && typeof entry.value === 'number' ? entry.value : null));
}

/**
 * Pure: both competitors' `linescores[]` -> one jsonb shape
 * `{ home: [...], away: [...] }`, or null when neither side carries any
 * (#1262). Written only once a game is final (liveGameEngine.js), but the
 * parser itself is unconditional — it reports whatever the payload carries.
 */
function normalizeLinescores(homeCompetitor, awayCompetitor) {
  const home = normalizeLinescoreValues(homeCompetitor && homeCompetitor.linescores);
  const away = normalizeLinescoreValues(awayCompetitor && awayCompetitor.linescores);
  return home === null && away === null ? null : { home, away };
}

/**
 * Pure: `competitions[0].headlines[0].shortLinkText` -> a string, or null
 * when absent (#1262).
 */
function normalizeHeadline(headlines) {
  const text = Array.isArray(headlines) && headlines[0] ? headlines[0].shortLinkText : null;
  return text ? String(text) : null;
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

  // Situation only comes from an in-progress game (#1233, ADR 0037); a stray
  // block on a scheduled/final payload is ignored, same as the clearing rule
  // the poll applies on every write.
  const situation = normalizeEspnSituation(
    gameStatus === 'in_progress' ? competition.situation : null,
    competitors
  );

  // Venue/Broadcast/Record (#1262, ADR 0038): read unconditionally — the
  // hourly Line Sync run is the writer that decides which columns these ride
  // on, this parser just reports what the payload carries.
  const venue = normalizeVenue(competition.venue);
  const isNeutralSite = typeof competition.neutralSite === 'boolean' ? competition.neutralSite : null;
  const broadcast = normalizeBroadcast(competition.broadcasts);
  const homeRecord = normalizeRecord(home.records, { isNeutralSite });
  const awayRecord = normalizeRecord(away.records, { isNeutralSite });
  // linescores/headline (#1262): also read unconditionally here — it is the
  // thirty-second poll that only writes them once a game is final.
  const linescores = normalizeLinescores(home, away);
  const headline = normalizeHeadline(competition.headlines);

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
    // ESPN's event id: the key of the summary endpoint the Live box reads
    // (ADR 0035, #1182). Stored on live_game_states so a worker restart
    // mid-game does not have to rebuild it from the scoreboard.
    espnEventId: event && event.id != null ? String(event.id) : null,
    // Situation (#1233, ADR 0037): who has the ball (a Team code), down and
    // distance text, the red zone flag, and the last play text. Null off the
    // field exactly like timeRemaining.
    possession: situation.possession,
    downDistance: situation.downDistance,
    isRedZone: situation.isRedZone,
    lastPlay: situation.lastPlay,
    // Win probability (#1262): folded into Situation per CONTEXT.md, cleared
    // together with the four fields above.
    homeWinProbability: situation.homeWinProbability,
    // Venue/Broadcast/Record (#1262, ADR 0038): written by the hourly Line
    // Sync run, not this poll — see liveGameEngine.js/lineSync.service.js.
    venueName: venue.venueName,
    venueCity: venue.venueCity,
    isIndoor: venue.isIndoor,
    isNeutralSite,
    broadcast,
    homeRecord,
    awayRecord,
    // linescores/headline (#1262): written by the poll, but only once final
    // (liveGameEngine.js gates that, not this parser).
    linescores,
    headline,
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
  normalizeEspnSituation,
  resolvePossession,
  normalizeHomeWinProbability,
  normalizeVenue,
  normalizeBroadcast,
  normalizeRecord,
  normalizeLinescoreValues,
  normalizeLinescores,
  normalizeHeadline,
  espnAbbrToOurs,
  etDateKey,
  ESPN_SCOREBOARD_URL,
  ESPN_TO_OUR_ABBR,
  OUR_TEAM_CODES,
};
