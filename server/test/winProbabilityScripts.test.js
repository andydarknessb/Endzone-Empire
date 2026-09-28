const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Smoke only: the two win probability v2 scripts are thin gatherers over the
// pure evaluation module (tested in winProbabilityEvaluation.test.js). This
// proves they parse their arguments and answer --help without reading any
// database configuration, since both require the pool only after parsing.
const report = require('../../scripts/win-prob-shadow-report');
const backtest = require('../../scripts/backtest-win-prob-k');

const script = (name) => path.join(__dirname, '..', '..', 'scripts', name);

test('both scripts answer --help with their usage and exit 0', () => {
  for (const name of ['win-prob-shadow-report.js', 'backtest-win-prob-k.js']) {
    const result = spawnSync(process.execPath, [script(name), '--help'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, `${name} --help exited ${result.status}: ${result.stderr}`);
    assert.match(result.stdout, /^Usage: node scripts\//, name);
  }
});

test('the shadow report reads season, a week range, leagues, k and --json', () => {
  const args = report.parseArgs(['--season', '2026', '--weeks', '5-8', '--league', '71', '--league', '9', '--k', '1.15', '--json']);
  assert.deepEqual(args.errors, []);
  assert.equal(args.season, 2026);
  assert.deepEqual(args.weeks, { from: 5, to: 8 });
  assert.deepEqual(args.leagues, [71, 9]);
  assert.equal(args.k, 1.15);
  assert.equal(args.json, true);
  assert.match(report.parseArgs([]).errors.join(' '), /--season/);
  assert.match(report.parseArgs(['--season', '2026', '--weeks', '8-5']).errors.join(' '), /--weeks/);
});

test('the backtest defaults to 2026 and a 0.6 to 1.8 grid by 0.05, and reads overrides', () => {
  const defaults = backtest.parseArgs([]);
  assert.deepEqual(defaults.errors, []);
  assert.equal(defaults.season, 2026);
  assert.deepEqual([defaults.from, defaults.to, defaults.step], [0.6, 1.8, 0.05]);
  const args = backtest.parseArgs(['--weeks', '3', '--from', '0.8', '--to', '1.4', '--step', '0.1']);
  assert.deepEqual(args.weeks, { from: 3, to: 3 });
  assert.deepEqual([args.from, args.to, args.step], [0.8, 1.4, 0.1]);
  assert.match(backtest.parseArgs(['--bogus']).errors.join(' '), /unknown argument/);
});
