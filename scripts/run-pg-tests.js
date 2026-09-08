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
 * the migration-smoke step in .github/workflows/ci.yml. Before spawning
 * anything, this runner decides whether a PG gate is open: either the
 * umbrella PG_TESTS, or a per-file *_PG_TESTS name derived from the pg files
 * themselves (never hand-listed), each open only at the exact string `1`. A
 * per-file gate alone still runs that one file through this umbrella runner,
 * which is a legitimate single-file local workflow and keeps working
 * unchanged. With no gate open, `npm run test:pg` refuses: it prints a
 * message containing `refusing to report green` to stderr and exits 2
 * before `node --test` is spawned, so a bare local run can never again read
 * the same as a green sweep in which nothing actually ran.
 *
 * Four properties the old enumerated steps (plus this refusal) encode, preserved here:
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
 *   4. Refuse before spawning. If neither the umbrella nor any per-file gate
 *      derived from the pg files is set to exactly `1`, main() writes the
 *      refusal message and exits 2 before the `spawn` call below ever runs,
 *      rather than letting node --test print an empty pass/skip summary that
 *      an exit code alone cannot tell apart from every pg test passing.
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

// Gate variable names a single pg file's source actually reads through
// process.env, restricted to PG_TESTS itself or a name ending in _PG_TESTS.
// The process.env. anchor is load-bearing: a name only mentioned inside a
// skip message (no process.env. prefix) is not a gate the file reads, and a
// name like PGHOST or PGDATABASE never ends in _PG_TESTS so it is never
// picked up either way.
function extractGateNames(source) {
  const names = new Set();
  const pattern = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1];
    if (name === 'PG_TESTS' || name.endsWith('_PG_TESTS')) {
      names.add(name);
    }
  }
  return [...names];
}

// Pure decision: given an environment object and the recognized per-file gate
// names (derived from the pg files, never hand-listed), decide whether
// run-pg-tests may proceed, and build the refusal message when it may not.
// Never reads process.env or the filesystem itself, so it is testable with a
// plain object and no database.
function decideGate(env, recognizedNames) {
  if (env.PG_TESTS === '1') {
    return { proceed: true, message: '' };
  }

  const recognizedSet = new Set(recognizedNames);
  const presentPgVars = Object.keys(env).filter(
    (key) => key === 'PG_TESTS' || key.endsWith('_PG_TESTS')
  );

  const perFileOpen = presentPgVars.some(
    (key) => key !== 'PG_TESTS' && recognizedSet.has(key) && env[key] === '1'
  );
  if (perFileOpen) {
    return { proceed: true, message: '' };
  }

  // No gate open. If the derivation itself yielded nothing while pg files
  // exist, that is a broken extractor, not a missing gate -- say so distinctly
  // so a broken extractor is never silently read as "no gate set". PG_TESTS=1
  // still proceeds above regardless of this, which is what protects
  // migration-smoke against a future pg file the extractor cannot parse.
  if (recognizedNames.length === 0) {
    return { proceed: false, message: buildDerivationBrokenMessage() };
  }

  return { proceed: false, message: buildRefusalMessage(env, presentPgVars, recognizedSet) };
}

function formatValue(value) {
  return JSON.stringify(value);
}

function buildDerivationBrokenMessage() {
  return [
    'run-pg-tests: refusing to report green: no per-file *_PG_TESTS gate names '
      + 'could be derived from server/test/*.pg.test.js. That looks like a broken '
      + 'gate-name extractor, not a missing gate, so it is called out separately '
      + 'from the ordinary no-gate refusal.',
    '',
    'Set PG_TESTS=1 to run the whole set (also the only thing that bypasses this '
      + 'check), or fix extractGateNames in scripts/run-pg-tests.js.',
  ].join('\n');
}

function buildRefusalMessage(env, presentPgVars, recognizedSet) {
  const lines = [
    "run-pg-tests: refusing to report green: no PG gate is set to exactly '1', "
      + 'so every server/test/*.pg.test.js file would self-skip and nothing would run.',
  ];

  const setButWrong = presentPgVars.filter((key) => env[key] !== '1');
  if (setButWrong.length) {
    lines.push('');
    lines.push("Set but not '1' (a gate opens only on the exact string '1'):");
    for (const key of setButWrong) {
      lines.push(`  ${key}=${formatValue(env[key])}`);
    }
  }

  const unrecognizedOpen = presentPgVars.filter(
    (key) => env[key] === '1' && key !== 'PG_TESTS' && !recognizedSet.has(key)
  );
  if (unrecognizedOpen.length) {
    lines.push('');
    lines.push("Set to '1' but not a gate any pg test file reads (unrecognized):");
    for (const key of unrecognizedOpen) {
      lines.push(`  ${key}=1`);
    }
  }

  lines.push('');
  lines.push(
    'To proceed: PG_TESTS=1 npm run test:pg runs every file; '
      + '<NAME>_PG_TESTS=1 npm run test:pg runs one file. '
      + "CI's migration-smoke job is where PG_TESTS=1 for the whole run comes from."
  );

  return lines.join('\n');
}

// Reads every pg file's source once and unions the gate names it declares.
function deriveRecognizedGateNames(dir, files) {
  const names = new Set();
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const name of extractGateNames(source)) {
      names.add(name);
    }
  }
  return [...names];
}

function main() {
  const all = listPgTestFiles();
  if (!all.length) {
    console.error(`run-pg-tests: no *.pg.test.js files found in ${TEST_DIR}`);
    process.exit(1);
  }

  const recognizedNames = deriveRecognizedGateNames(TEST_DIR, all);
  const decision = decideGate(process.env, recognizedNames);
  if (!decision.proceed) {
    console.error(decision.message);
    process.exit(2);
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

module.exports = {
  TEST_DIR,
  RUN_LAST,
  listPgTestFiles,
  orderPgTests,
  extractGateNames,
  decideGate,
};
