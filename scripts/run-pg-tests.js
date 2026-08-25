#!/usr/bin/env node
/**
 * Postgres migration-smoke test runner (#371).
 *
 * Runs every server/test/*.pg.test.js file, so a new pg test is covered in the
 * migration-smoke CI job because it exists, not because someone remembered to
 * add a workflow step for it. Replaces ten hand-listed `npm run test:*-pg`
 * steps with one `npm run test:pg` (which sets PG_TESTS=1 for the whole run).
 *
 * Three properties the old enumerated steps encoded, preserved here:
 *
 *   1. Serial execution. `node --test` runs files concurrently by default;
 *      these files share the single migration-smoke database and are not safe
 *      to interleave, so we pass --test-concurrency=1.
 *
 *   2. Ordering. holdout.pg.test.js inserts append-only ledger rows that by
 *      design cannot be deleted, and the empty-ledger rollback smoke earlier in
 *      migration-smoke must keep passing, so holdout runs LAST -- after the
 *      backtest and roster-tenure files that seed and delete a far-future
 *      season. The rule: every file in sorted order, except that RUN_LAST
 *      basenames move to the end. Plain sorted order already puts every
 *      seed-and-delete file ahead of holdout; RUN_LAST only pins the tail.
 *
 *   3. Per-file env gates still work locally. Each file self-skips unless
 *      PG_TESTS=1 or its own *_PG_TESTS variable is set, so the existing
 *      test:*-pg scripts keep running their file(s) on their own variable.
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
// because its append-only ledger rows cannot be deleted; if a second
// must-run-last file ever appears, add its basename to this list.
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
