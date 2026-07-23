const axios = require('axios');
const pool = require('../modules/pool');
const { normalizeNameKey, teamMatches } = require('./nameMatch');

/**
 * TheSportsDB provider — headshots, jersey numbers, and bio for the player
 * pool. It does NOT carry weekly fantasy stat lines (that stays Tank01's job in
 * scoring.service); this only enriches players.photo_url / jersey_number.
 *
 * Free/public test key is "123" (SPORTSDB_API_KEY), so photos work out of the
 * box. Base: https://www.thesportsdb.com/api/v1/json/<key>/
 */
// TheSportsDB's free key caps the league team-list endpoints (search_all_teams
// returns only 10; the league-id lookup returns unrelated results), so we can't
// enumerate the league at runtime. These 32 idTeam values are stable; iterating
// them and pulling each roster is the reliable path. Verified against the live
// API (28 via searchteams; the 4 relocated/late ones from their known ids).
const NFL_TEAM_IDS = [
  '134946', '134942', '134922', '134918', '134943', '134938', '134923', '134924',
  '134934', '134930', '134939', '134940', '134926', '134927', '134928', '134931',
  '134932', '135908', '135907', '134919', '134941', '134920', '134944', '134935',
  '134921', '134936', '134925', '134948', '134949', '134929', '134945', '134937',
];

function sportsDbClient() {
  const key = process.env.SPORTSDB_API_KEY || '123';
  return axios.create({
    baseURL: `https://www.thesportsdb.com/api/v1/json/${key}`,
    timeout: 15000,
  });
}

// TheSportsDB spells positions out ("Quarterback"); map to our slot codes.
// Anything not fantasy-relevant (offensive line, defenders, etc.) maps to null.
const POSITION_MAP = {
  quarterback: 'QB',
  'running back': 'RB',
  'full back': 'RB',
  fullback: 'RB',
  'wide receiver': 'WR',
  'tight end': 'TE',
  kicker: 'K',
  placekicker: 'K',
  'place kicker': 'K',
};

function normalizeSportsDbPosition(strPosition) {
  const key = String(strPosition || '').trim().toLowerCase();
  return POSITION_MAP[key] || null;
}

/**
 * One TheSportsDB roster/player entry -> our enrichment shape, or null when it
 * lacks a usable name. photo prefers the square headshot (strThumb) and falls
 * back to the transparent cutout (strCutout). Jersey is left null when absent.
 */
function normalizeSportsDbPlayer(entry) {
  const name = entry && entry.strPlayer;
  if (!name) return null;
  const photo = (entry.strThumb && String(entry.strThumb)) ||
    (entry.strCutout && String(entry.strCutout)) || null;
  const jersey = entry.strNumber != null && String(entry.strNumber).trim() !== ''
    ? String(entry.strNumber).trim().slice(0, 8)
    : null;
  return {
    name: String(name),
    nameKey: normalizeNameKey(name),
    position: normalizeSportsDbPosition(entry.strPosition),
    jerseyNumber: jersey,
    photoUrl: photo && photo.startsWith('http') ? photo : null,
    team: entry.strTeam ? String(entry.strTeam) : null,
    teamShort: entry.strTeamShort ? String(entry.strTeamShort) : null,
  };
}

/**
 * Pure matching: given our players ([{id, name, nfl_team}]) and a flat list of
 * normalized provider entries, return the photo/jersey updates to apply. Match
 * is by name key; when several providers share a name, prefer the one on the
 * same NFL team. Only entries that actually carry a photo or jersey produce an
 * update (nothing to write otherwise).
 */
function buildPhotoUpdates(players, entries) {
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
    const match =
      candidates.find((c) => teamMatches(player.nfl_team, c)) || candidates[0];
    if (!match.photoUrl && !match.jerseyNumber) continue;
    updates.push({
      id: player.id,
      photoUrl: match.photoUrl,
      jerseyNumber: match.jerseyNumber,
    });
  }
  return updates;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Populate players.photo_url / jersey_number from TheSportsDB by pulling every
 * NFL team's roster (one call per team over the static NFL_TEAM_IDS list) and
 * matching to our pool by name. Idempotent; COALESCE keeps an existing value
 * when the provider has none, so a re-run never wipes good data. Team defenses
 * (no matching person) simply keep their initials-avatar fallback.
 */
async function syncPlayerPhotos() {
  const api = sportsDbClient();
  const entries = [];
  let rostersFetched = 0;
  for (const teamId of NFL_TEAM_IDS) {
    try {
      const rosterResp = await api.get('/lookup_all_players.php', { params: { id: teamId } });
      const roster = (rosterResp.data && rosterResp.data.player) || [];
      if (Array.isArray(roster) && roster.length > 0) {
        for (const entry of roster) {
          const normalized = normalizeSportsDbPlayer(entry);
          if (normalized) entries.push(normalized);
        }
        rostersFetched += 1;
      }
    } catch (err) {
      console.error('photo sync: roster fetch failed for team %s:', teamId, err.message);
    }
    await delay(2100); // free tier allows ~30 req/min — pace to ~1 call / 2s
  }
  if (rostersFetched === 0) {
    const err = new Error('no NFL rosters returned from TheSportsDB (rate limited?)');
    err.statusCode = 502;
    throw err;
  }

  const players = await pool.query(`SELECT "id", "name", "nfl_team" FROM "players"`);
  const updates = buildPhotoUpdates(players.rows, entries);

  let updated = 0;
  for (const u of updates) {
    try {
      await pool.query(
        `UPDATE "players"
         SET "photo_url" = COALESCE($1, "photo_url"),
             "jersey_number" = COALESCE($2, "jersey_number")
         WHERE "id" = $3`,
        [u.photoUrl, u.jerseyNumber, u.id]
      );
      updated += 1;
    } catch (err) {
      console.error('photo sync: update failed for player %s:', u.id, err.message);
    }
  }

  return {
    teamsScanned: NFL_TEAM_IDS.length,
    rostersFetched,
    playersMatched: updates.length,
    playersUpdated: updated,
  };
}

module.exports = {
  sportsDbClient,
  normalizeSportsDbPosition,
  normalizeNameKey,
  normalizeSportsDbPlayer,
  teamMatches,
  buildPhotoUpdates,
  syncPlayerPhotos,
};
