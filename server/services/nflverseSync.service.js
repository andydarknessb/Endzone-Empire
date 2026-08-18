const axios = require('axios');
const pool = require('../modules/pool');
const scoring = require('./scoring.service');
const correction = require('./correction.service');
const { fantasySeasonLiveWhereSql } = require('./leaguePhase');

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
      idpInterceptionReturnYards: num(row.def_interception_yards),
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

  const leaguesResult = await pool.query(`SELECT "id" FROM "leagues" WHERE ${fantasySeasonLiveWhereSql()}`);
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
 * Pure: an OPTIONAL nflverse team column -> our abbreviation, or null.
 *
 * nflverseTeamToOurAbbr answers '' for a missing value, which would store an
 * empty string as if it were a team. A stat row whose file has no `team` column
 * must record "unknown", not a blank team, so this is the reader used for the
 * stats-jsonb gameTeam/gameOpponent keys.
 */
function optionalTeamAbbr(team) {
  const text = optionalText(team);
  return text ? nflverseTeamToOurAbbr(text) : null;
}

// nfl_games speaks Tank01's vocabulary — syncSchedule writes WSH, and Tank01
// game ids are spelled WSH (see modules/espnScoreboard.js) — while games.csv
// says WAS and LA. Schedule rows must be written in Tank01 codes so a
// backfilled week joins cleanly against Tank01-written weeks. This is a
// DIFFERENT target than nflverseTeamToOurAbbr above: DST stat matching goes
// through normalizeTeamAbbr, whose Washington code is WAS.
const NFLVERSE_TO_TANK01_SCHEDULE_ABBR = { LA: 'LAR', WAS: 'WSH' };
function nflverseTeamToScheduleAbbr(team) {
  const abbr = String(team || '').toUpperCase();
  if (!abbr) return null;
  return NFLVERSE_TO_TANK01_SCHEDULE_ABBR[abbr] || abbr;
}

/**
 * Pure: a games.csv Eastern-time kickoff (gameday 'YYYY-MM-DD' + gametime
 * 'HH:MM') -> UTC Date. The IANA TZ database resolves EST vs. EDT for the
 * date; NFL kickoffs never fall inside the 2am DST transition window, so
 * probing the day's offset at noon UTC is exact.
 */
function etKickoffToUtc(gameday, gametime) {
  const day = String(gameday || '').trim();
  const time = String(gametime || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{1,2}:\d{2}$/.test(time)) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${day}T12:00:00Z`));
  const zone = (parts.find((p) => p.type === 'timeZoneName') || {}).value || '';
  const offset = zone.match(/GMT([+-]\d{2}:\d{2})/);
  if (!offset) return null;
  const [hh, mm] = time.split(':');
  const date = new Date(`${day}T${hh.padStart(2, '0')}:${mm}:00${offset[1]}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Pure: a games.csv value that may be absent -> the value, or null. Never 0. */
function optionalNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Pure: a games.csv text value that may be absent -> a trimmed string, or null. */
function optionalText(value, maxLength) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || text.toUpperCase() === 'NA') return null;
  return maxLength ? text.slice(0, maxLength) : text;
}

/**
 * Pure: games.csv rows -> one season's REG-season nfl_games rows (both team
 * perspectives per game), kickoffs converted from ET, team codes mapped to
 * Tank01 vocabulary.
 *
 * Game CONTEXT (orientation, venue, roof, surface, neutral site, rest days)
 * was always in this file and previously discarded. It rides along now because
 * the weekly projection engine needs it — home/away for its schedule factor,
 * roof to know whether weather can even matter. Every context field is
 * OPTIONAL: a column the file does not carry (or carries as blank/NA) becomes
 * null, never a fabricated default. Latitude/longitude are deliberately absent
 * here — games.csv has no coordinates, and this code will not invent any.
 */
function buildScheduleRows(rows, { season }) {
  const out = [];
  for (const row of rows || []) {
    if (Number(row.season) !== Number(season) || row.game_type !== 'REG') continue;
    const week = Number(row.week);
    if (!Number.isInteger(week) || week < 1 || week > 18) continue;
    const home = nflverseTeamToScheduleAbbr(row.home_team);
    const away = nflverseTeamToScheduleAbbr(row.away_team);
    const kickoffAt = etKickoffToUtc(row.gameday, row.gametime);
    if (!home || !away || !kickoffAt) continue; // kickoff_at is NOT NULL
    const location = optionalText(row.location);
    const context = {
      gameKey: scoring.buildGameKey({ season, week, away, home }),
      // games.csv's `location` is 'Home' for a normal game and 'Neutral' for a
      // neutral-site one. An absent column leaves the flag unknown (null)
      // rather than asserting "not neutral".
      neutralSite: location == null ? null : location.toLowerCase() === 'neutral',
      venue: optionalText(row.stadium, 120),
      roof: optionalText(row.roof, 24),
      surface: optionalText(row.surface, 32),
    };
    out.push({
      season: Number(season), week, nflTeam: home, opponent: away, kickoffAt,
      homeAway: 'home', restDays: optionalNumber(row.home_rest), ...context,
    });
    out.push({
      season: Number(season), week, nflTeam: away, opponent: home, kickoffAt,
      homeAway: 'away', restDays: optionalNumber(row.away_rest), ...context,
    });
  }
  return out;
}

/**
 * Backfill one season's schedule into nfl_games from games.csv — free (no
 * Tank01 quota) and complete even for weeks whose kickoff times are still
 * placeholders (week 18 is listed at Sunday 1pm ET until flexed; Tank01's
 * feed drops those games entirely, which is how 2026 ended up with no week-18
 * rows and every bye underivable). INSERT-only: an existing row keeps its
 * Tank01-synced kickoff, so this can run any time without degrading live
 * data, and a later Tank01 re-sync still corrects placeholder times. Bye
 * derivation needs every week's ROW to exist, not exact times.
 */
async function syncScheduleFromNflverse({ season }) {
  const rows = parseCsv(await fetchCsvText(NFLVERSE_GAMES_URL));
  const scheduleRows = buildScheduleRows(rows, { season });
  let rowsInserted = 0;
  let contextUpdated = 0;
  for (const game of scheduleRows) {
    // Still never overwrites `opponent` or `kickoff_at` on an existing row —
    // a Tank01-synced kickoff stays authoritative. The ON CONFLICT branch
    // exists only to fill in the additive game-context columns, and each one
    // is COALESCEd so a null in this file cannot erase a value already there.
    const res = await pool.query(
      `INSERT INTO "nfl_games"
         ("season", "week", "nfl_team", "opponent", "kickoff_at",
          "game_key", "home_away", "neutral_site", "venue", "roof", "surface", "rest_days")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT ("season", "week", "nfl_team")
       DO UPDATE SET "game_key" = COALESCE(EXCLUDED."game_key", "nfl_games"."game_key"),
                     "home_away" = COALESCE(EXCLUDED."home_away", "nfl_games"."home_away"),
                     "neutral_site" = COALESCE(EXCLUDED."neutral_site", "nfl_games"."neutral_site"),
                     "venue" = COALESCE(EXCLUDED."venue", "nfl_games"."venue"),
                     "roof" = COALESCE(EXCLUDED."roof", "nfl_games"."roof"),
                     "surface" = COALESCE(EXCLUDED."surface", "nfl_games"."surface"),
                     "rest_days" = COALESCE(EXCLUDED."rest_days", "nfl_games"."rest_days")
       RETURNING ("xmax" = 0) AS "inserted"`,
      [
        game.season, game.week, game.nflTeam, game.opponent, game.kickoffAt,
        game.gameKey, game.homeAway, game.neutralSite, game.venue, game.roof,
        game.surface, game.restDays,
      ]
    );
    // xmax = 0 on the returned tuple distinguishes a fresh INSERT from an
    // upsert that took the DO UPDATE branch, so the counts stay meaningful now
    // that existing rows are touched to fill in context.
    const inserted = res.rows && res.rows[0] ? res.rows[0].inserted === true : (res.rowCount || 0) > 0;
    if (inserted) rowsInserted += 1;
    else contextUpdated += 1;
  }
  return { season: Number(season), gamesInFile: scheduleRows.length / 2, rowsInserted, contextUpdated };
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
  // Opportunity/role columns are OPTIONAL, so they use a null-preserving
  // reader rather than `num`: a season whose file lacks `targets` must record
  // "we don't know his target share", not "he had zero targets". The
  // projection engine reads the presence of these keys to decide whether it
  // has role data at all (see projectionFeatures.hasRoleSignal), and a
  // fabricated 0 would make a missing column look like a benching.
  const usage = (v) => {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const solo = num(row.def_tackles_solo);
  return {
    // Not scored by any rule (calculateFantasyPoints ignores unknown keys) —
    // carried purely as projection features. Same for gameTeam/gameOpponent:
    // who a line was earned FOR and AGAINST, so a stat row is self-describing
    // without a join. Home/away deliberately stays OUT of the jsonb; it's read
    // from nfl_games, which is the one place it can be corrected.
    gameTeam: optionalTeamAbbr(row.team),
    gameOpponent: optionalTeamAbbr(row.opponent_team),
    usagePassAttempts: usage(row.attempts),
    usageCompletions: usage(row.completions),
    usageCarries: usage(row.carries),
    usageTargets: usage(row.targets),
    usageAirYards: usage(row.receiving_air_yards),
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
    idpInterceptionReturnYards: num(row.def_interception_yards),
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
        // Unscored, same as on the player rows: which unit this line belongs to
        // and who it was earned against.
        gameTeam: optionalTeamAbbr(row.team),
        gameOpponent: optionalTeamAbbr(row.opponent_team),
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
async function applyNflverseFullWeek({
  season,
  week,
  playerRows,
  teamRows,
  scoresByGameId,
  crosswalk,
  preserveKeys = [],
}) {
  const weekPlayerRows = filterRowsForWeek(playerRows, { season, week });
  const weekTeamRows = filterRowsForWeek(teamRows, { season, week });

  const knownPlayers = await pool.query(
    `SELECT "id", "external_id" FROM "players" WHERE "external_id" IS NOT NULL`
  );
  const idByExternal = new Map(knownPlayers.rows.map((r) => [String(r.external_id), r.id]));

  // When this runs over a week Tank01 already filled (the Tue/Wed correction
  // path), carry forward the stat keys nflverse has no equivalent for — the
  // play-by-play TD-length arrays. They're the only thing a wholesale nflverse
  // upsert would silently destroy, and destroying them would zero out
  // TD-length bonuses for exactly the leagues that opted into them.
  const preserved = new Map();
  if (preserveKeys.length > 0) {
    const existing = await pool.query(
      `SELECT "player_id", "stats" FROM "player_stats" WHERE "season" = $1 AND "week" = $2`,
      [season, week]
    );
    for (const row of existing.rows) {
      const carry = {};
      for (const key of preserveKeys) {
        if (row.stats && row.stats[key] !== undefined) carry[key] = row.stats[key];
      }
      if (Object.keys(carry).length > 0) preserved.set(row.player_id, carry);
    }
  }

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
  for (const { playerId, stats: fresh } of playerUpdates) {
    const carry = preserved.get(playerId);
    const stats = carry ? { ...fresh, ...carry } : fresh;
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

/**
 * Stat keys only Tank01's play-by-play can produce, so a wholesale nflverse
 * apply must carry them forward rather than overwrite them. nflverse DOES
 * supply exact FG distances (fg_made_list -> fieldGoalDistances), so that key
 * is deliberately absent here.
 */
const PBP_ONLY_STAT_KEYS = ['passingTDLengths', 'rushingTDLengths', 'receivingTDLengths'];

/**
 * The free replacement for a Tank01 stat-correction re-sync: rebuild one
 * (season, week) wholesale from nflverse's published CSVs — offense, IDP,
 * kicking and team-DST — then re-score every affected league through
 * correction.service's existing correctLeagueWeek path.
 *
 * This is what takes the Tue/Wed correction pass from ~34 Tank01 calls a week
 * to zero. nflverse is also the more accurate source by then: it's the same
 * data the NFL's own corrections flow into, published nightly and "cleanest by
 * Thursday" per nflverse's docs.
 *
 * This always runs over weeks Tank01 already filled, so preserving the
 * pbp-only keys is the DEFAULT here rather than something each caller has to
 * remember (correction.service and the backfill script both reach this path).
 * A caller can still pass an explicit list; passing [] opts out entirely.
 *
 * @param {{season: number, week: number, rescoreLeagues?: boolean,
 *          preserveKeys?: string[]}} args
 */
async function correctWeekFromNflverse({
  season,
  week,
  rescoreLeagues = true,
  preserveKeys = PBP_ONLY_STAT_KEYS,
}) {
  const [playerRows, teamRows, scoresByGameId, crosswalk] = await Promise.all([
    fetchPlayerWeekStatsForSeason(season),
    fetchTeamWeekStatsForSeason(season),
    fetchGameScoresForSeason(season),
    fetchPlayersCrosswalk(),
  ]);
  const applied = await applyNflverseFullWeek({
    season,
    week,
    playerRows,
    teamRows,
    scoresByGameId,
    crosswalk,
    preserveKeys,
  });
  if (!rescoreLeagues) return { ...applied, leaguesRescored: 0, corrected: [] };

  const leaguesResult = await pool.query(
    `SELECT "id" FROM "leagues" WHERE ${fantasySeasonLiveWhereSql()}`
  );
  const corrected = [];
  for (const league of leaguesResult.rows) {
    try {
      // No-ops instantly for a league with no matchup rows at this
      // (season, week) — safe to call broadly rather than pre-filtering.
      const outcome = await correction.correctLeagueWeek({ leagueId: league.id, season, week });
      if (outcome.changes.length > 0) corrected.push(outcome);
    } catch (err) {
      console.error('nflverse correction: re-score failed for league %s:', league.id, err.message);
    }
  }
  return { ...applied, leaguesRescored: corrected.length, corrected };
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
     WHERE ${fantasySeasonLiveWhereSql()} AND "current_week" > 1`
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
  optionalTeamAbbr,
  nflverseTeamToScheduleAbbr,
  etKickoffToUtc,
  optionalNumber,
  optionalText,
  buildScheduleRows,
  syncScheduleFromNflverse,
  normalizeNflversePlayerStats,
  buildFullStatUpdates,
  buildDstStatUpdates,
  applyNflverseWeek,
  applyNflverseFullWeek,
  correctWeekFromNflverse,
  PBP_ONLY_STAT_KEYS,
  syncNflverseWeek,
  isNflverseFinalizationDay,
  finalizePriorWeeks,
};
