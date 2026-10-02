/* eslint-disable no-console */
/**
 * Backfill stats.gameTeam / stats.gameOpponent on player_stats rows that lack
 * them (holdout-confirm-2026 DEVIATIONS entry 6; ruling 2026-10-02 R4).
 *
 * The team and opponent come ONLY from the nflverse stats_player_week row for
 * that player's (season, week), in nflverse spelling (WAS, not WSH), exactly as
 * normalizeNflversePlayerStats writes them. Never from players.nfl_team. A row
 * with no nflverse match (or a blank team in the file) is skipped and listed.
 *
 * Dry run by default: prints the plan and a summary, writes nothing. `--apply`
 * writes through the one funnel (upsertPlayerStats, source 'nflverse-week',
 * which owns exactly gameTeam/gameOpponent here), so fantasy_points are
 * recomputed by the same function every writer uses; it never creates a row
 * and never changes a scored key. A row whose recomputed fantasy_points would
 * differ from the stored value is refused (reported, not written). `--apply`
 * needs --pre-correction-out so the prior rows are saved first.
 *
 * Usage:
 *   node scripts/backfill-stats-gameteam.js [--season N] [--week N]...
 *       [--pre-correction-out FILE] [--apply]
 *
 * Defaults: season 2026, every week. Runs against whatever DATABASE_URL points at.
 */
require('dotenv').config();

const fs = require('fs');
const pool = require('../server/modules/pool');
const { withTransaction } = require('../server/modules/withTransaction');
const nflverse = require('../server/services/nflverseSync.service');
const { upsertPlayerStats, storedStatLine } = require('../server/services/playerStatsWrite.service');
const { calculateFantasyPoints } = require('../server/services/scoringRules');

const blank = (v) => v === undefined || v === null || String(v).trim() === '';

function parseArgs(argv) {
  const args = { season: 2026, weeks: [], apply: false, preOut: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--apply') args.apply = true;
    else if (token === '--season') args.season = Number(argv[++i]);
    else if (token.startsWith('--season=')) args.season = Number(token.split('=')[1]);
    else if (token === '--week') args.weeks.push(Number(argv[++i]));
    else if (token.startsWith('--week=')) args.weeks.push(Number(token.split('=')[1]));
    else if (token === '--pre-correction-out') args.preOut = argv[++i];
    else if (token.startsWith('--pre-correction-out=')) args.preOut = token.split('=')[1];
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!Number.isInteger(args.season)) throw new Error('--season must be an integer');
  if (args.weeks.some((w) => !Number.isInteger(w) || w < 1 || w > 18)) throw new Error('--week must be an integer 1-18');
  if (args.apply && !args.preOut) throw new Error('--apply needs --pre-correction-out FILE (the prior rows are saved first)');
  return args;
}

/**
 * Pure: which rows get which gameTeam/gameOpponent.
 *
 * `rows`: { id, playerId, name, externalId, season, week, stats } (the player's
 * ESPN id as externalId). `nflverseRows`: the parsed stats_player_week file.
 * `gsisToEspn`: the players.csv crosswalk. Returns
 * `{ changes: [{ rowId, playerId, name, season, week, gameTeam, gameOpponent }],
 *    skipped: [{ rowId, playerId, name, season, week, reason }] }`.
 * Only rows with no gameTeam are considered; gameOpponent is filled only when
 * it is missing too. A key the file leaves blank is left out of the change.
 */
function planGameTeamBackfill({ rows, nflverseRows, gsisToEspn }) {
  const byEspnWeek = new Map();
  for (const r of nflverseRows) {
    if (r.season_type !== 'REG' || !r.player_id || r.player_id === '0') continue;
    const espn = gsisToEspn.get(r.player_id);
    if (!espn) continue;
    const key = `${espn}:${Number(r.season)}:${Number(r.week)}`;
    byEspnWeek.set(key, [...(byEspnWeek.get(key) || []), r]);
  }
  const changes = [];
  const skipped = [];
  for (const row of rows) {
    const stats = row.stats || {};
    if (!blank(stats.gameTeam)) continue;
    const who = { rowId: row.id, playerId: row.playerId, name: row.name, season: row.season, week: row.week };
    const matches = byEspnWeek.get(`${row.externalId}:${Number(row.season)}:${Number(row.week)}`) || [];
    if (matches.length === 0) { skipped.push({ ...who, reason: 'no nflverse stats_player_week row' }); continue; }
    if (matches.length > 1) { skipped.push({ ...who, reason: 'more than one nflverse row' }); continue; }
    const gameTeam = nflverse.optionalTeamAbbr(matches[0].team);
    if (!gameTeam) { skipped.push({ ...who, reason: 'blank team in nflverse row' }); continue; }
    const gameOpponent = blank(stats.gameOpponent) ? nflverse.optionalTeamAbbr(matches[0].opponent_team) : null;
    changes.push({ ...who, gameTeam, gameOpponent });
  }
  return { changes, skipped };
}

/** The fresh patch one planned change hands the funnel (a blank opponent is left out). */
const freshFor = (c) => ({ gameTeam: c.gameTeam, ...(c.gameOpponent ? { gameOpponent: c.gameOpponent } : {}) });

async function loadRows({ season, weeks }) {
  const res = await pool.query(
    `SELECT ps."id", ps."player_id", ps."season", ps."week", ps."stats", ps."fantasy_points", p."name", p."external_id"
       FROM "player_stats" ps JOIN "players" p ON p."id" = ps."player_id"
      WHERE ps."season" = $1 AND ($2::int[] IS NULL OR ps."week" = ANY($2::int[]))
        AND COALESCE(ps."stats"->>'gameTeam', '') = ''
      ORDER BY ps."week", ps."id"`,
    [season, weeks.length > 0 ? weeks : null]
  );
  return res.rows.map((r) => ({
    id: r.id, playerId: r.player_id, name: r.name, externalId: r.external_id === null ? null : String(r.external_id),
    season: r.season, week: r.week, stats: r.stats || {}, fantasyPoints: r.fantasy_points,
  }));
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const rows = await loadRows(args);
  const [nflverseRows, crosswalk] = await Promise.all([
    nflverse.fetchPlayerWeekStatsForSeason(args.season),
    nflverse.fetchPlayersCrosswalk(),
  ]);
  const { changes, skipped } = planGameTeamBackfill({ rows, nflverseRows, gsisToEspn: crosswalk });
  const byId = new Map(rows.map((r) => [r.id, r]));

  console.log(`${args.apply ? 'APPLY' : 'DRY RUN'}: season ${args.season}, weeks ${args.weeks.length > 0 ? args.weeks.join(',') : 'all'}`);
  console.log('planned changes (row id, player, season, week, gameTeam, gameOpponent):');
  for (const c of changes) console.log(`  ${c.rowId}\t${c.name}\t${c.season}\twk${c.week}\t${c.gameTeam}\t${c.gameOpponent || '-'}`);
  console.log('skipped (no change planned):');
  for (const s of skipped) console.log(`  ${s.rowId}\t${s.name}\t${s.season}\twk${s.week}\t${s.reason}`);

  // A planned row must be one the funnel leaves score-identical.
  const refused = changes.filter((c) => {
    const row = byId.get(c.rowId);
    const next = storedStatLine({ source: 'nflverse-week', fresh: freshFor(c), prior: row.stats }).stats;
    return Math.abs(calculateFantasyPoints(next) - Number(row.fantasyPoints)) >= 0.005;
  });
  const refusedIds = new Set(refused.map((c) => c.rowId));
  const byWeek = {};
  for (const r of rows) byWeek[r.week] = (byWeek[r.week] || 0) + 1;
  console.log(
    `summary: rows lacking gameTeam=${rows.length} (by week ${JSON.stringify(byWeek)}), planned=${changes.length}, ` +
      `skipped=${skipped.length}, would move fantasy_points (refused)=${refused.length}`
  );

  if (args.preOut) {
    fs.writeFileSync(args.preOut, JSON.stringify(rows.map((r) => ({ id: r.id, fantasy_points: r.fantasyPoints, stats: r.stats })), null, 1));
    console.log(`pre-correction rows (${rows.length}) saved to ${args.preOut}`);
  }
  if (!args.apply) {
    console.log('dry run: nothing written. Re-run with --apply --pre-correction-out FILE to write.');
    return { changes, skipped, written: 0 };
  }

  const todo = changes.filter((c) => !refusedIds.has(c.rowId));
  const written = await withTransaction(pool, async (client) => {
    let n = 0;
    for (const c of todo) {
      // Re-read under a row lock: a live write since the plan must not be clobbered.
      const current = await client.query('SELECT "stats" FROM "player_stats" WHERE "id" = $1 FOR UPDATE', [c.rowId]);
      const prior = current.rows[0] && current.rows[0].stats;
      if (!prior || !blank(prior.gameTeam)) continue;
      const out = await upsertPlayerStats(client, {
        playerId: c.playerId, season: c.season, week: c.week, source: 'nflverse-week', fresh: freshFor(c), prior,
      });
      if (out) n += 1;
    }
    return n;
  }, { label: 'backfill-stats-gameteam' });
  console.log(`applied: ${written} rows`);
  return { changes, skipped, written };
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Backfill failed:', err);
      pool.end().finally(() => process.exit(1));
    });
}

module.exports = { parseArgs, planGameTeamBackfill, main };
