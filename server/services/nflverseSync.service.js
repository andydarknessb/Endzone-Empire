const axios = require('axios');
const pool = require('../modules/pool');
const scoring = require('./scoring.service');
const correction = require('./correction.service');

/**
 * Two nflverse-backed jobs share this service:
 *
 * 1. IDP finalization pass: Tank01's live feed has no per-defender yardage
 *    for sacks, tackles-for-loss, or fumble returns (see scoring.service.js's
 *    normalizeTank01IdpStats). nflverse's public, no-auth weekly release CSVs
 *    carry those fields — fetched, joined to our `players` table via an
 *    ESPN-id crosswalk, and patched onto the already-synced week's stats.
 *    Not live: nflverse updates nightly after each game day, "cleanest by
 *    Thursday" per their own docs, so this runs as a Mon-Thu daily pass (see
 *    scheduler.js's runNflverseFinalization) rather than during live scoring.
 *
 * 2. Full-week backfill (applyNflverseFullWeek): builds COMPLETE player_stats
 *    rows — offense, IDP, kicking (exact FG distances from fg_made_list), and
 *    team-DST — entirely from nflverse, for historical weeks Tank01 can't
 *    serve (e.g. RapidAPI quota exhausted). Backfill-only; the live pipeline
 *    stays Tank01-first.
 *
 * File format note: nflverse stopped publishing the split old-format files
 * (player_stats_def_<season>.csv etc.) after 2024 — 2025 onward exists only
 * as the combined stats_player_week_<season>.csv (all positions, one row per
 * player-week; def_* column names mostly carried over, but def_safety became
 * def_safeties and def_fumble_recovery_yards_opp lost its def_ prefix).
 * Everything here reads the new format; the combined file also exists for
 * 2024, so there is a single code path for all seasons.
 */

const NFLVERSE_RELEASE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
// Lee Sharpe's games file (nflverse's canonical schedule+scores source):
// game_id values match stats_*_week_<season>.csv exactly (2025_01_ARI_NO).
const NFLVERSE_GAMES_URL = 'https://github.com/nflverse/nfldata/raw/master/data/games.csv';

/**
 * Pure: split one CSV line into fields, respecting RFC4180 double-quoting
 * (a quoted field may contain commas and "" for a literal quote). Neither
 * nflverse file used here has an embedded literal newline inside a quoted
 * field (confirmed by inspecting both directly), so splitting the whole
 * text on newlines first — see parseCsv — is safe.
 */
function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/** Pure: CSV text -> array of row objects keyed by the header row. */
function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = values[j];
    rows.push(row);
  }
  return rows;
}

async function fetchCsvText(url) {
  const response = await axios.get(url, { responseType: 'text', timeout: 30000 });
  return response.data;
}

/** One season's combined player weekly file (all positions, one row per
 * player-week; confirmed columns: season, week, season_type, player_id
 * [GSIS id], passing_/rushing_/receiving_* offense, def_* IDP including
 * def_sack_yards + def_tackles_for_loss_yards + fumble_recovery_yards_opp +
 * def_safeties, fg_made_list, pat_made, ...). */
async function fetchPlayerWeekStatsForSeason(season) {
  const url = `${NFLVERSE_RELEASE_BASE}/stats_player/stats_player_week_${season}.csv`;
  return parseCsv(await fetchCsvText(url));
}

/** One season's team weekly file — same columns as the player file but
 * aggregated per team side, one row per team per game. The def_* columns are
 * that team's DEFENSE; the offense columns are its own offense (so a team's
 * yards/points ALLOWED come from its opponent's row). */
async function fetchTeamWeekStatsForSeason(season) {
  const url = `${NFLVERSE_RELEASE_BASE}/stats_team/stats_team_week_${season}.csv`;
  return parseCsv(await fetchCsvText(url));
}

/** game_id -> { home_team, away_team, home_score, away_score } for one
 * season's regular-season games (the games file spans 1999-present, so
 * filter before building the map). */
async function fetchGameScoresForSeason(season) {
  const rows = parseCsv(await fetchCsvText(NFLVERSE_GAMES_URL));
  const map = new Map();
  for (const row of rows) {
    if (Number(row.season) !== Number(season) || row.game_type !== 'REG') continue;
    map.set(row.game_id, {
      homeTeam: row.home_team,
      awayTeam: row.away_team,
      homeScore: Number(row.home_score),
      awayScore: Number(row.away_score),
    });
  }
  return map;
}

/** gsis_id -> espn_id crosswalk (confirmed columns on nflverse's players.csv). */
async function fetchPlayersCrosswalk() {
  const url = `${NFLVERSE_RELEASE_BASE}/players/players.csv`;
  const rows = parseCsv(await fetchCsvText(url));
  const map = new Map();
  for (const row of rows) {
    if (row.gsis_id && row.espn_id) map.set(row.gsis_id, row.espn_id);
  }
  return map;
}

/** Pure: rows -> only the target (season, week, REG-season) rows. */
function filterRowsForWeek(rows, { season, week }) {
  return (rows || []).filter(
    (r) => Number(r.season) === Number(season) && Number(r.week) === Number(week) && r.season_type === 'REG'
  );
}

/**
 * Pure: join filtered nflverse rows to our players (via the espn_id
 * crosswalk) and compute each matched player's finalization patch. Rows
 * with no gsis id (nflverse's own placeholder/team-penalty rows use
 * player_id "0"), no crosswalk match, or no matching rostered player are
 * skipped — this only ever ADDS data for players we already synced from
 * Tank01, never invents a player.
 *
 * Only recovering the OPPONENT's fumble (the actual defensive playmaking
 * event) feeds the fumble-return-yards bonus; `_own` (recovering your own
 * team's fumble) isn't a defensive takeaway and isn't scored.
 *
 * Column names accept both file generations: the combined file renamed
 * def_safety -> def_safeties and dropped the def_ prefix from
 * fumble_recovery_yards_opp.
 */
function buildStatUpdates({ defRows, crosswalk, knownPlayersByExternalId }) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const updates = [];
  for (const row of defRows || []) {
    const gsisId = row.player_id;
    if (!gsisId || gsisId === '0') continue;
    const espnId = crosswalk.get(gsisId);
    if (!espnId) continue;
    const playerId = knownPlayersByExternalId.get(String(espnId));
    if (!playerId) continue;
    const patch = {
      idpSackYards: num(row.def_sack_yards),
      idpTacklesForLossYards: num(row.def_tackles_for_loss_yards),
      idpFumbleReturnYards: num(row.fumble_recovery_yards_opp ?? row.def_fumble_recovery_yards_opp),
      idpSafety: num(row.def_safeties ?? row.def_safety),
    };
    // The combined file has a row for EVERY player, not just defenders (the
    // old def-only file didn't) — an all-zero patch is a no-op merge, so
    // skipping it keeps the pass from rewriting every offensive row.
    if (Object.values(patch).every((v) => v === 0)) continue;
    updates.push({ playerId, patch });
  }
  return updates;
}

/**
 * Finalize one (season, week): fetch nflverse's defense file + players
 * crosswalk, patch the finalization-only fields onto each matched player's
 * already-synced player_stats row (preserving whatever Tank01 already wrote
 * there), and re-score every league sitting on that week — reusing
 * correction.service's correctLeagueWeek (the same recompute/notify path
 * Tank01 stat corrections use), not a new scoring code path.
 */
async function syncNflverseWeek({ season, week }) {
  const [defRows, crosswalk] = await Promise.all([
    fetchPlayerWeekStatsForSeason(season),
    fetchPlayersCrosswalk(),
  ]);
  return applyNflverseWeek({ season, week, defRows, crosswalk });
}

/**
 * Apply one (season, week)'s patches from already-fetched nflverse data.
 * Split from syncNflverseWeek so a multi-week backfill can download the
 * season defense file and the (large) players crosswalk once per season
 * instead of once per week, and skip the league re-score loop for
 * historical weeks no league ever sat on.
 */
async function applyNflverseWeek({ season, week, defRows, crosswalk, rescoreLeagues = true }) {
  const weekRows = filterRowsForWeek(defRows, { season, week });

  const knownPlayers = await pool.query(
    `SELECT "id", "external_id" FROM "players" WHERE "external_id" IS NOT NULL`
  );
  const idByExternal = new Map(knownPlayers.rows.map((r) => [String(r.external_id), r.id]));

  const updates = buildStatUpdates({ defRows: weekRows, crosswalk, knownPlayersByExternalId: idByExternal });
  if (updates.length === 0) return { season, week, playersUpdated: 0, leaguesRescored: 0 };

  let playersUpdated = 0;
  for (const { playerId, patch } of updates) {
    const existing = await pool.query(
      `SELECT "stats" FROM "player_stats" WHERE "player_id" = $1 AND "season" = $2 AND "week" = $3`,
      [playerId, season, week]
    );
    const prevStats = existing.rows[0] ? existing.rows[0].stats : {};
    const stats = { ...prevStats, ...patch };
    const points = scoring.calculateFantasyPoints(stats);
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("player_id", "season", "week")
       DO UPDATE SET "stats" = EXCLUDED."stats", "fantasy_points" = EXCLUDED."fantasy_points"`,
      [playerId, season, week, JSON.stringify(stats), points]
    );
    playersUpdated += 1;
  }

  if (!rescoreLeagues) {
    return { season, week, playersUpdated, leaguesRescored: 0 };
  }

  const leaguesResult = await pool.query(`SELECT "id" FROM "leagues" WHERE "draft_status" = 'complete'`);
  let leaguesRescored = 0;
  for (const league of leaguesResult.rows) {
    try {
      // No-ops instantly for a league with no matchup rows at this
      // (season, week) — safe to call broadly rather than pre-filtering.
      const outcome = await correction.correctLeagueWeek({ leagueId: league.id, season, week });
      if (outcome.changes.length > 0) leaguesRescored += 1;
    } catch (err) {
      console.error('nflverse finalization: re-score failed for league %s:', league.id, err.message);
    }
  }
  return { season, week, playersUpdated, leaguesRescored };
}

// ---- Full-week backfill from nflverse (no Tank01 involved) -----------------

/** Pure: '25;43;32' (fg_made_list) -> [25, 43, 32]; blank/missing -> [].
 * Empty segments are dropped BEFORE coercion — Number('') is 0, which would
 * otherwise smuggle a phantom 0-yard kick into the distance tiers. */
function parseFgMadeList(value) {
  return String(value || '')
    .split(';')
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .map(Number)
    .filter((v) => Number.isFinite(v));
}

/** nflverse team code -> ours. The only divergence is the Rams ('LA'). */
function nflverseTeamToOurAbbr(team) {
  const abbr = String(team || '').toUpperCase();
  return abbr === 'LA' ? 'LAR' : abbr;
}

/**
 * Pure: one combined-file player row -> our full flat stat line, mirroring
 * what normalizeTank01Stats + normalizeTank01IdpStats produce for a live
 * week, plus keys Tank01 can't supply at all (per-category two-point
 * conversions, exact FG distances without a play-by-play scan).
 *
 * Semantics matched to the Tank01 normalizers where the sources differ:
 * - fumbles = fumbles_lost_total (all lost fumbles, any category).
 * - returnTDs = special_teams_tds — broader than Tank01's punt-return-only
 *   field (kickoff-return TDs are invisible to Tank01 entirely).
 * - idpDefensiveTD = fumble_recovery_tds, mirroring Tank01's
 *   defTD-minus-interceptionTDs bucket (a pick-six still scores only the
 *   interception; individual blocked-kick-return TDs aren't attributed —
 *   the same accepted limit the live pipeline has).
 * - twoPointReturn has no nflverse weekly column; 0.
 * - The TD-length bonus arrays (passingTDLengths etc.) need play-by-play
 *   and are omitted — they score 0 points under default rules, and no
 *   league has scored matchups on backfilled seasons.
 */
function normalizeNflversePlayerStats(row) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const solo = num(row.def_tackles_solo);
  return {
    passingYards: num(row.passing_yards),
    passingTDs: num(row.passing_tds),
    interceptions: num(row.passing_interceptions),
    passingTwoPt: num(row.passing_2pt_conversions),
    rushingYards: num(row.rushing_yards),
    rushingTDs: num(row.rushing_tds),
    rushingTwoPt: num(row.rushing_2pt_conversions),
    receivingYards: num(row.receiving_yards),
    receivingTDs: num(row.receiving_tds),
    receptions: num(row.receptions),
    receivingTwoPt: num(row.receiving_2pt_conversions),
    fumbles: num(row.fumbles_lost_total),
    fieldGoal: num(row.fg_made),
    fieldGoalMissed: num(row.fg_missed),
    fieldGoalDistances: parseFgMadeList(row.fg_made_list),
    extraPoint: num(row.pat_made),
    extraPointMissed: num(row.pat_missed),
    returnTDs: num(row.special_teams_tds),
    puntReturns: num(row.punt_returns),
    puntReturnYards: num(row.punt_return_yards),
    kickReturns: num(row.kickoff_returns),
    kickReturnYards: num(row.kickoff_return_yards),
    soloTackle: solo,
    assistedTackle: num(row.def_tackle_assists),
    idpSack: num(row.def_sacks),
    idpInterception: num(row.def_interceptions),
    forcedFumble: num(row.def_fumbles_forced),
    idpFumbleRecovery: num(row.fumble_recovery_opp),
    passDeflection: num(row.def_pass_defended),
    qbHit: num(row.def_qb_hits),
    tacklesForLoss: num(row.def_tackles_for_loss),
    idpDefensiveTD: num(row.fumble_recovery_tds),
    twoPointReturn: 0,
    idpSackYards: num(row.def_sack_yards),
    idpTacklesForLossYards: num(row.def_tackles_for_loss_yards),
    idpFumbleReturnYards: num(row.fumble_recovery_yards_opp),
    idpSafety: num(row.def_safeties),
  };
}

/**
 * Pure: combined-file player rows (already filtered to one season/week) ->
 * full stat-line updates for players we know, via the same gsis -> espn ->
 * players.external_id join the finalization pass uses.
 */
function buildFullStatUpdates({ rows, crosswalk, knownPlayersByExternalId }) {
  const updates = [];
  for (const row of rows || []) {
    const gsisId = row.player_id;
    if (!gsisId || gsisId === '0') continue;
    const espnId = crosswalk.get(gsisId);
    if (!espnId) continue;
    const playerId = knownPlayersByExternalId.get(String(espnId));
    if (!playerId) continue;
    updates.push({ playerId, stats: normalizeNflversePlayerStats(row) });
  }
  return updates;
}

/**
 * Pure: team-week rows (one per team side, already filtered to one
 * season/week) -> DST stat lines keyed by OUR team abbreviation, mirroring
 * normalizeTank01DstStats: a team's def_* columns are its own defense;
 * everything it ALLOWED (yards, points, blocked kicks it forced) comes from
 * the opponent's row in the same game. Net yards allowed = the opponent's
 * passing_yards + sack_yards_lost (negative) + rushing_yards, the standard
 * net-total-yards identity. Points allowed come from the games file's final
 * scores (`scoresByGameId`); a game missing from it yields no DST rows —
 * better no row than one scored with pointsAllowed 0, which the tiers would
 * pay 10 points for.
 */
function buildDstStatUpdates({ teamRows, scoresByGameId }) {
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const byGameAndTeam = new Map();
  for (const row of teamRows || []) {
    byGameAndTeam.set(`${row.game_id}:${row.team}`, row);
  }
  const updates = [];
  for (const row of teamRows || []) {
    const opponent = byGameAndTeam.get(`${row.game_id}:${row.opponent_team}`);
    const score = scoresByGameId && scoresByGameId.get(row.game_id);
    if (!opponent || !score) continue;
    const pointsAllowed = row.team === score.homeTeam ? score.awayScore : score.homeScore;
    if (!Number.isFinite(pointsAllowed)) continue;
    updates.push({
      teamAbbr: nflverseTeamToOurAbbr(row.team),
      stats: {
        sack: num(row.def_sacks),
        interceptionReturn: num(row.def_interceptions),
        fumbleRecovery: num(row.fumble_recovery_opp),
        defensiveTD: num(row.def_tds),
        safety: num(row.def_safeties),
        blockedKick: num(opponent.fg_blocked) + num(opponent.pat_blocked) + num(opponent.pt_blocked),
        pointsAllowed,
        yardsAllowed:
          num(opponent.passing_yards) + num(opponent.sack_yards_lost) + num(opponent.rushing_yards),
      },
    });
  }
  return updates;
}

/**
 * Write one (season, week)'s COMPLETE player_stats rows from already-fetched
 * nflverse data: full stat lines for every crosswalk-matched player plus one
 * DST row per team. Same wholesale-jsonb upsert the Tank01 path uses — so
 * this must only run for weeks Tank01 didn't fill (it would drop the
 * pbp-derived TD-length arrays from a Tank01 week), and a later Tank01
 * re-sync of the same week simply converges the row back to the canonical
 * live-pipeline shape. Backfill-only: no league re-score, no play events.
 */
async function applyNflverseFullWeek({ season, week, playerRows, teamRows, scoresByGameId, crosswalk }) {
  const weekPlayerRows = filterRowsForWeek(playerRows, { season, week });
  const weekTeamRows = filterRowsForWeek(teamRows, { season, week });

  const knownPlayers = await pool.query(
    `SELECT "id", "external_id" FROM "players" WHERE "external_id" IS NOT NULL`
  );
  const idByExternal = new Map(knownPlayers.rows.map((r) => [String(r.external_id), r.id]));

  // Same abbreviation-keyed DEF-unit matching syncWeekStats uses.
  const defPlayers = await pool.query(
    `SELECT "id", "nfl_team" FROM "players" WHERE "position" = 'DEF'`
  );
  const defByAbbr = new Map();
  for (const row of defPlayers.rows) {
    const abbr = scoring.normalizeTeamAbbr(row.nfl_team);
    if (abbr) defByAbbr.set(abbr, row.id);
  }

  const playerUpdates = buildFullStatUpdates({
    rows: weekPlayerRows,
    crosswalk,
    knownPlayersByExternalId: idByExternal,
  });
  const dstUpdates = buildDstStatUpdates({ teamRows: weekTeamRows, scoresByGameId });

  let playersUpdated = 0;
  for (const { playerId, stats } of playerUpdates) {
    const points = scoring.calculateFantasyPoints(stats);
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("player_id", "season", "week")
       DO UPDATE SET "stats" = EXCLUDED."stats", "fantasy_points" = EXCLUDED."fantasy_points"`,
      [playerId, season, week, JSON.stringify(stats), points]
    );
    playersUpdated += 1;
  }

  let dstUpdated = 0;
  for (const { teamAbbr, stats } of dstUpdates) {
    const defPlayerId = defByAbbr.get(teamAbbr);
    if (!defPlayerId) continue;
    const points = scoring.calculateFantasyPoints(stats);
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("player_id", "season", "week")
       DO UPDATE SET "stats" = EXCLUDED."stats", "fantasy_points" = EXCLUDED."fantasy_points"`,
      [defPlayerId, season, week, JSON.stringify(stats), points]
    );
    dstUpdated += 1;
  }

  return { season, week, playersUpdated, dstUpdated, gamesInFile: Math.floor(weekTeamRows.length / 2) };
}

/** Pure: is `date` in nflverse's own "nightly after each game day, cleanest
 * by Thursday" window (Monday-Thursday)? */
function isNflverseFinalizationDay(date = new Date()) {
  const day = date.getDay();
  return day >= 1 && day <= 4;
}

/**
 * Scheduler entry point: for every in-season league, finalize the most
 * recently completed week's IDP stats via nflverse. Groups leagues by
 * (season, prior week) so each week's defense file is fetched once,
 * mirroring correction.service's resyncPriorWeeks grouping. A failure for
 * one (season, week) — nflverse unreachable, or that season's file not
 * published yet — is logged and skipped rather than aborting the pass.
 */
async function finalizePriorWeeks() {
  const leaguesResult = await pool.query(
    `SELECT "id", "current_season", "current_week" FROM "leagues"
     WHERE "draft_status" = 'complete' AND "season_status" != 'complete' AND "current_week" > 1`
  );
  const weeks = new Map();
  for (const league of leaguesResult.rows) {
    const week = league.current_week - 1;
    const key = `${league.current_season}:${week}`;
    if (!weeks.has(key)) weeks.set(key, { season: league.current_season, week });
  }

  const finalized = [];
  for (const { season, week } of weeks.values()) {
    try {
      const outcome = await syncNflverseWeek({ season, week });
      if (outcome.playersUpdated > 0) finalized.push(outcome);
    } catch (err) {
      console.error('nflverse finalization failed for %s week %s:', season, week, err.message);
    }
  }
  return { finalized };
}

module.exports = {
  parseCsv,
  fetchPlayerWeekStatsForSeason,
  fetchTeamWeekStatsForSeason,
  fetchGameScoresForSeason,
  fetchPlayersCrosswalk,
  filterRowsForWeek,
  buildStatUpdates,
  parseFgMadeList,
  nflverseTeamToOurAbbr,
  normalizeNflversePlayerStats,
  buildFullStatUpdates,
  buildDstStatUpdates,
  applyNflverseWeek,
  applyNflverseFullWeek,
  syncNflverseWeek,
  isNflverseFinalizationDay,
  finalizePriorWeeks,
};
