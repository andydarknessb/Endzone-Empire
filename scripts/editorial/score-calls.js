'use strict';

/**
 * Scores a week's Editorial calls (CONTEXT.md "Editorial call") against actual
 * points and against the engine's own pre-kickoff PPR read. Read-only: one
 * `BEGIN READ ONLY` transaction on DATABASE_URL, rolled back. Writes nothing.
 *
 *   node scripts/editorial/score-calls.js --calls <path> [--json]
 *
 * Inputs the engine side reads:
 *  - Engine: the on-time (`NOT is_late`) `capture_kind = 'scheduled'` snapshot
 *    for the file's season/week under the PPR preset (`projection_snapshots` +
 *    `projection_snapshot_players`), point estimate via `pointEstimateFor`. A
 *    player with no child row is reported as missing; the live projection run
 *    is never consulted.
 *  - Actuals: `player_stats.stats` re-priced with `calculateFantasyPoints`
 *    under the PPR preset (never the stored `fantasy_points` column). No stat
 *    row scores 0.
 *  - Inactive = no Appearance: no stat row, or a stat line with every figure
 *    zero (`decision.service.madeAppearance`). The ledger carries no
 *    post-game active flag, so that is the only signal there is.
 *
 * Positional finish = 1 + the count of players at that position with strictly
 * more actual points, over every `player_stats` row at the position that week
 * plus every ledger row at it (absent stats = 0). The same universe ranks the
 * engine: its call is START when its estimate ranks inside the position
 * cutoff among that week's ledger rows at the position, else SIT.
 */

const fs = require('fs');
const { spearman } = require('../backtest/lib/metrics');

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DEF'];

/** Pure: 1-based rank of `points` in `values` (descending), ties share the best rank. */
function finishOf(points, values) {
  return 1 + values.filter((v) => v > points).length;
}

/**
 * Pure: does one call hit? `null` when voided. START/FLEX hit when the player
 * appeared and finished inside the cutoff; SIT/OUT hit when he finished
 * outside it or did not appear. A conditional "if active" call on a player
 * who did not appear is void, not a miss.
 */
function judge({ verdict, condition, finish, cutoff, appeared }) {
  if (condition === 'if active' && !appeared) return null;
  const inside = appeared && finish <= cutoff;
  return verdict === 'START' || verdict === 'FLEX' ? inside : !inside;
}

/**
 * Pure: rho of the editorial order and of the engine's order vs actual points,
 * over the players in both the ranking and the ledger (the same set).
 */
function rankingRho(ranking, ledger, actuals) {
  const rows = ranking.filter((r) => ledger.has(r.playerId));
  const act = (r) => (actuals.get(r.playerId) || { points: 0 }).points;
  return {
    n: rows.length,
    missing: ranking.filter((r) => !ledger.has(r.playerId)).map((r) => r.name),
    editorialRho: spearman(rows.map((r) => -r.rank), rows.map(act)),
    engineRho: spearman(rows.map((r) => ledger.get(r.playerId).estimate), rows.map(act)),
  };
}

/**
 * Pure: the whole scoring. `ledger`: Map playerId -> { position, estimate };
 * `actuals`: Map playerId -> { position, points, appeared }.
 */
function scoreCalls(file, ledger, actuals) {
  const cutoffs = file.cutoffs;
  const pool = {};
  for (const pos of POSITIONS) {
    pool[pos] = new Map();
    for (const [id, l] of ledger) if (l.position === pos) pool[pos].set(id, 0);
    for (const [id, a] of actuals) if (a.position === pos) pool[pos].set(id, a.points);
  }
  const engineEstimates = (pos) => [...ledger.values()].filter((l) => l.position === pos && l.estimate != null).map((l) => l.estimate);

  const calls = file.calls.map((c) => {
    const a = actuals.get(c.playerId) || { points: 0, appeared: false };
    const cutoff = cutoffs[c.position];
    const finish = finishOf(a.points, [...pool[c.position].values()]);
    const editorialHit = judge({ ...c, finish, cutoff, appeared: a.appeared });
    const l = ledger.get(c.playerId);
    const engineMissing = !l || l.estimate == null;
    const engineRank = engineMissing ? null : finishOf(l.estimate, engineEstimates(c.position));
    const engineCall = engineMissing ? null : (engineRank <= cutoff ? 'START' : 'SIT');
    const engineHit = engineMissing || editorialHit === null
      ? null
      : judge({ verdict: engineCall, condition: null, finish, cutoff, appeared: a.appeared });
    return {
      id: c.id, name: c.name, position: c.position, verdict: c.verdict, condition: c.condition,
      actual: a.points, appeared: a.appeared, finish, editorialHit,
      engineEstimate: engineMissing ? null : l.estimate, engineRank, engineCall, engineHit,
    };
  });

  const counted = calls.filter((c) => c.editorialHit !== null);
  const paired = counted.filter((c) => c.engineHit !== null);
  const hits = (list, key) => list.filter((c) => c[key]).length;
  const rankings = {};
  for (const pos of POSITIONS) {
    if (file.rankings[pos]) rankings[pos] = rankingRho(file.rankings[pos], ledger, actuals);
  }
  return {
    rankings,
    calls,
    summary: {
      calls: calls.length,
      void: calls.length - counted.length,
      engineMissing: calls.filter((c) => c.engineRank === null).map((c) => c.name),
      editorial: { n: counted.length, hits: hits(counted, 'editorialHit') },
      paired: { n: paired.length, editorialHits: hits(paired, 'editorialHit'), engineHits: hits(paired, 'engineHit') },
    },
  };
}

/** Thin DB loader: the on-time scheduled PPR capture and the re-priced actuals for one week. */
async function load({ season, week }) {
  const pool = require('../../server/modules/pool');
  const model = require('../../server/services/projectionModel');
  const { pointEstimateFor } = require('../../server/services/projection.service');
  const { SCORING_PRESETS, calculateFantasyPoints } = require('../../server/services/scoringRules');
  const { madeAppearance } = require('../../server/services/decision.service');
  const rules = SCORING_PRESETS.ppr;
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const head = await client.query(
      `SELECT "id", "model_version", "captured_at", "capture_not_after"
       FROM "projection_snapshots"
       WHERE "season" = $1 AND "week" = $2 AND "scoring_profile" = 'ppr' AND "scoring_hash" = $3
         AND "capture_kind" = 'scheduled' AND NOT "is_late"
       ORDER BY "captured_at" DESC LIMIT 1`,
      [season, week, model.scoringHash(rules)]
    );
    if (head.rows.length === 0) return { capture: null };
    const [h] = head.rows;
    const rows = await client.query(
      `SELECT "player_id", "position", "mean", "median" FROM "projection_snapshot_players" WHERE "snapshot_id" = $1`,
      [h.id]
    );
    // numeric columns arrive as strings: coerce, or the rank comparisons go lexicographic
    const num = (v) => (v == null ? null : Number(v));
    const ledger = new Map(rows.rows.map((r) => [r.player_id, {
      position: r.position,
      estimate: num(pointEstimateFor({ mean: num(r.mean), median: num(r.median), modelVersion: h.model_version })),
    }]));
    const stats = await client.query(
      `SELECT s."player_id", p."position", s."stats" FROM "player_stats" s
       JOIN "players" p ON p."id" = s."player_id"
       WHERE s."season" = $1 AND s."week" = $2 AND p."position" = ANY($3::text[])`,
      [season, week, POSITIONS]
    );
    const actuals = new Map(stats.rows.map((r) => [r.player_id, {
      position: r.position,
      points: calculateFantasyPoints(r.stats, rules),
      appeared: madeAppearance(r.stats),
    }]));
    return { capture: h, ledger, actuals };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
}

const f2 = (v) => (v == null ? '-' : Number(v).toFixed(2));
const pct = (h, n) => (n ? `${h}/${n} (${Math.round((100 * h) / n)}%)` : '0/0');

function render(file, capture, r) {
  const out = [`Editorial calls: ${file.article} (season ${file.season}, week ${file.week}, ${file.scoring})`];
  out.push(`Engine capture: model ${capture.model_version}, captured ${new Date(capture.captured_at).toISOString()}, scheduled arm, PPR`);
  out.push('', 'Rankings (Spearman rho vs actual points, same player set)');
  for (const [pos, x] of Object.entries(r.rankings)) {
    out.push(`  ${pos.padEnd(3)} n=${String(x.n).padEnd(2)} editorial ${f2(x.editorialRho)}  engine ${f2(x.engineRho)}${x.missing.length ? `  no ledger row: ${x.missing.join(', ')}` : ''}`);
  }
  out.push('', 'Calls');
  out.push('  id   name                    pos verdict cond       actual fin  app  ed    eng-call eng-est eng-rk eng');
  const mark = (h) => (h === null ? 'void' : h ? 'HIT' : 'miss');
  for (const c of r.calls) {
    out.push(`  ${c.id.padEnd(4)} ${c.name.slice(0, 23).padEnd(23)} ${c.position.padEnd(3)} ${c.verdict.padEnd(7)} ${(c.condition || '').padEnd(9)} ${f2(c.actual).padStart(6)} ${String(c.finish).padStart(4)}  ${c.appeared ? 'yes' : 'no '}  ${mark(c.editorialHit).padEnd(5)} ${(c.engineCall || 'MISSING').padEnd(8)} ${f2(c.engineEstimate).padStart(6)} ${String(c.engineRank ?? '-').padStart(5)}  ${c.engineHit === null ? '-' : mark(c.engineHit)}`);
  }
  const s = r.summary;
  out.push('', `Void (if-active, did not appear): ${s.void}. Engine row missing: ${s.engineMissing.length ? s.engineMissing.join(', ') : 'none'}.`);
  out.push(`Editorial, all non-void calls: ${pct(s.editorial.hits, s.editorial.n)}`);
  out.push(`Same non-void calls with an engine row (n=${s.paired.n}): editorial ${pct(s.paired.editorialHits, s.paired.n)}, engine ${pct(s.paired.engineHits, s.paired.n)}`);
  return out.join('\n');
}

async function main(argv) {
  const at = argv.indexOf('--calls');
  if (at < 0 || !argv[at + 1]) throw new Error('score-calls: --calls <path> is required');
  const file = JSON.parse(fs.readFileSync(argv[at + 1], 'utf8'));
  if (file.scoring !== 'ppr') throw new Error('score-calls: only scoring "ppr" is supported');
  if (!process.env.DATABASE_URL) {
    try { process.loadEnvFile(); } catch (e) { /* no .env in cwd; the pool reports a missing URL */ }
  }
  const { capture, ledger, actuals } = await load(file);
  if (!capture) throw new Error(`score-calls: no on-time scheduled PPR capture for ${file.season} week ${file.week}`);
  const result = scoreCalls(file, ledger, actuals);
  console.log(argv.includes('--json')
    ? JSON.stringify({ article: file.article, capture, ...result }, null, 2)
    : render(file, capture, result));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { finishOf, judge, rankingRho, scoreCalls, spearman };
