/* eslint-disable no-console */
'use strict';

/**
 * Structural discovery of the freeze sequence's Commit A / Commit M / Commit
 * B, for `backtest-reproduction.yml` (accuracy-roadmap plan Step 6).
 *
 * WHY THIS LIVES UNDER scripts/ci/, NOT scripts/backtest/
 *
 * This shells `git`, which `scripts/backtest/**` may never do (that tree is
 * barred from `child_process` by test, the same way it is barred from `pg`
 * and `process.env`). It is CI-only tooling, not part of the offline
 * pipeline itself, so it lives outside every isolation boundary that applies
 * to the pipeline's own code.
 *
 * WHY DISCOVERY IS STRUCTURAL, NOT "HEAD"/"HEAD^"
 *
 * Before Commit B exists there is no manifest anywhere naming which pushed
 * commit is A and which is M. The ordinary case names them by shape: M is the
 * newest commit whose changed-path set, against its own first parent, is
 * EXACTLY the one MDE artifact path. A degenerate but valid regeneration can
 * produce the exact artifact blob A already carries; Git cannot represent
 * that as a changed-path commit. That case uses an explicit empty-tree,
 * single-parent witness whose three reserved trailers bind the artifact path
 * and the identical parent/commit blob. The reproduction job still regenerates
 * and byte-compares the artifact; the witness changes discovery only, never
 * the byte-comparison standard. `A = parent(M)` follows from either definition,
 * which is why
 * asserting `parent(M) === A` anywhere would check nothing (it's true by
 * construction) - the actual check this file performs on A is independent:
 * does A's OWN changed-path set, against A's OWN first parent, avoid every
 * forbidden path.
 *
 * WHY "NEWEST" MATTERS
 *
 * If a botched freeze ever produced M1 and then a corrected M2, newest valid
 * M discovery picks M2 - and `parent(M2)` is the corrected A, not the stale
 * one before it. An empty commit that claims any reserved witness trailer but
 * fails the complete witness contract is a modeled hard error, never skipped
 * in favor of an older M. Excluding `freeze/**` from A's own forbidden-path set
 * for anything OTHER than exact identity (see FORBIDDEN_PATHS below) is what
 * keeps this self-consistent: a corrected A that still carried leftover
 * freeze output from the botched attempt would trip A's own allowlist and
 * fail loudly, rather than passing unnoticed.
 */

const { execFileSync } = require('child_process');

const ARTIFACT_PATH = 'backtest-artifacts/pit-sweep-2024-2025/freeze/mde-artifact.json';
const MANIFEST_PATH = 'backtest-artifacts/pit-sweep-2024-2025/freeze/FREEZE_MANIFEST.json';
const MDE_WITNESS_TRAILERS = Object.freeze({
  kind: 'Backtest-MDE-Witness',
  path: 'Backtest-MDE-Path',
  blob: 'Backtest-MDE-Blob',
});
const POST_B_ALLOWED_PATHS = new Set([
  'backtest-artifacts/pit-sweep-2024-2025/REPORT.md',
  'backtest-artifacts/pit-sweep-2024-2025/report.json',
]);

/**
 * A's allowlist is really a DENYLIST: A is "everything non-output," the one
 * commit broad enough that a stray edit to the sealed preregistration, the
 * committed publication tree, or M/B's own output directory could otherwise
 * hide inside it unnoticed. All three are explicitly forbidden in A's own
 * changed-path set (plan Step 6): the sealed document, the committed
 * publication tree, and the freeze output directory in its entirety (not
 * just the two files M/B commit - the whole directory, so a stray extra file
 * dropped there by a botched run also trips this).
 */
const FORBIDDEN_IN_A = [
  // The real repo-relative path (`git diff-tree --name-only` reports full
  // paths, never a bare filename) - `backtest-artifacts/pit-sweep-2024-2025/
  // PREREGISTRATION.md`, confirmed against the actual tracked file rather
  // than assumed from the plan's shorthand.
  'backtest-artifacts/pit-sweep-2024-2025/PREREGISTRATION.md',
  /^backtest-data\//,
  /^backtest-artifacts\/pit-sweep-2024-2025\/freeze\//,
];

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** Like `git()`, but a nonzero exit returns `null` instead of throwing/printing - for checks that are
 * expected to fail routinely (e.g. "does this commit have a parent"), so a root commit does not spam
 * every CI run with a `fatal:` line that looks like a real problem but isn't one. */
function gitOrNull(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * All commits reachable from `ref`, newest first, as full 40-char SHAs.
 *
 * Unbounded by default: `findNewestExactPathCommit` below must be able to
 * find M/B no matter how far back they are, and a bounded window that quietly
 * stopped short would make "Commit M does not exist yet" indistinguishable
 * from "Commit M exists, just outside the window this happened to scan" -
 * the two have very different remedies. `maxCount` stays available for a
 * caller with an actual reason to bound the scan (tests, mainly).
 */
function listCommits(ref, { maxCount = null } = {}) {
  const args = ['log', '--format=%H'];
  if (maxCount !== null) args.push(`--max-count=${maxCount}`);
  args.push(ref);
  const out = git(args);
  return out ? out.split('\n') : [];
}

/**
 * The set of paths a commit changed relative to its OWN first parent. A
 * commit with no parent (the repo's root commit) is treated as changing
 * every path it introduces - `git diff-tree` handles that natively when no
 * parent is given.
 */
function changedPathsOf(sha) {
  const parent = gitOrNull(['rev-parse', '--verify', `${sha}^`]);
  const args = parent
    ? ['diff-tree', '--no-commit-id', '--name-only', '-r', parent, sha]
    : ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha];
  const out = git(args);
  return new Set(out ? out.split('\n').filter(Boolean) : []);
}

function isExactly(pathSet, expectedPath) {
  return pathSet.size === 1 && pathSet.has(expectedPath);
}

/** Find the newest commit on `ref` whose changed-path set is exactly `expectedPath`, or null. */
function findNewestExactPathCommit(ref, expectedPath) {
  for (const sha of listCommits(ref)) {
    if (isExactly(changedPathsOf(sha), expectedPath)) return sha;
  }
  return null;
}

function trailerValues(message, name) {
  const prefix = `${name}:`;
  return String(message)
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
}

function isValidByteIdenticalMdeWitness(sha) {
  if (changedPathsOf(sha).size !== 0) return false;
  const parents = git(['rev-list', '--parents', '-n', '1', sha]).split(/\s+/);
  if (parents.length !== 2) return false;
  const parent = parents[1];
  const message = git(['show', '-s', '--format=%B', sha]);
  const kinds = trailerValues(message, MDE_WITNESS_TRAILERS.kind);
  const paths = trailerValues(message, MDE_WITNESS_TRAILERS.path);
  const blobs = trailerValues(message, MDE_WITNESS_TRAILERS.blob);
  if (kinds.length !== 1 || kinds[0] !== 'byte-identical') return false;
  if (paths.length !== 1 || paths[0] !== ARTIFACT_PATH) return false;
  if (blobs.length !== 1 || !/^[0-9a-f]{40,64}$/.test(blobs[0])) return false;
  const commitBlob = gitOrNull(['rev-parse', '--verify', `${sha}:${ARTIFACT_PATH}`]);
  const parentBlob = gitOrNull(['rev-parse', '--verify', `${parent}:${ARTIFACT_PATH}`]);
  return commitBlob === blobs[0] && parentBlob === blobs[0];
}

function claimsByteIdenticalMdeWitness(sha) {
  const message = git(['show', '-s', '--format=%B', sha]);
  return Object.values(MDE_WITNESS_TRAILERS)
    .some((name) => trailerValues(message, name).length > 0);
}

function findNewestMCommit(ref) {
  for (const sha of listCommits(ref)) {
    const changedPaths = changedPathsOf(sha);
    if (isExactly(changedPaths, ARTIFACT_PATH)) return sha;
    if (changedPaths.size === 0) {
      if (isValidByteIdenticalMdeWitness(sha)) return sha;
      if (claimsByteIdenticalMdeWitness(sha)) {
        const error = new Error(
          `Commit ${sha} claims an invalid byte-identical MDE witness: require an empty single-parent commit, `
          + `exactly one ${MDE_WITNESS_TRAILERS.kind}: byte-identical trailer, exactly one `
          + `${MDE_WITNESS_TRAILERS.path}: ${ARTIFACT_PATH} trailer, and exactly one `
          + `${MDE_WITNESS_TRAILERS.blob} trailer matching the artifact blob in both the commit and its parent.`
        );
        error.code = 'INVALID_MDE_WITNESS';
        throw error;
      }
    }
  }
  return null;
}

/** Every forbidden-path violation in `pathSet`, human-readable, empty if none. */
function forbiddenViolationsIn(pathSet) {
  const violations = [];
  for (const p of pathSet) {
    for (const forbidden of FORBIDDEN_IN_A) {
      const hit = typeof forbidden === 'string' ? p === forbidden : forbidden.test(p);
      if (hit) violations.push(p);
    }
  }
  return violations;
}

function commitsBetween(baseExclusive, refInclusive) {
  const out = git(['log', '--format=%H', `${baseExclusive}..${refInclusive}`]);
  return out ? out.split('\n').filter(Boolean) : [];
}

function findNewestExactPathCommitAfter(ref, expectedPath, baseExclusive) {
  for (const sha of commitsBetween(baseExclusive, ref)) {
    if (isExactly(changedPathsOf(sha), expectedPath)) return sha;
  }
  return null;
}

function postBViolations({ bSha, ref }) {
  const violations = [];
  for (const sha of commitsBetween(bSha, ref)) {
    for (const changedPath of changedPathsOf(sha)) {
      if (!POST_B_ALLOWED_PATHS.has(changedPath)) violations.push({ sha, path: changedPath });
    }
  }
  return violations;
}

/**
 * The full discovery + non-circular chain check (plan Step 6).
 *
 * Returns a result object; never throws for an "expected" outcome (no M
 * found, A violates its allowlist) - those are reported in the result so the
 * CALLER (the workflow step) decides how loudly to fail, and reasons show up
 * in CI logs either way. A genuinely unexpected git failure still throws.
 */
function discover({ ref = 'HEAD' } = {}) {
  let mSha;
  try {
    mSha = findNewestMCommit(ref);
  } catch (err) {
    if (err.code !== 'INVALID_MDE_WITNESS') throw err;
    return {
      ok: false,
      reason: err.message,
      commitA: null,
      commitM: null,
      commitB: null,
    };
  }
  if (!mSha) {
    return {
      ok: false,
      reason: `no commit on ${ref} has a changed-path set exactly {${ARTIFACT_PATH}} - `
        + 'Commit M does not exist yet on this ref, so there is no reproducible artifact to verify. '
        + 'A reproduction workflow that passed anyway would be asserting something it never checked.',
      commitA: null,
      commitM: null,
      commitB: null,
    };
  }
  const aSha = git(['rev-parse', '--verify', `${mSha}^`]);
  const aChanged = changedPathsOf(aSha);
  const aViolations = forbiddenViolationsIn(aChanged);
  if (aViolations.length > 0) {
    return {
      ok: false,
      reason: `Commit A (${aSha}, parent of discovered Commit M ${mSha}) touches forbidden path(s): `
        + `${aViolations.join(', ')}. A must be "everything non-output" - the sealed preregistration, the `
        + 'committed publication tree, and the freeze output directory must all be untouched by A.',
      commitA: aSha,
      commitM: mSha,
      commitB: null,
    };
  }

  // A historical B from an older freeze remains in the ancestry while a
  // replacement M is undergoing reproduction. Only a manifest committed
  // after the newly discovered M can be B for this chain.
  const bSha = findNewestExactPathCommitAfter(ref, MANIFEST_PATH, mSha);
  let bCheck = null;
  if (bSha) {
    const bParent = git(['rev-parse', '--verify', `${bSha}^`]);
    if (bParent !== mSha) {
      return {
        ok: false,
        reason: `Commit B (${bSha}) has parent ${bParent}, expected discovered Commit M ${mSha}. `
          + 'The freeze requires parent(B) = M with no intervening commit.',
        commitA: aSha,
        commitM: mSha,
        commitB: bSha,
      };
    }
    const manifestJson = git(['show', `${bSha}:${MANIFEST_PATH}`]);
    const manifest = JSON.parse(manifestJson);
    const recordedA = manifest && manifest.commitA && manifest.commitA.sha;
    const recordedM = manifest && manifest.commitM && manifest.commitM.sha;
    const chainOk = recordedA === aSha && recordedM === mSha;
    bCheck = {
      sha: bSha, recordedA, recordedM, chainOk,
    };
    if (!chainOk) {
      return {
        ok: false,
        reason: `Commit B (${bSha})'s FREEZE_MANIFEST.json records commitA=${recordedA} / commitM=${recordedM}, `
          + `but structural discovery on ${ref} found A=${aSha} / M=${mSha}. This is the actual §17 chain `
          + 'check - the one that would catch a manifest pinning the wrong commits.',
        commitA: aSha,
        commitM: mSha,
        commitB: bSha,
      };
    }
    const outputViolations = postBViolations({ bSha, ref });
    if (outputViolations.length > 0) {
      return {
        ok: false,
        reason: `Commit(s) after B changed non-output path(s): ${outputViolations
          .map((v) => `${v.sha}:${v.path}`).join(', ')}. Only ${[...POST_B_ALLOWED_PATHS].join(', ')} may change after B.`,
        commitA: aSha,
        commitM: mSha,
        commitB: bSha,
      };
    }
    bCheck.outputOnlyCommits = commitsBetween(bSha, ref).length;
  }

  return {
    ok: true, commitA: aSha, commitM: mSha, commitB: bSha, bCheck,
  };
}

function main(argv) {
  const ref = argv[0] || 'HEAD';
  // A genuinely unexpected failure (a git invocation error, a malformed
  // Commit-B manifest that fails to JSON.parse, anything discover() does not
  // itself model as an "expected" ok:false outcome) must still produce a
  // complete, valid discovery.json with its OWN reason - never let it throw
  // past this point. The caller (backtest-reproduction.yml) prints whatever
  // this writes to stdout verbatim in its failure message; an uncaught throw
  // here would leave that file empty, and the workflow's hardcoded fallback
  // message ("no Commit M found") would then misreport a crash as a routine
  // "nothing to reproduce yet" outcome, masking the real failure.
  let result;
  try {
    result = discover({ ref });
  } catch (err) {
    result = {
      ok: false,
      reason: `CRASH during discovery, not a modeled "expected" outcome: ${err.message}`,
      commitA: null,
      commitM: null,
      commitB: null,
    };
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error(`FAIL: ${result.reason}`);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  ARTIFACT_PATH,
  MANIFEST_PATH,
  MDE_WITNESS_TRAILERS,
  POST_B_ALLOWED_PATHS,
  FORBIDDEN_IN_A,
  git,
  listCommits,
  changedPathsOf,
  isExactly,
  findNewestExactPathCommit,
  isValidByteIdenticalMdeWitness,
  claimsByteIdenticalMdeWitness,
  findNewestMCommit,
  forbiddenViolationsIn,
  commitsBetween,
  findNewestExactPathCommitAfter,
  postBViolations,
  discover,
  main,
};
