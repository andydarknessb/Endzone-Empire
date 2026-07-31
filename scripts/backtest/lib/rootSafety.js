'use strict';

/**
 * Shared root-collision safety guards for the Gate-3 packager
 * (`scripts/backtest/package-snapshot.js`) AND the rehydrator
 * (`scripts/backtest/rehydrate.js`).
 *
 * Both tools take multiple filesystem-root arguments from a caller (CLI flags
 * or a programmatic call) and both must refuse - before any read or write -
 * to run against roots that alias, or nest inside, one another. A packaging
 * run must never let `--snapshot` and `--publish` collide (it would silently
 * overwrite the sealed, never-in-git Gate-2 extraction); a rehydration run
 * must never let `--out-snapshot`, `--out-sources`, or `--publish` collide
 * (it would silently overwrite the publication tree it is reconstructing
 * FROM, or reconstruct one output on top of the other). This is the SAME
 * safety property in both directions of the same pipeline, so it is written
 * ONCE here and imported by both, rather than reimplemented per file - a
 * second, independently-invented (and, empirically, much weaker) version of
 * this exact guard living inside `rehydrate.js` is precisely the defect this
 * module exists to close.
 *
 * Hardened across three review rounds against `package-snapshot.js`'s own
 * history:
 *   - round 2: a Windows NTFS case-only alias (`C:\Foo` vs `C:\FOO`) is the
 *     SAME directory on disk even though `path.resolve` produces two
 *     different strings - fixed by canonicalizing through
 *     `fs.realpathSync.native` (which resolves symlinks/junctions AND, on
 *     Windows, the on-disk casing NTFS actually uses) before comparing.
 *   - round 3: a Windows UNC admin-share alias (`\\localhost\C$\...`) names
 *     the exact same directory as its drive-letter equivalent
 *     (`C:\...`), empirically proven (a marker file written through the
 *     local path reads back byte-identical through the UNC form), yet
 *     `fs.realpathSync.native` does NOT collapse the two down to one
 *     canonical string - so canonicalization alone would silently miss that
 *     alias. Fixed by rejecting the entire UNC path family outright, before
 *     canonicalization ever runs on it.
 *   - round 4: (a) a canonicalization failure on an ancestor that DOES exist
 *     (permission denied, I/O error, a vanished-mid-check race) must ABORT
 *     the check, not silently fall back to an unresolved, potentially-aliased
 *     path - a canonicalization failure makes the safety check LESS
 *     trustworthy, never a reason to continue with a weaker one; (b) the
 *     CANONICALIZED result of a root must itself be re-checked for UNC shape
 *     - a symlink/junction whose target resolves to a UNC form, even though
 *     the raw input argument was an ordinary drive-letter path, would
 *     otherwise slip past the raw-argument-only UNC check; (c) this file's
 *     own predecessor only ever compared exactly two roots, hardcoded - the
 *     rehydrator needed a THIRD root (its two outputs plus its input) checked
 *     pairwise, which is why this module takes a list of NAMED roots rather
 *     than two positional arguments.
 *   - round 6: the nesting check itself was wrong for a root that IS a
 *     filesystem/drive root. `path.resolve`/`realpathSync` render `C:\` (or
 *     POSIX `/`) WITH a trailing separator; the old check compared with
 *     `child.startsWith(parent + path.sep)`, and appending a second separator
 *     to an already-trailing-separator parent produces a string
 *     (`C:\\`, doubled) nothing starts with - so `C:\` and `C:\Users` were
 *     empirically found to pass as "disjoint" even though the second is
 *     plainly inside the first. Fixed by replacing the manual prefix
 *     comparison with `path.relative` (see `isContainedIn`), which has no such
 *     edge case.
 *
 * RESIDUAL, UNDEMONSTRATED LIMITATION (carried forward from round 2/3): a
 * Windows 8.3 short-name alias of an ordinary drive-letter path (e.g.
 * `C:\LONGDI~1` aliasing `C:\LongDirectoryName`) is a DIFFERENT alias family
 * this module does not independently verify one way or the other - 8.3 name
 * generation is commonly disabled on modern NTFS volumes
 * (`fsutil 8dot3name`), which also prevented testing it. Treat this as a
 * known, undemonstrated residual risk, not as covered by this module.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Safe path canonicalization for COMPARISON only (never for use as a real
// filesystem argument elsewhere)
// ---------------------------------------------------------------------------

/**
 * Walk upward from `resolvedPath` to the nearest ancestor that actually
 * exists on disk. A root legitimately may not exist yet when a safety check
 * runs (packaging creates `publishRoot`; rehydration creates its outputs), so
 * `fs.realpathSync` cannot be called on it directly - only on something that
 * is already there.
 */
function nearestExistingAncestor(resolvedPath) {
  let current = resolvedPath;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fs.existsSync(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current; // reached the filesystem root; give up climbing
    current = parent;
  }
}

/**
 * Canonicalize a path for COMPARISON: resolve the nearest existing ancestor
 * with `fs.realpathSync.native` (symlinks/junctions AND, on Windows, on-disk
 * casing), then rejoin whatever path segments do not exist yet onto that real
 * ancestor.
 *
 * FAIL CLOSED (round 4 fix): if `fs.realpathSync.native` throws for the
 * existing ancestor, this THROWS rather than falling back to the unresolved
 * ancestor. The prior version of this function treated that fallback as
 * "strictly more conservative than throwing" - that reasoning was backwards:
 * a canonicalization failure means the safety check below can no longer tell
 * whether two roots alias each other, which is exactly the moment to abort,
 * not to silently continue with a weaker, unresolved comparison. The one
 * case this is NOT reached for is a leaf path that genuinely does not exist
 * yet - `nearestExistingAncestor` already walks past that by design, so
 * `realpathSync.native` is only ever called on a path that just proved it
 * exists via `fs.existsSync`.
 *
 * `realpathNative` is an injectable seam (defaults to the real
 * `fs.realpathSync.native`) purely so a test can simulate a realpath failure
 * deterministically, without depending on platform-specific permission
 * revocation.
 */
function canonicalizeForCompare(inputPath, { realpathNative = fs.realpathSync.native } = {}) {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolved = path.resolve(String(inputPath));
  const ancestor = nearestExistingAncestor(resolved);
  const remainder = path.relative(ancestor, resolved);
  let realAncestor;
  try {
    realAncestor = realpathNative(ancestor);
  } catch (err) {
    throw new Error(
      `root safety check: could not canonicalize ${JSON.stringify(ancestor)} (fs.realpathSync.native ` +
      `failed: ${err.message}) - refusing to fall back to an unresolved, potentially-aliased path for a ` +
      'pre-write safety check. This aborts the whole run rather than downgrading to a weaker comparison.'
    );
  }
  // realAncestor is the OUTPUT of fs.realpathSync.native (an already-resolved real path, not raw input),
  // and remainder is path.relative's own output - this rejoins them purely for a COMPARISON string (see
  // this function's docblock: "never for use as a real filesystem argument elsewhere"), never to open,
  // read, or write a file.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return remainder ? path.join(realAncestor, remainder) : realAncestor;
}

/**
 * NTFS is case-insensitive by default (this codebase's environment), so the
 * comparison folds case there; POSIX filesystems are case-sensitive by
 * default, so it does not. `process.platform` is checked rather than
 * hardcoding one behavior, so this stays correct if this tooling is ever run
 * on a case-sensitive host.
 */
function normalizeForCompare(canonicalPath) {
  return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
}

/**
 * Reject any UNC-form path outright, BEFORE `canonicalizeForCompare` ever
 * runs on it. `fs.realpathSync.native` does not collapse a UNC admin-share
 * alias (`\\localhost\C$\...`) down to its local drive-letter equivalent
 * (`C:\...`) - proven empirically (see the module docblock) - so a real
 * collision hiding behind that alias shape would otherwise sail through
 * undetected. This tooling's stated audience is a local, single-operator
 * run; a UNC path is never required for that, so rejecting the whole family
 * - an ordinary hostname share (`\\host\share\...`), an admin share
 * (`\\localhost\C$\...`), and the `\\?\UNC\...` extended-length prefix -
 * closes every alias shape in it at once. Matches on a leading double
 * backslash (after normalizing `/` to `\` so a forward-slash-spelled UNC path
 * is not missed either), which is the one structural feature every member of
 * the family shares.
 */
function assertNotUncFormPath(inputPath, label) {
  const raw = String(inputPath);
  const normalized = raw.replace(/\//g, '\\');
  if (/^\\\\/.test(normalized)) {
    throw new Error(
      `${label} (${raw}) is a UNC-form path - refusing before any canonicalization, read, or write. ` +
      'A Windows UNC path (an ordinary hostname share like \\\\host\\share\\..., an admin-share alias ' +
      'like \\\\localhost\\C$\\..., or the \\\\?\\UNC\\... extended prefix) can name the exact same ' +
      'directory as an ordinary drive-letter path without fs.realpathSync.native ever collapsing the two ' +
      'down to one canonical string, so a disjoint-roots check could otherwise be fooled by an alias of a ' +
      'real collision. This is local, single-operator tooling; a UNC path is never required to run it - ' +
      'pass an ordinary drive-letter path instead (e.g. C:\\... rather than \\\\localhost\\C$\\...).'
    );
  }
}

// ---------------------------------------------------------------------------
// The N-way pairwise disjointness check
// ---------------------------------------------------------------------------

/**
 * Refuse (before ANY read past the paths themselves, and before any write) if
 * any two of `namedRoots` resolve to the same directory, or one is nested
 * inside another - comparing CANONICALIZED, case-folded-per-platform forms,
 * not raw `path.resolve` strings. Every root is first checked for a UNC-form
 * alias BEFORE canonicalization (that step cannot see through a UNC alias of
 * an ordinary path), and AGAIN after canonicalization (round 4: a
 * symlink/junction target that resolves to a UNC form must not slip past a
 * raw-argument-only check).
 *
 * `namedRoots` is `[{ name, path }, ...]` - at least two entries. Every
 * unique pair is checked, in the order given, so error messages always name
 * the earlier-listed root first (`assertDisjointRoots(a, b)` below preserves
 * exactly the two-argument call shape and message ordering every existing
 * caller and test already depends on).
 *
 * `canonicalize` is an injectable seam (defaults to the real
 * `canonicalizeForCompare` above) purely so a test can simulate a
 * canonicalized result that happens to be UNC-shaped (a symlink/junction
 * whose target resolves to a UNC form) deterministically, without depending
 * on real UNC-alias or junction infrastructure being reachable in the test
 * environment.
 */
function assertRootsDisjoint(namedRoots, { canonicalize = canonicalizeForCompare } = {}) {
  if (!Array.isArray(namedRoots) || namedRoots.length < 2) {
    throw new Error('assertRootsDisjoint: at least two named roots are required');
  }
  // 1. Reject UNC-form raw inputs outright, before any canonicalization.
  for (const root of namedRoots) assertNotUncFormPath(root.path, root.name);

  // 2. Canonicalize every root, then re-check the CANONICALIZED result for a
  //    UNC shape too (a symlink/junction target resolving to a UNC form).
  const canonical = namedRoots.map((root) => {
    const canonicalPath = canonicalize(root.path);
    assertNotUncFormPath(canonicalPath, `${root.name} (canonicalized)`);
    return { name: root.name, canonicalPath, cmp: normalizeForCompare(canonicalPath) };
  });

  // 3. Every unique pair, in the order given.
  //
  //    ROUND 6 FIX: this used to compare with `b.cmp.startsWith(a.cmp +
  //    path.sep)`, which is wrong whenever `a.cmp` is a filesystem/drive root
  //    that `path.resolve`/`realpathSync` already renders WITH a trailing
  //    separator (`C:\`, or POSIX `/`) - appending a SECOND separator produces
  //    a string (`C:\\`) nothing ever starts with, so a real containment
  //    (`C:\Users` inside `C:\`) silently passed as "disjoint". `path.relative`
  //    has no such edge case: it is what `path`'s own documentation recommends
  //    for exactly this "is B inside A" question, and it is agnostic to
  //    whether either input happens to carry a trailing separator.
  for (let i = 0; i < canonical.length; i++) {
    for (let j = i + 1; j < canonical.length; j++) {
      const a = canonical[i];
      const b = canonical[j];
      if (a.cmp === b.cmp) {
        throw new Error(
          `${a.name} and ${b.name} resolve to the SAME directory (${a.canonicalPath}) - refusing before ` +
          'any read or write. Two roots that alias the same directory would let an operation meant for ' +
          'one silently read from or write into what the other treats as a distinct, safely-isolated ' +
          'location.'
        );
      }
      if (isContainedIn(a.cmp, b.cmp)) {
        throw new Error(
          `${b.name} (${b.canonicalPath}) is nested INSIDE ${a.name} (${a.canonicalPath}) - refusing ` +
          'before any read or write: an operation against one root must never reach into a path the ' +
          'other root treats as its own tree.'
        );
      }
      if (isContainedIn(b.cmp, a.cmp)) {
        throw new Error(
          `${a.name} (${a.canonicalPath}) is nested INSIDE ${b.name} (${b.canonicalPath}) - refusing ` +
          'before any read or write: an operation against one root must never reach into a path the ' +
          'other root treats as its own tree.'
        );
      }
    }
  }
  return true;
}

/**
 * True if `childCmp` is a strict descendant of `parentCmp` - both already
 * canonicalized and case-folded-per-platform. `path.relative(parent, child)`
 * yields a path with no leading `..` and no absolute prefix exactly when
 * `child` is inside `parent`; an empty result means they are equal, which the
 * caller already checks for separately. Unlike a manual `startsWith(parent +
 * path.sep)` check, this has no edge case for a `parent` that is itself a
 * filesystem/drive root (`C:\`, `/`) already carrying a trailing separator -
 * the exact class of bug a third-party review reproduced (`C:\` and
 * `C:\Users` passing as disjoint).
 */
function isContainedIn(parentCmp, childCmp) {
  if (parentCmp === childCmp) return false;
  const rel = path.relative(parentCmp, childCmp);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

module.exports = {
  nearestExistingAncestor,
  canonicalizeForCompare,
  normalizeForCompare,
  assertNotUncFormPath,
  isContainedIn,
  assertRootsDisjoint,
};
