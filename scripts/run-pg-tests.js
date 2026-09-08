#!/usr/bin/env node
/**
 * Postgres migration-smoke test runner (#371).
 *
 * Runs every server/test/*.pg.test.js file, so a new pg test is covered in the
 * migration-smoke CI job because it exists, not because someone remembered to
 * add a workflow step for it. Replaces eleven hand-listed `npm run test:*-pg`
 * steps with one `npm run test:pg`.
 *
 * That script does NOT set PG_TESTS. The only place PG_TESTS=1 comes from is
 * the migration-smoke step in .github/workflows/ci.yml. Run `npm run test:pg`
 * locally with no Postgres env flag exported and every file self-skips and the
 * command exits 0, so a local green here is NOT evidence that any pg test ran.
 *
 * Three properties the old enumerated steps encoded, preserved here:
 *
 *   1. Serial execution. `node --test` runs files concurrently by default;
 *      these files share the single migration-smoke database and are not safe
 *      to interleave, so we pass --test-concurrency=1.
 *
 *   2. Ordering. holdout.pg.test.js runs LAST. The reason is defensive and
 *      not established: the migrate/rollback/migrate smoke above this
 *      script's own step already finished by the time test:pg starts, and
 *      the postgres:17 service is a fresh per-job container with no declared
 *      volume, so nothing holdout inserts can reach back and break a step
 *      that already passed. No pg file today asserts anything globally about
 *      the ledger being empty, so nothing running after holdout is known to
 *      break. But holdout's rows are permanent for the rest of the job, so a
 *      future pg file that did make such an assertion would break if it ran
 *      after holdout -- keeping holdout last is cheap insurance against a
 *      file nobody has written yet. The rule: every file in sorted order, except
 *      that RUN_LAST basenames move to the end. RUN_LAST is load-bearing, not
 *      decorative: holdout.pg.test.js sorts alphabetically AHEAD of the
 *      rosterTenures and lineupFollowsRoster seed-and-delete files, so plain
 *      sorted order would run it too early; force-appending RUN_LAST is what
 *      actually keeps it last.
 *
 *   3. Per-file env gates still work locally. Each file self-skips unless
 *      PG_TESTS or its own *_PG_TESTS variable holds exactly the string `1`.
 *      Every gate is a `=== '1'` comparison, so `=true`, `=0` or a stale
 *      value left in a shell skips silently. With `=1` the existing
 *      test:*-pg scripts keep running their file(s) on their own variable.
 *
 * No per-test --test-timeout is passed, matching the plain `node --test <file>`
 * the enumerated steps used before: these tests do real seeding and their
 * durations vary widely, and the GitHub Actions job timeout is the backstop.
 *
 * The glob is resolved here rather than in package.json so the command does not
 * depend on the shell, exactly as scripts/run-server-tests.js does.
 *
 *   node scripts/run-pg-tests.js     # every *.pg.test.js, serial, holdout last
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DIR = path.join(__dirname, '..', 'server', 'test');

// Basenames of pg files that MUST run last, held explicitly and by basename so
// a rename is a visible failure here rather than a silent reordering -- same
// discipline as the SWEEP list in scripts/run-server-tests.js. holdout is here
// because its ledger rows are permanent for the rest of the job; that is
// defensive and not established, since no pg file today asserts anything
// globally about ledger emptiness. If a file ever needs that guarantee, or a
// second must-run-last file appears, add its basename to this list.
const RUN_LAST = ['holdout.pg.test.js'];

function listPgTestFiles() {
  return fs.readdirSync(TEST_DIR).filter((name) => name.endsWith('.pg.test.js')).sort();
}

// Every file in sorted order, with RUN_LAST basenames moved to the end (in
// RUN_LAST order). Throws if a RUN_LAST basename is not in `all`, so a rename
// fails loudly instead of quietly leaving holdout mid-run.
function orderPgTests(all, runLast) {
  const missing = runLast.filter((name) => !all.includes(name));
  if (missing.length) {
    throw new Error(
      `run-pg-tests: these run-last files no longer exist: ${missing.join(', ')}. `
      + 'Update the RUN_LAST list in scripts/run-pg-tests.js.'
    );
  }
  const held = new Set(runLast);
  return [...all.filter((name) => !held.has(name)), ...runLast];
}

function main() {
  const all = listPgTestFiles();
  if (!all.length) {
    console.error(`run-pg-tests: no *.pg.test.js files found in ${TEST_DIR}`);
    process.exit(1);
  }

  let ordered;
  try {
    ordered = orderPgTests(all, RUN_LAST);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log(`run-pg-tests: ${ordered.length} files, serial (--test-concurrency=1)`);
  console.log(ordered.map((name, i) => `  ${i + 1}. ${name}`).join('\n'));

  const child = spawn(
    process.execPath,
    [
      '--test',
      '--test-concurrency=1',
      ...ordered.map((name) => path.join(TEST_DIR, name)),
    ],
    { stdio: 'inherit' }
  );
  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`run-pg-tests: test runner terminated by ${signal}`);
      process.exit(1);
    }
    process.exit(code === null ? 1 : code);
  });
}

if (require.main === module) {
  main();
}

module.exports = { TEST_DIR, RUN_LAST, listPgTestFiles, orderPgTests };
