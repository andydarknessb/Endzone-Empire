'use strict';

/**
 * Calibration gate for spec #1845 (ticket #1848): prints two reliability tables,
 * Threshold probability and pairwise start/sit probability, each ending PASS or
 * FAIL. Read-only: one `BEGIN READ ONLY` transaction on DATABASE_URL, rolled
 * back, and the readout goes to stdout. Writes no table, touches no holdout gate.
 *
 *   node scripts/holdout/calibration-readout.js [--season 2026]
 *
 * Reads the scheduled arm's on-time snapshots under each preset Scoring profile,
 * for every completed week of the season (every `live_game_states` row of the
 * week is `final`, and the week has at least one). Actual points are the
 * player's `player_stats` row priced under the snapshot's own profile. The
 * ledger has no Appearance record, so a player-week with no stat row is left
 * out; one with a stat row counts, even a zero from a rostered player who never
 * took the field.
 */

const pool = require('../../server/modules/pool');
const { SCORING_PRESETS, calculateFantasyPoints } = require('../../server/services/scoringRules');
const model = require('../../server/services/projectionModel');
const { pointEstimateFor } = require('../../server/services/projection.service');
const { buildReadout, renderReadout } = require('./lib/calibration');

const BASIS = 'a player-week counts when the player has a player_stats row for the week '
  + '(the ledger records no Appearance); points are that row priced under the snapshot\'s own preset profile';

const num = (v) => (v === null || v === undefined ? null : Number(v));

function parseArgs(argv) {
  const args = { season: 2026 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--season') args.season = Number(argv[++i]);
    else throw new Error(`calibration-readout: unknown argument ${argv[i]}`);
  }
  if (!Number.isInteger(args.season)) throw new Error('calibration-readout: --season must be an integer');
  return args;
}

async function completedWeeks(client, season) {
  const { rows } = await client.query(
    `SELECT "week" FROM "live_game_states" WHERE "season" = $1
     GROUP BY "week" HAVING bool_and("game_status" = 'final') ORDER BY "week"`,
    [season]
  );
  return rows.map((r) => r.week);
}

async function loadActuals(client, season, week, rules) {
  const { rows } = await client.query(
    'SELECT "player_id", "stats" FROM "player_stats" WHERE "season" = $1 AND "week" = $2',
    [season, week]
  );
  return new Map(rows.map((r) => [r.player_id, calculateFantasyPoints(r.stats, rules)]));
}

async function loadSnapshots(client, season, weeks) {
  const snapshots = [];
  for (const [profile, rules] of Object.entries(SCORING_PRESETS)) {
    const scoringHash = model.scoringHash(rules);
    for (const week of weeks) {
      const headers = await client.query(
        `SELECT "id", "model_version" FROM "projection_snapshots"
         WHERE "season" = $1 AND "week" = $2 AND "scoring_hash" = $3
           AND "capture_kind" = 'scheduled' AND NOT "is_late"`,
        [season, week, scoringHash]
      );
      if (headers.rows.length === 0) continue;
      const actuals = await loadActuals(client, season, week, rules);
      for (const header of headers.rows) {
        const children = await client.query(
          `SELECT "player_id", "position", "mean", "median", "p10", "p25", "p75", "p90",
                  "sample_size", "factors"
           FROM "projection_snapshot_players" WHERE "snapshot_id" = $1`,
          [header.id]
        );
        const rows = children.rows.map((r) => {
          const row = {
            playerId: r.player_id,
            position: r.position,
            mean: num(r.mean),
            median: num(r.median),
            p10: num(r.p10),
            p25: num(r.p25),
            p75: num(r.p75),
            p90: num(r.p90),
            sampleSize: r.sample_size,
            factors: r.factors,
            modelVersion: header.model_version,
          };
          row.pointEstimate = pointEstimateFor(row);
          return row;
        });
        snapshots.push({ week, profile, rows, actuals });
      }
    }
  }
  return snapshots;
}

async function main(argv) {
  const { season } = parseArgs(argv);
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const weeks = await completedWeeks(client, season);
    const snapshots = await loadSnapshots(client, season, weeks);
    const included = [...new Set(snapshots.map((s) => s.week))].sort((a, b) => a - b);
    const profiles = [...new Set(snapshots.map((s) => s.profile))];
    console.log(renderReadout(buildReadout(snapshots), { season, weeks: included, profiles, basis: BASIS }));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(() => pool.end())
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = { parseArgs, main };
