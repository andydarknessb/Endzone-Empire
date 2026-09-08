/**
 * Umbrella guard for the Postgres migration-smoke tests (#371).
 *
 * migration-smoke runs every server/test/*.pg.test.js from one directory-wide
 * step (`npm run test:pg`), gated by a single umbrella variable, PG_TESTS=1,
 * rather than eleven hand-listed npm scripts each setting its own variable. That
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
const { extractGateNames, decideGate } = require('../../scripts/run-pg-tests');

const TEST_DIR = __dirname;

function pgFiles() {
  return fs.readdirSync(TEST_DIR).filter((name) => name.endsWith('.pg.test.js')).sort();
}

// A pg file honours the umbrella iff its ENABLED check actually reads
// process.env.PG_TESTS. Matching `process.env.PG_TESTS` specifically, rather
// than the bare token, means a file that only NAMES PG_TESTS in a skip message
// while still gating on its own variable alone is caught, not passed.
function honoursUmbrella(source) {
  return /process\.env\.PG_TESTS\b/.test(source);
}

test('every server/test/*.pg.test.js references PG_TESTS', () => {
  const files = pgFiles();
  // The scan must actually reach the tree, or this would pass by finding
  // nothing; the tree holds well over ten pg test files today. The threshold
  // below is a floor proving the scan reached the tree, not a count of files.
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
    + "process.env.<OWN>_PG_TESTS === '1'` and mention PG_TESTS in the skip message."
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

  // Every run-last basename sits at the tail, in RUN_LAST order. Keeping
  // holdout last is defensive and not established -- see the runner's own
  // docblock (scripts/run-pg-tests.js) for the full argument.
  assert.deepEqual(ordered.slice(-RUN_LAST.length), RUN_LAST);
  assert.ok(RUN_LAST.includes('holdout.pg.test.js'));
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

// #989: extractGateNames pulls a pg file's own gate names from process.env
// reads only, never from prose. The process.env. anchor is what keeps a name
// mentioned only inside a skip message, or a connection variable like PGHOST,
// from being mistaken for a gate.
test('extractGateNames finds every process.env.*_PG_TESTS read, from both sides', () => {
  const withGates = "process.env.PG_TESTS === '1' || process.env.FOO_PG_TESTS === '1'";
  assert.deepEqual(extractGateNames(withGates).sort(), ['FOO_PG_TESTS', 'PG_TESTS']);

  const nameOnlyInSkipMessage = "console.log('set FOO_PG_TESTS=1 to run this file');";
  assert.deepEqual(extractGateNames(nameOnlyInSkipMessage), []);

  const connectionVarsOnly = 'const host = process.env.PGHOST; const db = process.env.PGDATABASE;';
  assert.deepEqual(extractGateNames(connectionVarsOnly), []);
});

// Red-tell (per the brief): dropping the process\.env\. anchor from the
// extraction pattern turns the skip-message half of the test above red,
// because a bare token match would then also pick up FOO_PG_TESTS from the
// skip-message-only source.
test('extractGateNames anchor: a bare token match would wrongly hit a skip message', () => {
  const nameOnlyInSkipMessage = "console.log('set FOO_PG_TESTS=1 to run this file');";
  const bareTokenPattern = /\b([A-Za-z_][A-Za-z0-9_]*_PG_TESTS)\b/g;
  const bareTokenNames = [...nameOnlyInSkipMessage.matchAll(bareTokenPattern)].map((m) => m[1]);
  assert.deepEqual(bareTokenNames, ['FOO_PG_TESTS']);
  assert.deepEqual(extractGateNames(nameOnlyInSkipMessage), []);
});

// #989: decideGate is the pure refusal/proceed decision. It takes a plain
// environment object and the recognized per-file gate names as arguments and
// never touches process.env itself, so every case below runs with no
// database and without mutating this test process's own environment.
test('decideGate: empty environment refuses with the headline phrase', () => {
  const decision = decideGate({}, ['HOLDOUT_PG_TESTS']);
  assert.equal(decision.proceed, false);
  assert.match(decision.message, /refusing to report green/);
});

// Red-tell: adding PG_TESTS: '1' to this fixture turns this test red (it
// would then proceed).
test('decideGate: PG_TESTS at exactly 1 proceeds', () => {
  const decision = decideGate({ PG_TESTS: '1' }, ['HOLDOUT_PG_TESTS']);
  assert.equal(decision.proceed, true);
  assert.equal(decision.message, '');
});

// Red-tell: changing this fixture's value from '1' to 'true' turns this test
// red (it would then refuse instead of proceeding).
test('decideGate: a recognized per-file gate at exactly 1 proceeds on its own', () => {
  const decision = decideGate({ HOLDOUT_PG_TESTS: '1' }, ['HOLDOUT_PG_TESTS']);
  assert.equal(decision.proceed, true);
  assert.equal(decision.message, '');
});

// Red-tell: passing ['PG_TESTS'] as the recognized-names argument here
// (instead of a list containing HOLDOUT_PG_TESTS) turns this test red, because
// HOLDOUT_PG_TESTS becomes unrecognized and unrecognized is a refusal.
test('decideGate: a recognized name present but not 1 refuses and is named with its value', () => {
  const decision = decideGate({ HOLDOUT_PG_TESTS: 'true' }, ['HOLDOUT_PG_TESTS']);
  assert.equal(decision.proceed, false);
  assert.match(decision.message, /HOLDOUT_PG_TESTS/);
  assert.match(decision.message, /"true"/);
  assert.match(decision.message, /exact string '1'/);
});

// Red-tell: removing the set-but-not-1 section from buildRefusalMessage turns
// this test red while leaving the empty-environment test above green.
test('decideGate: an env of { PG_TESTS: "" } refuses and renders the empty value visibly', () => {
  const decision = decideGate({ PG_TESTS: '' }, ['HOLDOUT_PG_TESTS']);
  assert.equal(decision.proceed, false);
  assert.match(decision.message, /PG_TESTS=""/);
});

// Red-tell: filtering the set-but-not-1 section on truthiness of the value
// turns the test above red (an empty string is falsy) while leaving the
// 'true'-typo test above green (a non-empty string is truthy).
test('decideGate: presence, not truthiness, drives the set-but-not-1 section', () => {
  const emptyValueDecision = decideGate({ PG_TESTS: '' }, ['HOLDOUT_PG_TESTS']);
  assert.match(emptyValueDecision.message, /PG_TESTS=""/);
});

// Red-tell: treating any *_PG_TESTS at 1 as an open gate (rather than checking
// it against the recognized-names argument) turns this test red.
test('decideGate: a *_PG_TESTS name at 1 that no pg file reads is unrecognized and refuses', () => {
  const decision = decideGate({ FOO_PG_TESTS: '1' }, ['HOLDOUT_PG_TESTS']);
  assert.equal(decision.proceed, false);
  assert.match(decision.message, /FOO_PG_TESTS/i);
  assert.match(decision.message, /unrecognized/);
});

// Fail-closed shape: an empty recognized-name list with no umbrella gate set
// means the derivation itself is broken, not that no gate is set, so this
// gets a distinct message. Red-tell: making an empty name list refuse
// unconditionally (instead of still honouring PG_TESTS=1) turns the second
// half of this test red, which is the half that protects migration-smoke.
test('decideGate: an empty recognized-name list is a derivation failure, but PG_TESTS=1 still proceeds', () => {
  const brokenDerivation = decideGate({}, []);
  assert.equal(brokenDerivation.proceed, false);
  assert.match(brokenDerivation.message, /refusing to report green/);
  assert.match(brokenDerivation.message, /derived/i);

  const stillProceeds = decideGate({ PG_TESTS: '1' }, []);
  assert.equal(stillProceeds.proceed, true);
  assert.equal(stillProceeds.message, '');
});

// Non-regression (#989): requiring the runner module with no gate set must not
// throw or exit, since server/test/pgTestsUmbrellaGuard.test.js requires it
// and runs inside the ordinary npm run test:server sweep. A refusal evaluated
// at module scope, instead of inside main(), would take that sweep down.
test('requiring run-pg-tests.js with no gate set is inert', () => {
  const result = require('node:child_process').spawnSync(
    process.execPath,
    ['-e', "require('../../scripts/run-pg-tests.js'); console.log('module load is inert')"],
    { cwd: __dirname, encoding: 'utf8' }
  );
  assert.equal(result.status, 0);
  assert.match(result.stdout, /module load is inert/);
});
