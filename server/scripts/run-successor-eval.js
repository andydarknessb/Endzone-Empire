'use strict';

/**
 * Runner for the v3.2 successor evaluation gate (#1439, ADR 0044): the I/O
 * shell around the pure `scripts/holdout/lib/successorEval.js`. Reads the
 * captured `scheduled`-arm ledger rows and `player_stats` through the
 * production pool - READ-ONLY, no migration, no write, ever (the tenant's
 * shared-database rule; this script is an operator run, never an IC run) -
 * and writes report.json / REPORT.md into the given study directory.
 *
 * Required arguments, no defaults - a run whose inputs are implicit is a run
 * whose inputs are arguable (mirrors run-holdout-confirm.js):
 *
 *   --model-version <v>   the MODEL_VERSION to evaluate, e.g. free_baseline_v3.1
 *                         for the rebuild-calibration run, or a landed
 *                         successor's version once #1440-#1443 register its
 *                         constants in successorEval.CONSTANTS_BY_MODEL_VERSION
 *   --season 2026         the ledger season
 *   --out <dir>           where REPORT.md / report.json are written
 *
 * Every scoring profile the ledger captures (standard, half_ppr, ppr) is
 * evaluated in one run - the report's whole point is the three profiles side
 * by side, so there is no `--profile` flag to run just one.
 */

const fs = require('fs');
const path = require('path');
const pool = require('../modules/pool');
const successorEval = require('../../scripts/holdout/lib/successorEval');
const { SCORING_PRESETS, calculateFantasyPoints } = require('../services/scoring.service');
const model = require('../services/projectionModel');
const projection = require('../services/projection.service');
const rootSafety = require('../../scripts/backtest/lib/rootSafety');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--model-version') args.modelVersion = argv[++i];
    else if (token === '--season') args.season = Number(argv[++i]);
    else if (token === '--out') args.outDir = argv[++i];
    else throw new Error(`run-successor-eval: unknown argument ${token}`);
  }
  if (typeof args.modelVersion !== 'string' || args.modelVersion.trim() === '') {
    throw new Error('run-successor-eval: --model-version is required');
  }
  if (!Number.isFinite(args.season)) {
    throw new Error('run-successor-eval: --season is required');
  }
  if (typeof args.outDir !== 'string' || args.outDir.trim() === '') {
    throw new Error('run-successor-eval: --out is required');
  }
  return args;
}

/**
 * Confines `--out` to inside this repository - identical containment proof
 * to `run-holdout-confirm.js`'s `resolveOutputPaths` (see there for why each
 * step is ordered the way it is). Duplicated rather than shared because the
 * two runners are independent study artifacts with their own two basenames;
 * factoring this into scripts/holdout/lib would widen #1439's reservation
 * beyond what the ruling scoped.
 */
function resolveOutputPaths(outDir) {
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('run-successor-eval: --out must be a non-empty path');
  }
  rootSafety.assertNotUncFormPath(outDir, 'run-successor-eval: --out');
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolved = path.resolve(REPO_ROOT, outDir);
  const rootCmp = rootSafety.normalizeForCompare(rootSafety.canonicalizeForCompare(REPO_ROOT));
  const outCmp = rootSafety.normalizeForCompare(rootSafety.canonicalizeForCompare(resolved));
  if (!rootSafety.isContainedIn(rootCmp, outCmp)) {
    throw new Error(
      `run-successor-eval: --out (${outDir}) resolves to ${resolved}, which is not a directory `
      + 'inside this repository - the report is a study artifact and is written beside the '
      + 'ledger it answers, never to an arbitrary location and never loose at the repository root'
    );
  }
  return {
    dir: resolved,
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    reportJson: path.join(resolved, 'report.json'),
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    reportMd: path.join(resolved, 'REPORT.md'),
  };
}

/** Every captured `scheduled`-arm week for one profile, in successorEval's `{ header, rows }` shape. */
async function loadCapturedWeeks({ season, profileName, client }) {
  const rules = SCORING_PRESETS[profileName];
  if (!rules) throw new Error(`run-successor-eval: unknown scoring profile ${profileName}`);
  const scoringHash = model.scoringHash(rules);
  const headers = await client.query(
    `SELECT "id", "week", "scoring_hash", "capture_not_after"
     FROM "projection_snapshots"
     WHERE "season" = $1 AND "scoring_profile" = $2 AND "scoring_hash" = $3 AND "capture_kind" = 'scheduled'
     ORDER BY "week"`,
    [season, profileName, scoringHash]
  );
  const weeks = [];
  for (const header of headers.rows) {
    const children = await client.query(
      `SELECT "player_id", "position", "nfl_team", "injury_status", "mean", "median",
              "p10", "p25", "p75", "p90", "active_probability", "sample_size", "factors"
       FROM "projection_snapshot_players" WHERE "snapshot_id" = $1 ORDER BY "player_id"`,
      [header.id]
    );
    weeks.push({
      header: {
        season,
        week: header.week,
        scoringHash: header.scoring_hash,
        captureNotAfter: header.capture_not_after,
      },
      rows: children.rows.map((r) => ({
        playerId: r.player_id,
        position: r.position,
        nflTeam: r.nfl_team,
        injuryStatus: r.injury_status,
        mean: r.mean,
        median: r.median,
        p10: r.p10,
        p25: r.p25,
        p75: r.p75,
        p90: r.p90,
        activeProbability: r.active_probability,
        sampleSize: r.sample_size,
        factors: r.factors || {},
      })),
    });
  }
  return { rules, weeks };
}

/**
 * `player_stats`, re-priced under `rules` (the SAME re-pricing rule
 * `projectionFeatures.js` states as invariant 2: the stored default-scoring
 * column is never read as authoritative). Keyed `'season:week:playerId'`,
 * matching `coverage.armWeekMetrics` and `scripts/holdout/lib/evaluate.js`'s
 * convention. A player-week absent here scores 0 downstream (missing is
 * missing, not fabricated - but a missed game is an honest 0 for a Survivor
 * cohort actual, per the same rule `coverage.js` already applies).
 */
async function loadActuals({
  season, weeks, playerIds, rules, client,
}) {
  const actuals = new Map();
  if (weeks.length === 0 || playerIds.length === 0) return actuals;
  const result = await client.query(
    `SELECT "player_id", "season", "week", "stats" FROM "player_stats"
     WHERE "season" = $1 AND "week" = ANY($2::int[]) AND "player_id" = ANY($3::int[])`,
    [season, weeks, playerIds]
  );
  for (const row of result.rows) {
    actuals.set(`${row.season}:${row.week}:${row.player_id}`, calculateFantasyPoints(row.stats, rules));
  }
  return actuals;
}

async function loadProfile({ season, profileName, client }) {
  const { rules, weeks } = await loadCapturedWeeks({ season, profileName, client });
  if (weeks.length === 0) return { name: profileName, rules, weeks, actuals: new Map() };
  const playerIds = [...new Set(weeks.flatMap((w) => w.rows.map((r) => r.playerId)))];
  const weekNumbers = weeks.map((w) => w.header.week);
  const actuals = await loadActuals({
    season, weeks: weekNumbers, playerIds, rules, client,
  });
  return { name: profileName, rules, weeks, actuals };
}

async function main(argv) {
  const args = parseArgs(argv);
  // Fail before ANY I/O when the checkout cannot supply this version's
  // constants (ruling point 1) - and before `--out` is even resolved.
  successorEval.constantsFor(args.modelVersion);
  const out = resolveOutputPaths(args.outDir);

  const profiles = [];
  for (const profileName of Object.keys(SCORING_PRESETS)) {
    // eslint-disable-next-line no-await-in-loop -- three profiles, sequential reads against a shared pool
    profiles.push(await loadProfile({ season: args.season, profileName, client: pool }));
  }

  const result = await successorEval.evaluate({
    profiles,
    modelVersion: args.modelVersion,
    // The real engine, read-only: `generateProjections` issues only SELECTs
    // (loadFeatureBundle, the odds/expert providers), and its own default
    // `client` is this same pool.
    generateProjections: projection.generateProjections,
  });

  fs.mkdirSync(out.dir, { recursive: true });
  fs.writeFileSync(out.reportJson, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(out.reportMd, `${successorEval.renderReport(result)}\n`, 'utf8');
  const scored = Object.values(result.profiles).reduce((s, p) => s + p.weeksScored, 0);
  console.log(`successor-eval: ${args.modelVersion} evaluated across ${Object.keys(result.profiles).length} `
    + `profiles, ${scored} profile-weeks scored`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = {
  parseArgs, resolveOutputPaths, loadCapturedWeeks, loadActuals, loadProfile, main,
};
