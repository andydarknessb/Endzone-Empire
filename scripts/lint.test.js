const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { summarize, run, main } = require('./lint');

// -----------------------------------------------------------------------
// summarize(): the pure predicate. Mirrors node_modules/eslint/lib/cli.js's
// own `(errorCount || tooManyWarnings) ? 1 : 0`, so these pin the exact
// values ESLint's own CLI would compute for the same results, not a
// reinvented approximation of them.
// -----------------------------------------------------------------------

test('summarize: a clean run (no errors, no warnings) exits 0', () => {
  const results = [
    { errorCount: 0, warningCount: 0 },
    { errorCount: 0, warningCount: 0 },
  ];
  const summary = summarize(results, { maxWarnings: 0 });
  assert.deepEqual(summary, {
    fileCount: 2,
    errorCount: 0,
    warningCount: 0,
    tooManyWarnings: false,
    exitCode: 0,
  });
});

test('summarize: any error exits 1 regardless of warnings', () => {
  const results = [{ errorCount: 1, warningCount: 0 }];
  const summary = summarize(results, { maxWarnings: 0 });
  assert.equal(summary.exitCode, 1);
});

test('summarize: a single warning exceeds maxWarnings=0 and exits 1', () => {
  const results = [{ errorCount: 0, warningCount: 1 }];
  const summary = summarize(results, { maxWarnings: 0 });
  assert.equal(summary.tooManyWarnings, true);
  assert.equal(summary.exitCode, 1);
});

test('summarize: warnings at or under a positive maxWarnings still exit 0', () => {
  const results = [{ errorCount: 0, warningCount: 3 }];
  assert.equal(summarize(results, { maxWarnings: 3 }).exitCode, 0);
  assert.equal(summarize(results, { maxWarnings: 5 }).exitCode, 0);
});

test('summarize: fileCount is the number of results, independent of problems', () => {
  const results = [
    { errorCount: 0, warningCount: 0 },
    { errorCount: 0, warningCount: 0 },
    { errorCount: 0, warningCount: 0 },
  ];
  assert.equal(summarize(results, { maxWarnings: 0 }).fileCount, 3);
});

// -----------------------------------------------------------------------
// run()/main(): propagation through the real ESLint Node API, against
// fixtures written to a scratch temp directory (never inside src/, server/
// or scripts/, so a deliberately-broken fixture never becomes a real
// finding in this repo's own `npm run lint`).
// -----------------------------------------------------------------------

function makeScratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'endzone-lint-wrapper-'));
}

// A scratch dir carries no eslintConfig of its own, so without an explicit
// parserOptions ESLint parses fixtures as ES5 and 'const'/'module.exports'
// themselves become parse errors -- which would make every fixture below
// "fail" for a reason that has nothing to do with the rule under test.
const MODERN_COMMONJS = { parserOptions: { ecmaVersion: 2020, sourceType: 'script' } };

test('main(): an ordinary lint failure (a real rule violation) propagates as exit 1', async () => {
  const dir = makeScratchDir();
  const file = path.join(dir, 'has-a-violation.js');
  fs.writeFileSync(file, 'const unused = 1;\nmodule.exports = {};\n');

  try {
    const result = await main({
      cwd: dir,
      patterns: [file],
      overrideConfig: { ...MODERN_COMMONJS, rules: { 'no-unused-vars': 'error' } },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.summary.errorCount, 1);
    assert.equal(result.summary.fileCount, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main(): a clean fixture with the same setup propagates as exit 0', async () => {
  const dir = makeScratchDir();
  const file = path.join(dir, 'is-clean.js');
  fs.writeFileSync(file, 'const used = 1;\nmodule.exports = { used };\n');

  try {
    const result = await main({
      cwd: dir,
      patterns: [file],
      overrideConfig: { ...MODERN_COMMONJS, rules: { 'no-unused-vars': 'error' } },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.summary.errorCount, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main(): an ESLint/configuration failure (no files match) propagates as exit 2, not 0 or 1', async () => {
  const result = await main({ patterns: ['definitely-does-not-exist-anywhere-xyz'] });
  assert.equal(result.exitCode, 2);
  assert.ok(result.error, 'expected the thrown ESLint error to be surfaced on the result');
  assert.equal(result.summary, undefined, 'a configuration failure never produced a results summary to report');
});

test('main(): a configuration failure is never folded into the 0/1 "found problems" scale', async () => {
  // A bad parser is a second, distinct real-world configuration failure
  // (mirrors a typo'd eslintConfig parser entry) -- confirms exit 2 isn't
  // specific to the "no files matched" case above.
  const dir = makeScratchDir();
  const file = path.join(dir, 'irrelevant.js');
  fs.writeFileSync(file, 'module.exports = {};\n');

  try {
    const result = await main({
      cwd: dir,
      patterns: [file],
      overrideConfig: { parser: 'nonexistent-parser-xyz' },
    });
    assert.equal(result.exitCode, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// run() itself (not just main()'s try/catch) really does reject on a
// configuration failure -- proves main()'s catch block has something real
// to catch, rather than the exit-2 path being reachable only because main()
// manufactures it.
test('run(): rejects (does not resolve) when ESLint hits a configuration failure', async () => {
  await assert.rejects(() => run({ patterns: ['definitely-does-not-exist-anywhere-xyz'] }));
});
