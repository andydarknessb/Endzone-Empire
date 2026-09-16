'use strict';

/**
 * #1484: "market on" vs "market off", scored over the EXISTING holdout
 * ledger, with no reprojection and no deploy.
 *
 * `projectPlayer` (projectionModel.js) already computes a market factor every
 * run from the odds sync (`factors.gameEnvironment`: `impliedPoints`,
 * `opponentImplied`, `slateAverageImplied`, the uncapped `rawEffect`), but
 * ships it inert: `MODEL_CONSTANTS.gameEnvironment.maxEffect` is 0, so the
 * shipped `effect` is always 0 and `scored` is always false. Because every
 * `projection_snapshot_players` row stores that `rawEffect` alongside the
 * captured mean/median/p10/p25/p75/p90, this script re-applies a candidate
 * cap (and optional shrinkage) directly to the ALREADY-CAPTURED distribution
 * - `scripts/holdout/lib/marketFactorReplay.js`'s `replayRows`, which shifts
 * mean/median/p10/p25/p75/p90 by `capturedMean * candidateEffect` exactly the
 * way `projectPlayer`'s `applyFactor('gameEnvironment', ...)` would have,
 * since `gameEnvironment` is the last multiplicative factor before
 * `simulateDistribution`'s additive residuals - and compares MAE, Spearman
 * rho, pairwise accuracy and 80%/50% interval coverage against
 * `player_stats`, per scoring profile, for ONE preregistered candidate
 * (`--max-effect`, optionally `--shrink`) against the `market-off` control.
 *
 * One candidate, not a sweep: ADR 0044 refuses a successor tuned on its own
 * test set, so the cap (and any shrinkage) is named on #1438 BEFORE this
 * runs, and the run answers yes or no for that candidate. The library
 * (`buildArms`) can still lay out several arms for a synthetic fixture in
 * tests; this runner deliberately does not expose that against the ledger.
 *
 * Weeks whose capture reports the market factor unavailable (`'no slate
 * baseline'` on 2026 week 1, or any other `gameEnvironment` unavailable
 * reason) are EXCLUDED from the comparison, not imputed
 * (`marketFactorReplay.weekEligibility`).
 *
 * READ-ONLY: this script issues only SELECTs against the production pool (it
 * reuses `run-successor-eval.js`'s own `loadProfile`, which reads
 * `projection_snapshots` / `projection_snapshot_players` / `player_stats`)
 * and never migrates or writes anything. It is an operator study run, not an
 * IC run.
 *
 * Activation is a constants change, not a code change: if some arm here beats
 * `market-off` on the full-season ledger, that arm's `maxEffect` (and
 * `shrink`, if used) becomes `MODEL_CONSTANTS.gameEnvironment`'s real values,
 * and that constants change rides the v3.2 version bump ONLY if it wins here
 * - per the ticket text (#1484). This script does not decide that; it only
 * produces the numbers the decision is made from.
 *
 * Required arguments:
 *
 *   --season 2026   the ledger season
 *   --out <dir>     where REPORT.md / report.json are written (confined
 *                    inside this repository, mirroring
 *                    run-successor-eval.js's resolveOutputPaths)
 *
 *   --max-effect 0.12  the ONE preregistered maxEffect candidate (from #1438)
 *
 * Optional:
 *
 *   --shrink 1         multiplier on rawEffect before the cap (default 1)
 *
 * Every scoring profile the ledger captures (standard, half_ppr, ppr) is
 * evaluated in one run, same as run-successor-eval.js - the report's whole
 * point is the profiles and arms side by side.
 */

const fs = require('fs');
const path = require('path');
const pool = require('../modules/pool');
const { SCORING_PRESETS } = require('../services/scoring.service');
const runSuccessorEval = require('./run-successor-eval');
const marketFactorReplay = require('../../scripts/holdout/lib/marketFactorReplay');
const rootSafety = require('../../scripts/backtest/lib/rootSafety');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const args = { maxEffect: null, shrink: 1 };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--season') args.season = Number(argv[++i]);
    else if (token === '--out') args.outDir = argv[++i];
    else if (token === '--max-effect') args.maxEffect = Number(argv[++i]);
    else if (token === '--shrink') args.shrink = Number(argv[++i]);
    else throw new Error(`compare-market-factor: unknown argument ${token}`);
  }
  if (!Number.isFinite(args.season)) {
    throw new Error('compare-market-factor: --season is required');
  }
  if (typeof args.outDir !== 'string' || args.outDir.trim() === '') {
    throw new Error('compare-market-factor: --out is required');
  }
  if (!Number.isFinite(args.maxEffect) || args.maxEffect <= 0) {
    throw new Error('compare-market-factor: --max-effect <positive number> is required (the one candidate preregistered on #1438)');
  }
  if (!Number.isFinite(args.shrink) || args.shrink <= 0 || args.shrink > 1) {
    throw new Error('compare-market-factor: --shrink must be a number in (0, 1]');
  }
  return args;
}

/**
 * Confines `--out` to inside this repository - identical containment proof
 * to `run-successor-eval.js`'s own `resolveOutputPaths` (see there for why
 * each step is ordered the way it is). Duplicated rather than shared for the
 * same reason that runner duplicates it from `run-holdout-confirm.js`: three
 * independent study artifacts, three own basenames, no shared reservation
 * beyond `rootSafety` itself.
 */
function resolveOutputPaths(outDir) {
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('compare-market-factor: --out must be a non-empty path');
  }
  rootSafety.assertNotUncFormPath(outDir, 'compare-market-factor: --out');
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolved = path.resolve(REPO_ROOT, outDir);
  const rootCmp = rootSafety.normalizeForCompare(rootSafety.canonicalizeForCompare(REPO_ROOT));
  const outCmp = rootSafety.normalizeForCompare(rootSafety.canonicalizeForCompare(resolved));
  if (!rootSafety.isContainedIn(rootCmp, outCmp)) {
    throw new Error(
      `compare-market-factor: --out (${outDir}) resolves to ${resolved}, which is not a directory `
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

async function main(argv) {
  const args = parseArgs(argv);
  const out = resolveOutputPaths(args.outDir);
  const arms = marketFactorReplay.buildArms({ caps: [args.maxEffect], shrinks: [args.shrink] });

  const profiles = [];
  for (const profileName of Object.keys(SCORING_PRESETS)) {
    // eslint-disable-next-line no-await-in-loop -- three profiles, sequential reads against a shared pool
    profiles.push(await runSuccessorEval.loadProfile({ season: args.season, profileName, client: pool }));
  }

  const result = marketFactorReplay.evaluateMarketFactor({ profiles, arms });

  fs.mkdirSync(out.dir, { recursive: true });
  fs.writeFileSync(out.reportJson, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(out.reportMd, `${marketFactorReplay.renderReport(result)}\n`, 'utf8');

  for (const [name, profile] of Object.entries(result.profiles)) {
    console.log(
      `compare-market-factor: ${name}: ${profile.eligibleWeeks.length} eligible week(s), `
      + `${profile.excludedWeeks.length} excluded`
    );
  }
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

module.exports = { parseArgs, resolveOutputPaths, main };
