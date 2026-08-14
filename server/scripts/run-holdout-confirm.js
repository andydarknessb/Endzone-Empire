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
const rootSafety = require('../../scripts/backtest/lib/rootSafety');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

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

/**
 * The ONE place this file turns `--out` into paths on disk.
 *
 * Unlike the frozen registry literals the rest of this tooling joins, `--out`
 * is genuine operator input, so the safety property cannot be argued from the
 * value's provenance - it has to be PROVEN here. The argument is refused
 * outright if it is UNC-form, then canonicalized through `rootSafety` (which
 * resolves symlinks, junctions and Windows on-disk casing, and tolerates a
 * directory that does not exist yet) and required to land inside this
 * repository. Only then is it joined with the two report basenames, which are
 * literals in this module and cannot contribute a separator or a traversal
 * segment.
 *
 * Confining the output to the repository is deliberate, and matches the
 * docblock at the top of this file: these reports ARE study artifacts and
 * belong beside the preregistration they answer, which is also why the
 * January runbook commits them. Do not relax this to "wherever the operator
 * points" without revisiting that runbook.
 *
 * Called before any database read, so a bad `--out` fails in the first
 * millisecond rather than after a full ledger extraction and evaluation.
 */
function resolveOutputPaths(outDir) {
  // `--out ''` (an unset shell variable interpolated into the flag) reaches
  // here: `parseArgs` only rejects `undefined`. Before this guard it resolved
  // to the repository root and dropped REPORT.md there silently, where the
  // pre-existing `fs.mkdirSync('')` had failed loudly with ENOENT. Turning a
  // loud failure into a quiet write is the opposite of this function's job,
  // and it contradicts the "Required arguments, no defaults" rule above.
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('run-holdout-confirm: --out must be a non-empty path');
  }
  rootSafety.assertNotUncFormPath(outDir, 'run-holdout-confirm: --out');
  // Resolving is the FIRST half of the containment proof, not a use: the value
  // is compared against the repository root immediately below and is refused
  // before it reaches any filesystem call. Same shape, and same annotation, as
  // `rootSafety.canonicalizeForCompare`, which this line feeds.
  //
  // Anchored to REPO_ROOT, not to `process.cwd()`. A relative `--out` names a
  // location in the repository - that is what the runbook's
  // `backtest-artifacts/holdout-confirm-2026` means, and it has to mean the
  // same directory whether the operator runs from the repo root, from
  // `server/`, or from anywhere else. An absolute `--out` is unaffected:
  // `path.resolve` ignores the base for it.
  //
  // The suppression below must stay on the line DIRECTLY above the call:
  // Semgrep honours `nosemgrep` only on the finding's own line or the one
  // immediately preceding it, so an explanatory comment inserted between the
  // two silently un-suppresses the rule.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolved = path.resolve(REPO_ROOT, outDir);
  const rootCmp = rootSafety.normalizeForCompare(rootSafety.canonicalizeForCompare(REPO_ROOT));
  const outCmp = rootSafety.normalizeForCompare(rootSafety.canonicalizeForCompare(resolved));
  // The repository ROOT itself is not a legal target: these are study
  // artifacts and belong in a study directory, never loose at the top of the
  // working tree. `isContainedIn` returns false on equality, so requiring it
  // alone is exactly the rule wanted - no equality escape hatch.
  if (!rootSafety.isContainedIn(rootCmp, outCmp)) {
    throw new Error(
      `run-holdout-confirm: --out (${outDir}) resolves to ${resolved}, which is not a directory `
      + 'inside this repository - the report is a study artifact and is written beside the '
      + 'preregistration it answers, never to an arbitrary location and never loose at the '
      + 'repository root'
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

  fs.mkdirSync(out.dir, { recursive: true });
  fs.writeFileSync(out.reportJson, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  fs.writeFileSync(out.reportMd, `${renderReport(result)}\n`, 'utf8');
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

module.exports = { parseArgs, resolveOutputPaths, loadWeeks, loadActuals, main };
