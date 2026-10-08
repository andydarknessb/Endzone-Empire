'use strict';

/**
 * Per-week readout of the shipped engine's accuracy against the Holdout ledger
 * (#2080): prints one JSON object to stdout (and to --out when given) with, per
 * preset Scoring profile, accuracy overall and per position beside a naive
 * baseline, the sealed-rule coverage figures, and the flags a week audit
 * chases. Read-only: one `BEGIN READ ONLY` transaction on DATABASE_URL, rolled
 * back, so it writes no table and touches no holdout gate.
 *
 * Reads the scheduled, on-time snapshot per profile. Accuracy is on the
 * Appearance basis the calibration readout uses: the ledger records no
 * Appearance, so a player-week counts when a `player_stats` row exists for it
 * (priced under the profile) and `activeProbability === 0` rows are left out.
 * The sealed rules score an absent actual as 0 instead; `sealedBasis` prints
 * that figure beside the other.
 *
 *   node --env-file=.env scripts/holdout/week-readout.js --week 4 [--season 2026] [--out file.json] [--perf]
 *
 * `--perf` also times `generateProjections` on the half-PPR cohort, cold then
 * warm, counting queries and listing those over 250 ms. It installs the ESPN odds
 * provider as server.js and worker.js do (its read is one SELECT, so the
 * transaction stays read-only) and leaves weather off (the NWS read is network),
 * so the figure is the production engine minus weather.
 */

const fs = require('fs');
const pool = require('../../server/modules/pool');
const { SCORING_PRESETS, calculateFantasyPoints } = require('../../server/services/scoringRules');
const model = require('../../server/services/projectionModel');
const projection = require('../../server/services/projection.service');
const { setVegasOddsProvider } = require('../../server/services/vegasOdds.provider');
const { espnOddsProvider } = require('../../server/services/espnOdds.provider');
const { buildWeekReadout } = require('./lib/weekReadout');

const num = (v) => (v === null || v === undefined ? null : Number(v));

function takeValue(argv, i, flag) {
  if (i >= argv.length || argv[i].startsWith('--')) throw new Error(`week-readout: ${flag} needs a value`);
  return argv[i];
}

function parseArgs(argv) {
  const args = { season: 2026, week: null, out: null, perf: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--season') args.season = Number(takeValue(argv, ++i, '--season'));
    else if (argv[i] === '--week') args.week = Number(takeValue(argv, ++i, '--week'));
    else if (argv[i] === '--out') args.out = takeValue(argv, ++i, '--out');
    else if (argv[i] === '--perf') args.perf = true;
    else throw new Error(`week-readout: unknown argument ${argv[i]}`);
  }
  if (!Number.isInteger(args.season)) throw new Error('week-readout: --season must be an integer');
  if (!Number.isInteger(args.week)) throw new Error('week-readout: --week is required and must be an integer');
  return args;
}

async function loadHeader(client, season, week) {
  const q = (text) => client.query(text, [season, week]).then((r) => r.rows);
  return {
    gameStates: await q('SELECT "game_status", count(*)::int AS n FROM "live_game_states" WHERE "season" = $1 AND "week" = $2 GROUP BY 1'),
    snapshots: await q(
      `SELECT "id", "scoring_profile", "model_version", "capture_kind", "constants_hash", "release_sha", "cohort_size",
              "captured_at", "capture_not_after", "input_cutoff", "is_late", "source_coverage"
       FROM "projection_snapshots" WHERE "season" = $1 AND "week" = $2 ORDER BY "scoring_profile", "capture_kind", "model_version"`
    ),
    captureStatus: await q(
      'SELECT "scoring_profile", "status", "message", "attempts", "updated_at" FROM "holdout_capture_status" WHERE "season" = $1 AND "week" = $2'
    ),
    projectionRuns: await q(
      `SELECT r."id", r."model_version", r."scoring_hash", r."input_cutoff", r."generated_at", r."created_at", r."updated_at",
              r."source_coverage", (SELECT count(*)::int FROM "player_week_projections" p WHERE p."run_id" = r."id") AS rows
       FROM "projection_runs" r WHERE r."season" = $1 AND r."week" = $2 ORDER BY r."id"`
    ),
  };
}

async function loadProfile(client, { season, week, profile, rules, statRows, players }) {
  const header = (await client.query(
    `SELECT "id", "model_version" FROM "projection_snapshots"
     WHERE "season" = $1 AND "week" = $2 AND "scoring_hash" = $3 AND "capture_kind" = 'scheduled' AND NOT "is_late"`,
    [season, week, model.scoringHash(rules)]
  )).rows[0];
  if (!header) return { error: 'no on-time scheduled snapshot' };

  const actuals = new Map();
  const priorByPlayer = new Map();
  for (const s of statRows) {
    const pts = calculateFantasyPoints(s.stats, rules);
    if (s.week === week) actuals.set(s.player_id, pts);
    else {
      const prior = priorByPlayer.get(s.player_id) || [];
      prior.push(pts);
      priorByPlayer.set(s.player_id, prior);
    }
  }

  const children = (await client.query(
    `SELECT "player_id", "position", "nfl_team", "injury_status", "mean", "median", "p10", "p25", "p75", "p90",
            "active_probability", "sample_size", "factors"
     FROM "projection_snapshot_players" WHERE "snapshot_id" = $1`,
    [header.id]
  )).rows;
  const rows = children.map((c) => ({
    playerId: c.player_id, position: c.position, team: c.nfl_team, injury: c.injury_status,
    mean: num(c.mean), median: num(c.median), p10: num(c.p10), p25: num(c.p25), p75: num(c.p75), p90: num(c.p90),
    activeProbability: num(c.active_probability), sampleSize: c.sample_size, factors: c.factors,
    modelVersion: header.model_version,
  }));

  return buildWeekReadout({
    season, week, profile, modelVersion: header.model_version, snapshotId: header.id,
    rows, actuals, priorByPlayer, players,
  });
}

// Cold then warm: the first run pays the engine's cache fills, the second is what a
// repeat call costs. Queries go through a wrapper so slow ones can be named.
async function timeEngine(client, { season, week, snapshotId }) {
  const rules = SCORING_PRESETS.half_ppr;
  // Production installs this at boot; without it the engine skips the odds read.
  setVegasOddsProvider(espnOddsProvider);
  const ids = (await client.query(
    'SELECT "player_id" FROM "projection_snapshot_players" WHERE "snapshot_id" = $1 ORDER BY 1', [snapshotId]
  )).rows.map((r) => r.player_id);
  let queries = 0;
  const slow = [];
  const timed = {
    query: async (text, params) => {
      queries += 1;
      const t = process.hrtime.bigint();
      try {
        return await client.query(text, params);
      } finally {
        const ms = Number(process.hrtime.bigint() - t) / 1e6;
        if (ms > 250) slow.push({ ms: Math.round(ms), sql: String(text).replace(/\s+/g, ' ').slice(0, 120) });
      }
    },
  };
  const perf = {};
  for (const label of ['cold', 'warm']) {
    queries = 0;
    slow.length = 0;
    const heap0 = process.memoryUsage().heapUsed;
    const t0 = process.hrtime.bigint();
    const res = await projection.generateProjections({
      season, week, rules, playerIds: ids, hashValue: model.scoringHash(rules), client: timed, weatherService: false,
    });
    perf[label] = {
      players: ids.length,
      wallMs: Math.round(Number(process.hrtime.bigint() - t0) / 1e6),
      queries,
      slowQueries: slow.slice(0, 8),
      heapDeltaMb: Math.round((process.memoryUsage().heapUsed - heap0) / 1048576),
      modelVersion: res.modelVersion,
      sourceCoverage: res.sourceCoverage,
    };
  }
  return perf;
}

async function main(argv) {
  const { season, week, out: outPath, perf } = parseArgs(argv);
  const client = await pool.connect();
  const report = { season, week, generatedAt: new Date().toISOString(), profiles: {} };
  try {
    await client.query('BEGIN READ ONLY');
    await client.query('SET LOCAL statement_timeout = 120000');

    Object.assign(report, await loadHeader(client, season, week));
    const players = new Map((await client.query('SELECT "id", "name" FROM "players"')).rows.map((p) => [p.id, { name: p.name }]));
    const statRows = (await client.query(
      'SELECT "player_id", "week", "stats" FROM "player_stats" WHERE "season" = $1 AND "week" <= $2', [season, week]
    )).rows;

    for (const [profile, rules] of Object.entries(SCORING_PRESETS)) {
      report.profiles[profile] = await loadProfile(client, { season, week, profile, rules, statRows, players });
    }

    const half = report.profiles.half_ppr;
    if (perf) {
      report.perf = half && half.snapshotId
        ? await timeEngine(client, { season, week, snapshotId: half.snapshotId })
        : { error: 'no on-time half_ppr snapshot' };
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  const text = JSON.stringify(report, null, 1);
  if (outPath) fs.writeFileSync(outPath, text);
  console.log(text);
  return report;
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
