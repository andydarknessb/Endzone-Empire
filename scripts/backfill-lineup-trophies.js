/* eslint-disable no-console */
/**
 * One-time backfill (#1864): Perfect Lineup, Captain Hindsight and the
 * points-left analytics row for every already-advanced week of one season, in
 * every manager-set-lineup league, judged on scores as they stand today.
 *
 * Writes only through the lineup pass Advance week runs
 * (trophy.service.awardLineupTrophies, weekly only), so a re-run adds nothing.
 * It rebuilds no Recap, sends no digest, notifies nobody and never reads or
 * writes called or override rows. A week is "advanced" when its matchups are
 * final, which is what finalizeWeekAndAdvance sets.
 *
 * Usage (owner, once, against production after the trophies release):
 *   DATABASE_URL=... node scripts/backfill-lineup-trophies.js --season 2026 --dry-run
 *   DATABASE_URL=... node scripts/backfill-lineup-trophies.js --season 2026
 */
require('dotenv').config();

const pool = require('../server/modules/pool');
const { awardLineupTrophies } = require('../server/services/trophy.service');

function parseArgs(argv) {
  const args = { season: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--dry-run') args.dryRun = true;
    else if (token === '--season') args.season = Number(argv[++i]);
    else if (token.startsWith('--season=')) args.season = Number(token.split('=')[1]);
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!Number.isInteger(args.season)) throw new Error('--season N is required (an integer)');
  return args;
}

async function backfill({ season, dryRun, log = console.log }) {
  const leagues = await pool.query(
    `SELECT * FROM "leagues" WHERE "pickem_only" = false AND "best_ball" = false ORDER BY "id"`
  );
  let rows = 0;
  const onRow = (row) => {
    rows += 1;
    log(`${dryRun ? 'would write' : 'wrote'} ${JSON.stringify(row)}`);
  };
  for (const league of leagues.rows) {
    const weeks = await pool.query(
      `SELECT DISTINCT "week" FROM "matchups"
       WHERE "league_id" = $1 AND "season" = $2 AND "final" = true ORDER BY "week"`,
      [league.id, season]
    );
    for (const { week } of weeks.rows) {
      await awardLineupTrophies({
        league, leagueId: league.id, season, week,
        backfill: { dryRun, onRow },
      });
    }
  }
  log(`Done${dryRun ? ' (dry run, nothing written)' : ''}: ${rows} row(s) ${dryRun ? 'would be ' : ''}written.`);
  return { rows };
}

if (require.main === module) {
  Promise.resolve()
    .then(() => {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
      return backfill(parseArgs(process.argv.slice(2)));
    })
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Backfill failed:', err.message);
      pool.end().finally(() => process.exit(1));
    });
}

module.exports = { parseArgs, backfill };
