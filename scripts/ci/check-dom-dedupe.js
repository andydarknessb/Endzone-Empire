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
 * code is not a usable signal — see #224. `npm ls <pkg> --parseable`
 * prints one line per distinct installed *path*, deduplicating identical
 * physical locations, regardless of how many consumers reference it. A
 * healthy tree prints exactly one path even when npm's tree view labels
 * the second and later consumers "deduped"; a split tree prints one path
 * per copy. This script counts those lines and treats any count other
 * than exactly one as a violation.
 *
 * Run: `npm run check:dom-dedupe`
 *
 * NOT YET WIRED INTO CI. This script exists, is documented, and is
 * runnable by hand or from a workflow step, but nothing invokes it
 * automatically today — see the PR that introduced it (#224) for the
 * proposed `test-build` step. Wiring it in is deliberately left to the
 * maintainer, since `.github/workflows/**` is out of scope here.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKAGE_NAME = '@testing-library/dom';

// Split `npm ls <pkg> --parseable` output into the set of distinct
// installed paths it names. Blank lines (a trailing newline, or the
// occasional blank line npm emits alongside a warning) are dropped.
// Windows line endings are normalized so this behaves the same whether
// npm's stdout used `\n` or `\r\n`.
//
// Paths are deduplicated case-insensitively on platforms whose default
// filesystem is case-insensitive (Windows, macOS) — two differently-cased
// spellings of the same physical directory are the same install, not two
// copies, on those platforms. `caseInsensitive` defaults from
// `process.platform` but is overridable so this stays testable without
// depending on the OS the tests happen to run on.
function parseParseablePaths(stdout, caseInsensitive = process.platform !== 'linux') {
  const seen = new Map(); // normalized key -> first-seen original spelling
  String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((p) => {
      const key = caseInsensitive ? p.toLowerCase() : p;
      if (!seen.has(key)) seen.set(key, p);
    });
  return Array.from(seen.values());
}

// Decide whether a set of installed paths represents the healthy,
// single-copy state this guard exists to enforce.
function evaluate(paths) {
  return { ok: paths.length === 1, count: paths.length };
}

// Best-effort version lookup for a diagnostic message: read the
// installed copy's own package.json. Never throws — a copy this script
// can't introspect still gets reported, just without a version.
function readInstalledVersion(installPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(installPath, 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function buildViolationMessage(paths, versionOf = readInstalledVersion) {
  const lines = [
    `\n❌ Expected exactly one installed copy of ${PACKAGE_NAME}, found ${paths.length}:\n`,
  ];
  paths.forEach((p) => {
    lines.push(`  ${p} @ ${versionOf(p)}`);
  });

  if (paths.length === 0) {
    lines.push(
      `\nNo installed copy of ${PACKAGE_NAME} was found at all. Run \`npm ci\` (or ` +
        '`npm install`) and re-run this check; if that still finds zero, ' +
        `${PACKAGE_NAME} may have been dropped from devDependencies (see #219 and ` +
        '#224 for why it needs to stay pinned there).\n'
    );
  } else {
    lines.push(
      '\nTwo or more copies means @testing-library/user-event and ' +
        '@testing-library/react no longer share one @testing-library/dom install. ' +
        "user-event will read a config singleton @testing-library/react never " +
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
  // On Windows, npm is a .cmd shim: Node refuses to spawn a .cmd file
  // directly without a shell (EINVAL), so `shell: true` is required there.
  // It is not needed for the arguments themselves — every argument below
  // is a fixed string literal, none of it is untrusted input.
  const result = spawnSync(
    'npm',
    ['ls', PACKAGE_NAME, '--all', '--parseable'],
    { encoding: 'utf8', shell: process.platform === 'win32' } // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process, javascript.lang.security.audit.spawn-shell-true.spawn-shell-true
  );

  if (result.error) {
    console.error(`\n❌ Could not run "npm ls ${PACKAGE_NAME}": ${result.error.message}\n`);
    process.exit(1);
  }

  // `npm ls` can exit non-zero for reasons unrelated to this check (an
  // unrelated invalid/extraneous package elsewhere in the tree). Its
  // stdout is still the tree it managed to compute, so parse it
  // regardless of exit code rather than trusting the exit code itself —
  // that's the exact trap #224 documents for THIS package.
  const paths = parseParseablePaths(result.stdout);
  const { ok } = evaluate(paths);

  if (!ok) {
    console.error(buildViolationMessage(paths));
    // npm's own stderr (e.g. an ELSPROBLEMS "invalid" warning) can carry
    // context this script's own diagnostic doesn't have; surface it too
    // when npm produced any.
    if (result.stderr && result.stderr.trim()) {
      console.error(`npm ls stderr:\n${result.stderr.trim()}\n`);
    }
    process.exit(1);
  }

  console.log(`✅ Exactly one copy of ${PACKAGE_NAME} installed (${paths[0]}).`);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseParseablePaths,
  evaluate,
  buildViolationMessage,
};
