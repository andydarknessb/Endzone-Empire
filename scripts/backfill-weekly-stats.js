/* eslint-disable no-console */
/**
 * Backfill weekly player stats (player_stats) from Tank01 for whole seasons.
 *
 * For each target season: ensures the nfl_games schedule exists (syncing it
 * if the season has none), pulls every week's box scores via
 * scoring.syncWeekStats (idempotent upserts on player_id/season/week), then
 * re-applies the nflverse IDP finalization patch — mandatory ordering,
 * because the Tank01 upsert replaces the stats jsonb wholesale and would
 * otherwise wipe the nflverse-only keys (idpSackYards etc.) from any
 * previously finalized week.
 *
 * A week whose box-score calls partially fail is detected by comparing
 * gamesProcessed against the schedule's game count and retried whole —
 * upserts make re-running a week safe. 429s honor Retry-After via
 * gameRecap.service's retryAfterMs.
 *
 * Known, accepted limits: players absent from `players` (no external_id —
 * e.g. retired since the season) are skipped, matching syncWeekStats's
 * normal behavior and Sleeper season-stat coverage; regular season only
 * (weeks 1-18); stored fantasy_points use the default half-PPR rules like
 * every other player_stats row.
 *
 * Do NOT follow this with the backfill-seasons job for past seasons — it
 * would overwrite the richer Sleeper-sourced player_season_stats rollups
 * (Tank01 has no two-point-conversion keys).
 *
 * Usage:
 *   node scripts/backfill-weekly-stats.js [--season N]... [--week N]...
 *       [--pause-ms N] [--skip-nflverse] [--source tank01|nflverse]
 *
 * Defaults: seasons 2024 and 2025, weeks 1-18, 250ms between box-score
 * calls (~630 Tank01 calls for the full default run — check RapidAPI quota
 * first). Runs against whatever DATABASE_URL points at.
 *
 * --source nflverse builds COMPLETE weeks (offense + IDP + kicking with
 * exact FG distances + team DST) from nflverse's free release CSVs instead
 * of Tank01 — zero RapidAPI calls, no rate limits. Only run it for weeks
 * Tank01 didn't fill: its wholesale upsert would drop the pbp-derived
 * TD-length arrays from a Tank01-sourced week (0-point under default rules,
 * but the Tank01 shape is canonical). A later Tank01 re-sync of an
 * nflverse-filled week safely converges it. The separate nflverse IDP patch
 * pass is skipped in this mode — the full rows already carry those keys.
 */
require('dotenv').config();

const pool = require('../server/modules/pool');
const scoring = require('../server/services/scoring.service');
const nflverse = require('../server/services/nflverseSync.service');
const { retryAfterMs } = require('../server/services/gameRecap.service');

const DEFAULT_SEASONS = [2024, 2025];
const REGULAR_SEASON_WEEKS = 18;
const MAX_WEEK_ATTEMPTS = 3;
const SHORT_WEEK_BACKOFF_MS = 15_000;

function parseArgs(argv) {
  const args = { seasons: [], weeks: [], pauseMs: 250, skipNflverse: false, source: 'tank01' };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--skip-nflverse') {
      args.skipNflverse = true;
    } else if (token === '--source') {
      args.source = argv[++i];
    } else if (token.startsWith('--source=')) {
      args.source = token.split('=')[1];
    } else if (token === '--season') {
      args.seasons.push(Number(argv[++i]));
    } else if (token.startsWith('--season=')) {
      args.seasons.push(Number(token.split('=')[1]));
    } else if (token === '--week') {
      args.weeks.push(Number(argv[++i]));
    } else if (token.startsWith('--week=')) {
      args.weeks.push(Number(token.split('=')[1]));
    } else if (token === '--pause-ms') {
      args.pauseMs = Number(argv[++i]);
    } else if (token.startsWith('--pause-ms=')) {
      args.pauseMs = Number(token.split('=')[1]);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (args.seasons.length === 0) args.seasons = DEFAULT_SEASONS.slice();
  if (args.seasons.some((s) => !Number.isInteger(s))) {
    throw new Error('--season must be an integer');
  }
  if (args.weeks.some((w) => !Number.isInteger(w) || w < 1 || w > REGULAR_SEASON_WEEKS)) {
    throw new Error(`--week must be an integer 1-${REGULAR_SEASON_WEEKS}`);
  }
  if (!Number.isFinite(args.pauseMs) || args.pauseMs < 0) {
    throw new Error('--pause-ms must be a non-negative number');
  }
  if (!['tank01', 'nflverse'].includes(args.source)) {
    throw new Error('--source must be tank01 or nflverse');
  }
  return args;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pure: decide what to do after one syncWeekStats attempt. `expectedGames`
 * null means the schedule is unknown — accept whatever came back.
 */
function weekOutcome({ gamesProcessed, expectedGames, attempt, maxAttempts = MAX_WEEK_ATTEMPTS }) {
  if (expectedGames == null || gamesProcessed >= expectedGames) return 'complete';
  return attempt < maxAttempts ? 'retry' : 'incomplete';
}

/** Schedule-derived game count for a week (nfl_games has 2 rows per game). */
async function expectedGamesFor(season, week) {
  const res = await pool.query(
    'SELECT COUNT(*)::int AS n FROM "nfl_games" WHERE "season" = $1 AND "week" = $2',
    [season, week]
  );
  const n = res.rows[0].n;
  return n > 0 ? Math.floor(n / 2) : null;
}

/**
 * Sync one week, retrying the whole week (safe — every write is an upsert)
 * when a 429 bubbles up or per-game failures left it short of the schedule.
 */
async function syncWeekWithRetry({ season, week, pauseMs, expectedGames }) {
  let result = null;
  for (let attempt = 1; attempt <= MAX_WEEK_ATTEMPTS; attempt++) {
    try {
      result = await scoring.syncWeekStats({ season, week, pauseMs });
    } catch (err) {
      const backoff = retryAfterMs(err);
      if (backoff == null || attempt === MAX_WEEK_ATTEMPTS) throw err;
      console.warn(`  ${season} wk${week}: rate limited, backing off ${backoff}ms`);
      await delay(backoff);
      continue;
    }
    const outcome = weekOutcome({ gamesProcessed: result.gamesProcessed, expectedGames, attempt });
    if (outcome === 'complete') return result;
    if (outcome === 'retry') {
      console.warn(
        `  ${season} wk${week}: only ${result.gamesProcessed}/${expectedGames} games, retrying week`
      );
      await delay(SHORT_WEEK_BACKOFF_MS);
    }
  }
  return result;
}

/**
 * nflverse full-fill for one season's requested weeks: three CSV fetches +
 * one crosswalk fetch per season, zero Tank01 calls. `ok` compares the
 * games present in nflverse's team file against our schedule count, the
 * same completeness signal the Tank01 path uses.
 */
async function runNflverseSeason({ season, weeks, crosswalk, summary }) {
  const [playerRows, teamRows, scoresByGameId] = [
    await nflverse.fetchPlayerWeekStatsForSeason(season),
    await nflverse.fetchTeamWeekStatsForSeason(season),
    await nflverse.fetchGameScoresForSeason(season),
  ];
  for (const wk of weeks) {
    const expectedGames = await expectedGamesFor(season, wk);
    try {
      const out = await nflverse.applyNflverseFullWeek({
        season, week: wk, playerRows, teamRows, scoresByGameId, crosswalk,
      });
      const ok = expectedGames == null || out.gamesInFile >= expectedGames;
      summary.push({
        season, week: wk, games: out.gamesInFile, expected: expectedGames,
        players: out.playersUpdated, ok,
      });
      console.log(
        `  ${ok ? '✓' : '✗'} ${season} wk${wk} (nflverse): games ${out.gamesInFile}/${expectedGames ?? '?'}, ` +
          `players ${out.playersUpdated}, dst ${out.dstUpdated}`
      );
    } catch (err) {
      summary.push({ season, week: wk, games: 0, expected: expectedGames, players: 0, ok: false });
      console.error(`  ✗ ${season} wk${wk} (nflverse): ${err.message}`);
    }
  }
}

async function main() {
  const { seasons, weeks: requestedWeeks, pauseMs, skipNflverse, source } = parseArgs(process.argv.slice(2));
  const weeks = requestedWeeks.length > 0
    ? requestedWeeks
    : Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => i + 1);
  console.log(
    `Backfill (${source}): seasons ${seasons.join(', ')} — weeks ${
      requestedWeeks.length > 0 ? requestedWeeks.join(', ') : '1-18'
    }${skipNflverse ? ', skipping nflverse pass' : ''}`
  );

  const summary = [];
  let crosswalk = null; // fetched once, shared across seasons

  if (source === 'nflverse') {
    crosswalk = await nflverse.fetchPlayersCrosswalk();
    for (const season of seasons) {
      await runNflverseSeason({ season, weeks, crosswalk, summary });
    }
    const failed = summary.filter((r) => !r.ok);
    console.log(
      `Done. weeks=${summary.length} complete=${summary.length - failed.length} incomplete=${failed.length}`
    );
    for (const r of failed) {
      console.log(`  incomplete: ${r.season} wk${r.week} (games ${r.games}/${r.expected ?? '?'})`);
    }
    return { summary, failedCount: failed.length };
  }

  for (const season of seasons) {
    const scheduled = await pool.query(
      'SELECT COUNT(*)::int AS n FROM "nfl_games" WHERE "season" = $1',
      [season]
    );
    if (scheduled.rows[0].n === 0) {
      console.log(`${season}: no nfl_games rows — syncing schedule first`);
      const sched = await scoring.syncSchedule({ season });
      console.log(`${season}: schedule synced (${JSON.stringify(sched)})`);
    }

    for (const wk of weeks) {
      const expectedGames = await expectedGamesFor(season, wk);
      try {
        const result = await syncWeekWithRetry({ season, week: wk, pauseMs, expectedGames });
        const ok = expectedGames == null || result.gamesProcessed >= expectedGames;
        summary.push({
          season,
          week: wk,
          games: result.gamesProcessed,
          expected: expectedGames,
          players: result.playersUpdated,
          ok,
        });
        console.log(
          `  ${ok ? '✓' : '✗'} ${season} wk${wk}: games ${result.gamesProcessed}/${expectedGames ?? '?'}, ` +
            `players ${result.playersUpdated}`
        );
      } catch (err) {
        summary.push({ season, week: wk, games: 0, expected: expectedGames, players: 0, ok: false });
        console.error(`  ✗ ${season} wk${wk}: ${err.message}`);
      }
    }

    if (!skipNflverse) {
      try {
        const defRows = await nflverse.fetchPlayerWeekStatsForSeason(season);
        if (!crosswalk) crosswalk = await nflverse.fetchPlayersCrosswalk();
        for (const wk of weeks) {
          const out = await nflverse.applyNflverseWeek({
            season,
            week: wk,
            defRows,
            crosswalk,
            rescoreLeagues: false,
          });
          console.log(`  nflverse ${season} wk${wk}: patched ${out.playersUpdated} players`);
        }
      } catch (err) {
        // Non-fatal: the offense/DST data is already stored; only the four
        // IDP yardage/safety keys are missing until this is re-run.
        console.error(`  nflverse pass failed for ${season}: ${err.message}`);
      }
    }
  }

  const failed = summary.filter((r) => !r.ok);
  console.log(
    `Done. weeks=${summary.length} complete=${summary.length - failed.length} incomplete=${failed.length}`
  );
  for (const r of failed) {
    console.log(`  incomplete: ${r.season} wk${r.week} (games ${r.games}/${r.expected ?? '?'})`);
  }
  return { summary, failedCount: failed.length };
}

if (require.main === module) {
  main()
    .then(({ failedCount }) => pool.end().then(() => process.exit(failedCount > 0 ? 1 : 0)))
    .catch((err) => {
      console.error('Backfill failed:', err);
      pool.end().finally(() => process.exit(1));
    });
}

module.exports = { parseArgs, weekOutcome, main };
