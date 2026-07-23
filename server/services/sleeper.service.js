const axios = require('axios');
const pool = require('../modules/pool');
const { normalizeNameKey } = require('./nameMatch');
const { calculateFantasyPoints } = require('./scoring.service');

/**
 * Sleeper provides real full-season NFL stats for free (no key). We use it to
 * fill player_season_stats with genuine prior-season lines so the quick-view's
 * previous-season totals and projections are meaningful.
 *   - /v1/players/nfl                     -> sleeper_id -> { full_name, position }
 *   - /v1/stats/nfl/regular/<year>        -> sleeper_id -> season stat totals
 * Stats are stored in our flat stat keys, so points re-score under each
 * league's rules exactly like Tank01-sourced weeks.
 */
const SLEEPER_BASE = 'https://api.sleeper.app/v1';

function sleeperClient() {
  return axios.create({ baseURL: SLEEPER_BASE, timeout: 30000 });
}

// Sleeper stat field -> our flat stat key. Covers the offensive + kicking stats
// our scoring rules price; defense (TEAM_* entries) is out of scope here.
const SLEEPER_STAT_MAP = {
  pass_yd: 'passingYards',
  pass_td: 'passingTDs',
  pass_int: 'interceptions',
  pass_2pt: 'passingTwoPt',
  rush_yd: 'rushingYards',
  rush_td: 'rushingTDs',
  rush_2pt: 'rushingTwoPt',
  rec: 'receptions',
  rec_yd: 'receivingYards',
  rec_td: 'receivingTDs',
  rec_2pt: 'receivingTwoPt',
  fum_lost: 'fumbles',
  fgm: 'fieldGoal',
  xpm: 'extraPoint',
};

/** Pure: a Sleeper season stat row -> our flat stat totals (non-zero only). */
function mapSleeperStats(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [sleeperKey, ourKey] of Object.entries(SLEEPER_STAT_MAP)) {
    const n = Number(raw[sleeperKey]);
    if (Number.isFinite(n) && n !== 0) out[ourKey] = Math.round(n * 100) / 100;
  }
  return out;
}

/**
 * Pure: join a Sleeper player-meta entry with its stat row into our enrichment
 * shape, or null when it isn't a usable individual player-season (no name, no
 * games, or no mappable stats — e.g. TEAM_* defense rows).
 */
function normalizeSleeperEntry(meta, statRow) {
  const name = meta && meta.full_name;
  if (!name) return null;
  const games = Number(statRow && statRow.gp) || 0;
  if (games <= 0) return null;
  const stats = mapSleeperStats(statRow);
  if (Object.keys(stats).length === 0) return null;
  return {
    nameKey: normalizeNameKey(name),
    position: String((meta.position || '')).toUpperCase(),
    games,
    stats,
  };
}

/**
 * Pure matching: our players ([{id, name, position}]) x normalized Sleeper
 * entries -> season-stat rows to upsert ([{ playerId, season, games, stats }]).
 * Match by name key; disambiguate same-named players by position.
 */
function buildSeasonStatUpdates(players, entries, season) {
  const byNameKey = new Map();
  for (const e of entries) {
    if (!e || !e.nameKey) continue;
    if (!byNameKey.has(e.nameKey)) byNameKey.set(e.nameKey, []);
    byNameKey.get(e.nameKey).push(e);
  }
  const updates = [];
  for (const player of players) {
    const candidates = byNameKey.get(normalizeNameKey(player.name));
    if (!candidates || candidates.length === 0) continue;
    const pos = String(player.position || '').toUpperCase();
    const match = candidates.find((c) => c.position === pos) || candidates[0];
    updates.push({ playerId: player.id, season, games: match.games, stats: match.stats });
  }
  return updates;
}

async function upsertSeasonStats(updates) {
  if (updates.length === 0) return 0;
  await pool.query(
    `INSERT INTO "player_season_stats" ("player_id", "season", "games_played", "stats", "fantasy_points")
     SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::jsonb[], $5::numeric[])
     ON CONFLICT ("player_id", "season")
     DO UPDATE SET "games_played" = EXCLUDED."games_played",
                   "stats" = EXCLUDED."stats",
                   "fantasy_points" = EXCLUDED."fantasy_points"`,
    [
      updates.map((u) => u.playerId),
      updates.map((u) => u.season),
      updates.map((u) => u.games),
      updates.map((u) => JSON.stringify(u.stats)),
      updates.map((u) => calculateFantasyPoints(u.stats)),
    ]
  );
  return updates.length;
}

/**
 * Populate player_season_stats from Sleeper for the given seasons (default the
 * two most recent completed: 2025 and 2024). Overwrites any thinner rollup for
 * the same (player, season). Fetches the player map once, then one stats call
 * per season. Idempotent.
 */
async function syncSeasonStats({ seasons = [2025, 2024] } = {}) {
  const api = sleeperClient();
  const playersResp = await api.get('/players/nfl');
  const meta = playersResp.data || {};
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    const err = new Error('unexpected Sleeper players payload');
    err.statusCode = 502;
    throw err;
  }

  const ourPlayers = await pool.query(`SELECT "id", "name", "position" FROM "players"`);
  const perSeason = [];
  for (const season of seasons) {
    try {
      const statsResp = await api.get(`/stats/nfl/regular/${season}`);
      const statsMap = statsResp.data || {};
      const entries = [];
      for (const [sleeperId, statRow] of Object.entries(statsMap)) {
        const normalized = normalizeSleeperEntry(meta[sleeperId], statRow);
        if (normalized) entries.push(normalized);
      }
      const updates = buildSeasonStatUpdates(ourPlayers.rows, entries, season);
      const upserted = await upsertSeasonStats(updates);
      perSeason.push({ season, sleeperPlayers: entries.length, playersUpserted: upserted });
    } catch (err) {
      console.error('Sleeper season sync failed for %s:', season, err.message);
      perSeason.push({ season, error: err.message });
    }
  }
  return { seasons: perSeason };
}

module.exports = {
  mapSleeperStats,
  normalizeSleeperEntry,
  buildSeasonStatUpdates,
  syncSeasonStats,
};
