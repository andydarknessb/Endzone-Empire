const axios = require('axios');
const pool = require('../modules/pool');
const scoring = require('./scoring.service');
const correction = require('./correction.service');

/**
 * IDP finalization pass: Tank01's live feed has no per-defender yardage for
 * sacks, tackles-for-loss, or fumble returns (see scoring.service.js's
 * normalizeTank01IdpStats). nflverse's public, no-auth weekly release CSVs
 * carry those fields — this service fetches them, joins to our `players`
 * table via an ESPN-id crosswalk, and patches the already-synced week's
 * stats. Not live: nflverse updates nightly after each game day, "cleanest
 * by Thursday" per their own docs, so this runs as a Mon-Thu daily pass (see
 * scheduler.js's runNflverseFinalization) rather than during live scoring.
 */

const NFLVERSE_RELEASE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download';

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

/** One season's individual-defense weekly file (confirmed columns: season,
 * week, season_type, player_id [GSIS id], def_sack_yards,
 * def_tackles_for_loss_yards, def_fumble_recovery_yards_own/_opp,
 * def_safety, ...). Per-season files are far smaller than the cumulative
 * career file, so this is what gets fetched on every run. */
async function fetchDefStatsForSeason(season) {
  const url = `${NFLVERSE_RELEASE_BASE}/player_stats/player_stats_def_${season}.csv`;
  return parseCsv(await fetchCsvText(url));
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

/** Pure: defRows -> only the target (season, week, REG-season) rows. */
function filterDefRowsForWeek(defRows, { season, week }) {
  return (defRows || []).filter(
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
 * Only `def_fumble_recovery_yards_opp` (recovering the OPPONENT's fumble —
 * the actual defensive playmaking event) feeds the fumble-return-yards
 * bonus; `_own` (recovering your own team's fumble) isn't a defensive
 * takeaway and isn't scored.
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
    updates.push({
      playerId,
      patch: {
        idpSackYards: num(row.def_sack_yards),
        idpTacklesForLossYards: num(row.def_tackles_for_loss_yards),
        idpFumbleReturnYards: num(row.def_fumble_recovery_yards_opp),
        idpSafety: num(row.def_safety),
      },
    });
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
    fetchDefStatsForSeason(season),
    fetchPlayersCrosswalk(),
  ]);
  const weekRows = filterDefRowsForWeek(defRows, { season, week });

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

  const leaguesResult = await pool.query(`SELECT "id" FROM "leagues" WHERE "draft_status" = 'complete'`);
  let leaguesRescored = 0;
  for (const league of leaguesResult.rows) {
    try {
      // No-ops instantly for a league with no matchup rows at this
      // (season, week) — safe to call broadly rather than pre-filtering.
      const outcome = await correction.correctLeagueWeek({ leagueId: league.id, season, week });
      if (outcome.changes.length > 0) leaguesRescored += 1;
    } catch (err) {
      console.error(`nflverse finalization: re-score failed for league ${league.id}:`, err.message);
    }
  }
  return { season, week, playersUpdated, leaguesRescored };
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
      console.error(`nflverse finalization failed for ${season} week ${week}:`, err.message);
    }
  }
  return { finalized };
}

module.exports = {
  parseCsv,
  fetchDefStatsForSeason,
  fetchPlayersCrosswalk,
  filterDefRowsForWeek,
  buildStatUpdates,
  syncNflverseWeek,
  isNflverseFinalizationDay,
  finalizePriorWeeks,
};
