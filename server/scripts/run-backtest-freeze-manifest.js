/* eslint-disable no-console */
'use strict';

/**
 * The real-wiring entry point for Step 4: produce `FREEZE_MANIFEST.json`,
 * which is Commit B in its entirety.
 *
 * WHY THIS FILE LIVES UNDER server/scripts/, NOT scripts/backtest/
 *
 * `lib/freezeManifest.js` validates a manifest's SHAPE but cannot fill one in:
 * that needs `git rev-parse`/`git cat-file` (a `child_process` call
 * `scripts/backtest/**` may never make) and a sidecar file the container wrote
 * (real filesystem I/O at a path this process does not control). This file is
 * that wiring, and nothing else - the shape rules live in the pure, tested
 * `lib/freezeManifest.js`.
 *
 * `--runtime-identity <path>` IS REQUIRED, WITH NO DEFAULT, AND IS THE ONLY
 * LEGITIMATE SOURCE OF NODE/OS/IMAGE IDENTITY
 *
 * This process runs on the HOST, after the container has already produced
 * Commit M. Its own `process.version`/`process.platform`/`process.arch` are
 * the host's, not the container's - recording them here would assert a
 * falsehood about what actually produced M (plan section 4: "recording its
 * own process.version/OS-arch there would assert a falsehood about what
 * actually produced M"). `--runtime-identity` must point at the runtime-
 * identity sidecar JSON the container entrypoint (freeze plan Step 5) wrote
 * into the OUTPUT mount - Node/npm versions read from INSIDE the running
 * container, plus the base image digest and platform baked into
 * `backtest.Dockerfile`. Per the plan, that sidecar is read IN PLACE and is
 * never copied into the working tree, so `freeze/` only ever contains the two
 * files actually meant to be committed (M, then this manifest).
 *
 * WHAT THIS SCRIPT DOES NOT DO. It does not verify Commit M's blob actually
 * matches the bytes at `freeze/mde-artifact.json` on disk beyond what `git
 * cat-file` itself reports; it does not run the reproduction check
 * (`backtest-reproduction.yml`'s job, in CI, separately). It only assembles
 * the manifest from git identities and the sidecar, validates the shape via
 * `lib/freezeManifest.assertValidManifest`, and writes it.
 *
 * THE SCORING PROFILES (prereg 4.3). `buildScoringProfiles` is the one piece
 * of REAL wiring in this file beyond git/the sidecar: it reads the three
 * preregistered profiles' actual rule sets off `scoring.service.SCORING_PRESETS`
 * - the same rules `run-backtest-rosters.js` scores every candidate through -
 * and pins each one's exact canonical serialization plus a SHA-256 hash of it,
 * with half-PPR marked primary. `lib/freezeManifest.js` validates the
 * resulting shape (exactly three, hash-correct, primary on half-PPR) but
 * cannot compute it, for the same reason it cannot compute a git SHA: it may
 * not require `server/services/*`.
 *
 * Usage (Step 7.6 of the freeze sequence, after Commit M has been pushed and
 * CI has reproduced it):
 *   node server/scripts/run-backtest-freeze-manifest.js \
 *       --commit-a <sha> --commit-m <sha> \
 *       --runtime-identity <path-in-the-output-mount> \
 *       --out backtest-artifacts/pit-sweep-2024-2025/freeze/FREEZE_MANIFEST.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const freezeManifest = require('../../scripts/backtest/lib/freezeManifest');
const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');
const { SCORING_PRESETS } = require('../services/scoring.service');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function requireFlagValue(argv, index, flagName) {
  const value = argv[index];
  if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
    throw new Error(`run-backtest-freeze-manifest: ${flagName} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = {
    commitA: null, commitM: null, runtimeIdentity: null, out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--commit-a') args.commitA = requireFlagValue(argv, ++i, token);
    else if (token === '--commit-m') args.commitM = requireFlagValue(argv, ++i, token);
    else if (token === '--runtime-identity') args.runtimeIdentity = requireFlagValue(argv, ++i, token);
    else if (token === '--out') args.out = requireFlagValue(argv, ++i, token);
    else throw new Error(`run-backtest-freeze-manifest: unknown argument ${token}`);
  }
  for (const [flag, value] of [
    ['--commit-a', args.commitA],
    ['--commit-m', args.commitM],
    ['--runtime-identity', args.runtimeIdentity],
    ['--out', args.out],
  ]) {
    if (!value) {
      throw new Error(
        `run-backtest-freeze-manifest: ${flag} is required, with no default. In particular, `
        + '--runtime-identity must never fall back to this host\'s own process.version/OS-arch, which '
        + 'would record a falsehood about what actually produced Commit M.'
      );
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// git identity
// ---------------------------------------------------------------------------

/** `git rev-parse <ref>^{commit}`, resolved and verified to be a real commit. */
function resolveCommitSha(ref, { git = defaultGit, label = 'git' } = {}) {
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  return freezeManifest.assertShaShape(sha, { label: `${label}: ${ref}` });
}

/** The root tree SHA of a commit (`git rev-parse <sha>^{tree}`). */
function resolveTreeSha(commitSha, { git = defaultGit, label = 'git' } = {}) {
  const sha = git(['rev-parse', `${commitSha}^{tree}`]).trim();
  return freezeManifest.assertShaShape(sha, { label: `${label}: tree of ${commitSha}` });
}

/**
 * The git blob SHA of `freeze/mde-artifact.json` AS COMMITTED IN `commitSha` -
 * i.e. Commit M's own record of that file's identity, read via `git
 * ls-tree` rather than by hashing a working-tree file (which could be stale,
 * uncommitted, or line-ending-mangled by a Windows checkout the
 * `backtest-artifacts/**` `.gitattributes` LF stanza from Commit A exists to
 * prevent in the first place).
 */
function resolveArtifactBlobSha(commitSha, {
  git = defaultGit,
  artifactPath = 'backtest-artifacts/pit-sweep-2024-2025/freeze/mde-artifact.json',
  label = 'git',
} = {}) {
  const output = git(['ls-tree', commitSha, '--', artifactPath]).trim();
  if (!output) {
    throw new Error(
      `${label}: ${commitSha} does not contain ${artifactPath} - this is not the freeze's Commit M`
    );
  }
  // `git ls-tree` output: "<mode> <type> <sha>\t<path>"
  const match = output.match(/^\d+\s+blob\s+([0-9a-f]{40,64})\s+/);
  if (!match) throw new Error(`${label}: could not parse git ls-tree output for ${artifactPath}: ${JSON.stringify(output)}`);
  return freezeManifest.assertShaShape(match[1], { label: `${label}: blob sha of ${artifactPath}` });
}

function defaultGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

// ---------------------------------------------------------------------------
// the runtime-identity sidecar
// ---------------------------------------------------------------------------

/**
 * Read and shape-check the sidecar the container entrypoint wrote. It is read
 * IN PLACE (wherever `--runtime-identity` points, inside the output mount) and
 * this function never copies it anywhere - see the module docblock.
 */
function readRuntimeIdentity(sidecarPath) {
  const raw = fs.readFileSync(sidecarPath, 'utf8');
  const sidecar = JSON.parse(raw);
  for (const field of ['nodeVersion', 'npmVersion', 'platform', 'arch', 'imageRef', 'imagePlatform']) {
    if (typeof sidecar[field] !== 'string' || sidecar[field].trim() === '') {
      throw new Error(`run-backtest-freeze-manifest: runtime-identity sidecar is missing "${field}"`);
    }
  }
  return sidecar;
}

// ---------------------------------------------------------------------------
// the scoring profiles (prereg 4.3)
// ---------------------------------------------------------------------------

/**
 * The three preregistered scoring profiles, pinned by their exact serialized
 * rules AND a SHA-256 hash of that serialization (prereg 4.3), built from the
 * REAL rule sets in `server/services/scoring.service.js` - the same module
 * `run-backtest-rosters.js` scores every candidate through, so a manifest
 * reader can check the pinned rules genuinely match what produced the study's
 * numbers, not a hand-transcribed copy of them.
 *
 * `SCORING_PRESETS`'s keys (`standard`, `half_ppr`, `ppr`) are exactly
 * `freezeManifest.SCORING_PROFILE_NAMES` - deliberately, so this function
 * needs no translation table that could silently drift out of step with
 * either module. Sorted by name here (not by `SCORING_PRESETS`'s own
 * insertion order) so the pinned array's order does not depend on how that
 * object literal happens to be written.
 */
/**
 * The one guard standing between "the manifest pins Commit A's scoring rules"
 * and "the manifest pins whatever happens to be on disk right now": this
 * script `require()`s `server/services/scoring.service.js` via normal Node
 * module resolution, which reads whatever is checked out at the CALLER's
 * cwd/tree - NOT necessarily Commit A. Unlike the git SHAs above (resolved
 * directly via `git rev-parse`/`git ls-tree` against the commit, never
 * dependent on what happens to be checked out), a plain `require()` has no
 * such binding. CI's reproduction workflow happens to invoke this script from
 * inside a detached worktree AT Commit A, which makes this hold true there,
 * but that is a property of HOW it is invoked, not something this script
 * itself enforces - a local/manual run against a moved-on branch would
 * silently pin the wrong rules. Comparing the required module's on-disk git
 * blob hash against Commit A's own recorded blob hash for that exact path
 * closes that gap independent of cwd, worktree, or invocation style.
 */
function assertScoringServiceMatchesCommitA({ commitASha, git, label = 'run-backtest-freeze-manifest' }) {
  const REQUIRED_PATH = 'server/services/scoring.service.js';
  const onDiskPath = require.resolve('../services/scoring.service');
  const onDiskSha = git(['hash-object', onDiskPath]).trim();
  let committedSha;
  try {
    committedSha = git(['rev-parse', '--verify', `${commitASha}:${REQUIRED_PATH}`]).trim();
  } catch (err) {
    throw new Error(`${label}: could not resolve ${REQUIRED_PATH} at commit A (${commitASha}): ${err.message}`);
  }
  if (onDiskSha !== committedSha) {
    throw new Error(
      `${label}: the required ${REQUIRED_PATH} (git blob ${onDiskSha}) does not match the copy committed `
      + `at commit A (${commitASha}, git blob ${committedSha}) - this script must be run against a checkout `
      + 'whose scoring.service.js is byte-identical to Commit A\'s, or the pinned scoring profiles would not '
      + 'be the rules that actually produced the study\'s numbers'
    );
  }
}

function buildScoringProfiles(scoringPresets = SCORING_PRESETS) {
  return Object.entries(scoringPresets)
    .map(([name, rules]) => {
      const serialized = canonicalJson(rules);
      return {
        name,
        rules: serialized,
        sha256: crypto.createHash('sha256').update(serialized, 'utf8').digest('hex'),
        primary: name === freezeManifest.PRIMARY_SCORING_PROFILE,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(argv, deps = {}) {
  const args = parseArgs(argv);
  const git = deps.git || defaultGit;
  const readSidecar = deps.readRuntimeIdentity || readRuntimeIdentity;

  const commitASha = resolveCommitSha(args.commitA, { git, label: 'commit A' });
  const commitMSha = resolveCommitSha(args.commitM, { git, label: 'commit M' });
  const treeSha = resolveTreeSha(commitASha, { git, label: 'commit A' });
  const blobSha = resolveArtifactBlobSha(commitMSha, { git, label: 'commit M' });
  const sidecar = readSidecar(args.runtimeIdentity);
  assertScoringServiceMatchesCommitA({ commitASha, git });

  const manifest = freezeManifest.buildManifest({
    commitA: { sha: commitASha, treeSha },
    commitM: { sha: commitMSha, blobSha },
    node: { version: sidecar.nodeVersion, npmVersion: sidecar.npmVersion },
    os: { platform: sidecar.platform, arch: sidecar.arch },
    image: { ref: sidecar.imageRef, platform: sidecar.imagePlatform },
    scoringProfiles: buildScoringProfiles(),
  });
  const serialized = freezeManifest.serializeManifest(manifest);

  // args.out is the operator's own CLI argument to this locally-invoked
  // tool, not external/network input.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  fs.mkdirSync(path.dirname(path.resolve(String(args.out))), { recursive: true });
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  fs.writeFileSync(path.resolve(String(args.out)), serialized, 'utf8');
  console.log(`wrote freeze manifest to ${args.out}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  resolveCommitSha,
  resolveTreeSha,
  resolveArtifactBlobSha,
  readRuntimeIdentity,
  buildScoringProfiles,
  main,
};
