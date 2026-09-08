#!/usr/bin/env node
/**
 * Server test runner.
 *
 * `npm run test:server` exists so a server author can run the tests their
 * change affects and trust a green result. That requires running every test
 * that exercises server code, which lives in more than one place. The runner
 * knows four populations:
 *
 *   fast       server/test/*.test.js minus the sweep set, via `node --test`.
 *              The default. A couple of minutes.
 *   sweep      the backtest sweep files below, via `node --test`. ~35 min,
 *              essentially the whole wall clock; never run per commit. `--sweep`
 *              runs ONLY these.
 *   cross-tree jest tests under src/ that require/import server code, discovered
 *              by content (scripts/crossTreeTests.js), run through the project's
 *              configured jest command (react-scripts test --runTestsByPath),
 *              NOT bare jest and NOT with a forced --env: each file's own
 *              docblock decides its environment. Seconds. Runs after the fast
 *              set in the default mode, and again in `--all`, so a server change
 *              cannot go green here yet red in CI's client job.
 *   pg         the *.pg.test.js files are in the fast set and pass through it,
 *              but each self-skips unless a Postgres env flag holds exactly
 *              the string `1`: the umbrella `PG_TESTS`, or the file's own
 *              `*_PG_TESTS` flag. The per-file names are not enumerated here,
 *              because any such list goes stale as files are added; read the
 *              `const ENABLED` line at the top of the file you want, which is
 *              the authority. Every gate is a `=== '1'` comparison, so
 *              `=true` or `=0` skips silently. With none set they run as a
 *              fast no-op.
 *
 * The sweep files build large cartesian-product fixtures (cells x seasons x
 * weeks x salts x players); they are CPU-bound, not hung, so they are worth
 * keeping, just not on every run. The glob is resolved here rather than in
 * package.json so the command does not depend on the shell: `server/test/**`
 * behaves differently under bash with and without globstar, and not at all like
 * cmd.exe.
 *
 *   node scripts/run-server-tests.js            # fast set, then cross-tree
 *   node scripts/run-server-tests.js --sweep    # only the heavy sweep set
 *   node scripts/run-server-tests.js --all      # everything, then cross-tree
 *
 * Exit status: the process exits non-zero if EITHER the node:test run or the
 * cross-tree run fails, and it runs both even when the first fails, so one
 * invocation reports everything.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { discoverCrossTreeTests } = require('./crossTreeTests');

const REPO_ROOT = path.join(__dirname, '..');
const TEST_DIR = path.join(REPO_ROOT, 'server', 'test');

// Basenames, so a rename is a visible failure here rather than a silent
// re-inclusion that quietly puts 35 minutes back on every run. SWEEP is scoped
// to the single server/test directory, where a basename is a unique key; it is
// matched only against files read from TEST_DIR and is never compared against
// the cross-tree set (which lives under src/ and shares basenames with
// server/test), so the cross-root basename collisions cannot touch it.
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

function runSpawn(command, args, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: 'inherit', ...options });
    } catch (err) {
      // spawn can throw synchronously (e.g. ENAMETOOLONG when the argv is too
      // long, ENOENT when the binary is missing) before ever emitting 'error'.
      // Route that to the same message and exit code as the async 'error' path
      // so the runner reports a clean failure instead of dying with a stack.
      console.error(`run-server-tests: failed to launch ${command}: ${err.message}`);
      resolve(1);
      return;
    }
    child.on('exit', (code, signal) => {
      if (signal) {
        console.error(`run-server-tests: a runner was terminated by ${signal}`);
        resolve(1);
        return;
      }
      resolve(code === null ? 1 : code);
    });
    child.on('error', (err) => {
      console.error(`run-server-tests: failed to launch ${command}: ${err.message}`);
      resolve(1);
    });
  });
}

// The files a mode selects, as basenames read from TEST_DIR. Exits the process
// if the SWEEP list has gone stale or the mode matched nothing; those are the
// same fatal conditions as before and are part of what "which files each mode
// selects" means.
function selectNodeTestFiles(mode) {
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

  return selected;
}

// The exact spawn descriptor for the node:test set. Kept pure (no spawn, no
// logging) so the guard (scripts/run-server-tests.test.js) can assert its shape
// directly: each file is a path relative to REPO_ROOT and the spawn cwd is
// REPO_ROOT, the same shape runCrossTreeSet uses. `node --test` resolves
// relative paths against cwd, so the selected set is identical, but the argv
// stays short (~10 KB instead of ~34 KB from a deep .claude/worktrees checkout),
// which is what keeps spawn under the OS command-length limit (ENAMETOOLONG).
function buildNodeTestSpawn(mode, selected) {
  const files = selected || selectNodeTestFiles(mode);
  const timeout = mode === 'fast' ? TIMEOUT_MS.fast : TIMEOUT_MS.sweep;
  return {
    command: process.execPath,
    args: ['--test', `--test-timeout=${timeout}`, ...files.map((name) => path.join('server', 'test', name))],
    options: { cwd: REPO_ROOT },
  };
}

function runNodeTestSet(mode) {
  const selected = selectNodeTestFiles(mode);
  const timeout = mode === 'fast' ? TIMEOUT_MS.fast : TIMEOUT_MS.sweep;
  console.log(`run-server-tests: node:test ${mode}, ${selected.length} files, per-test timeout ${timeout}ms`);

  const { command, args, options } = buildNodeTestSpawn(mode, selected);
  return runSpawn(command, args, options);
}

function runCrossTreeSet() {
  const files = discoverCrossTreeTests(REPO_ROOT);
  if (!files.length) {
    // Discovery should never return zero on a real checkout; the guard
    // (scripts/crossTreeTests.test.js) exists to catch that in CI. If it
    // happens here, fail loudly rather than run react-scripts with no paths
    // (which would run the entire jest tree).
    console.error('run-server-tests: cross-tree discovery found no files; refusing to run.');
    console.error('This is a discovery regression - see scripts/crossTreeTests.js.');
    return Promise.resolve(1);
  }

  console.log(`run-server-tests: cross-tree, ${files.length} files (jest, per-file environment)`);

  let reactScriptsBin;
  try {
    reactScriptsBin = require.resolve('react-scripts/bin/react-scripts.js');
  } catch (err) {
    console.error(`run-server-tests: cannot resolve react-scripts: ${err.message}`);
    return Promise.resolve(1);
  }

  // The project's configured jest command. No forced --env: each file's own
  // docblock decides its environment. --runTestsByPath so each argument is an
  // exact path, not a regex (a bare path would also match worktree copies under
  // .claude/worktrees/ on a developer machine).
  return runSpawn(
    process.execPath,
    [reactScriptsBin, 'test', '--watchAll=false', '--runInBand', '--runTestsByPath', ...files],
    { cwd: REPO_ROOT, env: { ...process.env, CI: 'true' } }
  );
}

async function main() {
  const mode = process.argv.includes('--sweep')
    ? 'sweep'
    : (process.argv.includes('--all') ? 'all' : 'fast');

  const nodeTestCode = await runNodeTestSet(mode);

  // --sweep runs only the heavy sweep node:test files; the cross-tree set is not
  // part of it. The default and --all both append the cross-tree run, and run
  // it even when the node:test set failed, so one invocation reports both.
  let crossTreeCode = 0;
  if (mode !== 'sweep') {
    crossTreeCode = await runCrossTreeSet();
  }

  process.exit(nodeTestCode !== 0 || crossTreeCode !== 0 ? 1 : 0);
}

// Only run when invoked as the CLI (node scripts/run-server-tests.js). Under
// require() -- the guard -- the module exports its builders without spawning.
if (require.main === module) {
  main();
}

module.exports = { REPO_ROOT, TEST_DIR, selectNodeTestFiles, buildNodeTestSpawn };
