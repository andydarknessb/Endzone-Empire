const test = require('node:test');
const assert = require('node:assert/strict');
const { getTestMatchPatterns, createTestFileMatcher } = require('./jestTestMatch');

// Issue #171: `npm test` found zero tests when run from a git worktree under
// `.claude/worktrees/<name>`, because CRA's default testMatch is built from
// `<rootDir>` — an absolute, OS-separated path. On Windows, jest-util's
// replacePathSepForGlob() converts every `\` in that path to `/` *except*
// one immediately followed by a dot (it treats `\.` as an intentional glob
// escape for a literal dot). A worktree path has exactly that shape
// (`...\Endzone-Empire\.claude\worktrees\...`), so the backslash right
// before `.claude` survives as a literal character in the compiled pattern.
// micromatch then treats that same backslash as an escape character while
// compiling the pattern (dropping it from the regex), so the generated
// glob requires "Endzone-Empire.claude" with no separator at all — which no
// real path can ever have — and discovery silently finds nothing.
//
// The fix pins `jest.testMatch` in package.json using plain, `**/`-prefixed
// relative globs instead of `<rootDir>` — never routed through rootDir
// substitution, so there's nothing for replacePathSepForGlob to mangle.
// These tests exercise the pinned patterns with jest-util's own matcher
// (the same one @jest/core's SearchSource uses) to guard against a
// regression back to a `<rootDir>`-based pattern.

test('testMatch patterns do not rely on <rootDir> substitution', () => {
  const patterns = getTestMatchPatterns();
  for (const pattern of patterns) {
    assert.ok(
      !pattern.includes('<rootDir>'),
      `testMatch pattern "${pattern}" uses <rootDir>: on Windows, a worktree ` +
        'nested under a dot-prefixed directory (.claude/worktrees/<name>) makes ' +
        'the substituted rootDir path unmatchable (issue #171) — use a relative, ' +
        '**/-prefixed pattern instead.'
    );
  }
});

test('package.json does not set jest.roots (CRA rejects it and exits 1)', () => {
  // eslint-disable-next-line global-require
  const packageJson = require('../package.json');
  assert.ok(
    !packageJson.jest || !('roots' in packageJson.jest),
    '"roots" is not in the whitelist react-scripts honors from package.json; ' +
      'setting it makes `npm test` exit 1 on every checkout, not just worktrees.'
  );
});

test('discovers a *.test.jsx file nested under a dot-prefixed worktree directory on Windows', () => {
  const isMatch = createTestFileMatcher();
  const candidate =
    'C:\\Users\\Cory\\Endzone-Empire\\.claude\\worktrees\\example\\src\\components\\Foo\\Foo.test.jsx';
  assert.equal(isMatch(candidate), true);
});

test('discovers a __tests__ file nested under a dot-prefixed worktree directory on Windows', () => {
  const isMatch = createTestFileMatcher();
  const candidate =
    'C:\\Users\\Cory\\Endzone-Empire\\.claude\\worktrees\\example\\src\\__tests__\\bar.js';
  assert.equal(isMatch(candidate), true);
});

test('discovers a *.spec.ts file from an ordinary (non-worktree) checkout', () => {
  const isMatch = createTestFileMatcher();
  const candidate = 'C:\\Users\\Cory\\Endzone-Empire\\src\\lib\\draftGradeAdp.spec.ts';
  assert.equal(isMatch(candidate), true);
});

test('discovers a test file from a POSIX-style worktree path (Linux/macOS CI)', () => {
  const isMatch = createTestFileMatcher();
  const candidate = '/home/runner/work/Endzone-Empire/.claude/worktrees/example/src/foo.test.js';
  assert.equal(isMatch(candidate), true);
});

test('does not match a non-test source file', () => {
  const isMatch = createTestFileMatcher();
  const candidate =
    'C:\\Users\\Cory\\Endzone-Empire\\.claude\\worktrees\\example\\src\\components\\Foo\\Foo.jsx';
  assert.equal(isMatch(candidate), false);
});

test('does not match a test-shaped file outside of src', () => {
  const isMatch = createTestFileMatcher();
  const candidate = 'C:\\Users\\Cory\\Endzone-Empire\\server\\test\\teamName.test.js';
  assert.equal(isMatch(candidate), false);
});
