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
 * Determinism (#313): `npm ls` resolves against the node_modules of its
 * working directory, so before this change the SAME checkout printed a
 * different sentence depending on which subdirectory you invoked the guard
 * from. We pin the working directory to the checkout that owns THIS script
 * (two levels up from scripts/ci/), which makes the count and the message
 * independent of the working directory WITHIN one checkout: run it from the
 * repo root or from scripts/ci/ or from anywhere below, and you get the same
 * answer about the same tree.
 *
 * What this deliberately does NOT do is force one canonical root across
 * checkouts. Every git worktree carries its own copy of this script, so the
 * anchor resolves to whatever checkout the running script lives in. A worktree
 * with no node_modules legitimately reports zero; the main checkout with a
 * split install legitimately reports two. Those are two different trees, so
 * two different sentences is correct, not a contradiction — forcing them to a
 * single root would make the guard lie about a real difference between the
 * installs. The fix for #313's "same tree, two sentences" complaint is not to
 * collapse the roots but to NAME the search root in every message, so a reader
 * can tell "found 0 under the worktree" apart from "found 2 under the main
 * checkout" instead of reading a bare "found 0" against a bare "found 2" and
 * concluding the dependency was dropped.
 *
 * Symlinked worktrees (common here — many worktrees symlink node_modules to
 * the main checkout): npm resolves the symlink but evaluates the resolved copy
 * against the WORKTREE's package.json, so a copy can be counted correctly, be
 * flagged INVALID/extraneous by npm, and physically live under a different
 * checkout than the search root this message names. The count and the pass/
 * fail verdict stay right; the named root is the tree we asked about, not
 * necessarily the directory the bytes sit in. We do not resolve symlinks
 * (that would change the frozen pass/fail rule, #313); instead the failure
 * path surfaces npm's own stderr, which carries the INVALID/extraneous
 * markers that explain the discrepancy.
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

// Build the failure diagnostic. It is a pure function of (copies, searchRoot),
// so the same tree state and the same search root always produce the same
// sentence. It names the count, the location it searched, and every copy it
// found with that copy's resolved version (or, for zero, the absence and
// where it looked).
function buildViolationMessage(copies, searchRoot) {
  const lines = [
    `\n❌ ${PACKAGE_NAME} dedupe check failed.`,
    `Searched: ${searchRoot}`,
    `   (via \`npm ls ${PACKAGE_NAME} --all --parseable --long\`, resolved against that directory's node_modules)`,
    `Expected exactly one installed copy; found ${copies.length}${copies.length ? ':' : '.'}\n`,
  ];
  copies.forEach(({ path: installPath, version }) => {
    lines.push(`  ${installPath}  (${PACKAGE_NAME}@${version || 'unknown'})`);
  });

  if (copies.length === 0) {
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
  const result = spawnSync(
    process.execPath,
    [npmExecPath, 'ls', PACKAGE_NAME, '--all', '--parseable', '--long'],
    { encoding: 'utf8', shell: false, cwd: searchRoot }
  );

  if (result.error) {
    console.error(`\n❌ Could not run "npm ls ${PACKAGE_NAME}" in ${searchRoot}: ${result.error.message}\n`);
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
    console.error(buildViolationMessage(copies, searchRoot));
    // npm's own stderr (e.g. an ELSPROBLEMS "invalid" warning) can carry
    // context this script's own diagnostic doesn't have; surface it too
    // when npm produced any.
    if (result.stderr && result.stderr.trim()) {
      console.error(`npm ls stderr:\n${result.stderr.trim()}\n`);
    }
    process.exit(1);
  }

  const only = copies[0];
  console.log(
    `✅ Exactly one copy of ${PACKAGE_NAME} installed under ${searchRoot}: ` +
      `${only.path} (${PACKAGE_NAME}@${only.version || 'unknown'}).`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveSearchRoot,
  parseInstalledCopies,
  evaluate,
  buildViolationMessage,
};
