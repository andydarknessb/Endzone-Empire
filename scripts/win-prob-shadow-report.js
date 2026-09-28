/* eslint-disable no-console */
/**
 * Win probability v2 shadow report (Home v2 spec, "Win probability v2" board,
 * "Calibration and gate").
 *
 * Reads the `win_probability_shadow` rows the live score pass recorded
 * (winProbabilityShadow.service) for one season and a range of weeks, joins
 * each to its matchup's settled score, and grades v1 and v2 by checkpoint
 * (kickoff, in game, played, and rows flagged by starters without a
 * projection Interval) through the pure evaluation module
 * (server/services/winProbabilityEvaluation.js), then states the ship gate.
 * v1 is recomputed from each row's scores and Expected finals exactly as the
 * client computes it.
 *
 * Read-only: one SELECT, no writes, no network beyond the database.
 *
 * Usage:
 *   node scripts/win-prob-shadow-report.js --season 2026 [--weeks 5-8]
 *       [--league 71]... [--k 1.15] [--json]
 *
 *   --season N     required
 *   --weeks A-B    inclusive week range (or a single week); default every week
 *   --league N     only this league (repeatable); default every league
 *   --k N          grade v2 at this calibration constant instead of the k each
 *                  row was recorded at (the row's mu over its sigma rescaled)
 *   --json         print the full report and gate verdict as JSON
 *
 * Runs against whatever database the standard DATABASE_URL / PG* environment
 * points at.
 */

const USAGE = `Usage: node scripts/win-prob-shadow-report.js --season N [--weeks A-B] [--league N]... [--k N] [--json]`;

function parseWeeks(value) {
  const match = /^(\d+)(?:-(\d+))?$/.exec(String(value || '').trim());
  if (!match) return null;
  const from = Number(match[1]);
  const to = match[2] == null ? from : Number(match[2]);
  return from <= to ? { from, to } : null;
}

function parseArgs(argv) {
  const args = { season: null, weeks: { from: 1, to: 99 }, leagues: [], k: null, json: false, help: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') args.help = true;
    else if (flag === '--json') args.json = true;
    else if (flag === '--season') args.season = Number(argv[++i]);
    else if (flag === '--weeks' || flag === '--week') {
      const weeks = parseWeeks(argv[++i]);
      if (weeks) args.weeks = weeks;
      else args.errors.push(`${flag} must be a week or a range like 5-8`);
    } else if (flag === '--league') args.leagues.push(Number(argv[++i]));
    else if (flag === '--k') args.k = Number(argv[++i]);
    else args.errors.push(`unknown argument ${flag}`);
  }
  if (!args.help) {
    if (!Number.isInteger(args.season)) args.errors.push('--season N is required');
    if (args.leagues.some((id) => !Number.isInteger(id))) args.errors.push('--league takes a league id');
    if (args.k != null && !(args.k > 0)) args.errors.push('--k must be a positive number');
  }
  return args;
}

const num = (x, digits = 4) => (x == null ? '-' : x.toFixed(digits));
const pct = (x) => (x == null ? '-' : `${(x * 100).toFixed(1)}%`);
const pad = (value, width) => String(value).padStart(width);

function printReport({ args, report, gate }) {
  const { kickoff, inGame, played, flagged } = report.checkpoints;
  const weeks = args.weeks.to === 99 ? 'every week' : `weeks ${args.weeks.from}-${args.weeks.to}`;
  console.log(`Win probability v2 shadow report · season ${args.season} · ${weeks}`
    + `${args.leagues.length ? ` · leagues ${args.leagues.join(', ')}` : ''}`
    + `${args.k != null ? ` · graded at k ${args.k}` : ' · graded at the recorded k'}`);
  console.log(`Rows: ${report.rowsTotal} read · ${report.rowsGraded} graded · ${report.rowsWithoutResult} without a settled result`);
  console.log('');
  console.log(`${'checkpoint'.padEnd(10)} ${pad('rows', 6)} ${pad('flagged', 8)} ${pad('v1 Brier', 9)} ${pad('v2 Brier', 9)}`
    + ` ${pad('v1 log loss', 12)} ${pad('v2 log loss', 12)} ${pad('clamps v1/v2', 13)}`);
  for (const [label, group] of [['kickoff', kickoff], ['in game', inGame], ['played', played], ['flagged', flagged]]) {
    console.log(`${label.padEnd(10)} ${pad(group.count, 6)} ${pad(group.flaggedCount, 8)} ${pad(num(group.v1.brier), 9)}`
      + ` ${pad(num(group.v2.brier), 9)} ${pad(num(group.v1.logLoss), 12)} ${pad(num(group.v2.logLoss), 12)}`
      + ` ${pad(`${group.v1.clamps}/${group.v2.clamps}`, 13)}`);
  }
  console.log('');
  const { certainty } = played;
  console.log(`Played rows exactly 0 or 1: v2 ${certainty.v2.exact} of ${certainty.v2.rows}`
    + ` · v1 ${certainty.v1.exact} of ${certainty.v1.rows}`);
  if (certainty.v2.nonExactRowIds.length) {
    console.log(`  v2 rows not exact (win_probability_shadow.id): ${certainty.v2.nonExactRowIds.join(', ')}`);
  }

  for (const [label, group] of [['kickoff', kickoff], ['in game', inGame]]) {
    for (const model of ['v1', 'v2']) {
      console.log('');
      console.log(`Reliability · ${label} · ${model}`);
      console.log(`  ${'bin'.padEnd(10)} ${pad('rows', 6)} ${pad('predicted', 10)} ${pad('observed', 9)} ${pad('gap', 7)}`);
      for (const bin of group[model].reliability) {
        const gap = bin.count ? Math.abs(bin.meanPredicted - bin.observedRate) : null;
        console.log(`  ${`${bin.lower.toFixed(1)}-${bin.upper.toFixed(1)}`.padEnd(10)} ${pad(bin.count, 6)}`
          + ` ${pad(pct(bin.meanPredicted), 10)} ${pad(pct(bin.observedRate), 9)} ${pad(pct(gap), 7)}`);
      }
    }
  }

  console.log('');
  console.log(`Gate: ${gate.pass ? 'PASS' : 'FAIL'}`);
  for (const check of gate.checks) {
    console.log(`  ${check.pass ? 'pass' : 'FAIL'}  ${check.name.padEnd(14)} ${check.detail}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.errors.length) {
    args.errors.forEach((e) => console.error(e));
    console.error(USAGE);
    return 2;
  }

  // Required here, not at load, so --help and a bad argument never read the
  // database configuration.
  require('dotenv').config();
  const pool = require('../server/modules/pool');
  const { evaluateShadowRows, gateVerdict } = require('../server/services/winProbabilityEvaluation');

  try {
    const params = [args.season, args.weeks.from, args.weeks.to];
    if (args.leagues.length) params.push(args.leagues);
    const { rows } = await pool.query(
      `SELECT "s"."id", "s"."league_id", "s"."matchup_id", "s"."season", "s"."week", "s"."bucket_start",
              "s"."captured_at", "s"."status", "s"."home_score", "s"."away_score",
              "s"."home_expected_final", "s"."away_expected_final",
              "s"."home_players_remaining", "s"."away_players_remaining", "s"."starters_without_interval",
              "s"."mu", "s"."sigma", "s"."k", "s"."home_probability", "s"."model_version",
              "m"."final" AS "matchup_final", "m"."home_score" AS "final_home_score",
              "m"."away_score" AS "final_away_score"
       FROM "win_probability_shadow" "s"
       JOIN "matchups" "m" ON "m"."id" = "s"."matchup_id"
       WHERE "s"."season" = $1 AND "s"."week" BETWEEN $2 AND $3
         ${args.leagues.length ? 'AND "s"."league_id" = ANY($4)' : ''}
       ORDER BY "s"."matchup_id", "s"."captured_at", "s"."id"`,
      params
    );

    // Only a settled matchup has a result to grade against.
    const results = new Map();
    for (const row of rows) {
      if (row.matchup_final) {
        results.set(Number(row.matchup_id), { homeScore: row.final_home_score, awayScore: row.final_away_score });
      }
    }
    const report = evaluateShadowRows({ rows, results, k: args.k });
    const gate = gateVerdict(report);

    if (args.json) console.log(JSON.stringify({ args: { ...args, errors: undefined }, report, gate }, null, 2));
    else printReport({ args, report, gate });
    return 0;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, main };
