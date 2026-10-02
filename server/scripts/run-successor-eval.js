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
 *
 * It applies backtest-artifacts/v3.2-successor-gate/DECISION_RULE.md (#1938):
 * only the weeks holdout-confirm-2026's `survivingWeeks` keeps for half_ppr are
 * scored, for every profile.
 *
 *   --deciding-read <sha>  required for any model version other than
 *                         free_baseline_v3.1 and must equal this checkout's
 *                         HEAD (rule section 2); otherwise the run is refused
 *                         before any query. free_baseline_v3.1 is the
 *                         calibration run and evaluates no check.
 *   --v31-digest          print the SHA-256 of the rebuilt v3.1 rows over every
 *                         half_ppr week captured so far, and nothing else (the
 *                         per-child comparison of rule section 2). Takes
 *                         --season only.
 */

const fs = require('fs');
const path = require('path');
const pool = require('../modules/pool');
const successorEval = require('../../scripts/holdout/lib/successorEval');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { SCORING_PRESETS, calculateFantasyPoints } = require('../services/scoringRules');
const model = require('../services/projectionModel');
const projection = require('../services/projection.service');
const rootSafety = require('../../scripts/backtest/lib/rootSafety');
const evaluator = require('../../scripts/holdout/lib/evaluate');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RULE_PATH = path.join(REPO_ROOT, 'backtest-artifacts', 'v3.2-successor-gate', 'DECISION_RULE.md');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--model-version') args.modelVersion = argv[++i];
    else if (token === '--season') args.season = Number(argv[++i]);
    else if (token === '--out') args.outDir = argv[++i];
    else if (token === '--deciding-read') args.decidingRead = argv[++i];
    else if (token === '--v31-digest') args.v31Digest = true;
    else throw new Error(`run-successor-eval: unknown argument ${token}`);
  }
  if (!Number.isFinite(args.season)) {
    throw new Error('run-successor-eval: --season is required');
  }
  if (args.v31Digest) return args;
  if (typeof args.modelVersion !== 'string' || args.modelVersion.trim() === '') {
    throw new Error('run-successor-eval: --model-version is required');
  }
  if (typeof args.outDir !== 'string' || args.outDir.trim() === '') {
    throw new Error('run-successor-eval: --out is required');
  }
  return args;
}

/**
 * Rule section 2: a v3.2 column is computed only from the freeze commit it is
 * given, run from that commit. Pure; `head` is this checkout's HEAD.
 */
function assertDecidingRead({ modelVersion, decidingRead }, head, dirty = '') {
  if (modelVersion === successorEval.MODEL_VERSION_V3_1) return;
  if (decidingRead !== head) {
    throw new Error(
      `run-successor-eval: ${modelVersion} is computed only with --deciding-read <sha> equal to this checkout's HEAD `
      + `(${head}); got ${decidingRead === undefined ? 'no --deciding-read' : decidingRead}. Refusing before any query (rule section 2).`
    );
  }
  if (dirty) {
    throw new Error(`run-successor-eval: the deciding read runs from a clean checkout of the freeze commit (rule section 2); tracked changes present:
${dirty}`);
  }
}

const gitDirty = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
const gitHead = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

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

/**
 * Rule section 3: the weeks the sealed `survivingWeeks` keeps for half_ppr, from
 * the scheduled and both candidate headers and child ids in the shape
 * run-holdout-confirm.js builds. Used for every profile.
 */
async function loadSurvivors({ season, client }) {
  const rules = SCORING_PRESETS[successorEval.GATE_PROFILE];
  const headers = await client.query(
    `SELECT "id", "week", "capture_kind", "constants_hash", "model_version", "cohort_hash",
            "cohort_size", "captured_at", "capture_not_after", "is_late"
     FROM "projection_snapshots"
     WHERE "season" = $1 AND "scoring_profile" = $2 AND "scoring_hash" = $3
       AND "capture_kind" = ANY($4::text[])
     ORDER BY "week", "capture_kind"`,
    [season, successorEval.GATE_PROFILE, model.scoringHash(rules), [evaluator.CONTROL_KIND, ...evaluator.CELL_KINDS]]
  );
  const byWeek = new Map();
  for (const header of headers.rows) {
    // eslint-disable-next-line no-await-in-loop -- sequential reads against a shared pool
    const children = await client.query(
      'SELECT "player_id" FROM "projection_snapshot_players" WHERE "snapshot_id" = $1 ORDER BY "player_id"',
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
      rows: children.rows.map((r) => ({ playerId: r.player_id })),
    };
  }
  return successorEval.selectSurvivors([...byWeek.values()].sort((a, b) => a.week - b.week));
}

/** Every captured `scheduled`-arm week for one profile (only `weekNumbers` when given), in successorEval's `{ header, rows }` shape. */
async function loadCapturedWeeks({
  season, profileName, client, weekNumbers = null,
}) {
  const rules = SCORING_PRESETS[profileName];
  if (!rules) throw new Error(`run-successor-eval: unknown scoring profile ${profileName}`);
  const scoringHash = model.scoringHash(rules);
  const headers = await client.query(
    `SELECT "id", "week", "scoring_hash", "capture_not_after"
     FROM "projection_snapshots"
     WHERE "season" = $1 AND "scoring_profile" = $2 AND "scoring_hash" = $3 AND "capture_kind" = 'scheduled'
       AND ($4::int[] IS NULL OR "week" = ANY($4::int[]))
     ORDER BY "week"`,
  [season, profileName, scoringHash, weekNumbers]
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

async function loadProfile({
  season, profileName, client, weekNumbers = null,
}) {
  const { rules, weeks } = await loadCapturedWeeks({
    season, profileName, client, weekNumbers,
  });
  if (weeks.length === 0) return { name: profileName, rules, weeks, actuals: new Map() };
  const playerIds = [...new Set(weeks.flatMap((w) => w.rows.map((r) => r.playerId)))];
  const loadedWeeks = weeks.map((w) => w.header.week);
  const actuals = await loadActuals({
    season, weeks: loadedWeeks, playerIds, rules, client,
  });
  return { name: profileName, rules, weeks, actuals };
}

async function main(argv, { head = gitHead, dirty = gitDirty } = {}) {
  const args = parseArgs(argv);
  if (args.v31Digest) {
    const { rules, weeks } = await loadCapturedWeeks({ season: args.season, profileName: successorEval.GATE_PROFILE, client: pool });
    console.log(await successorEval.rebuildV31Digest({ weeks, rules, generateProjections: projection.generateProjections }));
    return 0;
  }
  // Fail before ANY I/O when the deciding read is not authorised, or when the
  // checkout cannot supply either the target version's constants OR v3.1's
  // (every report carries the v3.1 rebuild as its error bar), and before
  // `--out` is even resolved.
  // The calibration run is not a deciding read: no git call for it.
  if (args.modelVersion !== successorEval.MODEL_VERSION_V3_1) assertDecidingRead(args, head(), dirty());
  successorEval.constantsFor(args.modelVersion);
  successorEval.constantsFor(successorEval.MODEL_VERSION_V3_1);
  const out = resolveOutputPaths(args.outDir);
  const ruleSha256 = crypto.createHash('sha256').update(fs.readFileSync(RULE_PATH)).digest('hex');

  const survivors = await loadSurvivors({ season: args.season, client: pool });
  const profiles = [];
  for (const profileName of Object.keys(SCORING_PRESETS)) {
    // eslint-disable-next-line no-await-in-loop -- three profiles, sequential reads against a shared pool
    profiles.push(await loadProfile({
      season: args.season, profileName, client: pool, weekNumbers: survivors.weeks,
    }));
  }

  const result = await successorEval.evaluate({
    profiles,
    survivors,
    modelVersion: args.modelVersion,
    // The real engine, read-only: `generateProjections` issues only SELECTs
    // (loadFeatureBundle, the odds/expert providers), and its own default
    // `client` is this same pool.
    generateProjections: projection.generateProjections,
  });
  result.ruleSha256 = ruleSha256;
  result.decidingRead = args.decidingRead || null;
  for (const profile of profiles) result.profiles[profile.name].actualsSha256 = successorEval.actualsDigest(profile.actuals);

  fs.mkdirSync(out.dir, { recursive: true });
  fs.writeFileSync(out.reportJson, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(out.reportMd, `${successorEval.renderReport(result)}\n`, 'utf8');
  console.log(`successor-eval: ${args.modelVersion} ${result.mode}, verdict ${result.verdict === null ? 'none' : result.verdict}, `
    + `${survivors.weeks.length} surviving weeks`);
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
  parseArgs, assertDecidingRead, resolveOutputPaths, loadSurvivors, loadCapturedWeeks, loadActuals, loadProfile, main,
};
