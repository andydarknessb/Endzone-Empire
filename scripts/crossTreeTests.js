'use strict';

// Issue #234: `npm run test:server` used to run only `server/test/*.test.js`,
// so a jest test that lives under `src/` but exercises SERVER code could go
// green in the run a server author executes and red only in CI's client job.
//
// This module discovers those "cross-tree" tests by CONTENT, not by a
// hard-coded list and not by a naming convention: a file counts iff it is a
// jest test under `src/` (per jest's own `testMatch`, so js/jsx/ts/tsx are all
// covered) AND its source has at least one require/import specifier that
// resolves to a path under `server/`. Content-based discovery is the whole
// point: a new such file is picked up without editing a list, and a renamed
// one is not lost.
//
// Identity is the REPO-RELATIVE POSIX path, never the basename. `server/test`
// and `src/` share several basenames as genuinely different files
// (identityComparisonGuard, leaguePhase, leagueType, rosterShape, teamIdentity
// as of 2026-08), so a basename key would silently drop one of a colliding
// pair. This module never keys on basename, and it never touches the runner's
// SWEEP list, which stays basename-scoped to the single `server/test`
// directory where basenames are unique by construction.

const fs = require('node:fs');
const path = require('node:path');
const { createTestFileMatcher } = require('./jestTestMatch');

const REPO_ROOT = path.resolve(__dirname, '..');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

// Returns the first relative specifier in `source` that resolves to a path
// under `serverDir`, or null. Textual by design: it errs toward inclusion (a
// specifier that resolves under server/ counts even if it sat in a comment),
// because the guard that consumes this module asserts a known set is a SUBSET
// of the result, so a false positive is loud (count check) while a false
// negative -- the gap this whole ticket exists to close -- would be silent.
function serverRequireIn(source, fromDir, serverDir) {
  // IMPORTANT: construct the regex fresh on every call. A single /g regex
  // hoisted out of this function carries `lastIndex` between files and will
  // silently skip an early specifier in the next file (that dropped
  // weeklyRecapNarrative during development). Do not lift this to module scope.
  const specRe = /(?:require\s*\(\s*|import\s*\(\s*|import\s+|from\s+)['"]([^'"]+)['"]/g;
  let match;
  while ((match = specRe.exec(source)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue; // only a relative path can reach server/
    const resolved = path.resolve(fromDir, spec);
    const rel = path.relative(serverDir, resolved);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return spec;
    }
  }
  return null;
}

// Discovers every jest test file under `<repoRoot>/src` whose source requires
// or imports a path resolving under `<repoRoot>/server`. Returns repo-relative
// POSIX paths, sorted and de-duplicated.
function discoverCrossTreeTests(repoRoot = REPO_ROOT) {
  const srcDir = path.join(repoRoot, 'src');
  const serverDir = path.join(repoRoot, 'server');
  const isTestFile = createTestFileMatcher();

  const found = new Set();
  for (const absPath of walk(srcDir, [])) {
    if (!isTestFile(absPath)) continue;
    const source = fs.readFileSync(absPath, 'utf8');
    if (serverRequireIn(source, path.dirname(absPath), serverDir)) {
      found.add(path.relative(repoRoot, absPath).split(path.sep).join('/'));
    }
  }
  return [...found].sort();
}

module.exports = { discoverCrossTreeTests, serverRequireIn, REPO_ROOT };
