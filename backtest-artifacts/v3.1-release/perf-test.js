/* Read-only performance checks for the v3.1 release.
 * 1. League scan latency with vs without ORDER BY (worst realistic case).
 * 2. EXPLAIN (no ANALYZE — nothing executes) for the new DELETE predicate.
 * 3. End-to-end generateProjections latency for a heavy week (cold-cache cost). */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
require(path.join(REPO, 'node_modules', 'dotenv')).config({ path: path.join(REPO, '.env') });
const pool = require(path.join(REPO, 'server/modules/pool'));
const projection = require(path.join(REPO, 'server/services/projection.service'));
const model = require(path.join(REPO, 'server/services/projectionModel'));
const { SCORING_RULES } = require(path.join(REPO, 'server/services/scoring.service'));

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const SCAN = (orderBy) => `
  SELECT "ps"."player_id", "ps"."week", "ps"."stats", "p"."position",
         fn_normalize_nfl_team("ng"."opponent") AS "defense", "ng"."home_away"
  FROM "player_stats" "ps"
  JOIN "players" "p" ON "p"."id" = "ps"."player_id"
  LEFT JOIN "nfl_games" "ng" ON "ng"."season" = "ps"."season" AND "ng"."week" = "ps"."week"
    AND fn_normalize_nfl_team("ng"."nfl_team") = fn_normalize_nfl_team("p"."nfl_team")
  WHERE "ps"."season" = $1 AND "ps"."week" < $2 AND "p"."position" = ANY($3::text[])
  ${orderBy ? 'ORDER BY "ps"."player_id", "ps"."week"' : ''}
  LIMIT $4`;

async function timeQuery(label, sql, params, reps) {
  const times = [];
  for (let i = 0; i < reps; i++) {
    const t0 = process.hrtime.bigint();
    const r = await pool.query(sql, params);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (i === 0) console.log(`  ${label}: ${r.rows.length} rows`);
  }
  times.sort((a, b) => a - b);
  console.log(`  ${label}: min=${times[0].toFixed(0)}ms median=${times[Math.floor(reps / 2)].toFixed(0)}ms max=${times[reps - 1].toFixed(0)}ms (${reps} reps)`);
}

(async () => {
  try {
    console.log('=== 1. League scan: ORDER BY cost (season 2024, week 18 = worst case) ===');
    const params = [2024, 18, POSITIONS, 60000];
    await timeQuery('without ORDER BY', SCAN(false), params, 5);
    await timeQuery('with ORDER BY   ', SCAN(true), params, 5);

    console.log('\n=== 2. EXPLAIN of the invalidation DELETE (plan only, nothing executed) ===');
    const plan = await pool.query(
      `EXPLAIN DELETE FROM "projection_runs"
       WHERE "season" = $1 AND "week" >= $2 AND "model_version" = $3`,
      [2025, 10, model.MODEL_VERSION]
    );
    for (const row of plan.rows) console.log('  ' + row['QUERY PLAN']);

    console.log('\n=== 3. Cold-cache generateProjections, 2024 week 18 (heaviest bundle) ===');
    const cohort = await pool.query(
      `SELECT "ps"."player_id" FROM "player_stats" "ps"
       JOIN "players" "p" ON "p"."id" = "ps"."player_id"
       WHERE "ps"."season" = 2024 AND "ps"."week" = 18 AND "p"."position" = ANY($1::text[])
       ORDER BY "ps"."player_id"`,
      [POSITIONS]
    );
    const playerIds = cohort.rows.map((r) => r.player_id);
    const hashValue = model.scoringHash(SCORING_RULES);
    for (let i = 0; i < 3; i++) {
      const t0 = process.hrtime.bigint();
      await projection.generateProjections({
        season: 2024, week: 18, rules: SCORING_RULES, playerIds, hashValue, weatherService: false,
      });
      console.log(`  run ${i + 1}: ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)}ms for ${playerIds.length} players`);
    }
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
})();
