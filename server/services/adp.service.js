const axios = require('axios');
const pool = require('../modules/pool');
const { normalizeNameKey } = require('./nameMatch');
const { IDP_POSITIONS } = require('./scoring.service');
const { normalizeNflTeam } = require('./nflTeam');

const IDP_POSITION_SET = new Set(IDP_POSITIONS);

/**
 * Average Draft Position from Fantasy Football Calculator's free, no-key ADP
 * API (https://fantasyfootballcalculator.com/api/v1/adp/<format>). It returns
 * the ~200 most-drafted players for a scoring format; everyone else stays null
 * (undrafted). Half-PPR is the default to match this app's default scoring.
 */
const FFC_BASE = 'https://fantasyfootballcalculator.com/api/v1/adp';
const VALID_FORMATS = new Set(['standard', 'ppr', 'half-ppr', '2qb', 'dynasty', 'rookie']);

// The market-health thresholds every gate reads (#747). MARKET_FLOOR is the
// count of players carrying an ADP below which the market is treated as absent:
// the wipe guard refuses to write a Success body with fewer usable entries, and
// draft start refuses (draftStart.service, draftSchedule.service) when fewer
// than this many players carry a non-null adp. MARKET_STALE_DAYS is the age (in
// days since the last ok run) past which the market is surfaced as stale; unlike
// the floor it warns rather than blocks. Both are exported so no gate hardcodes
// the number.
const MARKET_FLOOR = 100;
const MARKET_STALE_DAYS = 7;

/**
 * Append one observable row to data_sync_runs for an ADP run (#747): the daily
 * worker sync and the manual admin trigger both land here, and getSchedulerStatus
 * reports the latest. One INSERT at the end of a run records the whole thing -
 * started_at is captured before the upstream fetch, finished_at defaults to now().
 *
 * BEST-EFFORT BY CONSTRUCTION. A failure to record must never mask the real
 * outcome of a run: the market may have been refreshed correctly, and a thrown
 * observability write would turn that into a 500 to the admin and stop the
 * scheduler from day-stamping (re-running the full sync every tick). This also
 * covers the carve-out window - the migration that creates data_sync_runs is
 * applied by the maintainer, so the table may not exist yet when this code is
 * live. Swallowing here (rather than at each call site) keeps every caller
 * uniformly best-effort with no chance of the asymmetry creeping back.
 */
async function recordAdpRun({ startedAt, ok, detail }) {
  try {
    await pool.query(
      `INSERT INTO "data_sync_runs" ("job", "started_at", "finished_at", "ok", "detail")
       VALUES ($1, $2, now(), $3, $4::jsonb)`,
      ['adp', startedAt, ok, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.error('data_sync_runs record failed for adp (run outcome unaffected):', err.message);
  }
}

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
    // Team code (CONTEXT.md), folded from FFC's `team` field — the only
    // reliable key for DEF entries, whose names ("Denver Defense") never
    // match our DEF rows ("Denver Broncos"). See the DEF match in
    // buildAdpUpdates for why both sides fold through normalizeNflTeam.
    teamAbbr: normalizeNflTeam(entry.team),
    adp: Math.round(adp * 100) / 100,
  };
}

/**
 * Pure matching: our players ([{id, name, position, nfl_team}]) x normalized
 * ADP entries -> [{ id, adp }]. DEF rows match by team code (our DEF names are
 * full team names like "Denver Broncos", FFC's are "Denver Defense" — only the
 * team abbreviation lines up). Everyone else matches by name key; when a name
 * collides, prefer the entry whose position matches ours. Unmatched players
 * produce no update (adp stays null / undrafted).
 */
function buildAdpUpdates(players, entries) {
  const byNameKey = new Map();
  const defByTeam = new Map();
  for (const e of entries) {
    if (!e) continue;
    if (e.position === 'DEF' && e.teamAbbr) defByTeam.set(e.teamAbbr, e);
    if (!e.nameKey) continue;
    if (!byNameKey.has(e.nameKey)) byNameKey.set(e.nameKey, []);
    byNameKey.get(e.nameKey).push(e);
  }
  const updates = [];
  for (const player of players) {
    const pos = String(player.position || '').toUpperCase();
    if (pos === 'DEF') {
      // Both sides are Team codes (CONTEXT.md) folded through normalizeNflTeam:
      // FFC's `team` field (built into defByTeam above) and players.nfl_team,
      // which for a DEF row holds a full team name, not an abbreviation. A
      // raw-spelling mismatch (FFC's WSH vs. our "Washington Commanders")
      // would silently fail to match without folding both sides the same way.
      const match = defByTeam.get(normalizeNflTeam(player.nfl_team));
      if (match) updates.push({ id: player.id, adp: match.adp });
      continue;
    }
    // FFC has no IDP format, so an individual defender can only ever "match" a
    // same-named offensive player (a real hazard: LB Justin Jefferson, CB
    // Lamar Jackson). IDP ADP stays null by design.
    if (IDP_POSITION_SET.has(pos)) continue;
    const candidates = byNameKey.get(normalizeNameKey(player.name));
    if (!candidates || candidates.length === 0) continue;
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
 *
 * ONE MARKET FOR EVERY LEAGUE. This app syncs a single global column in the
 * half-PPR, 12-team format regardless of any league's own scoring, because the
 * ADP is a market reference (CONTEXT.md), not a league-specific ranking.
 * Per-format ADP is a separate product question and is deliberately not built
 * here (#747, decision 6).
 *
 * THE WIPE GUARD (#747, decision 5). The refresh NULLs every ADP before setting
 * the matched values, so a Success body with too few players would empty the
 * whole market. A body with fewer than MARKET_FLOOR usable entries is therefore
 * treated as a failed run: nothing is written to players, and the run is
 * recorded ok = false with the thin count in detail. The NULL-then-set runs
 * only after the guard passes. Every run - refused, succeeded, or thrown -
 * appends one data_sync_runs row so freshness and health can observe it.
 */
async function syncAdp({ format = 'half-ppr', teams = 12, year } = {}) {
  const fmt = VALID_FORMATS.has(format) ? format : 'half-ppr';
  const startedAt = new Date();

  let resp;
  try {
    const api = adpClient();
    const params = { teams };
    if (year) params.year = year;
    resp = await api.get(`/${fmt}`, { params });
  } catch (err) {
    await recordAdpRun({ startedAt, ok: false, detail: { reason: 'fetch_failed', message: err.message } });
    throw err;
  }

  const body = resp.data || {};
  if (body.status !== 'Success' || !Array.isArray(body.players)) {
    await recordAdpRun({ startedAt, ok: false, detail: { reason: 'bad_response', status: body.status ?? null } });
    const err = new Error(`unexpected ADP response (status=${body.status})`);
    err.statusCode = 502;
    throw err;
  }

  const entries = [];
  for (const raw of body.players) {
    const e = normalizeAdpEntry(raw);
    if (e) entries.push(e);
  }

  // Wipe guard: refuse to reset the market from a body too thin to be a real
  // one. Recorded as a failed run; players is left untouched (and unread).
  if (entries.length < MARKET_FLOOR) {
    await recordAdpRun({ startedAt, ok: false, detail: { reason: 'thin_market', adpPlayers: entries.length } });
    return {
      ok: false,
      skipped: true,
      reason: 'thin_market',
      format: fmt,
      teams,
      adpPlayers: entries.length,
      playersMatched: 0,
      playersUpdated: 0,
    };
  }

  const players = await pool.query(`SELECT "id", "name", "position", "nfl_team" FROM "players"`);
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

  await recordAdpRun({ startedAt, ok: true, detail: { adpPlayers: entries.length, matched: updates.length } });
  return {
    ok: true,
    format: fmt,
    teams,
    adpPlayers: entries.length,
    playersMatched: updates.length,
    playersUpdated: updates.length,
  };
}

module.exports = {
  normalizeAdpPosition,
  normalizeAdpEntry,
  buildAdpUpdates,
  syncAdp,
  MARKET_FLOOR,
  MARKET_STALE_DAYS,
};
