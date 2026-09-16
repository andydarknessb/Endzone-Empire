/**
 * The Tank01 feed adapter: the RapidAPI client factory, response-envelope
 * unwrapping, every Tank01 normaliser (folded in from tank01Normalizers.js,
 * #1183, rather than duplicated here), the Tank01 team-name map, its
 * game-key builder and its headshot resolver. Split out of
 * scoring.service.js (#1504, spec #1492) as one of the six modules the old
 * scoring module now re-exports whole.
 *
 * Sits beside, not over, the metered Tank01 client (modules/tank01Client.js)
 * and its quota state, which stay their own seam and are untouched here. The
 * existing Tank01 box source (tank01BoxSource.js) stays at its own path —
 * server/test/boxSource.tank01.test.js imports it there — and moves under
 * this adapter's ownership in a later PR of #1492's chain, not this one.
 */
const axios = require('axios');
const { NFL_TEAM_FULL_NAMES: NFL_TEAM_NAME_TO_ABBR } = require('./nflTeam');

// Tank01's box-score normalisers live in tank01Normalizers.js (#1183) and are
// re-exported below for their existing importers.
const {
  normalizeTank01Stats,
  normalizeTank01IdpStats,
  extractPlayByPlayBonusStats,
  normalizeTank01DstStats,
} = require('./tank01Normalizers');

function rapidApiClient() {
  if (!process.env.RAPID_API_KEY || !process.env.RAPID_API_HOST) {
    const err = new Error('RAPID_API_KEY / RAPID_API_HOST not configured');
    err.statusCode = 503;
    throw err;
  }
  return axios.create({
    baseURL: `https://${process.env.RAPID_API_HOST}`,
    headers: {
      'X-RapidAPI-Key': process.env.RAPID_API_KEY,
      'X-RapidAPI-Host': process.env.RAPID_API_HOST,
    },
    timeout: 15000,
  });
}

/**
 * Unwrap a Tank01 response. Every endpoint answers with
 * { statusCode, body } — the payload lives in `body`. Tolerates a raw
 * payload too, in case the envelope ever disappears.
 */
function tank01Body(data) {
  if (data && typeof data === 'object' && 'body' in data) return data.body;
  return data;
}

/**
 * A players.nfl_team value (full name or already-an-abbreviation) -> an
 * abbreviation. It resolves a full name to its code and returns an input that is
 * already abbreviated UNCHANGED, so it can only fold names, never reconcile two
 * abbreviations that disagree.
 *
 * The 32-name table it reads (`NFL_TEAM_NAME_TO_ABBR`) now lives in
 * services/nflTeam.js, next to the alias table and under the guard that holds
 * both against the migration defining fn_normalize_nfl_team (#227). It was a
 * third copy of the same rows, and a renamed or relocated franchise had to be
 * remembered in three places.
 *
 * This function is NOT `normalizeNflTeam`, and the difference is the
 * short-circuit below: an already-abbreviated input is returned as-is, so `WSH`
 * stays `WSH` here where the shared helper would fold it to `WAS`. That is why
 * it must NOT be used to match a DEF unit against a live box score: the DEF
 * row's Team code is WAS and Tank01's teamAbv is WSH, and this resolver would
 * leave them in different vocabularies (the #431 bug). The DEF join folds
 * through normalizeNflTeam instead. adp.service's DEF match had the same
 * disagreeing-vocabularies shape and was moved to normalizeNflTeam too (#451).
 * What remains here is the callers whose two sides do already agree or need
 * only a name folded: the syncTeamDefenses backfill (missingTeamDefenses,
 * feedSyncRuns.service.js), projectionFeatures. #227 deliberately did not
 * merge this with normalizeNflTeam; nothing here is kickoff-keyed, and those
 * callers were not asked to change.
 */
function normalizeTeamAbbr(nflTeam) {
  const raw = String(nflTeam || '').trim();
  if (!raw) return null;
  if (/^[A-Z]{2,3}$/.test(raw)) return raw;
  return NFL_TEAM_NAME_TO_ABBR[raw.toUpperCase()] || null;
}

/**
 * Pure: the stable identifier both per-team rows of one NFL game share.
 * Deliberately spelled the way nflverse spells its own `game_id`
 * (`2026_03_BUF_MIA`, season_week_away_home), so a Tank01-synced week and an
 * nflverse-backfilled week produce the SAME key for the same game and a
 * per-game lookup (weather, venue) never fans out to two half-games.
 * Returns null when any component is missing.
 */
function buildGameKey({ season, week, away, home }) {
  const w = Number(week);
  if (!Number.isFinite(Number(season)) || !Number.isInteger(w) || !away || !home) return null;
  return `${Number(season)}_${String(w).padStart(2, '0')}_${away}_${home}`;
}

/**
 * Pure: one Tank01 game entry -> { home, away, kickoffAt } (team
 * abbreviations; null when the entry is missing anything load-bearing).
 * Home/away orientation was always present in the feed and previously
 * discarded — it is carried through now so nfl_games can record which side of
 * the game each row is.
 */
function normalizeTank01Game(entry) {
  if (!entry || !entry.home || !entry.away) return null;
  const epoch = Number(entry.gameTime_epoch);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  return { home: entry.home, away: entry.away, kickoffAt: new Date(epoch * 1000) };
}

/**
 * Resolve a headshot URL for a Tank01 player entry. Prefer the provider's own
 * `espnHeadshot` URL when present; otherwise build the public ESPN headshot
 * URL from the player's `espnID` (a stable, keyed pattern). Returns null when
 * neither is available, so the UI falls back to an initials avatar.
 */
function resolveHeadshotUrl(entry) {
  const provided = entry && entry.espnHeadshot;
  if (provided && String(provided).startsWith('http')) return String(provided);
  const espnId = entry && entry.espnID;
  if (espnId != null && /^\d+$/.test(String(espnId))) {
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  }
  return null;
}

module.exports = {
  rapidApiClient,
  tank01Body,
  normalizeTank01Stats,
  normalizeTank01IdpStats,
  extractPlayByPlayBonusStats,
  normalizeTank01DstStats,
  normalizeTeamAbbr,
  NFL_TEAM_NAME_TO_ABBR,
  buildGameKey,
  normalizeTank01Game,
  resolveHeadshotUrl,
};
