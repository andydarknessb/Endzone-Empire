/* eslint-disable no-console */
/**
 * Roll up season totals (player_season_stats) for team defenses and individual
 * defenders from the weekly rows already in player_stats.
 *
 * Why this exists: player_season_stats is otherwise populated by the Sleeper
 * season sync, whose stat map covers offense and kicking only — defenders and
 * DEF units are silently dropped. So every DEF/IDP player had complete weekly
 * stats but no season rollup, which is what the profile pages' season summary
 * and the quick-view's "Previous Seasons" table read.
 *
 * Safety: the upsert is scoped to DEFENSIVE_POSITIONS. Sleeper never writes a
 * row for those positions, so this can never overwrite a Sleeper-sourced
 * offense/K rollup — unlike an unscoped backfill-seasons run, which would.
 * The script proves this each run by comparing the non-defensive row count and
 * a sampled offense row before and after.
 *
 * Season-rollover runbook: offense/K rollups come from the Sleeper season sync;
 * DEF/IDP rollups come from this script. Nothing on the scheduler needs it —
 * in-season reads for these positions go straight to player_stats.
 *
 * Usage:
 *   node scripts/backfill-defense-season-stats.js [--cutoff N]
 *
 * Rolls up every season strictly before --cutoff (default 2026, i.e. 2024 and
 * 2025 today). Idempotent — re-running recomputes and upserts the same rows.
 * Runs against whatever DATABASE_URL points at. Exits non-zero if any
 * post-run check fails.
 */
require('dotenv').config();

const pool = require('../server/modules/pool');
const scoring = require('../server/services/scoring.service');

const { DEFENSIVE_POSITIONS, IDP_POSITIONS } = scoring;
const DEFAULT_CUTOFF = 2026;
const NFL_TEAM_COUNT = 32;

function parseArgs(argv) {
  const args = { cutoff: DEFAULT_CUTOFF };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--cutoff') {
      args.cutoff = Number(argv[++i]);
    } else if (token.startsWith('--cutoff=')) {
      args.cutoff = Number(token.split('=')[1]);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  if (!Number.isInteger(args.cutoff)) throw new Error('--cutoff must be an integer');
  return args;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/**
 * Pure: compare the pre/post snapshots of everything this script must NOT
 * touch, plus the DEF/IDP coverage it must produce. Returns a list of failure
 * strings — empty means every check passed.
 */
function checkOutcome({ before, after, seasons }) {
  const problems = [];

  if (before.otherRows !== after.otherRows) {
    problems.push(
      `non-defensive player_season_stats rows changed: ${before.otherRows} -> ${after.otherRows}`
    );
  }
  if (JSON.stringify(before.offenseSample) !== JSON.stringify(after.offenseSample)) {
    problems.push('sampled offense rollup row changed (Sleeper data was overwritten)');
  }

  for (const season of seasons) {
    const def = after.byPosition.find((r) => r.season === season && r.position === 'DEF');
    if (!def || def.rows !== NFL_TEAM_COUNT) {
      problems.push(`${season}: expected ${NFL_TEAM_COUNT} DEF rows, got ${def ? def.rows : 0}`);
    }
    const idpRows = after.byPosition
      .filter((r) => r.season === season && IDP_POSITIONS.includes(r.position))
      .reduce((sum, r) => sum + r.rows, 0);
    if (idpRows === 0) problems.push(`${season}: no IDP rollup rows`);
  }

  for (const spot of after.spotChecks) {
    if (spot.rollupPoints == null) {
      problems.push(`${spot.label} (${spot.season}): no rollup row`);
      continue;
    }
    if (round2(spot.rollupPoints) !== round2(spot.weeklySum)) {
      problems.push(
        `${spot.label} (${spot.season}): rollup ${spot.rollupPoints} != weekly sum ${spot.weeklySum}`
      );
    }
    if (spot.gamesPlayed !== spot.weeklyCount) {
      problems.push(
        `${spot.label} (${spot.season}): games_played ${spot.gamesPlayed} != ${spot.weeklyCount} weekly rows`
      );
    }
  }

  return problems;
}

/** Per-position/season rollup row counts for the defensive positions. */
async function defensiveRowCounts(cutoff) {
  const res = await pool.query(
    `SELECT "pss"."season", "p"."position", COUNT(*)::int AS "rows"
     FROM "player_season_stats" "pss"
     JOIN "players" "p" ON "p"."id" = "pss"."player_id"
     WHERE "pss"."season" < $1 AND "p"."position" = ANY($2)
     GROUP BY "pss"."season", "p"."position"
     ORDER BY "pss"."season", "p"."position"`,
    [cutoff, DEFENSIVE_POSITIONS]
  );
  return res.rows.map((r) => ({ season: Number(r.season), position: r.position, rows: r.rows }));
}

/** Everything the run must leave untouched: the offense/K rollups. */
async function nonDefensiveSnapshot() {
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS "n"
     FROM "player_season_stats" "pss"
     JOIN "players" "p" ON "p"."id" = "pss"."player_id"
     WHERE NOT ("p"."position" = ANY($1))`,
    [DEFENSIVE_POSITIONS]
  );
  // A stable sample row (lowest player_id/season) to prove the stats jsonb and
  // points of a Sleeper-sourced rollup came through byte-identical.
  const sampleRes = await pool.query(
    `SELECT "pss"."player_id", "pss"."season", "pss"."games_played",
            "pss"."stats", "pss"."fantasy_points"
     FROM "player_season_stats" "pss"
     JOIN "players" "p" ON "p"."id" = "pss"."player_id"
     WHERE NOT ("p"."position" = ANY($1))
     ORDER BY "pss"."player_id", "pss"."season"
     LIMIT 1`,
    [DEFENSIVE_POSITIONS]
  );
  return { otherRows: countRes.rows[0].n, offenseSample: sampleRes.rows[0] || null };
}

/**
 * One rollup vs. its own weekly rows, for a named player and season: the
 * rollup's stored points must equal the sum of the weekly points, and its
 * games_played the weekly row count.
 */
async function spotCheck({ label, playerId, season }) {
  const rollupRes = await pool.query(
    `SELECT "games_played", "fantasy_points" FROM "player_season_stats"
     WHERE "player_id" = $1 AND "season" = $2`,
    [playerId, season]
  );
  const weeklyRes = await pool.query(
    `SELECT COUNT(*)::int AS "n", COALESCE(SUM("fantasy_points"), 0) AS "total"
     FROM "player_stats" WHERE "player_id" = $1 AND "season" = $2`,
    [playerId, season]
  );
  const rollup = rollupRes.rows[0] || null;
  return {
    label,
    season,
    rollupPoints: rollup ? Number(rollup.fantasy_points) : null,
    gamesPlayed: rollup ? Number(rollup.games_played) : null,
    weeklySum: Number(weeklyRes.rows[0].total),
    weeklyCount: weeklyRes.rows[0].n,
  };
}

/** Seasons that actually have defensive weekly rows below the cutoff. */
async function seasonsWithDefensiveWeeklies(cutoff) {
  const res = await pool.query(
    `SELECT DISTINCT "ps"."season"
     FROM "player_stats" "ps"
     JOIN "players" "p" ON "p"."id" = "ps"."player_id"
     WHERE "ps"."season" < $1 AND "p"."position" = ANY($2)
     ORDER BY "ps"."season"`,
    [cutoff, DEFENSIVE_POSITIONS]
  );
  return res.rows.map((r) => Number(r.season));
}

/** The highest-scoring IDP player of a season — a meaningful spot-check target. */
async function topIdpPlayer(season) {
  const res = await pool.query(
    `SELECT "p"."id", "p"."name", "p"."position"
     FROM "player_stats" "ps"
     JOIN "players" "p" ON "p"."id" = "ps"."player_id"
     WHERE "ps"."season" = $1 AND "p"."position" = ANY($2)
     GROUP BY "p"."id", "p"."name", "p"."position"
     ORDER BY SUM("ps"."fantasy_points") DESC
     LIMIT 1`,
    [season, IDP_POSITIONS]
  );
  return res.rows[0] || null;
}

async function snapshot(cutoff, seasons) {
  const [byPosition, nonDefensive] = [await defensiveRowCounts(cutoff), await nonDefensiveSnapshot()];
  const defRes = await pool.query(
    `SELECT "id", "name" FROM "players" WHERE "position" = 'DEF' AND "name" = 'Denver Broncos'`
  );
  const def = defRes.rows[0] || null;
  const spotChecks = [];
  for (const season of seasons) {
    if (def) {
      spotChecks.push(await spotCheck({ label: `DEF ${def.name}`, playerId: def.id, season }));
    }
    const idp = await topIdpPlayer(season);
    if (idp) {
      spotChecks.push(await spotCheck({ label: `${idp.position} ${idp.name}`, playerId: idp.id, season }));
    }
  }
  return { byPosition, ...nonDefensive, spotChecks };
}

async function main() {
  const { cutoff } = parseArgs(process.argv.slice(2));
  const seasons = await seasonsWithDefensiveWeeklies(cutoff);
  console.log(
    `Defensive season rollup: cutoff ${cutoff} — seasons with weekly data: ${seasons.join(', ') || 'none'}`
  );
  if (seasons.length === 0) {
    console.log('Nothing to roll up.');
    return { problems: [] };
  }

  const before = await snapshot(cutoff, seasons);
  console.log(`  before: defensive rollup rows ${before.byPosition.reduce((s, r) => s + r.rows, 0)}, ` +
    `non-defensive rows ${before.otherRows}`);

  const result = await scoring.syncPlayerSeasonStats({
    currentSeason: cutoff,
    positions: DEFENSIVE_POSITIONS,
  });
  console.log(`  upserted ${result.seasonsUpserted} player-season rollups (cutoff ${result.cutoffSeason})`);

  const after = await snapshot(cutoff, seasons);
  for (const row of after.byPosition) {
    console.log(`  ${row.season} ${row.position}: ${row.rows} rows`);
  }
  for (const spot of after.spotChecks) {
    console.log(
      `  spot ${spot.label} ${spot.season}: rollup ${spot.rollupPoints} pts / ${spot.gamesPlayed} G ` +
        `vs weekly ${round2(spot.weeklySum)} pts / ${spot.weeklyCount} wk`
    );
  }
  console.log(`  non-defensive rows: ${before.otherRows} -> ${after.otherRows}`);

  const problems = checkOutcome({ before, after, seasons });
  if (problems.length === 0) {
    console.log('Done. All checks passed.');
  } else {
    console.error('Done with FAILURES:');
    for (const p of problems) console.error(`  ✗ ${p}`);
  }
  return { problems };
}

if (require.main === module) {
  main()
    .then(({ problems }) => pool.end().then(() => process.exit(problems.length > 0 ? 1 : 0)))
    .catch((err) => {
      console.error('Defensive season rollup failed:', err);
      pool.end().finally(() => process.exit(1));
    });
}

module.exports = { parseArgs, checkOutcome, round2, main };
