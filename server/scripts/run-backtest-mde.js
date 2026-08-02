/* eslint-disable no-console */
'use strict';

/**
 * The real-wiring entry point for Step 3: run the blinded, control-only MDE
 * artifact (`mde-artifact.json`) that becomes freeze Commit M.
 *
 * WHY THIS FILE LIVES UNDER server/scripts/, NOT scripts/backtest/
 *
 * `lib/controlCellEvaluator.js` and `lib/mde.js` are pure and take a projection
 * FUNCTION as an argument; something has to be the function, and that something
 * is `projection.service.generateProjections` run against a REHYDRATED snapshot
 * client - both of which reach `server/services/*` and neither of which
 * `scripts/backtest/**` may require. This file is that wiring, and nothing more:
 * every decision worth reviewing (the control-only guard, the pairwise/regret
 * machinery, the power-contour algorithm) lives in the pure, tested modules this
 * file calls.
 *
 * WHY A REHYDRATED SNAPSHOT, NEVER THE LOCAL SEALED ONE
 *
 * Same reasoning as `run-backtest-rosters.js`: Commit M has to be reproducible
 * from committed bytes alone (that is the entire point of the reproduction CI
 * workflow), so this script is pointed at rehydration OUTPUT
 * (`--rehydrated-snapshot`, required, no default) rather than at
 * `backtest-data/snapshot/`, which is never committed.
 *
 * `--out <path>` IS ALSO REQUIRED, WITH NO DEFAULT
 *
 * The container entrypoint (freeze plan Step 5) points this at a dedicated
 * writable output bind-mount, never at the read-only worktree mount the
 * rehydrated snapshot and the code itself are mounted from. A default here -
 * even a sensible-looking one under the worktree - would be a script that could
 * silently try to write into a read-only mount, or silently write somewhere the
 * container's copy-out step never looks. See `rehydrate.js`'s own
 * `--out-snapshot`/`--out-sources` for the identical discipline.
 *
 * `--rosters` AND `--cohort` are also required, with no default: DIRECTORIES
 * of the committed Commit-A artifacts `run-backtest-rosters.js` actually
 * writes - `<out>/roster-weeks/<season>-w<week>.json` and
 * `<out>/cohort-weeks/<season>-w<week>.json` respectively, one file per
 * season-week, each self-identifying its own `season`/`week`. (An earlier
 * version of this script expected a single aggregated `"season:week"`-keyed
 * JSON file for each; that shape was never what the roster script produced,
 * so the CONTRACT here is the directory-of-per-week-files shape both scripts
 * now agree on - see `loadWeekArtifactsFromDir` below, and
 * `run-backtest-rosters.js`'s own docblock for the writing side.) The cohort
 * artifacts carry the resolved outcome-truth `actualPointsByPlayerId` per
 * preregistration 4.3 (`lib/outcomes.resolveCohortOutcomes`). This script
 * LOADS them; it never regenerates them - matching the plan's "the sweep
 * loads them, it never regenerates them" discipline for roster artifacts
 * (`lib/rosters.js` module docblock), extended here to the MDE's control-cell
 * inputs. Only the 17 primary 2025 weeks are actually read by the control
 * evaluator; a directory may contain the full 34 season-weeks (both scripts'
 * natural output) without error - the 2024 files are simply never looked up.
 *
 * THE ARTIFACT MUST BE ENVIRONMENT-FREE
 *
 * No Node version, no absolute path, no timestamp anywhere in the written
 * bytes - runtime identity belongs only in freeze Commit B's manifest
 * (`run-backtest-freeze-manifest.js`), sourced from a runtime-identity sidecar
 * the container wrote, never from this process's own `process.version`/
 * `process.platform`. `buildArtifact`/`serializeArtifact` below are exported so
 * `server/test/backtestMde.test.js`'s pinning test can exercise the exact
 * canonicalization this script uses without needing a database.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const snapshotClientLib = require('../../scripts/backtest/lib/snapshotClient');
const controlCellEvaluator = require('../../scripts/backtest/lib/controlCellEvaluator');
const ordering = require('../../scripts/backtest/lib/ordering');
const rostersLib = require('../../scripts/backtest/lib/rosters');
const mde = require('../../scripts/backtest/lib/mde');
const asOf = require('../../scripts/backtest/lib/asOfView');
const cohortLib = require('../../scripts/backtest/lib/cohort');
const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');
const { collectColumns } = require('../../scripts/backtest/lib/csv');
const { makeSourceReader } = require('../../scripts/backtest/snapshot-checks');

const { normalizeTeamKey } = require('../services/projectionFeatures');
const { generateProjections } = require('../services/projection.service');
const { availabilityFor } = require('../services/projectionModel');
const { optimalAssignment } = require('../services/lineupOptimizer');
const model = require('../services/projectionModel');
const { SCORING_RULES } = require('../services/scoring.service');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function requireFlagValue(argv, index, flagName) {
  const value = argv[index];
  if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
    throw new Error(`run-backtest-mde: ${flagName} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    rehydratedSnapshot: null, rehydratedSources: null, rosters: null, cohort: null, out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--rehydrated-snapshot') args.rehydratedSnapshot = requireFlagValue(argv, ++i, token);
    else if (token === '--rehydrated-sources') args.rehydratedSources = requireFlagValue(argv, ++i, token);
    else if (token === '--rosters') args.rosters = requireFlagValue(argv, ++i, token);
    else if (token === '--cohort') args.cohort = requireFlagValue(argv, ++i, token);
    else if (token === '--out') args.out = requireFlagValue(argv, ++i, token);
    else throw new Error(`run-backtest-mde: unknown argument ${token}`);
  }
  for (const [flag, value] of [
    ['--rehydrated-snapshot', args.rehydratedSnapshot],
    ['--rehydrated-sources', args.rehydratedSources],
    ['--rosters', args.rosters],
    ['--cohort', args.cohort],
    ['--out', args.out],
  ]) {
    if (!value) {
      throw new Error(
        `run-backtest-mde: ${flag} is required, with no default. A defaulted output path is a path `
        + 'that can silently land outside the container\'s dedicated writable output mount.'
      );
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Loading the directory-of-per-week-files artifacts (see module docblock)
// ---------------------------------------------------------------------------

/**
 * `--rosters`/`--cohort` are DIRECTORIES of `<season>-w<week>.json` files -
 * exactly what `run-backtest-rosters.js` writes to `roster-weeks/` and
 * `cohort-weeks/`. Every `.json` file in the directory is read and indexed by
 * its OWN `season`/`week` fields (never by filename - the filename is a
 * naming convention, not the source of truth), matching every other artifact
 * this pipeline reads by content rather than by path.
 *
 * Fails loudly on a file with no `season`/`week`, and on two files claiming
 * the same season-week - both would otherwise be silently one-or-the-other
 * depending on directory iteration order.
 *
 * `verifyFreezeHash`, if supplied, re-derives each artifact's `freezeHash`
 * from its own contents and fails loudly on a mismatch. `freezeHash` is
 * computed once at write time (`rosterGeneration.js`/`run-backtest-
 * rosters.js`) and stored in the artifact, but nothing previously read it
 * back and re-checked it - it was write-only, so a byte corrupted in a
 * roster-weeks/cohort-weeks file after Commit A (a bad merge, a manual edit,
 * a filesystem fault) would be silently consumed by the MDE run instead of
 * being caught at the point of use.
 */
function loadWeekArtifactsFromDir(dirPath, { label, verifyFreezeHash } = {}) {
  // dirPath is the operator's own --rosters/--cohort CLI argument to this
  // locally-invoked tool, not external/network input.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const dir = path.resolve(String(dirPath));
  let entries;
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch (err) {
    throw new Error(`${label}: could not read directory ${dir} (${err.message})`);
  }
  if (entries.length === 0) {
    throw new Error(`${label}: ${dir} contains no .json files`);
  }
  const byKey = {};
  for (const file of entries) {
    // file is a dirent name fs.readdirSync itself just reported as existing
    // under dir - not external input.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const full = path.join(dir, file);
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (parsed.season === undefined || parsed.week === undefined) {
      throw new Error(`${label}: ${file} has no season/week - every artifact must self-identify its week`);
    }
    if (verifyFreezeHash) {
      if (typeof parsed.freezeHash !== 'string' || parsed.freezeHash.trim() === '') {
        throw new Error(`${label}: ${file} has no freezeHash to verify`);
      }
      const recomputed = verifyFreezeHash(parsed);
      if (recomputed !== parsed.freezeHash) {
        throw new Error(
          `${label}: ${file}'s stored freezeHash (${parsed.freezeHash}) does not match its own recomputed `
          + `hash (${recomputed}) - the file's contents have diverged from what produced its freezeHash`
        );
      }
    }
    const key = `${Number(parsed.season)}:${Number(parsed.week)}`;
    if (byKey[key]) {
      throw new Error(`${label}: both ${byKey[key].__file} and ${file} claim season-week ${key}`);
    }
    byKey[key] = { ...parsed, __file: file };
  }
  for (const value of Object.values(byKey)) delete value.__file;
  return byKey;
}

/** Re-derives a roster-week artifact's freezeHash from its own contents (mirrors `lib/rosters.freezeHash`). */
function verifyRosterFreezeHash(parsed) {
  return rostersLib.freezeHash(parsed);
}

/** Re-derives a cohort-week artifact's freezeHash from its own contents (mirrors `run-backtest-rosters.js`'s `cohortFreezeHash`). */
function verifyCohortFreezeHash(parsed) {
  const { freezeHash: _stored, ...rest } = parsed;
  return crypto.createHash('sha256').update(canonicalJson(rest), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Environment-free canonicalization
// ---------------------------------------------------------------------------

/**
 * A conservative pattern for "looks like it leaked runtime identity": a
 * `process.version`-shaped string (`v` + digits + dots), or any absolute
 * filesystem path shape (POSIX `/...` or Windows `C:\...`). Checked against
 * the FULLY SERIALIZED artifact, not field-by-field, so a leak nested inside
 * `perWeekDetail` or any future field is caught the same way a top-level one
 * would be.
 */
const NODE_VERSION_SHAPE = /\bv\d+\.\d+\.\d+\b/;
const ABSOLUTE_PATH_SHAPE = /(^|[^A-Za-z0-9_./\\-])(\/[A-Za-z0-9_.-]+\/[^\s"]*|[A-Za-z]:\\[^\s"]*)/;

function assertEnvironmentFree(serialized, { label = 'mde-artifact' } = {}) {
  if (!/^[\x00-\x7F]*$/.test(serialized)) {
    throw new Error(`${label}: contains non-ASCII bytes; the artifact must be plain-ASCII canonical JSON`);
  }
  if (NODE_VERSION_SHAPE.test(serialized)) {
    throw new Error(`${label}: contains a process.version-shaped substring; runtime identity belongs only in Commit B's manifest`);
  }
  if (ABSOLUTE_PATH_SHAPE.test(serialized)) {
    throw new Error(`${label}: contains an absolute-path-shaped substring; the artifact must carry no filesystem paths`);
  }
  return true;
}

/**
 * Build the committed artifact shape: the MDE report plus the control cell's
 * per-week series it was computed from (so a reader can check the SD estimates
 * without recomputing them), and NOTHING that identifies this machine or this
 * moment.
 */
function buildArtifact({ controlEvaluation, mdeReport }) {
  return {
    cell: controlEvaluation.cell,
    season: controlEvaluation.season,
    weeks: controlEvaluation.weeks,
    controlRegretWeeks: controlEvaluation.controlRegretWeeks,
    controlPairwiseWeeks: controlEvaluation.controlPairwiseWeeks,
    mde: mdeReport,
  };
}

/** Canonical, environment-free serialization - the exact bytes this script writes. */
function serializeArtifact(artifact) {
  const serialized = `${canonicalJson(artifact)}\n`;
  assertEnvironmentFree(serialized);
  return serialized;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const ROSTER_COLUMNS = ['season', 'week', 'game_type', 'gsis_id', 'team', 'position', 'status', 'full_name'];
const PLAYERS_CROSSWALK_COLUMNS = ['gsis_id', 'espn_id'];

/**
 * Build the `reconstruction` bundle `snapshotClient.createSnapshotClient`
 * requires in `reconstructed` mode, for the one season the MDE's control
 * evaluation ever touches (2025, the primary season - `lib/
 * controlCellEvaluator.PRIMARY_SEASON`).
 *
 * Mirrors `run-backtest-rosters.js`'s own season-context construction (same
 * `rosterIndex`/crosswalk/`gsisByPlayerId` machinery), because the two scripts
 * must reconstruct the SAME 2025 weeks the same way - a divergence here would
 * mean the control cell's projections were computed against a subtly different
 * roster reconstruction than the one its regret estimand was drafted from.
 */
function buildReconstruction({ readSource, snapshot, season }) {
  const rosterRows = collectColumns(
    readSource(`roster_weekly_${season}`), ROSTER_COLUMNS, { label: `roster_weekly_${season}` }
  ).rows;
  const rosterIndex = asOf.buildRosterIndex(rosterRows);

  const playersCsvRows = collectColumns(
    readSource('players'), PLAYERS_CROSSWALK_COLUMNS, { label: 'players.csv' }
  ).rows;
  const crosswalk = cohortLib.buildCrosswalk(playersCsvRows);
  const { gsisByPlayerId } = cohortLib.buildGsisByPlayerId({ dbPlayers: snapshot.players, crosswalk });

  return {
    rosterIndex,
    normalizeTeamKey,
    gsisByPlayerId,
    // The primary policy discards injury status entirely (prereg 4.2); a null
    // injuryIndex is legal for it (asOf.reconstructPlayerWeek treats a missing
    // index as "no injury information", which is exactly what the primary
    // policy means).
    policy: asOf.INJURY_POLICIES.PRIMARY,
    overlayRows: snapshot.orientationOverlay,
    viewFor: ({ season: s, week: w, gsisId }) => asOf.reconstructPlayerWeek({
      rosterIndex, injuryIndex: null, policy: asOf.INJURY_POLICIES.PRIMARY, season: s, week: w, gsisId, normalizeTeamKey,
    }),
  };
}

async function main(argv) {
  const args = parseArgs(argv);

  const snapshot = snapshotClientLib.loadSnapshot({ root: args.rehydratedSnapshot });
  // See run-backtest-rosters.js's identical fix: `makeSourceReader` needs an
  // explicit `provenancePath`, and `rehydrate.js` writes it to
  // `<rehydratedSources>/provenance.json`. Omitting it resolved to
  // `undefined` and failed every real run.
  const readSource = makeSourceReader({
    sourcesDir: args.rehydratedSources,
    // args.rehydratedSources is the operator's own CLI argument, joined only
    // with a hardcoded literal filename - not external input.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    provenancePath: path.join(args.rehydratedSources, 'provenance.json'),
  });
  const rosterIndexByWeek = loadWeekArtifactsFromDir(args.rosters, {
    label: 'run-backtest-mde --rosters', verifyFreezeHash: verifyRosterFreezeHash,
  });
  const cohortIndexByWeek = loadWeekArtifactsFromDir(args.cohort, {
    label: 'run-backtest-mde --cohort', verifyFreezeHash: verifyCohortFreezeHash,
  });

  const reconstruction = buildReconstruction({
    readSource, snapshot, season: controlCellEvaluator.PRIMARY_SEASON,
  });

  // Fails closed on a duplicate position/player-name rank row - the same
  // invariant run-backtest-rosters.js enforces on this identical source data
  // (`ordering.buildRankIndex`) - rather than hand-building a `new Map(...)`
  // from the raw rows, which silently last-wins on a duplicate key instead of
  // throwing.
  const ranks = ordering.buildRankIndex({
    positionRankRows: snapshot.positionRank,
    playerNameRankRows: snapshot.playerNameRank,
    label: 'run-backtest-mde candidate ranking',
  });

  const weekArtifacts = new Map();
  for (const [key, rosterWeek] of Object.entries(rosterIndexByWeek)) {
    const cohortWeek = cohortIndexByWeek[key];
    if (!cohortWeek) throw new Error(`run-backtest-mde: no cohort artifact for ${key}`);
    weekArtifacts.set(key, {
      rosterWeek,
      cohortWeek: {
        ...cohortWeek,
        actualPointsByPlayerId: new Map(Object.entries(cohortWeek.actualPointsByPlayerId || {}).map(
          ([id, points]) => [Number(id), points]
        )),
      },
      positionRank: ranks.positionRank,
      nameRankById: ranks.nameRankById,
    });
  }

  const projectPoints = async ({
    season, week, playerIds, modelConstants,
  }) => {
    // `generateProjections` returns `{ projections, inputCutoff,
    // sourceCoverage }` (projection.service.js:456), not the per-player Map
    // itself - `controlCellEvaluator`'s `pairwiseRowsByPosition`/roster entry
    // lookups need the Map keyed by playerId directly. Returning the whole
    // wrapper here made every playerId lookup miss (indexing an object keyed
    // "projections"/"inputCutoff"/"sourceCoverage" by a numeric playerId is
    // always undefined), which silently produced 0 finite projections for
    // every week and surfaced only as "need at least two weeks to estimate
    // an SD" three steps downstream in lib/mde.js - caught by a real
    // end-to-end container run, not by code review.
    const { projections } = await generateProjections({
      season,
      week,
      rules: SCORING_RULES,
      playerIds,
      hashValue: model.scoringHash(SCORING_RULES),
      client: snapshotClientLib.createSnapshotClient({
        snapshot, season, week, mode: snapshotClientLib.MODES.RECONSTRUCTED, reconstruction,
      }),
      weatherService: false,
      modelConstants,
    });
    return projections;
  };

  const controlEvaluation = await controlCellEvaluator.evaluateControlCell({
    weekArtifacts,
    baseConstants: model.MODEL_CONSTANTS,
    projectPoints,
    availabilityFor,
    optimize: optimalAssignment,
  });

  const mdeReport = mde.runMde({
    controlRegretWeeks: controlEvaluation.controlRegretWeeks,
    controlPairwiseWeeks: controlEvaluation.controlPairwiseWeeks,
    artifacts: [{ cell: controlEvaluation.cell }],
  });

  const artifact = buildArtifact({ controlEvaluation, mdeReport });
  const serialized = serializeArtifact(artifact);

  // args.out is the operator's own CLI argument to this locally-invoked
  // tool, not external/network input.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  fs.mkdirSync(path.dirname(path.resolve(String(args.out))), { recursive: true });
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  fs.writeFileSync(path.resolve(String(args.out)), serialized, 'utf8');
  console.log(`wrote MDE artifact to ${args.out}`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  NODE_VERSION_SHAPE,
  ABSOLUTE_PATH_SHAPE,
  assertEnvironmentFree,
  buildArtifact,
  serializeArtifact,
  buildReconstruction,
  loadWeekArtifactsFromDir,
  main,
};
