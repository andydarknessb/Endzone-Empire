/* Read-only data checks reproducing the external review's measurements.
 * No writes: SELECT-only SQL plus in-process lineup assignment. */
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
require(path.join(REPO, 'node_modules', 'dotenv')).config({ path: path.join(REPO, '.env') });

const pool = require(path.join(REPO, 'server/modules/pool'));
const { SCORING_RULES, calculateFantasyPoints } = require(path.join(REPO, 'server/services/scoring.service'));
const { DEFAULT_ROSTER_SLOTS } = require(path.join(REPO, 'server/services/lineup.service'));
const { optimalAssignment } = require(path.join(REPO, 'server/services/lineupOptimizer'));

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const SEASONS = [2024, 2025];
const WEEKS = Array.from({ length: 17 }, (_, i) => i + 2); // 2..18, backtest default

async function checkA() {
  const { rows } = await pool.query(
    `SELECT "ps"."season",
            COUNT(*)::int AS "total_rows",
            COUNT(*) FILTER (WHERE "ps"."stats" ? 'gameTeam')::int AS "with_game_team",
            COUNT(*) FILTER (
              WHERE "ps"."stats" ? 'gameTeam'
                AND fn_normalize_nfl_team("ps"."stats"->>'gameTeam')
                    IS DISTINCT FROM fn_normalize_nfl_team("p"."nfl_team")
            )::int AS "team_mismatch"
     FROM "player_stats" "ps"
     JOIN "players" "p" ON "p"."id" = "ps"."player_id"
     WHERE "ps"."season" = ANY($1::int[])
     GROUP BY "ps"."season" ORDER BY "ps"."season"`,
    [SEASONS]
  );
  console.log('\n=== A. stored gameTeam vs today\'s players.nfl_team ===');
  for (const r of rows) {
    console.log(`  ${r.season}: ${r.team_mismatch}/${r.with_game_team} enriched rows mismatch (total rows ${r.total_rows})`);
  }
}

async function checkB() {
  console.log('\n=== B. lineup-regret roster fill (first 16 by player_id, 9 default slots) ===');
  const slotCount = DEFAULT_ROSTER_SLOTS.reduce((s, x) => s + x.count, 0);
  let evaluated = 0;
  let unfilled = 0;
  const detail = [];
  for (const season of SEASONS) {
    for (const week of WEEKS) {
      const { rows } = await pool.query(
        `SELECT "ps"."player_id", "ps"."stats", "p"."position"
         FROM "player_stats" "ps"
         JOIN "players" "p" ON "p"."id" = "ps"."player_id"
         WHERE "ps"."season" = $1 AND "ps"."week" = $2 AND "p"."position" = ANY($3::text[])
         ORDER BY "ps"."player_id"`,
        [season, week, POSITIONS]
      );
      if (rows.length === 0) continue; // week never played -> no observations at all
      const roster = rows
        .map((r) => ({ playerId: r.player_id, position: r.position, actual: calculateFantasyPoints(r.stats, SCORING_RULES) }))
        .sort((a, b) => a.playerId - b.playerId)
        .slice(0, 16);
      if (roster.length < DEFAULT_ROSTER_SLOTS.length) continue; // script's own skip rule
      evaluated += 1;
      const candidates = roster.map((o) => ({ playerId: o.playerId, position: o.position }));
      const actual = new Map(roster.map((o) => [o.playerId, o.actual]));
      const best = optimalAssignment({ rosterSlots: DEFAULT_ROSTER_SLOTS, candidates, pointsFor: actual });
      const filled = best.assignments.filter((a) => a.playerId != null).length;
      const byPos = {};
      for (const c of candidates) byPos[c.position] = (byPos[c.position] || 0) + 1;
      if (filled < slotCount) {
        unfilled += 1;
        detail.push(`    ${season} w${String(week).padStart(2)}: filled ${filled}/${slotCount}  roster mix ${JSON.stringify(byPos)}`);
      }
    }
  }
  console.log(`  evaluated roster-weeks: ${evaluated}; with unfilled slots: ${unfilled}`);
  for (const line of detail) console.log(line);
}

async function checkC() {
  const { rows } = await pool.query(
    `SELECT "ps"."season",
            COUNT(*) FILTER (WHERE "ps"."stats" ? 'gameOpponent')::int AS "with_opponent",
            COUNT(*) FILTER (
              WHERE "ps"."stats" ? 'gameOpponent' AND "ng"."opponent" IS NOT NULL
                AND fn_normalize_nfl_team("ps"."stats"->>'gameOpponent')
                    IS DISTINCT FROM fn_normalize_nfl_team("ng"."opponent")
            )::int AS "contradicted_rows",
            COUNT(DISTINCT "ps"."player_id") FILTER (
              WHERE "ps"."stats" ? 'gameOpponent' AND "ng"."opponent" IS NOT NULL
                AND fn_normalize_nfl_team("ps"."stats"->>'gameOpponent')
                    IS DISTINCT FROM fn_normalize_nfl_team("ng"."opponent")
            )::int AS "players_affected"
     FROM "player_stats" "ps"
     JOIN "players" "p" ON "p"."id" = "ps"."player_id"
     LEFT JOIN "nfl_games" "ng" ON "ng"."season" = "ps"."season" AND "ng"."week" = "ps"."week"
       AND fn_normalize_nfl_team("ng"."nfl_team") = fn_normalize_nfl_team("p"."nfl_team")
     WHERE "ps"."season" = ANY($1::int[])
     GROUP BY "ps"."season" ORDER BY "ps"."season"`,
    [SEASONS]
  );
  console.log('\n=== C. a404cf0 contradiction-check scope on the SAME-SEASON (default) path ===');
  console.log('  (rows where the schedule opponent via the player\'s CURRENT team disagrees with stored gameOpponent)');
  for (const r of rows) {
    console.log(`  ${r.season}: ${r.contradicted_rows}/${r.with_opponent} enriched rows would trip it, across ${r.players_affected} players`);
  }
}

(async () => {
  try {
    await checkA();
    await checkB();
    await checkC();
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exit(1);
  }
})();
