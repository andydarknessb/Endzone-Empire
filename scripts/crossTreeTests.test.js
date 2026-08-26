const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoverCrossTreeTests, serverRequireIn } = require('./crossTreeTests');
const { createTestFileMatcher } = require('./jestTestMatch');

// Issue #234. `npm run test:server` now runs, after the node:test set, every
// jest test under `src/` that exercises server code, found by content. This
// guard exists so that step cannot silently run zero (or too few) files: if
// the discovery mechanism regresses and drops a file, CI goes red here rather
// than a server change going green in a run that never touched its test.
//
// The known set is the anchor. Discovery must find AT LEAST these, and each of
// these by name; a new cross-tree file only grows the number and needs no edit
// here (adding one is, at most, a count change, per the ticket). A file
// DISAPPEARING from the result -- the silent-omission failure this ticket is
// about -- fails this guard.
//
// Measurement note for future editors: take counts against origin/integration
// (a worktree cut from it), NOT the shared main checkout, which lags by tens of
// commits. The two trees genuinely differ in teamIdentity.test.js, the exact
// file the count turns on (the #341 server-parity require is on integration and
// not yet released to main), and neither tree errors. That stale-tree read is
// how an earlier measurement came back as twelve.
const KNOWN_CROSS_TREE_TESTS = [
  'src/content/articles/sitemapParity.test.js',
  'src/lib/draftAutopickClock.integration.test.js',
  'src/lib/draftGradeAdp.integration.test.ts',
  'src/lib/draftTurns.test.js',
  'src/lib/leaguePhase.test.js',
  'src/lib/lineupLockTimeline.integration.test.js',
  'src/lib/monteCarloPlayoffProjection.test.js',
  'src/lib/multiSeasonRollover.integration.test.js',
  'src/lib/scoringMatrix.integration.test.js',
  'src/lib/tank01ChaoticIngestion.integration.test.js',
  'src/lib/teamIdentity.test.js',
  'src/lib/tradeFairnessApi.integration.test.js',
  'src/lib/weeklyRecapNarrative.integration.test.ts',
];

test('discovery finds every known cross-tree test, and never fewer', () => {
  const discovered = discoverCrossTreeTests();
  for (const known of KNOWN_CROSS_TREE_TESTS) {
    assert.ok(
      discovered.includes(known),
      `cross-tree discovery no longer finds ${known}. A jest test under src/ that ` +
        'requires server code has stopped being discovered, so a server change can now ' +
        'go green in `npm run test:server` without ever running this test. Fix discovery ' +
        '(scripts/crossTreeTests.js); do not delete the file from KNOWN to make this pass.'
    );
  }
  assert.ok(
    discovered.length >= KNOWN_CROSS_TREE_TESTS.length,
    `cross-tree discovery returned ${discovered.length} files, fewer than the ` +
      `${KNOWN_CROSS_TREE_TESTS.length} known. Discovery has regressed and is dropping files.`
  );
});

test('every discovered file is a jest test under testMatch, keyed on its repo-relative path', () => {
  const discovered = discoverCrossTreeTests();
  const isTestFile = createTestFileMatcher();
  const repoRoot = path.resolve(__dirname, '..');
  const seen = new Set();
  for (const rel of discovered) {
    assert.ok(rel.startsWith('src/'), `discovered path is not under src/: ${rel}`);
    assert.ok(!seen.has(rel), `duplicate repo-relative path in discovery result: ${rel}`);
    seen.add(rel);
    assert.equal(
      isTestFile(path.join(repoRoot, ...rel.split('/'))),
      true,
      `discovered file is not a jest testMatch file: ${rel}`
    );
  }
});

// The five basenames that exist in both server/test and src/ as different
// files (identityComparisonGuard, leaguePhase, leagueType, rosterShape,
// teamIdentity) are why discovery keys on the repo-relative path. This fixture
// proves the mechanism directly: two DIFFERENT files sharing one basename, both
// requiring server code, must both survive. A basename-keyed Set would collapse
// them to one and silently drop a real server test.
test('a basename shared by two files in different dirs does not drop either (repo-relative keying)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'crosstree-collide-'));
  try {
    fs.mkdirSync(path.join(repo, 'server'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'src', 'a'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'src', 'b'), { recursive: true });
    const body = "const pool = require('../../server/pool');\n";
    fs.writeFileSync(path.join(repo, 'src', 'a', 'dup.test.js'), body);
    fs.writeFileSync(path.join(repo, 'src', 'b', 'dup.test.js'), body);
    // A sibling that reaches nothing under server/ must NOT be discovered.
    fs.writeFileSync(
      path.join(repo, 'src', 'a', 'plain.test.js'),
      "const local = require('./helper');\n"
    );

    const discovered = discoverCrossTreeTests(repo);
    assert.ok(discovered.includes('src/a/dup.test.js'), 'dropped src/a/dup.test.js');
    assert.ok(discovered.includes('src/b/dup.test.js'), 'dropped src/b/dup.test.js (basename collision)');
    assert.ok(!discovered.includes('src/a/plain.test.js'), 'included a non-server test');
    assert.equal(discovered.length, 2);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('serverRequireIn matches a relative specifier resolving under server/, and only that', () => {
  const serverDir = path.resolve('/repo/server');
  const fromDir = path.resolve('/repo/src/lib');
  assert.equal(serverRequireIn("require('../../server/modules/pool')", fromDir, serverDir), '../../server/modules/pool');
  assert.equal(serverRequireIn("import x from '../../server/services/foo'", fromDir, serverDir), '../../server/services/foo');
  assert.equal(serverRequireIn("import('../../server/services/foo')", fromDir, serverDir), '../../server/services/foo');
  assert.equal(serverRequireIn("import '../../server/side-effect'", fromDir, serverDir), '../../server/side-effect');
  // Non-matches: a sibling client module, a bare package, and a sibling that
  // only shares a name prefix with the server dir.
  assert.equal(serverRequireIn("import { a } from './teamIdentity'", fromDir, serverDir), null);
  assert.equal(serverRequireIn("require('react')", fromDir, serverDir), null);
  assert.equal(serverRequireIn("require('../../serverless/x')", fromDir, serverDir), null);
});

// Regression guard for the lastIndex hazard. serverRequireIn must construct its
// /g regex fresh on each call: a hoisted, shared regex carries lastIndex
// between calls and skips an early specifier in the next source. This test
// calls it twice in a row and requires the SECOND call to still find a require
// that sits at the very start of its source. If someone lifts the regex to
// module scope "to avoid re-allocating", this goes red.
test('finds an early require on a second consecutive call (no shared-regex lastIndex leak)', () => {
  const serverDir = path.resolve('/repo/server');
  const fromDir = path.resolve('/repo/src/lib');
  const long = "require('../../server/modules/pool')" + ' // padding'.repeat(50);
  const earlyThenNothing = "require('../../server/services/recap.service')\nconst x = 1;\n";
  assert.equal(serverRequireIn(long, fromDir, serverDir), '../../server/modules/pool');
  assert.equal(
    serverRequireIn(earlyThenNothing, fromDir, serverDir),
    '../../server/services/recap.service',
    'second call missed an early require -- the regex is leaking lastIndex between calls'
  );
});
