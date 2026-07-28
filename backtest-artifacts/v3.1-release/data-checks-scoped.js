/* Read-only: checks A and C rescoped to the backtest cohort
 * (positions QB/RB/WR/TE/K/DEF, weeks 2-18) with strict null handling. */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
require(path.join(REPO, 'node_modules', 'dotenv')).config({ path: path.join(REPO, '.env') });
const pool = require(path.join(REPO, 'server/modules/pool'));

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

(async () => {
  try {
    const a = await pool.query(
      `SELECT "ps"."season",
              COUNT(*) FILTER (WHERE "ps"."stats"->>'gameTeam' IS NOT NULL)::int AS "with_game_team",
              COUNT(*) FILTER (
                WHERE fn_normalize_nfl_team("ps"."stats"->>'gameTeam') IS NOT NULL
                  AND fn_normalize_nfl_team("p"."nfl_team") IS NOT NULL
                  AND fn_normalize_nfl_team("ps"."stats"->>'gameTeam')
                      <> fn_normalize_nfl_team("p"."nfl_team")
              )::int AS "team_mismatch"
       FROM "player_stats" "ps"
       JOIN "players" "p" ON "p"."id" = "ps"."player_id"
       WHERE "ps"."season" = ANY($1::int[]) AND "ps"."week" BETWEEN 2 AND 18
         AND "p"."position" = ANY($2::text[])
       GROUP BY "ps"."season" ORDER BY "ps"."season"`,
      [[2024, 2025], POSITIONS]
    );
    console.log('=== A (cohort-scoped): gameTeam vs current team, fantasy positions, weeks 2-18 ===');
    for (const r of a.rows) {
      console.log(`  ${r.season}: ${r.team_mismatch}/${r.with_game_team} mismatch`);
    }

    const c = await pool.query(
      `SELECT "ps"."season",
              COUNT(*) FILTER (
                WHERE fn_normalize_nfl_team("ps"."stats"->>'gameOpponent') IS NOT NULL
                  AND fn_normalize_nfl_team("ng"."opponent") IS NOT NULL
              )::int AS "comparable",
              COUNT(*) FILTER (
                WHERE fn_normalize_nfl_team("ps"."stats"->>'gameOpponent') IS NOT NULL
                  AND fn_normalize_nfl_team("ng"."opponent") IS NOT NULL
                  AND fn_normalize_nfl_team("ps"."stats"->>'gameOpponent')
                      <> fn_normalize_nfl_team("ng"."opponent")
              )::int AS "contradicted_rows",
              COUNT(DISTINCT "ps"."player_id") FILTER (
                WHERE fn_normalize_nfl_team("ps"."stats"->>'gameOpponent') IS NOT NULL
                  AND fn_normalize_nfl_team("ng"."opponent") IS NOT NULL
                  AND fn_normalize_nfl_team("ps"."stats"->>'gameOpponent')
                      <> fn_normalize_nfl_team("ng"."opponent")
              )::int AS "players_affected"
       FROM "player_stats" "ps"
       JOIN "players" "p" ON "p"."id" = "ps"."player_id"
       LEFT JOIN "nfl_games" "ng" ON "ng"."season" = "ps"."season" AND "ng"."week" = "ps"."week"
         AND fn_normalize_nfl_team("ng"."nfl_team") = fn_normalize_nfl_team("p"."nfl_team")
       WHERE "ps"."season" = ANY($1::int[]) AND "ps"."week" BETWEEN 2 AND 18
         AND "p"."position" = ANY($2::text[])
       GROUP BY "ps"."season" ORDER BY "ps"."season"`,
      [[2024, 2025], POSITIONS]
    );
    console.log('\n=== C (cohort-scoped): same-season contradiction trips, fantasy positions, weeks 2-18 ===');
    for (const r of c.rows) {
      console.log(`  ${r.season}: ${r.contradicted_rows}/${r.comparable} rows, ${r.players_affected} players`);
    }
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exit(1);
  }
})();
