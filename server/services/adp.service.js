const axios = require('axios');
const pool = require('../modules/pool');
const { runSyncJob } = require('../modules/syncRun');
const { PLAYERS_BULK_WRITE_LOCK } = require('../modules/advisoryLock');
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
// carrying an ADP below which the market is treated as absent, and it is the
// one every gate reads: the wipe guard refuses a Success body with fewer than
// MARKET_FLOOR usable entries, OR with at least that many usable entries but
// fewer than MARKET_FLOOR of them matching a roster player (#747 decision 5,
// amended 2026-09-11) - draft start (draftStart.service,
// draftSchedule.service) refuses when fewer than this many players carry a
// non-null adp, and getMarketStatus below reports it as the
// commissioner-visible `floor`. MARKET_STALE_DAYS is
// the age (in days since the last ok run) past which the market is meant to read
// as stale; it is exported here so no gate hardcodes the number, and
// getMarketStatus is what reads it (#748).
const MARKET_FLOOR = 100;
const MARKET_STALE_DAYS = 7;

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
 * Sync run module (ADR 0036, #1201): `runSyncJob` owns the fetch/apply split,
 * the transaction, the advisory lock and the one `data_sync_runs` row per run
 * - the shape this job hand-rolled (#747, #882, #904) is now written once, in
 * server/modules/syncRun.js. `fetchAdpUnit` below is the `fetch`: it calls
 * FFC, applies the wipe guard (#747, decision 5), and - only once the guard
 * passes - reads the roster and builds the matches, all outside any
 * transaction. `applyAdpUnit` is the `apply`: the NULL-then-set, inside the
 * transaction `runSyncJob` opens under `PLAYERS_BULK_WRITE_LOCK`. The three
 * resolved/thrown shapes below (ok body, thin-market body, thrown
 * bad_response) are unchanged for every caller (scheduler.js, admin.router.js,
 * scoring.router.js) - only where the shape is written moved.
 */
async function syncAdp({ format = 'half-ppr', teams = 12, year } = {}) {
  const fmt = VALID_FORMATS.has(format) ? format : 'half-ppr';

  const result = await runSyncJob({
    job: 'adp',
    lock: PLAYERS_BULK_WRITE_LOCK,
    fetch: () => fetchAdpUnit(fmt, teams, year),
    apply: (client, unit) => applyAdpUnit(client, unit),
  });

  if (result && result.refused) {
    const detail = result.detail || {};
    return {
      ok: false,
      skipped: true,
      reason: result.reason,
      format: fmt,
      teams,
      adpPlayers: detail.adpPlayers || 0,
      // thin_market never reads the roster, so its detail carries no
      // `matched` and this stays 0; thin_match carries the measured count
      // that tripped the refusal (#1227).
      playersMatched: detail.matched != null ? detail.matched : 0,
      playersUpdated: 0,
    };
  }

  return {
    ok: true,
    format: fmt,
    teams,
    adpPlayers: result.adpPlayers,
    playersMatched: result.matched,
    playersUpdated: result.matched,
  };
}

/**
 * `fetch()` for the ADP job (ADR 0036): the FFC call, the response-shape
 * guard, and - because both must happen before any transaction opens - the
 * wipe guard and the roster read/match that used to run between the guard and
 * `withTransaction` in this function. A non-2xx or throwing FFC call is an
 * untagged throw, tagged `fetch_failed` by `runSyncJob`; an unexpected body
 * shape is pre-tagged `bad_response` (statusCode 502) here, same as before.
 *
 * THE WIPE GUARD (#747, decision 5, amended 2026-09-11). The apply step NULLs
 * every ADP before setting the matched values, so a Success body with too
 * few USABLE entries, or too few of those entries that actually MATCH a
 * roster row, would empty the whole market either way. Two checks, one
 * constant:
 * - too few usable entries is a refusal before the roster is even read:
 *   nothing is written to players, and `runSyncJob` records the run
 *   ok=false with reason 'refused' and `thin_market` as the refusalReason,
 *   `adpPlayers` carried through in `detail` (#1197 R3).
 * - enough usable entries but too few of them matching a roster row (an
 *   upstream name-format or team-code change would do it) is also a
 *   refusal, `thin_match`, checked after `buildAdpUpdates` runs: nothing is
 *   written to players, and `runSyncJob` records ok=false with
 *   refusalReason 'thin_match', `adpPlayers` and `matched` both carried
 *   through in `detail`. A match-ratio guard was considered and rejected
 *   (#1227): one constant, one floor, read by every gate.
 */
async function fetchAdpUnit(fmt, teams, year) {
  const api = adpClient();
  const params = { teams };
  if (year) params.year = year;
  const resp = await api.get(`/${fmt}`, { params });

  const body = resp.data || {};
  if (body.status !== 'Success' || !Array.isArray(body.players)) {
    const err = new Error(`unexpected ADP response (status=${body.status})`);
    err.statusCode = 502;
    err.syncFailureReason = 'bad_response';
    throw err;
  }

  const entries = [];
  for (const raw of body.players) {
    const e = normalizeAdpEntry(raw);
    if (e) entries.push(e);
  }

  if (entries.length < MARKET_FLOOR) {
    // Log the refusal HERE, not only through the recorded row. That record is
    // best-effort, and during the carve-out window before the migration is
    // applied data_sync_runs does not exist, so the INSERT is swallowed. Without
    // this line a market-emptying upstream body would be refused with no record
    // anywhere, while the draft-start gate blocks starts league-wide - drafts
    // failing everywhere with an unlogged cause (#747 review 750-f1).
    console.warn(
      `ADP sync refused: ${entries.length} usable entries is below the ${MARKET_FLOOR}-player market floor; players left unchanged`
    );
    return { refused: true, reason: 'thin_market', detail: { adpPlayers: entries.length } };
  }

  const players = await pool.query(`SELECT "id", "name", "position", "nfl_team" FROM "players"`);
  const updates = buildAdpUpdates(players.rows, entries);

  if (updates.length < MARKET_FLOOR) {
    // The entries guard above only proves FFC sent enough well-formed rows;
    // it says nothing about whether those rows hit our roster. A mass
    // name-format or team-code mismatch upstream would pass that guard and
    // then wipe the market down to whatever the (few or zero) matches leave
    // behind. Refuse the same way the entries guard does: log here (the
    // record is best-effort and the table may not exist yet), write nothing.
    console.warn(
      `ADP sync refused: ${updates.length} matched players is below the ${MARKET_FLOOR}-player market floor (of ${entries.length} usable entries); players left unchanged`
    );
    return { refused: true, reason: 'thin_match', detail: { adpPlayers: entries.length, matched: updates.length } };
  }

  return [{ entries, updates }];
}

/**
 * `apply(client, unit)` for the ADP job: runs inside `runSyncJob`'s
 * `withTransaction`, after the module has already taken
 * `PLAYERS_BULK_WRITE_LOCK` on this client. Returns exactly the shape
 * recorded as this run's `data_sync_runs` detail on success, and read back by
 * `syncAdp` to build its own resolved body: `{ adpPlayers, matched }`.
 *
 * Full reset-and-set in two bulk statements (one round trip each) so it stays
 * fast over the pooler and a player who fell out of the top ~200 loses a
 * stale ADP. The two statements run in ONE transaction on one checked-out
 * client (#882): as two separate autocommit pool queries there was a window
 * between the NULL wipe and the bulk set in which zero players carried an ADP,
 * and any concurrent reader of the market count (the scheduled-draft sweep, a
 * manual startDraft) that landed in it would see an empty market on a fully
 * loaded system - the sweep then sends a spurious draft_no_market notification.
 * Wrapped in a transaction, a concurrent reader sees the old count or the new
 * one under MVCC and never 0.
 *
 * SERIALIZED WITH syncInjuries (#904). Holding the wipe's row locks across the
 * bulk set (which locks target rows in a different order) would otherwise
 * permit a deadlock cycle with syncInjuries (scoring.service.js), which locks
 * near the whole players table FOR UPDATE in its own scan order and holds to
 * commit. Both writers take a single transaction-scoped advisory lock
 * (PLAYERS_BULK_WRITE_LOCK), taken by `runSyncJob` as the FIRST statement
 * after BEGIN, before any row lock here, so the two runs cannot interleave and
 * cannot form the cycle. It is the BLOCKING xact form (pg_advisory_xact_lock):
 * the second sync waits rather than skipping. That wait ends when the other
 * sync's transaction finishes (no network I/O runs inside either transaction,
 * so it is short) OR when statement_timeout fires, whichever comes first:
 * every pooled connection sets statement_timeout (pool.js, 15s web / 30s
 * worker), and it counts lock-wait time, so a lock blocked past the limit is
 * CANCELLED with SQLSTATE 57014, not parked. 57014 is not in dbRetry's
 * TRANSIENT_CODES, so that sync fails (rolls back to the previous ADP values,
 * records ok=false) rather than retrying. Both sides of this lock now hold it
 * for a small, fixed number of statements across their whole transaction -
 * this wipe plus one bulk set, and syncInjuries' scan, one bulk set, and its
 * IR flag pass (#929) - so a wait long enough to reach the timeout is
 * unlikely to arise. Either way the xact scope releases the lock, so there is
 * no explicit unlock that could strand it behind Supavisor's transaction
 * pooling the way a session lock did in #839.
 */
async function applyAdpUnit(client, { entries, updates }) {
  await client.query(`UPDATE "players" SET "adp" = NULL WHERE "adp" IS NOT NULL`);
  if (updates.length > 0) {
    await client.query(
      `UPDATE "players" p SET "adp" = v.adp
       FROM (SELECT unnest($1::int[]) AS id, unnest($2::numeric[]) AS adp) v
       WHERE p."id" = v.id`,
      [updates.map((u) => u.id), updates.map((u) => u.adp)]
    );
  }
  return { adpPlayers: entries.length, matched: updates.length };
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
