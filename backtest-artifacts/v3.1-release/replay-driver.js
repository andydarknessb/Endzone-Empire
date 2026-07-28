/* Paired-replay driver: per-player default-config projections from ONE checkout.
 * Usage: node replay-driver.js <repoRoot> <outFile> <season> [<season>...]
 * Read-only: generateProjections computes without touching cache tables. */
const path = require('path');
const fs = require('fs');

const root = process.argv[2];
const outFile = process.argv[3];
const seasons = process.argv.slice(4).map(Number);
if (!root || !outFile || seasons.length === 0) {
  console.error('usage: node replay-driver.js <repoRoot> <outFile> <season>...');
  process.exit(2);
}

require(path.join(root, 'node_modules', 'dotenv')).config({ path: 'c:/Users/Cory/Endzone-Empire/.env' });
const pool = require(path.join(root, 'server', 'modules', 'pool'));
const projection = require(path.join(root, 'server', 'services', 'projection.service'));
const model = require(path.join(root, 'server', 'services', 'projectionModel'));
const { rulesForLeague, SCORING_RULES } = require(path.join(root, 'server', 'services', 'scoring.service'));

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const WEEKS = Array.from({ length: 17 }, (_, i) => i + 2);

(async () => {
  try {
    const rules = rulesForLeague(null) || SCORING_RULES;
    const hashValue = model.scoringHash(rules);
    const rows = [];
    for (const season of seasons) {
      for (const week of WEEKS) {
        const cohort = await pool.query(
          `SELECT "ps"."player_id" FROM "player_stats" "ps"
           JOIN "players" "p" ON "p"."id" = "ps"."player_id"
           WHERE "ps"."season" = $1 AND "ps"."week" = $2 AND "p"."position" = ANY($3::text[])
           ORDER BY "ps"."player_id"`,
          [season, week, POSITIONS]
        );
        const playerIds = cohort.rows.map((r) => r.player_id);
        if (playerIds.length === 0) continue;
        const run = await projection.generateProjections({
          season, week, rules, playerIds, hashValue, weatherService: false,
        });
        for (const pid of playerIds) {
          const p = run.projections.get(pid);
          const vs = p && p.factors && p.factors.versusOpponent ? p.factors.versusOpponent : null;
          rows.push([
            season, week, pid,
            p ? p.mean : null, p ? p.median : null, p ? p.p10 : null, p ? p.p90 : null,
            vs ? (vs.meetings == null ? null : vs.meetings) : null,
            vs ? (vs.pointsContribution == null ? null : vs.pointsContribution) : null,
          ]);
        }
        console.log(`  ${season} w${week}: ${playerIds.length} players`);
      }
    }
    fs.writeFileSync(outFile, JSON.stringify({ modelVersion: model.MODEL_VERSION, rows }));
    console.log(`wrote ${rows.length} rows -> ${outFile}`);
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
})();
