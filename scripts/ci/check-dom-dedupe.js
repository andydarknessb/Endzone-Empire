#!/usr/bin/env node
/**
 * Guard against a second, un-deduped copy of @testing-library/dom.
 *
 * Why this exists (#219, #169): @testing-library/react's act-aware
 * asyncWrapper/eventWrapper config lives on whichever copy of
 * @testing-library/dom it imports. @testing-library/user-event only
 * declares @testing-library/dom as a peer, so if npm ever resolves two
 * different installed copies, user-event reads a config singleton RTL
 * never configured and every user-event interaction in the test suite
 * dispatches its events OUTSIDE act(), silently. #219 fixed this for the
 * versions in place at the time by pinning @testing-library/dom to the
 * version @testing-library/react already used, collapsing both consumers
 * onto one resolved copy. That pin only holds while every consumer's
 * declared range is satisfiable by the pinned version. @testing-library/react
 * v15 and v16 both want @testing-library/dom ^10, so a routine RTL bump
 * re-splits the tree, and — per #224's triage — v15 does this with
 * `npm install` reporting "up to date", exit 0, nothing failing. This
 * script is the thing that is supposed to fail instead.
 *
 * Method: `npm ls <pkg>` exits 0 on a tree with two legitimately resolved
 * copies (it only fails on invalid/missing/extraneous packages), so exit
 * code is not a usable signal — see #224. `npm ls <pkg> --parseable` prints
 * one line per distinct installed *path*, deduplicating identical physical
 * locations regardless of how many consumers reference it. A healthy tree
 * prints exactly one path even when npm's tree view labels the second and
 * later consumers "deduped"; a split tree prints one path per copy. This
 * script counts those lines and treats any count other than exactly one as a
 * violation. We add `--long`, which appends the resolved id to each line as
 * `<path>:<name>@<version>`, so the diagnostic can name the version of every
 * copy it found. Those versions are npm's own resolved answer carried on the
 * same subprocess output — NOT a package.json this script opened. Reading a
 * package.json beneath the subprocess output would reverse a deliberate
 * decision (#224): it would turn display data back into a filesystem path to
 * follow. `--long` keeps the physical-path count rule byte-for-byte and only
 * adds display data, so the pass/fail rule is unchanged.
 *
 * Why NOT `npm ls --json` for the version: --json is a *tree* view, so on a
 * healthy tree @testing-library/dom appears once under @testing-library/react
 * AND once under @testing-library/user-event even though both share one
 * physical copy. Counting those nodes would report two on a green tree. Only
 * `--parseable` collapses to one line per physical install, which is the
 * count this guard is defined on.
 *
 * Anchoring, in two steps (#313, then #352): `npm ls` reports only what is
 * installed under ITS working directory's node_modules, so before #313 the
 * SAME checkout printed a different sentence depending on which subdirectory
 * you invoked the guard from. #313 pinned the SEARCH root to the checkout that
 * owns THIS script (two levels up from scripts/ci/, via resolveSearchRoot),
 * making the answer independent of the working directory WITHIN one checkout.
 *
 * #313 stopped there and let each checkout's search root also be its `npm ls`
 * root. That is wrong for a nested git worktree with no node_modules of its
 * own: Node's module resolution walks UP from the importing test file, so the
 * tests there load @testing-library/dom from the PARENT checkout's install,
 * but `npm ls` scoped to the worktree sees nothing and prints `found 0` for a
 * perfectly healthy shared install — and a real split living in the parent is
 * invisible from the worktree. #352 adds a second step: from the search root,
 * resolveInstallRoot walks the ancestor chain the same way Node does and finds
 * the nearest directory whose node_modules actually holds the package. That
 * INSTALL root is where `npm ls` runs, so the guard always reports on the tree
 * the tests will use. When the search root has its own install (the main
 * checkout, CI, a worktree that ran `npm ci`), the two roots coincide and the
 * behavior is byte-for-byte what #313 produced.
 *
 * When the two roots differ, every message (success and failure) names BOTH
 * ("searched from X, resolved against Y") so a reader can tell "found 2 in the
 * parent, reached from this worktree" apart from a split that lives in the
 * worktree itself. Only when the package resolves NOWHERE up the chain does
 * the guard fail-closed with `found 0` and the `npm ci` remediation; a nested
 * worktree backed by an ancestor install never reaches that message.
 *
 * Symlinked worktrees (common here — many worktrees symlink node_modules to
 * the main checkout): the symlink makes the worktree its OWN install root
 * (fs.existsSync follows the link), so search root and install root coincide
 * and `npm ls` runs in the worktree. npm resolves the symlink but evaluates
 * the resolved copy against the WORKTREE's package.json, emitting the INVALID
 * four-field `--long` shape the parser already collapses to one physical copy;
 * the guard passes, naming that one path. We do not resolve symlinks to their
 * physical target (that would change the frozen pass/fail rule, #313); the
 * failure path still surfaces npm's own stderr, which carries any
 * INVALID/extraneous markers that explain a discrepancy.
 *
 * Run: `npm run check:dom-dedupe`
 *
 * Wired into CI (#313): the `test-build` job runs `npm run check:dom-dedupe`
 * after `npm ci` and before the client test suite, so a re-split fails fast
 * and names its cause here instead of surfacing later as an unrelated
 * user-event test dispatching outside act(). The `.github/workflows/**` step
 * itself is a carve-out path merged by the maintainer.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PACKAGE_NAME = '@testing-library/dom';

// Anchor the guard to the checkout that owns this script rather than
// process.cwd(). scripts/ci/check-dom-dedupe.js sits two directories below
// the repo root. Resolving from __dirname (not the current working directory)
// makes the count and the message independent of the working directory WITHIN
// one checkout. It does NOT unify separate checkouts: each worktree has its
// own copy of this script, so the anchor follows the running script's tree,
// and that tree is judged on its own state — see the Determinism note above
// (#313).
function resolveSearchRoot() {
  return path.resolve(__dirname, '..', '..');
}

// Find the tree the tests will actually use (#352). `npm ls` reports only what
// is installed under ITS working directory's node_modules, but Node's module
// resolution walks UP from the importing file: a nested git worktree with no
// node_modules of its own resolves @testing-library/dom from the parent
// checkout's install. Anchoring `npm ls` to the search root then reports
// `found 0` for exactly that healthy shared-install case, and hides a real
// split that lives in the parent. So, starting from the search root, walk the
// ancestor chain the same way Node would and return the nearest directory
// whose node_modules holds an installed copy of the package (its package.json
// exists). That directory is where `npm ls` should run. Return null when no
// ancestor has it installed — the genuine fail-closed "resolves nowhere" case.
//
// Synchronous fs checks only (no npm spawn) so this stays unit-testable
// against temp-dir fixtures. fs.existsSync follows symlinks, so a worktree
// whose node_modules is a symlink to the parent's resolves to the worktree
// itself (search root == install root), which is the correct "judge this tree
// on its own" behavior — npm ls then emits the INVALID four-field shape the
// parser already collapses to one copy.
//
// Trust boundary: every real call site passes `resolveSearchRoot()`'s return
// value — `path.resolve(__dirname, '..', '..')`, fixed by where this script
// lives on disk — and the unit tests pass a `fs.mkdtempSync` directory they
// created themselves. Neither is request or user input, and `dir` here only
// ever walks upward (`path.dirname`) from one of those two starting points,
// so it cannot be steered to an attacker-chosen path.
function resolveInstallRoot(searchRoot) {
  const pkgSegments = PACKAGE_NAME.split('/'); // ['@testing-library', 'dom']
  const hasCopy = (dir) =>
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    fs.existsSync(path.join(dir, 'node_modules', ...pkgSegments, 'package.json'));
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  let dir = path.resolve(searchRoot);
  let parent = path.dirname(dir);
  while (parent !== dir) {
    if (hasCopy(dir)) return dir;
    dir = parent;
    parent = path.dirname(dir);
  }
  // The loop stops before testing the filesystem root itself; test it too.
  if (hasCopy(dir)) return dir;
  return null;
}

// Split `npm ls <pkg> --parseable --long` output into the set of distinct
// installed copies it names, each as { path, version }. Blank lines (a
// trailing newline, or the occasional blank line npm emits alongside a
// warning) are dropped. Windows line endings are normalized so this behaves
// the same whether npm's stdout used `\n` or `\r\n`.
//
// Each --long line is `<physical-path>:<name>@<version>` (npm appends further
// colon-delimited fields on some entries — a resolved path and a status marker
// like INVALID/extraneous for a symlinked or mislinked copy; the version is
// the first token after the id). The physical path can itself contain
// `@testing-library/dom` as a directory, but never the id separator `:<name>@`,
// since path separators are `/` or `\` and the only colon in a path is a
// Windows drive letter. So the FIRST occurrence of `:<name>@` is the
// path->id boundary. We use indexOf (not lastIndexOf) so that even if a later
// field ever carried an id-shaped token, we still anchor to the real boundary
// rather than the last look-alike.
//
// Copies are deduplicated by path, case-insensitively on platforms whose
// default filesystem is case-insensitive (Windows, macOS) — two
// differently-cased spellings of the same physical directory are the same
// install, not two copies, on those platforms. `caseInsensitive` defaults
// from `process.platform` but is overridable so this stays testable without
// depending on the OS the tests happen to run on.
function parseInstalledCopies(stdout, caseInsensitive = process.platform !== 'linux') {
  const marker = `:${PACKAGE_NAME}@`;
  const seen = new Map(); // normalized path key -> { path, version } (first seen)
  String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const at = line.indexOf(marker);
      let installPath;
      let version;
      if (at === -1) {
        // No id suffix (plain --parseable output, or an unexpected shape).
        // Treat the whole line as the path; the version is unknown rather
        // than guessed.
        installPath = line;
        version = null;
      } else {
        installPath = line.slice(0, at);
        version = line.slice(at + marker.length).split(':')[0] || null;
      }
      const key = caseInsensitive ? installPath.toLowerCase() : installPath;
      if (!seen.has(key)) seen.set(key, { path: installPath, version });
    });
  return Array.from(seen.values());
}

// Decide whether a set of installed copies represents the healthy,
// single-copy state this guard exists to enforce. Exactly one physical copy
// is the pass; zero and two-or-more are both violations. Fail-closed: zero
// (cannot-look, or genuinely dropped) is NEVER a pass.
function evaluate(copies) {
  return { ok: copies.length === 1, count: copies.length };
}

// Build the failure diagnostic. It is a pure function of (copies, searchRoot,
// installRoot), so the same tree state and the same roots always produce the
// same sentence. It names the count, the location it searched, the location it
// actually resolved against when that differs (#352), and every copy it found
// with that copy's resolved version (or, for zero, the absence and where it
// looked).
//
// installRoot is the directory `npm ls` ran in (the nearest ancestor whose
// node_modules holds the package). It defaults to searchRoot for the common
// case where they coincide (the main checkout, CI, a worktree with its own
// install). It is null only in the "resolves nowhere" found-0 case, which is
// treated the same as coinciding for naming: only the search root is named.
function buildViolationMessage(copies, searchRoot, installRoot = searchRoot) {
  const rootsDiffer = installRoot !== null && installRoot !== searchRoot;
  const lines = [`\n❌ ${PACKAGE_NAME} dedupe check failed.`];
  if (rootsDiffer) {
    // The search root had no install of its own, so Node - and this guard -
    // resolved the package from an ancestor. Name both so the reader can tell
    // "found 2 under the parent, reached from this worktree" apart from a
    // split that lives in the worktree itself.
    lines.push(
      `Searched from: ${searchRoot}`,
      `Resolved against: ${installRoot}`,
      `   (${searchRoot} has no node_modules of its own; Node resolves ${PACKAGE_NAME} from the ` +
        `nearest ancestor install, so \`npm ls ${PACKAGE_NAME} --all --parseable --long\` ran in ${installRoot})`
    );
  } else {
    lines.push(
      `Searched: ${searchRoot}`,
      `   (via \`npm ls ${PACKAGE_NAME} --all --parseable --long\`, resolved against that directory's node_modules)`
    );
  }
  lines.push(
    `Expected exactly one installed copy; found ${copies.length}${copies.length ? ':' : '.'}\n`
  );
  copies.forEach(({ path: installPath, version }) => {
    lines.push(`  ${installPath}  (${PACKAGE_NAME}@${version || 'unknown'})`);
  });

  if (copies.length === 0 && rootsDiffer) {
    // Degenerate, effectively unreachable from main(): an ancestor install
    // resolved (its package.json exists, so installRoot is non-null and differs
    // from the worktree searchRoot) yet `npm ls` in it reported no copy. The
    // `npm ci` remediation below would be actively wrong here - it would tell a
    // reader in the worktree to install into the worktree when a real ancestor
    // install already exists (#352 forbids exactly that advice from this case).
    // Name the contradiction instead and defer to npm's own stderr.
    lines.push(
      `\nAn install of ${PACKAGE_NAME} was found under ${installRoot} (its package.json ` +
        `exists there), but \`npm ls\` run in that directory reported no copy. That is an ` +
        'unexpected, inconsistent tree state, not the normal "never installed" case, so ' +
        `do NOT run \`npm ci\` in ${searchRoot}. Inspect ${installRoot}/node_modules and ` +
        'the npm ls stderr below (see #219 and #224 for why this package must stay ' +
        'deduped).\n'
    );
  } else if (copies.length === 0) {
    lines.push(
      `\nNo copy of ${PACKAGE_NAME} is installed under ${searchRoot}. That is the ` +
        'normal state of a fresh checkout or a git worktree that has never had ' +
        '`npm ci` run inside it, and it is NOT by itself evidence that the ' +
        'dependency was dropped from the repo. Run `npm ci` in that directory and ' +
        're-run this check. If npm ci still finds zero copies, then ' +
        `${PACKAGE_NAME} may actually have been removed from devDependencies ` +
        '(see #219 and #224 for why it must stay pinned there).\n'
    );
  } else if (copies.length >= 2) {
    lines.push(
      '\nTwo or more copies means @testing-library/user-event and ' +
        '@testing-library/react no longer share one @testing-library/dom install. ' +
        'user-event will read a config singleton @testing-library/react never ' +
        'configured, and every user-event interaction across the test suite will ' +
        'dispatch its events outside act(), silently, with no test failing (see ' +
        '#219 for the original defect and #224 for why this check exists). This ' +
        'usually follows a @testing-library/react or @testing-library/user-event ' +
        'version bump: @testing-library/react v15 and v16 both require ' +
        '@testing-library/dom ^10, which no longer satisfies the ' +
        '@testing-library/dom pin in devDependencies. Re-pin @testing-library/dom ' +
        'to a version every consumer can share (do not use an npm `overrides` ' +
        'entry, see #224: it would silently force an unsupported pairing instead ' +
        'of failing honestly), then re-run this check.\n'
    );
  }
  return lines.join('\n');
}

function main() {
  // npm sets npm_execpath for every package script. Execute that JavaScript
  // through the already-running Node binary so Windows never needs cmd.exe.
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    console.error('\nERROR: npm_execpath is missing; run this guard through `npm run check:dom-dedupe`.\n');
    process.exit(1);
  }
  // Resolve against the checkout that owns this script, not the invoking
  // directory, so the answer is the same from anywhere (#313).
  const searchRoot = resolveSearchRoot();
  // Then find the tree the tests will actually use: the nearest ancestor whose
  // node_modules holds the package, the same way Node's module resolution walks
  // up. From a nested worktree with no install of its own, this is the parent
  // checkout, so the guard reports on the shared install the tests really load
  // rather than printing `found 0` for a healthy tree (#352).
  const installRoot = resolveInstallRoot(searchRoot);

  if (installRoot === null) {
    // The package resolves nowhere from the search root or any ancestor. This
    // is the genuine fail-closed case, and the only one that keeps the
    // `npm ci` remediation. There is no directory to run `npm ls` in.
    console.error(buildViolationMessage([], searchRoot, null));
    process.exit(1);
  }

  const result = spawnSync(
    process.execPath,
    [npmExecPath, 'ls', PACKAGE_NAME, '--all', '--parseable', '--long'],
    { encoding: 'utf8', shell: false, cwd: installRoot }
  );

  if (result.error) {
    console.error(`\n❌ Could not run "npm ls ${PACKAGE_NAME}" in ${installRoot}: ${result.error.message}\n`);
    process.exit(1);
  }

  // `npm ls` can exit non-zero for reasons unrelated to this check (an
  // unrelated invalid/extraneous package elsewhere in the tree). Its
  // stdout is still the tree it managed to compute, so parse it
  // regardless of exit code rather than trusting the exit code itself —
  // that's the exact trap #224 documents for THIS package.
  const copies = parseInstalledCopies(result.stdout);
  const { ok } = evaluate(copies);

  if (!ok) {
    console.error(buildViolationMessage(copies, searchRoot, installRoot));
    // npm's own stderr (e.g. an ELSPROBLEMS "invalid" warning) can carry
    // context this script's own diagnostic doesn't have; surface it too
    // when npm produced any.
    if (result.stderr && result.stderr.trim()) {
      console.error(`npm ls stderr:\n${result.stderr.trim()}\n`);
    }
    process.exit(1);
  }

  const only = copies[0];
  // Name the resolved root when it differs from the search root, so a pass
  // from a nested worktree self-explains which tree it judged (#352).
  const where =
    installRoot !== searchRoot
      ? `under ${installRoot} (searched from ${searchRoot}, resolved against that ancestor)`
      : `under ${searchRoot}`;
  console.log(
    `✅ Exactly one copy of ${PACKAGE_NAME} installed ${where}: ` +
      `${only.path} (${PACKAGE_NAME}@${only.version || 'unknown'}).`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveSearchRoot,
  resolveInstallRoot,
  parseInstalledCopies,
  evaluate,
  buildViolationMessage,
};
