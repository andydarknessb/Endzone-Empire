#!/usr/bin/env node
/**
 * Server test runner.
 *
 * Splits the server suite in two, the same way `test:holdout-pg` and
 * `test:backtest-pg` are already split out, because six backtest sweep files
 * account for essentially the entire wall clock:
 *
 *   backtestRunBacktestSweep          ~35 min
 *   backtestPermutationControl        ~7.7 min
 *   backtestInputsGeneration          ~2.8 min
 *   backtestSweepEvidence             ~2.6 min
 *   backtestInputsAssembly            ~2.0 min
 *   backtestInputsPermutationCapture  ~1.8 min
 *
 * The other 149 files finish in under 15 seconds each. Measured 2026-08-19 on
 * an idle 16-core machine: the whole suite took 41.6 minutes, and the fast half
 * alone takes a couple of minutes. These tests build large cartesian-product
 * fixtures (cells x seasons x weeks x salts x players); they are CPU-bound, not
 * hung, so they are worth keeping, just not on every `npm run test:server`.
 *
 * The glob is resolved here rather than in package.json so the command does not
 * depend on the shell: `server/test/**` behaves differently under bash with and
 * without globstar, and not at all like cmd.exe.
 *
 *   node scripts/run-server-tests.js            # the fast 149
 *   node scripts/run-server-tests.js --sweep    # only the six heavy ones
 *   node scripts/run-server-tests.js --all      # everything, ~42 min
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DIR = path.join(__dirname, '..', 'server', 'test');

// Basenames, so a rename is a visible failure here rather than a silent
// re-inclusion that quietly puts 35 minutes back on every run.
const SWEEP = [
  'backtestInputsAssembly.test.js',
  'backtestInputsGeneration.test.js',
  'backtestInputsPermutationCapture.test.js',
  'backtestPermutationControl.test.js',
  'backtestRunBacktestSweep.test.js',
  'backtestSweepEvidence.test.js',
];

// Per-TEST, not per-file: individual tests here run in milliseconds, so a
// minute means something is genuinely stuck rather than merely slow.
const TIMEOUT_MS = { fast: 60_000, sweep: 600_000 };

function main() {
  const mode = process.argv.includes('--sweep')
    ? 'sweep'
    : (process.argv.includes('--all') ? 'all' : 'fast');

  const all = fs.readdirSync(TEST_DIR).filter((name) => name.endsWith('.test.js')).sort();

  const missing = SWEEP.filter((name) => !all.includes(name));
  if (missing.length) {
    console.error(`run-server-tests: these sweep files no longer exist: ${missing.join(', ')}`);
    console.error('Update the SWEEP list in scripts/run-server-tests.js.');
    process.exit(1);
  }

  const selected = mode === 'sweep'
    ? all.filter((name) => SWEEP.includes(name))
    : (mode === 'all' ? all : all.filter((name) => !SWEEP.includes(name)));

  if (!selected.length) {
    console.error(`run-server-tests: no test files matched mode "${mode}"`);
    process.exit(1);
  }

  const timeout = mode === 'fast' ? TIMEOUT_MS.fast : TIMEOUT_MS.sweep;
  console.log(`run-server-tests: ${mode}, ${selected.length} files, per-test timeout ${timeout}ms`);

  const child = spawn(
    process.execPath,
    ['--test', `--test-timeout=${timeout}`, ...selected.map((name) => path.join(TEST_DIR, name))],
    { stdio: 'inherit' }
  );
  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`run-server-tests: test runner terminated by ${signal}`);
      process.exit(1);
    }
    process.exit(code === null ? 1 : code);
  });
}

main();
