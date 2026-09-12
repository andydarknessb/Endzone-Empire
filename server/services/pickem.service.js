const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const { logTransaction } = require('./activity.service');
const { RECAPS_TABLE_SQL, isMissingRecapStorage } = require('../modules/recapStorage');
const { isPickemOnly } = require('./leagueType');
const { teamIdentityColumns, teamIdentityJoin } = require('./teamIdentity');
const { isIndoorGame } = require('./nwsWeather.service');

/**
 * League Pick'em — pick the winner of every NFL game, every week.
 *
 * ## The slate has no game id, so games are unordered TEAM PAIRS
 *
 * `nfl_games` is the only table that covers a whole season up front, and it
 * stores ONE ROW PER TEAM PER WEEK with no game id and no home/away marker.
 * A game is therefore identified here by `pairKey(a, b)` — both teams'
 * canonical abbreviations, uppercased, sorted, joined with '|' — exactly the
 * key modules/espnScoreboard.js `resolveGameIds` already uses to tie ESPN's
 * scoreboard back to our schedule. That key is what `pickem_picks.team_pair`
 * stores.
 *
 * `live_game_states` is joined as an OPPORTUNISTIC OVERLAY for home/away
 * order, status, live score and the Tank01 game id. It is written by the live
 * engine only once a week is in play, so a future week has no rows at all —
 * the slate and, critically, the KICKOFF LOCKS must never depend on it. Both
 * come from `nfl_games.kickoff_at`.
 *
 * ## Team vocabulary
 *
 * Both tables are read through the SQL function `fn_normalize_nfl_team()` on
 * every team column. `nfl_games` speaks Tank01 (WSH), `live_game_states` can
 * carry either that or a full DEF name, and the two have silently failed to
 * join in this codebase before. Normalizing in SQL means `picked_team` is
 * normalized by construction: validation only accepts values that came out of
 * the derived slate.
 *
 * ## Lock semantics
 *
 * A game locks INCLUSIVELY at kickoff (`kickoff_at <= now()`), matching
 * `lockedPlayerIds` in lineup.service.js. Locking is what reveals other
 * managers' picks, so the two must agree: an unlocked pick is never returned
 * to anyone but its owner.
 *
 * ## Ties
 *
 * A tied final game credits NOBODY (the Yahoo rule) — no points, and it counts
 * as neither correct nor incorrect.
 */

const REG_SEASON_WEEKS = 18;
const MODES = ['straight', 'confidence'];
const DEFAULT_SETTINGS = { enabled: false, mode: 'straight' };

class PickemError extends Error {
  constructor(statusCode, code, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/* ------------------------------------------------------------------ *
 * Pure core                                                           *
 * ------------------------------------------------------------------ */

/** Pure: a team string in whatever vocabulary -> trimmed upper case. */
function normalizeTeam(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

/**
 * Pure: the unordered key identifying one NFL game, e.g. pairKey('mia','BUF')
 * -> 'BUF|MIA'. Returns null when either side is missing (a bye-week row in
 * nfl_games has a null opponent).
 */
function pairKey(a, b) {
  const teams = [normalizeTeam(a), normalizeTeam(b)];
  if (!teams[0] || !teams[1]) return null;
  return teams.sort().join('|');
}

/** Internal: games are unique per (week, pair), not per pair. */
function slotKey(week, gameKey) {
  return `${week == null ? '' : week}|${gameKey}`;
}

/**
 * Pure: build the pickable slate.
 *
 * @param {Array} gameRows rows from `nfl_games` — `{ week, nfl_team, opponent,
 *   kickoff_at, game_key, roof }`, both team columns ALREADY normalized in
 *   SQL. Two rows describe each game (one per team); the game's kickoff is
 *   the MIN of the pair, so a half-synced schedule can never push a lock
 *   later than the earliest evidence we have. `game_key` and `roof` are the
 *   same value on both rows of a pair (nflverse's own both-perspectives game
 *   id, and the schedule's roof vocabulary); either row supplies them.
 * @param {Array} lgsRows rows from `live_game_states`, also already
 *   normalized. Optional and frequently EMPTY (future weeks) — every field it
 *   supplies degrades to null/'scheduled' rather than dropping the game.
 * @returns {Array} games sorted by week, then kickoff, then key
 */
function deriveSlateFromRows(gameRows, lgsRows) {
  const liveByKey = new Map();
  for (const row of lgsRows || []) {
    const key = pairKey(row.home_team, row.away_team);
    if (!key) continue;
    liveByKey.set(slotKey(row.week == null ? null : Number(row.week), key), row);
  }

  const pairs = new Map();
  for (const row of gameRows || []) {
    const key = pairKey(row.nfl_team, row.opponent);
    if (!key) continue;
    const kickoff = row.kickoff_at == null ? null : new Date(row.kickoff_at);
    if (!kickoff || Number.isNaN(kickoff.getTime())) continue;
    const week = row.week == null ? null : Number(row.week);
    const mapKey = slotKey(week, key);
    const existing = pairs.get(mapKey);
    if (!existing) {
      pairs.set(mapKey, {
        week,
        gameKey: key,
        kickoff,
        dbGameKey: row.game_key || null,
        roof: row.roof || null,
      });
    } else {
      if (kickoff < existing.kickoff) existing.kickoff = kickoff;
      if (!existing.dbGameKey && row.game_key) existing.dbGameKey = row.game_key;
      if (!existing.roof && row.roof) existing.roof = row.roof;
    }
  }

  const games = [];
  for (const [mapKey, entry] of pairs) {
    const live = liveByKey.get(mapKey) || null;
    const teams = entry.gameKey.split('|');
    games.push({
      week: entry.week,
      gameKey: entry.gameKey,
      teams,
      kickoffAt: entry.kickoff.toISOString(),
      homeTeam: live ? normalizeTeam(live.home_team) : null,
      awayTeam: live ? normalizeTeam(live.away_team) : null,
      status: live && live.game_status ? String(live.game_status) : 'scheduled',
      homeScore: live ? Number(live.current_score_home) || 0 : null,
      awayScore: live ? Number(live.current_score_away) || 0 : null,
      quarter: live && live.quarter != null ? live.quarter : null,
      timeRemaining: live && live.time_remaining != null ? live.time_remaining : null,
      tank01GameId: live && live.tank01_game_id != null ? live.tank01_game_id : null,
      // Schedule facts (ADR 0038): present from the schedule sync alone, no
      // live_game_states row required.
      dbGameKey: entry.dbGameKey,
      roof: entry.roof,
      // Game-context Sync (hourly) and the thirty-second poll both write onto
      // the same live_game_states row; every field below degrades to null
      // when that row, or that particular column on it, is absent.
      venueName: live && live.venue_name != null ? String(live.venue_name) : null,
      venueCity: live && live.venue_city != null ? String(live.venue_city) : null,
      isIndoor: live && live.is_indoor != null ? Boolean(live.is_indoor) : null,
      isNeutralSite: live && live.is_neutral_site != null ? Boolean(live.is_neutral_site) : null,
      broadcast: live && live.broadcast != null ? String(live.broadcast) : null,
      homeRecord: live && live.home_record != null ? live.home_record : null,
      awayRecord: live && live.away_record != null ? live.away_record : null,
      homeWinProbability:
        live && live.home_win_probability != null ? Number(live.home_win_probability) : null,
      linescores: live && live.linescores != null ? live.linescores : null,
      headline: live && live.headline != null ? String(live.headline) : null,
      possession: live && live.possession != null ? String(live.possession) : null,
      downDistance: live && live.down_distance != null ? String(live.down_distance) : null,
      isRedZone: live && live.is_red_zone != null ? Boolean(live.is_red_zone) : null,
      lastPlay: live && live.last_play != null ? String(live.last_play) : null,
    });
  }
  games.sort(
    (a, b) =>
      (a.week || 0) - (b.week || 0) ||
      a.kickoffAt.localeCompare(b.kickoffAt) ||
      a.gameKey.localeCompare(b.gameKey)
  );
  return games;
}

/**
 * Pure: second winner tier. `private.game_recaps` keeps final scores long
 * after live scoring (modules/liveGameEngine.js) has stopped tracking a
 * week, so a game the live table never marked final can still be graded.
 * Games already final are untouched.
 */
function applyRecapFinals(games, recapRows) {
  if (!recapRows || recapRows.length === 0) return games || [];
  const byKey = new Map();
  for (const row of recapRows) {
    const key = pairKey(row.home_team, row.away_team);
    if (!key) continue;
    byKey.set(slotKey(row.week == null ? null : Number(row.week), key), row);
  }
  return (games || []).map((game) => {
    if (game.status === 'final') return game;
    const recap = byKey.get(slotKey(game.week, game.gameKey));
    if (!recap) return game;
    return {
      ...game,
      status: 'final',
      homeTeam: normalizeTeam(recap.home_team),
      awayTeam: normalizeTeam(recap.away_team),
      homeScore: Number(recap.home_score) || 0,
      awayScore: Number(recap.away_score) || 0,
    };
  });
}

/**
 * Pure: who won. Only a FINAL game with a known home/away order resolves; a
 * tie resolves to no winner (`isTie`), which credits nobody.
 */
function winnerOf(game) {
  if (!game || game.status !== 'final') return { winner: null, isTie: false, final: false };
  if (!game.homeTeam || !game.awayTeam) return { winner: null, isTie: false, final: false };
  const home = Number(game.homeScore) || 0;
  const away = Number(game.awayScore) || 0;
  if (home === away) return { winner: null, isTie: true, final: true };
  return { winner: home > away ? game.homeTeam : game.awayTeam, isTie: false, final: true };
}

/** Pure: inclusive at kickoff, exactly like lineup.service `lockedPlayerIds`. */
function isGameLocked(game, now = new Date()) {
  if (!game || !game.kickoffAt) return false;
  const at = now instanceof Date ? now : new Date(now);
  return new Date(game.kickoffAt).getTime() <= at.getTime();
}

/* ------------------------------------------------------------------ *
 * Week-board field builders (ADR 0038) — each pure, each null when its *
 * own source has nothing, per the ADR's "insight is not a term" ruling *
 * ------------------------------------------------------------------ */

/** Pure: `{ spread, total, observedAt }` from the newest odds snapshot row, or null. */
function buildLine(snapshotRow) {
  if (!snapshotRow) return null;
  return {
    spread: snapshotRow.spread == null ? null : Number(snapshotRow.spread),
    total: snapshotRow.total == null ? null : Number(snapshotRow.total),
    observedAt: snapshotRow.observed_at,
  };
}

/**
 * Pure: weather is null outright for an indoor game (there is nothing to
 * report) or when no forecast snapshot exists yet — never a fields-null
 * object, unlike the Decision card's own weather shape.
 */
function buildWeather(roof, snapshotRow) {
  if (isIndoorGame({ roof })) return null;
  if (!snapshotRow) return null;
  return {
    shortForecast: snapshotRow.short_forecast || null,
    temperatureF: snapshotRow.temperature_f == null ? null : Number(snapshotRow.temperature_f),
    windSpeedMph: snapshotRow.wind_speed_mph == null ? null : Number(snapshotRow.wind_speed_mph),
    precipitationProbability:
      snapshotRow.precipitation_probability == null ? null : Number(snapshotRow.precipitation_probability),
  };
}

/** Pure: `{ name, city, indoor, neutralSite }` from the derived game, or null. */
function buildVenue(game) {
  if (!game) return null;
  const { venueName, venueCity, isIndoor, isNeutralSite } = game;
  if (venueName == null && venueCity == null && isIndoor == null && isNeutralSite == null) return null;
  return { name: venueName, city: venueCity, indoor: isIndoor, neutralSite: isNeutralSite };
}

/**
 * Pure: `{ away: { total, road }, home: { total, home } }` — CONTEXT.md's
 * Record, cut to the side each team is about to play in. Null when neither
 * side's Record has been synced yet.
 */
function buildRecords(game) {
  if (!game) return null;
  const { homeRecord, awayRecord } = game;
  if (homeRecord == null && awayRecord == null) return null;
  return {
    home: homeRecord == null ? null : { total: homeRecord.total ?? null, home: homeRecord.home ?? null },
    away: awayRecord == null ? null : { total: awayRecord.total ?? null, road: awayRecord.road ?? null },
  };
}

/**
 * Pure: CONTEXT.md's Situation, locked games only — an unlocked game is
 * always null here regardless of what live_game_states happens to hold, and
 * a locked game with no Situation columns written yet is null too.
 */
function buildSituation(game, locked) {
  if (!locked || !game) return null;
  const { possession, downDistance, isRedZone, lastPlay, homeWinProbability } = game;
  if (
    possession == null &&
    downDistance == null &&
    isRedZone == null &&
    lastPlay == null &&
    homeWinProbability == null
  ) {
    return null;
  }
  return {
    possession,
    downDistance,
    redZone: isRedZone,
    lastPlay,
    homeWinProbability,
  };
}

/**
 * Pure: `previousRank` support — rerun `computePickemStandings` over only the
 * weeks strictly before `currentWeek`, so a mid-season standings response can
 * show each team's rank as of the prior completed week. Week 1 (or an
 * unknown current week) has no prior week at all, so it returns an empty map
 * and every row's `previousRank` reads back null.
 */
function computePreviousRanks({ members, games, picks, mode, currentWeek }) {
  if (!currentWeek || Number(currentWeek) <= 1) return new Map();
  const priorGames = (games || []).filter((game) => Number(game.week) < Number(currentWeek));
  const priorPicks = (picks || []).filter((pick) => Number(pick.week) < Number(currentWeek));
  const priorStandings = computePickemStandings({ members, games: priorGames, picks: priorPicks, mode });
  return new Map(priorStandings.map((row) => [row.userId, row.rank]));
}

/**
 * Pure: validate a whole batch of picks. The batch is ALL-OR-NOTHING — one
 * locked or malformed entry rejects the lot, so a manager never half-saves a
 * week. Returns `{ code: null, picks }` when valid, otherwise
 * `{ code, message, gameKeys }` naming the offending games.
 *
 * @param {object} input
 * @param {Array}  input.picks    `[{ gameKey, pickedTeam, confidence? }]`
 * @param {Array}  input.games    the derived slate for this week
 * @param {string} input.mode     'straight' | 'confidence'
 * @param {Date}   input.now
 * @param {Array}  input.heldConfidences confidences already stored for games
 *   this batch does NOT touch. In practice those are the locked games (the
 *   client resubmits every unlocked pick), but scoping it this way means a
 *   partial submission still can't write a duplicate confidence.
 */
function validatePicksPayload({
  picks,
  games = [],
  mode = 'straight',
  now = new Date(),
  heldConfidences = [],
}) {
  if (!Array.isArray(picks) || picks.length === 0) {
    return { code: 'PICKEM_BAD_GAME', message: 'picks must be a non-empty array', gameKeys: [] };
  }
  const byKey = new Map((games || []).map((game) => [game.gameKey, game]));

  const seen = new Set();
  const unknown = [];
  const duplicates = [];
  for (const pick of picks) {
    const key = normalizeTeam(pick && pick.gameKey);
    if (!key || !byKey.has(key)) {
      unknown.push(key);
      continue;
    }
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  if (unknown.length > 0) {
    return {
      code: 'PICKEM_BAD_GAME',
      message: "that game is not on this week's slate",
      gameKeys: unknown,
    };
  }
  if (duplicates.length > 0) {
    return {
      code: 'PICKEM_BAD_GAME',
      message: 'each game may be picked only once',
      gameKeys: duplicates,
    };
  }

  const normalized = picks.map((pick) => {
    const gameKey = normalizeTeam(pick.gameKey);
    return {
      gameKey,
      pickedTeam: normalizeTeam(pick.pickedTeam),
      confidence: pick.confidence,
      game: byKey.get(gameKey),
    };
  });

  const badTeam = normalized
    .filter((pick) => !pick.game.teams.includes(pick.pickedTeam))
    .map((pick) => pick.gameKey);
  if (badTeam.length > 0) {
    return {
      code: 'PICKEM_BAD_TEAM',
      message: 'the picked team is not playing in that game',
      gameKeys: badTeam,
    };
  }

  const locked = normalized
    .filter((pick) => isGameLocked(pick.game, now))
    .map((pick) => pick.gameKey);
  if (locked.length > 0) {
    return {
      code: 'PICKEM_LOCKED',
      message: 'those games have already kicked off',
      gameKeys: locked,
    };
  }

  if (mode !== 'confidence') {
    return {
      code: null,
      picks: normalized.map(({ gameKey, pickedTeam }) => ({ gameKey, pickedTeam, confidence: null })),
    };
  }

  // Confidence mode: every submitted pick carries a whole number in
  // 1..slateSize. A FULL permutation is deliberately NOT required — Thursday's
  // game should be pickable on Tuesday without ranking the whole week.
  const slateSize = (games || []).length;
  const badConfidence = normalized
    .filter((pick) => {
      const value = Number(pick.confidence);
      return !Number.isInteger(value) || value < 1 || value > slateSize;
    })
    .map((pick) => pick.gameKey);
  if (badConfidence.length > 0) {
    return {
      code: 'PICKEM_BAD_CONFIDENCE',
      message: `confidence must be a whole number from 1 to ${slateSize}`,
      gameKeys: badConfidence,
    };
  }

  const used = new Map();
  for (const held of heldConfidences || []) {
    const value = Number(held && held.confidence);
    if (Number.isInteger(value)) used.set(value, held.gameKey);
  }
  const collisions = [];
  for (const pick of normalized) {
    const value = Number(pick.confidence);
    if (used.has(value)) collisions.push(pick.gameKey);
    else used.set(value, pick.gameKey);
  }
  if (collisions.length > 0) {
    return {
      code: 'PICKEM_BAD_CONFIDENCE',
      message: 'each confidence value can be used only once in a week',
      gameKeys: collisions,
    };
  }

  return {
    code: null,
    picks: normalized.map(({ gameKey, pickedTeam, confidence }) => ({
      gameKey,
      pickedTeam,
      confidence: Number(confidence),
    })),
  };
}

/**
 * Pure: score ONE week. `games` and `picks` must already be that week's.
 * Straight-up pays 1 point per correct pick; confidence pays the pick's own
 * value. An unresolved or tied game pays nothing to anybody.
 *
 * @returns {Array} `[{ userId, points, correct, incorrect, pushes, pending, made }]`
 */
function scorePickemWeek({ games = [], picks = [], mode = 'straight' }) {
  const byKey = new Map((games || []).map((game) => [game.gameKey, game]));
  const results = new Map();
  const rowFor = (userId) => {
    if (!results.has(userId)) {
      results.set(userId, {
        userId,
        points: 0,
        correct: 0,
        incorrect: 0,
        pushes: 0,
        pending: 0,
        made: 0,
      });
    }
    return results.get(userId);
  };

  for (const pick of picks || []) {
    const row = rowFor(pick.userId);
    row.made += 1;
    const game = byKey.get(normalizeTeam(pick.gameKey));
    if (!game) continue; // schedule changed out from under a stored pick
    const { winner, isTie, final } = winnerOf(game);
    if (!final) {
      row.pending += 1;
      continue;
    }
    if (isTie) {
      row.pushes += 1; // Yahoo rule: a tie credits nobody
      continue;
    }
    if (winner === normalizeTeam(pick.pickedTeam)) {
      row.correct += 1;
      row.points += mode === 'confidence' ? Number(pick.confidence) || 0 : 1;
    } else {
      row.incorrect += 1;
    }
  }
  return [...results.values()];
}

/**
 * Pure: season standings. Same pure-core/overlay split as season.service's
 * `computeStandings` — member display fields (team name, avatar) ride along on
 * `members` rather than being fetched in here.
 *
 * Order: total points desc, then correct picks desc, then Team name, so the
 * result is deterministic even before a single game is final. The final
 * tiebreak was the author's account username until #343 removed it from the
 * standings; a shared surface orders by Team identity, so it is Team name now.
 * A duplicate Team name is valid identity (CONTEXT.md), so a tie between two
 * identical Team names can still order arbitrarily - the same tolerance the old
 * username tiebreak had for two managers who shared a display name.
 */
function comparePickemStandingScore(a, b) {
  return b.points - a.points || b.correct - a.correct;
}

function computePickemStandings({ members = [], games = [], picks = [], mode = 'straight' }) {
  const gamesByWeek = new Map();
  for (const game of games || []) {
    const week = game.week == null ? 0 : Number(game.week);
    if (!gamesByWeek.has(week)) gamesByWeek.set(week, []);
    gamesByWeek.get(week).push(game);
  }
  const picksByWeek = new Map();
  for (const pick of picks || []) {
    const week = pick.week == null ? 0 : Number(pick.week);
    if (!picksByWeek.has(week)) picksByWeek.set(week, []);
    picksByWeek.get(week).push(pick);
  }

  const totals = new Map();
  for (const [week, weekGames] of gamesByWeek) {
    const weekResults = scorePickemWeek({
      games: weekGames,
      picks: picksByWeek.get(week) || [],
      mode,
    });
    for (const result of weekResults) {
      const running = totals.get(result.userId) || {
        points: 0, correct: 0, incorrect: 0, pushes: 0, pending: 0, made: 0, weekly: {},
      };
      running.points += result.points;
      running.correct += result.correct;
      running.incorrect += result.incorrect;
      running.pushes += result.pushes;
      running.pending += result.pending;
      running.made += result.made;
      // Per-week points so the UI can show any single week without a second
      // endpoint; 18 small integers per member is noise next to the pick rows.
      running.weekly[week] = (running.weekly[week] || 0) + result.points;
      totals.set(result.userId, running);
    }
  }

  const rows = (members || []).map((member) => {
    const total = totals.get(member.userId) || {
      points: 0, correct: 0, incorrect: 0, pushes: 0, pending: 0, made: 0, weekly: {},
    };
    return { ...member, ...total };
  });
  rows.sort(
    (a, b) =>
      comparePickemStandingScore(a, b) ||
      String(a.teamName || '').localeCompare(String(b.teamName || ''))
  );
  if (rows[0]?.points === 0 && rows[0]?.correct === 0) {
    return rows.map((row, index) => ({ ...row, rank: index + 1 }));
  }
  let rank = 0;
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    if (!previous || comparePickemStandingScore(previous, row) !== 0) {
      rank = index + 1;
    }
    return { ...row, rank };
  });
}

/* ------------------------------------------------------------------ *
 * I/O                                                                 *
 * ------------------------------------------------------------------ */

// fn_normalize_nfl_team() on EVERY team column — nfl_games speaks Tank01
// (WSH), live_game_states may carry either that or a full DEF team name, and
// an un-normalized comparison between the two is a bug this codebase has
// shipped before.
const SLATE_GAMES_SQL = `
  SELECT "week",
         fn_normalize_nfl_team("nfl_team") AS "nfl_team",
         fn_normalize_nfl_team("opponent") AS "opponent",
         "kickoff_at", "game_key", "roof"
    FROM "nfl_games"
   WHERE "season" = $1 AND "opponent" IS NOT NULL AND "kickoff_at" IS NOT NULL`;

const SLATE_LIVE_SQL = `
  SELECT "week", "tank01_game_id",
         fn_normalize_nfl_team("home_team") AS "home_team",
         fn_normalize_nfl_team("away_team") AS "away_team",
         "game_status", "current_score_home", "current_score_away",
         "quarter", "time_remaining",
         "venue_name", "venue_city", "is_indoor", "is_neutral_site", "broadcast",
         "home_record", "away_record", "home_win_probability", "linescores", "headline",
         "possession", "down_distance", "is_red_zone", "last_play"
    FROM "live_game_states"
   WHERE "season" = $1`;

const SLATE_RECAPS_SQL = `
  SELECT "week",
         fn_normalize_nfl_team("home_team") AS "home_team",
         fn_normalize_nfl_team("away_team") AS "away_team",
         "home_score", "away_score"
    FROM ${RECAPS_TABLE_SQL}
   WHERE "season" = $1`;

// ADR 0038: the newest sportsbook quote per game, keyed by nfl_games.game_key
// (the both-perspectives id game_odds_snapshots already uses) rather than by
// the pick'em team-pair key — DISTINCT ON picks the latest observed_at per
// game in one round trip for the whole week's slate.
const WEEK_LINES_SQL = `
  SELECT DISTINCT ON ("game_key") "game_key", "total", "spread", "observed_at"
    FROM "game_odds_snapshots"
   WHERE "game_key" = ANY($1::text[])
   ORDER BY "game_key", "observed_at" DESC`;

// The forecast nearest kickoff per game — smallest horizon_hours wins, same
// convention as decisionCardContext.service.js's loadWeather.
const WEEK_WEATHER_SQL = `
  SELECT DISTINCT ON ("game_key") "game_key", "short_forecast", "temperature_f",
         "wind_speed_mph", "precipitation_probability"
    FROM "game_weather_snapshots"
   WHERE "game_key" = ANY($1::text[])
   ORDER BY "game_key", "horizon_hours" ASC`;

const UPSERT_PICKS_SQL = `
  INSERT INTO "pickem_picks"
    ("league_id", "user_id", "season", "week", "team_pair", "picked_team", "confidence")
  SELECT $1, $2, $3, $4, "p"."team_pair", "p"."picked_team", "p"."confidence"
    FROM unnest($5::text[], $6::text[], $7::smallint[])
      AS "p"("team_pair", "picked_team", "confidence")
  ON CONFLICT ("league_id", "user_id", "season", "week", "team_pair")
  DO UPDATE SET "picked_team" = EXCLUDED."picked_team",
                "confidence" = EXCLUDED."confidence",
                "updated_at" = now()`;

/** The league row Pick'em needs, or 404. Accepts a pool or a checked-out client. */
async function loadLeague(db, leagueId) {
  const result = await db.query(
    `SELECT "id", "name", "current_season", "current_week", "pickem_only" FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  const league = result.rows[0];
  if (!league) throw new PickemError(404, 'LEAGUE_NOT_FOUND', 'league not found');
  return league;
}

/** A league's Pick'em config. NO ROW MEANS OFF — that's the whole default. */
async function getSettings(leagueId, db = pool) {
  const result = await db.query(
    `SELECT "enabled", "mode" FROM "pickem_settings" WHERE "league_id" = $1`,
    [leagueId]
  );
  const row = result.rows[0];
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    enabled: Boolean(row.enabled),
    mode: MODES.includes(row.mode) ? row.mode : DEFAULT_SETTINGS.mode,
  };
}

/**
 * Commissioner write. Enabling/disabling is allowed in a fantasy league, but a
 * pick'em-only league always has pick'em on: turning it off would leave the
 * league with no game at all, so that is refused with 409 PICKEM_ONLY_LEAGUE.
 * Changing the SCORING MODE once the current season has picks is refused for
 * every league type — every stored confidence would be reinterpreted (or
 * discarded) retroactively — with 409 PICKEM_MODE_LOCKED.
 */
async function putSettings({ leagueId, enabled, mode }) {
  if (mode !== undefined && !MODES.includes(mode)) {
    throw new PickemError(400, 'PICKEM_BAD_MODE', `mode must be one of: ${MODES.join(', ')}`);
  }
  // withTransaction owns connect/BEGIN/COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). Refusals throw a PickemError inside work and the
  // wrapper rolls back and rethrows untouched, so no catch-side mapping moves
  // outward. The bad-mode check above is pre-transaction and stays before it.
  return withTransaction(
    pool,
    async (client) => {
    const league = await loadLeague(client, leagueId);
    if (isPickemOnly(league) && enabled === false) {
      throw new PickemError(
        409,
        'PICKEM_ONLY_LEAGUE',
        "this is a pick'em league; Pick'em is its only game and cannot be turned off"
      );
    }
    const current = await getSettings(leagueId, client);
    const nextMode = mode === undefined ? current.mode : mode;
    const nextEnabled = enabled === undefined ? current.enabled : Boolean(enabled);

    if (nextMode !== current.mode) {
      const existing = await client.query(
        `SELECT 1 FROM "pickem_picks" WHERE "league_id" = $1 AND "season" = $2 LIMIT 1`,
        [leagueId, league.current_season]
      );
      if (existing.rows[0]) {
        throw new PickemError(
          409,
          'PICKEM_MODE_LOCKED',
          'picks have already been made this season; the scoring mode is locked until next season'
        );
      }
    }

    await client.query(
      `INSERT INTO "pickem_settings" ("league_id", "enabled", "mode")
       VALUES ($1, $2, $3)
       ON CONFLICT ("league_id") DO UPDATE
         SET "enabled" = EXCLUDED."enabled",
             "mode" = EXCLUDED."mode",
             "updated_at" = now()`,
      [leagueId, nextEnabled, nextMode]
    );
    await logTransaction(client, {
      leagueId,
      type: 'commissioner',
      detail: { action: 'pickem_settings', enabled: nextEnabled, mode: nextMode },
    });
    return { enabled: nextEnabled, mode: nextMode };
    },
    { label: 'pickem-settings' }
  );
}

/** One week's derived slate. Never depends on live_game_states existing. */
async function getWeekSlate({ season, week, db = pool }) {
  const games = await db.query(`${SLATE_GAMES_SQL} AND "week" = $2`, [season, week]);
  const live = await db.query(`${SLATE_LIVE_SQL} AND "week" = $2`, [season, week]);
  return deriveSlateFromRows(games.rows, live.rows);
}

/**
 * A whole season's slate with finals resolved. Recaps are the second winner
 * tier; if that storage isn't migrated the pass is skipped rather than
 * failing the standings.
 */
async function getSeasonSlate({ season, db = pool }) {
  const games = await db.query(SLATE_GAMES_SQL, [season]);
  const live = await db.query(SLATE_LIVE_SQL, [season]);
  const slate = deriveSlateFromRows(games.rows, live.rows);
  let recaps = { rows: [] };
  try {
    recaps = await db.query(SLATE_RECAPS_SQL, [season]);
  } catch (error) {
    if (!isMissingRecapStorage(error)) throw error;
  }
  return applyRecapFinals(slate, recaps.rows);
}

/**
 * A member's view of one week: the slate, their own picks, and everyone
 * else's picks FOR LOCKED GAMES ONLY. The per-game reveal is the whole point
 * of the lock — never widen this filter. `pickedCount` is the one exception
 * (ADR 0038): a count of every manager who has picked that game, EVERY
 * phase, computed from the same `stored` rows but never leaking who or which
 * way — it is a tally, not a projection of any pick's fields.
 */
async function getWeekView({ leagueId, userId, season, week, mode, now = new Date() }) {
  const slate = await getWeekSlate({ season, week });
  const stored = await pool.query(
    // pickem_picks.user_id stays only to tell the viewer's own picks apart from
    // everyone else's below (row.user_id === userId); it is not projected onto
    // any othersPicks entry. The author's username is gone with the users JOIN,
    // and the reveal orders by Team name now (#343).
    `SELECT "pickem_picks"."user_id", "pickem_picks"."team_pair",
            "pickem_picks"."picked_team", "pickem_picks"."confidence",
            ${teamIdentityColumns()}
       FROM "pickem_picks"
       ${teamIdentityJoin('"pickem_picks"."league_id"', '"pickem_picks"."user_id"')}
      WHERE "pickem_picks"."league_id" = $1
        AND "pickem_picks"."season" = $2
        AND "pickem_picks"."week" = $3
      ORDER BY "teams"."name"`,
    [leagueId, season, week]
  );

  // ADR 0038: Line and weather are read off nfl_games.game_key, the same
  // both-perspectives id game_odds_snapshots/game_weather_snapshots already
  // use — never the pick'em team-pair key, and never a live ESPN/NWS call.
  const dbGameKeys = [...new Set(slate.map((game) => game.dbGameKey).filter(Boolean))];
  const [lines, weathers] = await Promise.all([
    dbGameKeys.length ? pool.query(WEEK_LINES_SQL, [dbGameKeys]) : Promise.resolve({ rows: [] }),
    dbGameKeys.length ? pool.query(WEEK_WEATHER_SQL, [dbGameKeys]) : Promise.resolve({ rows: [] }),
  ]);
  const lineByGameKey = new Map(lines.rows.map((row) => [row.game_key, row]));
  const weatherByGameKey = new Map(weathers.rows.map((row) => [row.game_key, row]));

  const pickedCountByKey = new Map();
  for (const row of stored.rows) {
    pickedCountByKey.set(row.team_pair, (pickedCountByKey.get(row.team_pair) || 0) + 1);
  }

  const games = slate.map((game) => {
    const { winner, isTie } = winnerOf(game);
    const locked = isGameLocked(game, now);
    const lineRow = game.dbGameKey ? lineByGameKey.get(game.dbGameKey) : null;
    const weatherRow = game.dbGameKey ? weatherByGameKey.get(game.dbGameKey) : null;
    return {
      week: game.week,
      gameKey: game.gameKey,
      teams: game.teams,
      kickoffAt: game.kickoffAt,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      status: game.status,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      quarter: game.quarter,
      timeRemaining: game.timeRemaining,
      tank01GameId: game.tank01GameId,
      locked,
      winner,
      isTie,
      pickedCount: pickedCountByKey.get(game.gameKey) || 0,
      line: buildLine(lineRow),
      weather: buildWeather(game.roof, weatherRow),
      venue: buildVenue(game),
      broadcast: game.broadcast,
      records: buildRecords(game),
      situation: buildSituation(game, locked),
      linescores: game.linescores,
      headline: game.headline,
    };
  });
  const lockedKeys = new Set(games.filter((game) => game.locked).map((game) => game.gameKey));

  const myPicks = [];
  const othersPicks = {};
  for (const row of stored.rows) {
    const pick = {
      gameKey: row.team_pair,
      pickedTeam: row.picked_team,
      confidence: row.confidence == null ? null : Number(row.confidence),
    };
    if (row.user_id === userId) {
      myPicks.push(pick);
      continue;
    }
    if (!lockedKeys.has(row.team_pair)) continue;
    if (!othersPicks[row.team_pair]) othersPicks[row.team_pair] = [];
    // Team identity only: another manager's pick names them by Team, never by
    // the author account (#343, #115). The viewer already knows their own team
    // from `viewerTeamId` on the week response root.
    othersPicks[row.team_pair].push({
      teamId: row.teamId ?? null,
      teamName: row.teamName ?? null,
      ...pick,
    });
  }

  return { season, week, mode, games, myPicks, othersPicks };
}

/**
 * Save a batch of picks. Transactional, and the slate + lock check are
 * re-derived INSIDE the transaction: the client rendered its board some time
 * ago, and a game may have kicked off since. Any locked or invalid entry
 * rejects the whole batch and names the offending games.
 */
async function upsertPicks({ leagueId, userId, season, week, picks, now = new Date() }) {
  // withTransaction owns connect/BEGIN/COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). Every refusal throws a PickemError inside work,
  // rolled back and rethrown untouched by the wrapper; no catch-side mapping.
  return withTransaction(
    pool,
    async (client) => {
    const settings = await getSettings(leagueId, client);
    if (!settings.enabled) {
      throw new PickemError(403, 'PICKEM_DISABLED', "Pick'em is not enabled for this league");
    }
    const games = await getWeekSlate({ season, week, db: client });
    if (games.length === 0) {
      throw new PickemError(409, 'PICKEM_NO_SLATE', 'no NFL games are scheduled for that week yet');
    }

    const existing = await client.query(
      `SELECT "team_pair", "confidence" FROM "pickem_picks"
        WHERE "league_id" = $1 AND "user_id" = $2 AND "season" = $3 AND "week" = $4`,
      [leagueId, userId, season, week]
    );
    const incoming = new Set(
      (Array.isArray(picks) ? picks : []).map((pick) => normalizeTeam(pick && pick.gameKey))
    );
    const heldConfidences = existing.rows
      .filter((row) => !incoming.has(row.team_pair))
      .map((row) => ({ gameKey: row.team_pair, confidence: row.confidence }));

    const validated = validatePicksPayload({
      picks,
      games,
      mode: settings.mode,
      now,
      heldConfidences,
    });
    if (validated.code) {
      throw new PickemError(
        validated.code === 'PICKEM_LOCKED' ? 409 : 400,
        validated.code,
        validated.message,
        { gameKeys: validated.gameKeys }
      );
    }

    await client.query(UPSERT_PICKS_SQL, [
      leagueId,
      userId,
      season,
      week,
      validated.picks.map((pick) => pick.gameKey),
      validated.picks.map((pick) => pick.pickedTeam),
      validated.picks.map((pick) => pick.confidence),
    ]);
    return { saved: validated.picks.length, myPicks: validated.picks };
    },
    { label: 'pickem-picks' }
  );
}

/**
 * Compute-on-read season standings — a handful of small queries, no cache.
 * `db` may be a checked-out client (the pick'em season lifecycle computes the
 * final standings inside its completion transaction), and `games` lets a
 * caller that already holds the season slate skip re-deriving it.
 */
async function loadStandings({ leagueId, season, db, games, includeFormerPickers, currentWeek = null }) {
  const settings = await getSettings(leagueId, db);
  const members = await db.query(
    // "teams"."owner_id" AS "user_id" is the JOIN KEY only: it matches a
    // member to their pick rows (pickem_picks.user_id) and to per-week scoring
    // totals, and the completion path reads it to match a former picker. It is
    // account identity, so it stays SERVER-SIDE - the member-facing /standings
    // route strips it before serializing (#343). The account username is gone;
    // the standings tiebreak orders by Team name now.
    `SELECT "teams"."owner_id" AS "user_id",
            "teams"."id" AS "team_id", "teams"."name" AS "team_name",
            "teams"."avatar_url", "teams"."avatar_static_url"
       FROM "teams"
      WHERE "teams"."league_id" = $1
      ORDER BY "teams"."name"`,
    [leagueId]
  );
  const stored = await db.query(
    `SELECT "user_id", "week", "team_pair", "picked_team", "confidence"
       FROM "pickem_picks" WHERE "league_id" = $1 AND "season" = $2`,
    [leagueId, season]
  );
  const slate = games || (await getSeasonSlate({ season, db }));

  const participants = members.rows.map((row) => ({
      // userId is the internal join key (to picks and per-week totals) and is
      // stripped from the member-facing standings at the route (#343).
      userId: row.user_id,
      teamId: row.team_id ?? null,
      teamName: row.team_name,
      avatarUrl: row.avatar_url,
      avatarStaticUrl: row.avatar_static_url,
    }));
  if (includeFormerPickers) {
    const currentManagerIds = new Set(participants.map((member) => String(member.userId)));
    for (const pick of stored.rows) {
      if (currentManagerIds.has(String(pick.user_id))) continue;
      currentManagerIds.add(String(pick.user_id));
      participants.push({
        userId: pick.user_id,
        teamId: null,
        teamName: null,
        avatarUrl: null,
        avatarStaticUrl: null,
      });
    }
  }

  const mappedPicks = stored.rows.map((row) => ({
    userId: row.user_id,
    week: Number(row.week),
    gameKey: row.team_pair,
    pickedTeam: row.picked_team,
    confidence: row.confidence == null ? null : Number(row.confidence),
  }));

  const standings = computePickemStandings({
    members: participants,
    games: slate,
    picks: mappedPicks,
    mode: settings.mode,
  });

  // previousRank (ADR 0038) is member-facing only: getCompletionStandings
  // never passes currentWeek, so its rows keep their exact pre-existing shape
  // for the season-completion consumers that already read this function.
  if (currentWeek == null) {
    return { season, mode: settings.mode, standings };
  }
  const previousRankByUserId = computePreviousRanks({
    members: participants,
    games: slate,
    picks: mappedPicks,
    mode: settings.mode,
    currentWeek,
  });
  const standingsWithPreviousRank = standings.map((row) => ({
    ...row,
    previousRank: previousRankByUserId.has(row.userId) ? previousRankByUserId.get(row.userId) : null,
  }));
  return { season, mode: settings.mode, standings: standingsWithPreviousRank };
}

async function getStandings({ leagueId, season, db = pool, games = null, currentWeek = null }) {
  return loadStandings({ leagueId, season, db, games, includeFormerPickers: false, currentWeek });
}

/**
 * Retain every season picker long enough to determine whether a removed Team
 * would have won. Null Team identity is rejected only in the champion set.
 */
async function getCompletionStandings({ leagueId, season, db = pool, games = null }) {
  return loadStandings({ leagueId, season, db, games, includeFormerPickers: true });
}

module.exports = {
  PickemError,
  MODES,
  DEFAULT_SETTINGS,
  REG_SEASON_WEEKS,
  // pure
  normalizeTeam,
  pairKey,
  deriveSlateFromRows,
  applyRecapFinals,
  winnerOf,
  isGameLocked,
  validatePicksPayload,
  scorePickemWeek,
  computePickemStandings,
  computePreviousRanks,
  buildLine,
  buildWeather,
  buildVenue,
  buildRecords,
  buildSituation,
  // I/O
  loadLeague,
  getSettings,
  putSettings,
  getWeekSlate,
  getSeasonSlate,
  getWeekView,
  upsertPicks,
  getStandings,
  getCompletionStandings,
};
