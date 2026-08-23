const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseParseablePaths,
  evaluate,
  buildViolationMessage,
} = require('./check-dom-dedupe');

// These tests exercise the pure logic only: parsing pre-captured
// `npm ls --parseable` text and deciding what it means. Nothing here
// spawns a real npm process or touches node_modules.

test('parseParseablePaths: a single path with a trailing newline yields one entry', () => {
  const stdout = 'C:\\repo\\node_modules\\@testing-library\\dom\n';
  assert.deepEqual(parseParseablePaths(stdout), [
    'C:\\repo\\node_modules\\@testing-library\\dom',
  ]);
});

test('parseParseablePaths: two distinct paths (the split-tree shape) yield two entries', () => {
  const stdout =
    '/repo/node_modules/@testing-library/dom\n' +
    '/repo/node_modules/@testing-library/react/node_modules/@testing-library/dom\n';
  assert.deepEqual(parseParseablePaths(stdout), [
    '/repo/node_modules/@testing-library/dom',
    '/repo/node_modules/@testing-library/react/node_modules/@testing-library/dom',
  ]);
});

test('parseParseablePaths: blank lines and CRLF endings are ignored, not counted as copies', () => {
  const stdout = '\r\n/repo/node_modules/@testing-library/dom\r\n\r\n';
  assert.deepEqual(parseParseablePaths(stdout), [
    '/repo/node_modules/@testing-library/dom',
  ]);
});

test('parseParseablePaths: an identical path repeated (e.g. duplicate --parseable lines) counts once', () => {
  const stdout =
    '/repo/node_modules/@testing-library/dom\n' +
    '/repo/node_modules/@testing-library/dom\n';
  assert.deepEqual(parseParseablePaths(stdout), [
    '/repo/node_modules/@testing-library/dom',
  ]);
});

test('parseParseablePaths: empty output yields no entries', () => {
  assert.deepEqual(parseParseablePaths(''), []);
});

test('parseParseablePaths: with caseInsensitive=true, two differently-cased spellings of the same path count as one (Windows/macOS)', () => {
  const stdout =
    'C:\\repo\\node_modules\\@testing-library\\dom\n' +
    'c:\\repo\\node_modules\\@testing-library\\dom\n';
  assert.deepEqual(parseParseablePaths(stdout, true), [
    'C:\\repo\\node_modules\\@testing-library\\dom',
  ]);
});

test('parseParseablePaths: with caseInsensitive=false, two differently-cased spellings count as two (Linux)', () => {
  const stdout =
    '/repo/node_modules/@testing-library/dom\n' +
    '/repo/Node_Modules/@testing-library/dom\n';
  assert.deepEqual(parseParseablePaths(stdout, false), [
    '/repo/node_modules/@testing-library/dom',
    '/repo/Node_Modules/@testing-library/dom',
  ]);
});

test('evaluate: exactly one path is ok (the healthy, deduped state)', () => {
  assert.deepEqual(evaluate(['/repo/node_modules/@testing-library/dom']), {
    ok: true,
    count: 1,
  });
});

test('evaluate: two paths is a violation (the silent re-split #224 exists to catch)', () => {
  assert.deepEqual(
    evaluate([
      '/repo/node_modules/@testing-library/dom',
      '/repo/node_modules/@testing-library/react/node_modules/@testing-library/dom',
    ]),
    { ok: false, count: 2 }
  );
});

test('evaluate: zero paths is a violation, not a silent pass', () => {
  assert.deepEqual(evaluate([]), { ok: false, count: 0 });
});

test('buildViolationMessage: names every path and its version', () => {
  const paths = [
    '/repo/node_modules/@testing-library/dom',
    '/repo/node_modules/@testing-library/react/node_modules/@testing-library/dom',
  ];
  const versionOf = (p) => (p.includes('react') ? '10.4.1' : '9.3.4');
  const message = buildViolationMessage(paths, versionOf);
  assert.match(message, /\/repo\/node_modules\/@testing-library\/dom @ 9\.3\.4/);
  assert.match(
    message,
    /react\/node_modules\/@testing-library\/dom @ 10\.4\.1/
  );
});

test('buildViolationMessage: references both #219 (the original defect) and #224 (this guard)', () => {
  const message = buildViolationMessage(
    ['/repo/node_modules/@testing-library/dom', '/repo/other/@testing-library/dom'],
    () => '9.3.4'
  );
  assert.match(message, /#219/);
  assert.match(message, /#224/);
});

test('buildViolationMessage: warns against an npm overrides entry as the fix', () => {
  const message = buildViolationMessage(
    ['/repo/node_modules/@testing-library/dom', '/repo/other/@testing-library/dom'],
    () => '9.3.4'
  );
  assert.match(message, /overrides/);
});

test('buildViolationMessage: zero copies gets a distinct, actionable message instead of the two-copy explanation', () => {
  const message = buildViolationMessage([], () => '9.3.4');
  assert.match(message, /No installed copy/);
  assert.match(message, /npm ci/);
  assert.doesNotMatch(message, /Two or more copies/);
});
