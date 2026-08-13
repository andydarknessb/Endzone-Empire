'use strict';

/**
 * Runner for the `holdout-confirm-2026` evaluator: the I/O shell around the
 * pure `scripts/holdout/lib/evaluate.js`. Reads the ledger through the
 * production pool, reads the PINNED actuals file, writes REPORT.md and
 * report.json into the study directory, exits non-zero on an unevaluable
 * study so an operator cannot mistake silence for a verdict.
 *
 * Required arguments, no defaults - a run whose inputs are implicit is a run
 * whose inputs are arguable:
 *
 *   --season 2026            the study season
 *   --prior-season 2025      the roster-ranking window's second season
 *   --profile half_ppr       the profile evaluated (half_ppr is the primary;
 *                            other profiles are non-selecting sensitivities)
 *   --actuals <path>         JSON of pinned actual points:
 *                            { "2026:1:123": 7.9, "2025:18:44": 12.1, ... },
 *                            produced by the ACTUALS_MANIFEST pipeline
 *                            (PREREGISTRATION.md §5) after the season ends
 *   --out <dir>              where REPORT.md / report.json are written
 *
 * Deliberately NOT here: the nflverse fetch, crosswalk mapping and scoring
 * that PRODUCE the actuals file. Those run once, at fetch time, against
 * whatever schema the 2026 files actually carry, and their output is pinned
 * by hash in ACTUALS_MANIFEST.json before this runner ever executes.
 */

const fs = require('fs');
const path = require('path');
const pool = require('../modules/pool');
const evaluator = require('../../scripts/holdout/lib/evaluate');
const { renderReport } = require('../../scripts/holdout/lib/report');
const { SCORING_PRESETS } = require('../services/scoring.service');
const model = require('../services/projectionModel');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--season') args.season = Number(argv[++i]);
    else if (token === '--prior-season') args.priorSeason = Number(argv[++i]);
    else if (token === '--profile') args.profile = argv[++i];
    else if (token === '--actuals') args.actualsPath = argv[++i];
    else if (token === '--out') args.outDir = argv[++i];
    else throw new Error(`run-holdout-confirm: unknown argument ${token}`);
  }
  for (const key of ['season', 'priorSeason', 'profile', 'actualsPath', 'outDir']) {
    if (args[key] === undefined || (typeof args[key] === 'number' && !Number.isFinite(args[key]))) {
      throw new Error(`run-holdout-confirm: --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
    }
  }
  return args;
}

/** Ledger extraction: every arm header + child rows for the season/profile. */
async function loadWeeks({ season, profile, client }) {
  const rules = SCORING_PRESETS[profile];
  if (!rules) throw new Error(`run-holdout-confirm: unknown scoring profile ${profile}`);
  const scoringHash = model.scoringHash(rules);
  const kinds = [evaluator.CONTROL_KIND, ...evaluator.CELL_KINDS];
  const headers = await client.query(
    `SELECT "id", "week", "capture_kind", "constants_hash", "model_version", "cohort_hash",
            "cohort_size", "captured_at", "capture_not_after", "is_late"
     FROM "projection_snapshots"
     WHERE "season" = $1 AND "scoring_profile" = $2 AND "scoring_hash" = $3
       AND "capture_kind" = ANY($4::text[])
     ORDER BY "week", "capture_kind"`,
    [season, profile, scoringHash, kinds]
  );
  const byWeek = new Map();
  for (const header of headers.rows) {
    const children = await client.query(
      `SELECT "player_id", "position", "mean", "median", "p10", "p25", "p75", "p90", "active_probability"
       FROM "projection_snapshot_players" WHERE "snapshot_id" = $1 ORDER BY "player_id"`,
      [header.id]
    );
    if (!byWeek.has(header.week)) byWeek.set(header.week, { week: header.week, arms: {} });
    byWeek.get(header.week).arms[header.capture_kind] = {
      snapshotId: header.id,
      isLate: header.is_late,
      capturedAt: header.captured_at,
      captureNotAfter: header.capture_not_after,
      constantsHash: header.constants_hash,
      modelVersion: header.model_version,
      cohortHash: header.cohort_hash,
      cohortSize: header.cohort_size,
      rows: children.rows.map((r) => ({
        playerId: r.player_id,
        position: r.position,
        mean: r.mean,
        median: r.median,
        p10: r.p10,
        p25: r.p25,
        p75: r.p75,
        p90: r.p90,
        activeProbability: r.active_probability,
      })),
    };
  }
  return [...byWeek.values()].sort((a, b) => a.week - b.week);
}

function loadActuals(actualsPath) {
  const parsed = JSON.parse(fs.readFileSync(actualsPath, 'utf8'));
  const actuals = new Map();
  for (const [key, value] of Object.entries(parsed)) {
    if (!/^\d{4}:\d{1,2}:\d+$/.test(key)) throw new Error(`run-holdout-confirm: malformed actuals key "${key}"`);
    // `Number.isFinite(value)` WITHOUT coercion: `Number(null)` is 0 and
    // `Number('12')` is 12, and either slipping through converts "the actuals
    // pipeline broke for this player-week" into silent plausible data. The
    // file is machine-produced (§5), so a non-number JSON value IS the
    // pipeline breaking. Adversarial review finding: the coercing form
    // accepted a literal JSON null as a scored zero.
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`run-holdout-confirm: non-numeric actual for "${key}" (got ${JSON.stringify(value)})`);
    }
    actuals.set(key, value);
  }
  if (actuals.size === 0) throw new Error('run-holdout-confirm: the actuals file is empty');
  return actuals;
}

async function main(argv) {
  const args = parseArgs(argv);
  const weeks = await loadWeeks({ season: args.season, profile: args.profile, client: pool });
  const actuals = loadActuals(args.actualsPath);

  const result = evaluator.evaluate({
    season: args.season,
    priorSeason: args.priorSeason,
    weeks,
    actuals,
    // NO config overrides: the runner runs the sealed study or nothing.
  });
  result.profile = args.profile;
  result.primaryProfile = args.profile === 'half_ppr';

  fs.mkdirSync(args.outDir, { recursive: true });
  fs.writeFileSync(path.join(args.outDir, 'report.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(args.outDir, 'REPORT.md'), `${renderReport(result)}\n`, 'utf8');
  console.log(`holdout-confirm: ${result.weeks.surviving}/${result.weeks.provided} weeks surviving; `
    + (result.evaluable
      ? `A=${result.candidateA.verdict}, B selected=${result.candidateB.selected || 'none'}`
      : 'UNEVALUABLE'));
  return result.evaluable ? 0 : 1;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = { parseArgs, loadWeeks, loadActuals, main };
