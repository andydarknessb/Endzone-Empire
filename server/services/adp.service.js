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

// The market-health thresholds (#747). MARKET_FLOOR is the count of players
// carrying an ADP below which the market is treated as absent, and it is the one
// every gate reads: the wipe guard refuses a Success body with fewer usable
// entries, draft start (draftStart.service, draftSchedule.service) refuses
// when fewer than this many players carry a non-null adp, and getMarketStatus
// below reports it as the commissioner-visible `floor`. MARKET_STALE_DAYS is
// the age (in days since the last ok run) past which the market is meant to read
// as stale; it is exported here so no gate hardcodes the number, and
// getMarketStatus is what reads it (#748).
const MARKET_FLOOR = 100;
const MARKET_STALE_DAYS = 7;

/**
 * Append one observable row to data_sync_runs for an ADP run (#747): the daily
 * worker sync and the manual admin trigger both land here, and getSchedulerStatus
 * reports the latest. One INSERT at the end of a run records the whole thing -
 * started_at is captured before the upstream fetch, and finished_at is left to
 * the column DEFAULT (now()), the instant of the write.
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
      `INSERT INTO "data_sync_runs" ("job", "started_at", "ok", "detail")
       VALUES ($1, $2, $3, $4::jsonb)`,
      ['adp', startedAt, ok, detail ? JSON.stringify(detail) : null]
    );
  } catch (err) {
    console.error('data_sync_runs record failed for adp (run outcome unaffected):', err.message);
  }
}

/**
 * The market's observable state for GET /api/league/:id (#748): how many
 * players carry an ADP, the floor that count is judged against, when the last
 * successful sync finished, and whether that run is stale. `stale` is true
 * both when there has never been an ok run and when the latest one finished
 * more than MARKET_STALE_DAYS ago, so a consumer can read it without a null
 * check of its own.
 *
 * The data_sync_runs read follows getSchedulerStatus's precedent
 * (modules/scheduler.js): the migration that creates the table is applied by
 * the maintainer as a separate step, so the table may not exist yet in a given
 * environment, and this is called from GET /api/league/:id, a hot
 * authenticated route. A failed or impossible read must not 500 that route, so
 * it degrades to the same shape as "no run yet" (lastSyncAt null, stale true)
 * rather than throwing.
 */
async function getMarketStatus() {
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS "n" FROM "players" WHERE "adp" IS NOT NULL`
  );
  const adpPlayers = countResult.rows[0].n;

  let lastSyncAt = null;
  try {
    const runResult = await pool.query(
      `SELECT "finished_at" FROM "data_sync_runs"
       WHERE "job" = 'adp' AND "ok" = true
       ORDER BY "finished_at" DESC, "id" DESC LIMIT 1`
    );
    const row = runResult.rows[0];
    if (row) lastSyncAt = row.finished_at;
  } catch (err) {
    console.warn('getMarketStatus: data_sync_runs read failed, reporting lastSyncAt=null:', err.message);
    lastSyncAt = null;
  }

  const staleCutoffMs = MARKET_STALE_DAYS * 24 * 60 * 60 * 1000;
  const stale = lastSyncAt == null || (Date.now() - new Date(lastSyncAt).getTime()) > staleCutoffMs;

  return { adpPlayers, floor: MARKET_FLOOR, lastSyncAt, stale };
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
    // Log the refusal HERE, not only through recordAdpRun. That record is
    // best-effort, and during the carve-out window before the migration is
    // applied data_sync_runs does not exist, so the INSERT is swallowed. Without
    // this line a market-emptying upstream body would be refused with no record
    // anywhere, while the draft-start gate blocks starts league-wide - drafts
    // failing everywhere with an unlogged cause (#747 review 750-f1).
    console.warn(
      `ADP sync refused: ${entries.length} usable entries is below the ${MARKET_FLOOR}-player market floor; players left unchanged`
    );
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
  getMarketStatus,
  MARKET_FLOOR,
  MARKET_STALE_DAYS,
};
