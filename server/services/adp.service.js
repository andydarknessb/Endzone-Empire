const axios = require('axios');
const pool = require('../modules/pool');
const { normalizeNameKey } = require('./nameMatch');

/**
 * Average Draft Position from Fantasy Football Calculator's free, no-key ADP
 * API (https://fantasyfootballcalculator.com/api/v1/adp/<format>). It returns
 * the ~200 most-drafted players for a scoring format; everyone else stays null
 * (undrafted). Half-PPR is the default to match this app's default scoring.
 */
const FFC_BASE = 'https://fantasyfootballcalculator.com/api/v1/adp';
const VALID_FORMATS = new Set(['standard', 'ppr', 'half-ppr', '2qb', 'dynasty', 'rookie']);

function adpClient() {
  return axios.create({ baseURL: FFC_BASE, timeout: 15000 });
}

// FFC positions are close to ours; only the kicker code differs.
function normalizeAdpPosition(pos) {
  const p = String(pos || '').toUpperCase();
  return p === 'PK' ? 'K' : p;
}

/**
 * One FFC ADP row -> our shape, or null without a usable name or numeric adp.
 * `adp` is a positive number (average pick); lower = drafted earlier.
 */
function normalizeAdpEntry(entry) {
  const name = entry && entry.name;
  const adp = Number(entry && entry.adp);
  if (!name || !Number.isFinite(adp) || adp <= 0) return null;
  return {
    name: String(name),
    nameKey: normalizeNameKey(name),
    position: normalizeAdpPosition(entry.position),
    adp: Math.round(adp * 100) / 100,
  };
}

/**
 * Pure matching: our players ([{id, name, position}]) x normalized ADP entries
 * -> [{ id, adp }]. Match is by name key; when a name collides, prefer the
 * entry whose position matches ours. Unmatched players produce no update (adp
 * stays null / undrafted).
 */
function buildAdpUpdates(players, entries) {
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
    updates.push({ id: player.id, adp: match.adp });
  }
  return updates;
}

/**
 * Refresh players.adp from FFC. Idempotent full refresh: every player's adp is
 * set to its matched value or reset to null (so a player who fell out of the
 * top ~200 since last run stops showing a stale ADP). Defaults to half-PPR,
 * 12-team, current season.
 */
async function syncAdp({ format = 'half-ppr', teams = 12, year } = {}) {
  const fmt = VALID_FORMATS.has(format) ? format : 'half-ppr';
  const api = adpClient();
  const params = { teams };
  if (year) params.year = year;
  const resp = await api.get(`/${fmt}`, { params });
  const body = resp.data || {};
  if (body.status !== 'Success' || !Array.isArray(body.players)) {
    const err = new Error(`unexpected ADP response (status=${body.status})`);
    err.statusCode = 502;
    throw err;
  }

  const entries = [];
  for (const raw of body.players) {
    const e = normalizeAdpEntry(raw);
    if (e) entries.push(e);
  }

  const players = await pool.query(`SELECT "id", "name", "position" FROM "players"`);
  const updates = buildAdpUpdates(players.rows, entries);

  // Full reset-and-set in two bulk statements (one round trip each) so it stays
  // fast over the pooler and a player who fell out of the top ~200 loses a
  // stale ADP.
  await pool.query(`UPDATE "players" SET "adp" = NULL WHERE "adp" IS NOT NULL`);
  if (updates.length > 0) {
    await pool.query(
      `UPDATE "players" p SET "adp" = v.adp
       FROM (SELECT unnest($1::int[]) AS id, unnest($2::numeric[]) AS adp) v
       WHERE p."id" = v.id`,
      [updates.map((u) => u.id), updates.map((u) => u.adp)]
    );
  }
  return { format: fmt, teams, adpPlayers: entries.length, playersMatched: updates.length, playersUpdated: updates.length };
}

module.exports = {
  normalizeAdpPosition,
  normalizeAdpEntry,
  buildAdpUpdates,
  syncAdp,
};
