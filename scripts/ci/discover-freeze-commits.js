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
 * commit is A and which is M. The only thing that can name them is their own
 * shape: M is defined as "the newest commit whose changed-path set, against
 * its own first parent, is EXACTLY the one MDE artifact path" - nothing else
 * about M (not its message, not its position relative to HEAD) is load-
 * bearing. `A = parent(M)` follows from that definition, which is why
 * asserting `parent(M) === A` anywhere would check nothing (it's true by
 * construction) - the actual check this file performs on A is independent:
 * does A's OWN changed-path set, against A's OWN first parent, avoid every
 * forbidden path.
 *
 * WHY "NEWEST" MATTERS
 *
 * If a botched freeze ever produced M1 and then a corrected M2, "newest
 * exact-path match" picks M2 - and `parent(M2)` is the corrected A, not the
 * stale one before it. Excluding `freeze/**` from A's own forbidden-path set
 * for anything OTHER than exact identity (see FORBIDDEN_PATHS below) is what
 * keeps this self-consistent: a corrected A that still carried leftover
 * freeze output from the botched attempt would trip A's own allowlist and
 * fail loudly, rather than passing unnoticed.
 */

const { execFileSync } = require('child_process');

const ARTIFACT_PATH = 'backtest-artifacts/pit-sweep-2024-2025/freeze/mde-artifact.json';
const MANIFEST_PATH = 'backtest-artifacts/pit-sweep-2024-2025/freeze/FREEZE_MANIFEST.json';
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
  const mSha = findNewestExactPathCommit(ref, ARTIFACT_PATH);
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

  const bSha = findNewestExactPathCommit(ref, MANIFEST_PATH);
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
  POST_B_ALLOWED_PATHS,
  FORBIDDEN_IN_A,
  git,
  listCommits,
  changedPathsOf,
  isExactly,
  findNewestExactPathCommit,
  forbiddenViolationsIn,
  commitsBetween,
  postBViolations,
  discover,
  main,
};
