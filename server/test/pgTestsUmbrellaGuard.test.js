/**
 * Umbrella guard for the Postgres migration-smoke tests (#371).
 *
 * migration-smoke runs every server/test/*.pg.test.js from one directory-wide
 * step (`npm run test:pg`), gated by a single umbrella variable, PG_TESTS=1,
 * rather than ten hand-listed npm scripts each setting its own variable. That
 * arrangement only holds if every pg test file actually honours PG_TESTS: a
 * file whose ENABLED check reads only its own *_PG_TESTS variable would be
 * globbed into the run and then silently self-skip, gating itself out of CI
 * with no visible failure -- the exact orphaning this ticket removes, one level
 * up. This guard runs in the ordinary `npm run test:server` suite and fails the
 * moment a pg test file does not reference PG_TESTS.
 *
 * Precedent for the style: identityComparisonGuard.test.js and
 * scripts/ci/check-dom-dedupe.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderPgTests, RUN_LAST } = require('../../scripts/run-pg-tests');

const TEST_DIR = __dirname;

function pgFiles() {
  return fs.readdirSync(TEST_DIR).filter((name) => name.endsWith('.pg.test.js')).sort();
}

// A pg file honours the umbrella iff its source mentions PG_TESTS -- the token
// appears both in `process.env.PG_TESTS === '1' || ...` and in the skip
// message, so a whole-word match is enough to prove it was wired.
function honoursUmbrella(source) {
  return /\bPG_TESTS\b/.test(source);
}

test('every server/test/*.pg.test.js references PG_TESTS', () => {
  const files = pgFiles();
  // The scan must actually reach the tree, or this would pass by finding
  // nothing; twelve pg files exist today.
  assert.ok(files.length >= 10, `expected to find the pg test files; got ${files.length}`);

  const offenders = files.filter(
    (name) => !honoursUmbrella(fs.readFileSync(path.join(TEST_DIR, name), 'utf8'))
  );
  assert.deepEqual(
    offenders,
    [],
    'These pg test files do not reference PG_TESTS, so `npm run test:pg` would glob them '
    + 'in and they would silently self-skip, gating themselves out of migration-smoke. '
    + "Change each ENABLED check to `process.env.PG_TESTS === '1' || "
    + "process.env.<OWN>_PG_TESTS === '1'` and mention PG_TESTS in the skip message.'"
  );
});

// The guard passes trivially if the scan finds nothing or the predicate never
// rejects. Pin the predicate from both sides: a file lacking the token is
// caught, a file carrying it passes.
test('the umbrella predicate catches a file that does not honour PG_TESTS', () => {
  const withoutUmbrella = "const ENABLED = process.env.HOLDOUT_PG_TESTS === '1';\n";
  const withUmbrella =
    "const ENABLED = process.env.PG_TESTS === '1' || process.env.HOLDOUT_PG_TESTS === '1';\n";
  assert.equal(honoursUmbrella(withoutUmbrella), false);
  assert.equal(honoursUmbrella(withUmbrella), true);
});

test('run-pg-tests orders every pg file with holdout last', () => {
  const files = pgFiles();
  const ordered = orderPgTests(files, RUN_LAST);

  // Same set, no dupes, no drops.
  assert.deepEqual([...ordered].sort(), files);
  assert.equal(ordered.length, files.length);

  // Every run-last basename sits at the tail, in RUN_LAST order.
  assert.deepEqual(ordered.slice(-RUN_LAST.length), RUN_LAST);
  assert.ok(RUN_LAST.includes('holdout.pg.test.js'));

  // The far-future-season seeders must precede holdout: they seed and delete a
  // far-future season, and holdout inserts append-only ledger rows that cannot
  // be deleted, so holdout runs after them and the empty-ledger rollback smoke
  // keeps passing.
  const holdoutAt = ordered.indexOf('holdout.pg.test.js');
  for (const seeder of [
    'backtestSnapshotClient.pg.test.js',
    'rosterTenures.pg.test.js',
    'lineupFollowsRoster.pg.test.js',
  ]) {
    assert.ok(files.includes(seeder), `${seeder} missing from tree`);
    assert.ok(ordered.indexOf(seeder) < holdoutAt, `${seeder} must run before holdout`);
  }
});

// orderPgTests must fail loudly if a RUN_LAST basename no longer matches a real
// file -- a rename should break here, not silently reorder into alphabetical
// with holdout no longer last.
test('run-pg-tests rejects a run-last basename that is not present', () => {
  assert.throws(
    () => orderPgTests(['a.pg.test.js', 'b.pg.test.js'], ['holdout.pg.test.js']),
    /run-last/i
  );
});
