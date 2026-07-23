/* eslint-disable no-console */
/**
 * Backfill public NFL game recaps from finalized games.
 *
 * Walks live_game_states WHERE game_status = 'final' (optionally filtered by
 * --season / --week), and generates a recap for each via
 * gameRecap.service.generateForGame. Skips games that already have a recap row
 * unless --force is passed. Safe to re-run — generateForGame is idempotent.
 *
 * Usage:
 *   node scripts/backfill-game-recaps.js [--season N] [--week N] [--force]
 *
 * Runs against whatever DB the standard PG/DATABASE_URL env points at, so it
 * works against a local/test DB exactly like production.
 */
require('dotenv').config();

const pool = require('../server/modules/pool');
const { RECAPS_TABLE_SQL } = require('../server/modules/recapStorage');
const { generateForGame } = require('../server/services/gameRecap.service');

function parseArgs(argv) {
  const args = { season: null, week: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--force') {
      args.force = true;
    } else if (token === '--season') {
      args.season = Number(argv[++i]);
    } else if (token === '--week') {
      args.week = Number(argv[++i]);
    } else if (token.startsWith('--season=')) {
      args.season = Number(token.split('=')[1]);
    } else if (token.startsWith('--week=')) {
      args.week = Number(token.split('=')[1]);
    }
  }
  if (args.season != null && !Number.isInteger(args.season)) {
    throw new Error('--season must be an integer');
  }
  if (args.week != null && !Number.isInteger(args.week)) {
    throw new Error('--week must be an integer');
  }
  return args;
}

async function main() {
  const { season, week, force } = parseArgs(process.argv.slice(2));

  const params = [];
  const where = [`"game_status" = 'final'`];
  if (season != null) {
    params.push(season);
    where.push(`"season" = $${params.length}`);
  }
  if (week != null) {
    params.push(week);
    where.push(`"week" = $${params.length}`);
  }

  const finalsRes = await pool.query(
    `SELECT "tank01_game_id", "season", "week" FROM "live_game_states"
     WHERE ${where.join(' AND ')}
     ORDER BY "season", "week", "tank01_game_id"`,
    params
  );
  const games = finalsRes.rows;

  // Which of those already have a recap (skipped unless --force).
  const existing = new Set();
  if (!force && games.length > 0) {
    const ids = games.map((g) => g.tank01_game_id);
    const recapRes = await pool.query(
      `SELECT "tank01_game_id" FROM ${RECAPS_TABLE_SQL} WHERE "tank01_game_id" = ANY($1)`,
      [ids]
    );
    for (const r of recapRes.rows) existing.add(r.tank01_game_id);
  }

  const filter = [season != null ? `season=${season}` : null, week != null ? `week=${week}` : null]
    .filter(Boolean)
    .join(' ') || 'all seasons/weeks';
  console.log(`Backfill (${filter}${force ? ', --force' : ''}): ${games.length} final game(s) found.`);

  let generated = 0;
  let skipped = 0;
  let failed = 0;
  for (const game of games) {
    if (!force && existing.has(game.tank01_game_id)) {
      skipped += 1;
      continue;
    }
    try {
      const data = await generateForGame(game.tank01_game_id);
      if (data) {
        generated += 1;
        console.log(`  ✓ ${game.tank01_game_id} (season ${game.season}, week ${game.week})`);
      } else {
        skipped += 1; // generateForGame no-op'd (e.g. not final)
      }
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${game.tank01_game_id}: ${err.message}`);
    }
  }

  console.log(`Done. generated=${generated} skipped=${skipped} failed=${failed}`);
  return { generated, skipped, failed };
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

module.exports = { parseArgs, main };
