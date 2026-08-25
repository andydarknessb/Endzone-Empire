const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {
  resolveSearchRoot,
  parseInstalledCopies,
  evaluate,
  buildViolationMessage,
} = require('./check-dom-dedupe');

// These tests exercise the pure logic only: parsing pre-captured
// `npm ls --parseable --long` text and deciding what it means. Nothing here
// spawns a real npm process or touches node_modules.

// A real `--parseable --long` line pairs the physical path with npm's
// resolved id: `<path>:<name>@<version>`. These fixtures are literal npm
// output shapes (Windows drive letters, the nested-under-react path, CRLF).
const ONE = 'C:\\repo\\node_modules\\@testing-library\\dom:@testing-library/dom@9.3.4';
const NESTED =
  '/repo/node_modules/@testing-library/react/node_modules/@testing-library/dom:@testing-library/dom@9.3.4';
const TOP = '/repo/node_modules/@testing-library/dom:@testing-library/dom@10.4.1';

test('parseInstalledCopies: a single --long line yields one copy with path and version', () => {
  assert.deepEqual(parseInstalledCopies(ONE + '\n'), [
    { path: 'C:\\repo\\node_modules\\@testing-library\\dom', version: '9.3.4' },
  ]);
});

test('parseInstalledCopies: two distinct paths (the split-tree shape) yield two copies with their versions', () => {
  assert.deepEqual(parseInstalledCopies(NESTED + '\n' + TOP + '\n'), [
    {
      path: '/repo/node_modules/@testing-library/react/node_modules/@testing-library/dom',
      version: '9.3.4',
    },
    { path: '/repo/node_modules/@testing-library/dom', version: '10.4.1' },
  ]);
});

test('parseInstalledCopies: the version is the token after the id, even if npm appends more colon fields', () => {
  // `--long` can append further colon-delimited fields; the version is the
  // first token after `:<name>@`, not the whole tail.
  const line = TOP + ':https://registry.npmjs.org/@testing-library/dom/-/dom-10.4.1.tgz';
  assert.deepEqual(parseInstalledCopies(line + '\n'), [
    { path: '/repo/node_modules/@testing-library/dom', version: '10.4.1' },
  ]);
});

test('parseInstalledCopies: the four-field INVALID shape from a symlinked worktree parses to path + version', () => {
  // A worktree that symlinks node_modules to the main checkout makes npm
  // resolve the symlink but evaluate it against the worktree's package.json,
  // so `--long` emits four colon-delimited fields:
  //   <path>:<name>@<version>:<resolved-real-path>:<status-marker>
  // The resolved real path lives under a DIFFERENT checkout, and the marker is
  // INVALID/extraneous. We keep the first-field path and the version; the
  // resolved path and marker are display context surfaced via npm's stderr on
  // failure, not parsed here. (This is the shape audited on ic-324's worktree.)
  const line =
    'C:\\repo\\.claude\\worktrees\\wt\\node_modules\\@testing-library\\dom' +
    ':@testing-library/dom@10.4.1' +
    ':C:\\repo\\node_modules\\@testing-library\\dom' +
    ':INVALID';
  assert.deepEqual(parseInstalledCopies(line + '\n'), [
    {
      path: 'C:\\repo\\.claude\\worktrees\\wt\\node_modules\\@testing-library\\dom',
      version: '10.4.1',
    },
  ]);
});

test('parseInstalledCopies: anchors to the FIRST id boundary (indexOf), robust to a later id-shaped field', () => {
  // Guards the indexOf choice: npm today puts a resolved path and a status
  // marker in the trailing fields, but were a later field ever to carry an
  // id-shaped token, we must still split at the real path->id boundary (the
  // first marker), not the last. The path never contains `:<name>@`, so the
  // first occurrence is always the true boundary.
  const line = TOP + ':@testing-library/dom@99.0.0';
  assert.deepEqual(parseInstalledCopies(line + '\n'), [
    { path: '/repo/node_modules/@testing-library/dom', version: '10.4.1' },
  ]);
});

test('parseInstalledCopies: a line with no id suffix keeps the whole line as the path and a null version', () => {
  const plain = '/repo/node_modules/@testing-library/dom';
  assert.deepEqual(parseInstalledCopies(plain + '\n'), [
    { path: '/repo/node_modules/@testing-library/dom', version: null },
  ]);
});

test('parseInstalledCopies: blank lines and CRLF endings are ignored, not counted as copies', () => {
  const stdout = '\r\n' + ONE + '\r\n\r\n';
  assert.deepEqual(parseInstalledCopies(stdout), [
    { path: 'C:\\repo\\node_modules\\@testing-library\\dom', version: '9.3.4' },
  ]);
});

test('parseInstalledCopies: an identical path repeated counts once (first-seen version kept)', () => {
  assert.deepEqual(parseInstalledCopies(ONE + '\n' + ONE + '\n'), [
    { path: 'C:\\repo\\node_modules\\@testing-library\\dom', version: '9.3.4' },
  ]);
});

test('parseInstalledCopies: empty output yields no copies', () => {
  assert.deepEqual(parseInstalledCopies(''), []);
});

test('parseInstalledCopies: caseInsensitive=true collapses two differently-cased spellings of one path (Windows/macOS)', () => {
  const stdout =
    'C:\\repo\\node_modules\\@testing-library\\dom:@testing-library/dom@9.3.4\n' +
    'c:\\repo\\node_modules\\@testing-library\\dom:@testing-library/dom@9.3.4\n';
  assert.deepEqual(parseInstalledCopies(stdout, true), [
    { path: 'C:\\repo\\node_modules\\@testing-library\\dom', version: '9.3.4' },
  ]);
});

test('parseInstalledCopies: caseInsensitive=false keeps two differently-cased spellings as two (Linux)', () => {
  const stdout =
    '/repo/node_modules/@testing-library/dom:@testing-library/dom@9.3.4\n' +
    '/repo/Node_Modules/@testing-library/dom:@testing-library/dom@9.3.4\n';
  assert.deepEqual(parseInstalledCopies(stdout, false), [
    { path: '/repo/node_modules/@testing-library/dom', version: '9.3.4' },
    { path: '/repo/Node_Modules/@testing-library/dom', version: '9.3.4' },
  ]);
});

test('evaluate: exactly one copy is ok (the healthy, deduped state)', () => {
  assert.deepEqual(evaluate([{ path: '/repo/node_modules/@testing-library/dom', version: '9.3.4' }]), {
    ok: true,
    count: 1,
  });
});

test('evaluate: two copies is a violation (the silent re-split #224 exists to catch)', () => {
  assert.deepEqual(
    evaluate([
      { path: '/repo/node_modules/@testing-library/dom', version: '9.3.4' },
      { path: '/repo/other/@testing-library/dom', version: '10.4.1' },
    ]),
    { ok: false, count: 2 }
  );
});

test('evaluate: zero copies is a violation, not a silent pass (fail-closed)', () => {
  assert.deepEqual(evaluate([]), { ok: false, count: 0 });
});

// --- resolveSearchRoot: the anchor that makes the count independent of cwd ---

test('resolveSearchRoot: returns the checkout root two levels above scripts/ci, not process.cwd()', () => {
  const expected = path.resolve(__dirname, '..', '..');
  const before = process.cwd();
  assert.equal(resolveSearchRoot(), expected);
  // Its value must not follow the working directory. Change cwd to somewhere
  // else and confirm the resolved root is unchanged (#313 determinism).
  const elsewhere = path.resolve(__dirname); // scripts/ci itself, != repo root
  try {
    process.chdir(elsewhere);
    assert.notEqual(process.cwd(), expected);
    assert.equal(resolveSearchRoot(), expected);
  } finally {
    process.chdir(before);
  }
});

// --- buildViolationMessage: message content per shape, and it must regress ---

const SEARCH_ROOT = '/repo';

test('buildViolationMessage: found-2 names the count, the search root, and every path WITH its version', () => {
  const copies = [
    { path: '/repo/node_modules/@testing-library/dom', version: '10.4.1' },
    {
      path: '/repo/node_modules/@testing-library/react/node_modules/@testing-library/dom',
      version: '9.3.4',
    },
  ];
  const message = buildViolationMessage(copies, SEARCH_ROOT);
  // The count.
  assert.match(message, /found 2/);
  // The location it searched.
  assert.match(message, /Searched: \/repo/);
  // Both paths.
  assert.match(message, /\/repo\/node_modules\/@testing-library\/dom/);
  assert.match(message, /react\/node_modules\/@testing-library\/dom/);
  // Both versions, attached to their copy. A message that dropped the version
  // (the pre-#313 shape) would fail these two assertions.
  assert.match(message, /@testing-library\/dom@10\.4\.1/);
  assert.match(message, /@testing-library\/dom@9\.3\.4/);
  // The explanation and its references, and the overrides warning.
  assert.match(message, /outside act\(\)/);
  assert.match(message, /#219/);
  assert.match(message, /#224/);
  assert.match(message, /overrides/);
  // It must NOT be the zero-branch prose.
  assert.doesNotMatch(message, /No copy of @testing-library\/dom is installed/);
});

test('buildViolationMessage: found-0 names the search root and the cannot-look explanation, not the two-copy one', () => {
  const message = buildViolationMessage([], SEARCH_ROOT);
  assert.match(message, /found 0/);
  // Names where it looked, so a worktree zero self-explains instead of
  // reading as "the dependency was dropped".
  assert.match(message, /Searched: \/repo/);
  assert.match(message, /No copy of @testing-library\/dom is installed under \/repo/);
  assert.match(message, /npm ci/);
  assert.match(message, /worktree/);
  // Fail-closed still points at #219/#224 in case it really was dropped.
  assert.match(message, /#219/);
  assert.match(message, /#224/);
  // It must NOT be the two-copy explanation.
  assert.doesNotMatch(message, /outside act\(\)/);
  assert.doesNotMatch(message, /Two or more copies/);
});

test('buildViolationMessage: a null version renders as "unknown", never as the literal null', () => {
  const message = buildViolationMessage(
    [{ path: '/repo/node_modules/@testing-library/dom', version: null }],
    SEARCH_ROOT
  );
  assert.match(message, /@testing-library\/dom@unknown/);
  assert.doesNotMatch(message, /@null/);
});

test('buildViolationMessage: a single copy never prints the "two or more copies" explanation', () => {
  // main() only reaches this function under !ok (count 0 or >=2), so a
  // one-element array is not reachable today. Guard against a future caller or
  // a refactor of the ok check emitting the multi-copy prose for a healthy
  // single install: the explanation branch is gated on length >= 2.
  const message = buildViolationMessage(
    [{ path: '/repo/node_modules/@testing-library/dom', version: '9.3.4' }],
    SEARCH_ROOT
  );
  assert.doesNotMatch(message, /Two or more copies/);
  assert.doesNotMatch(message, /outside act\(\)/);
  // It still names what it found, without a misleading cause.
  assert.match(message, /found 1/);
  assert.match(message, /@testing-library\/dom@9\.3\.4/);
});

test('buildViolationMessage: is a pure function of (copies, searchRoot) - same inputs, identical sentence', () => {
  // The determinism the second AC asks for lives here: given the same tree
  // state and the same resolved root, the message is byte-for-byte identical
  // no matter which directory produced it.
  const copies = [{ path: '/repo/a', version: '9.3.4' }, { path: '/repo/b', version: '10.4.1' }];
  assert.equal(
    buildViolationMessage(copies, SEARCH_ROOT),
    buildViolationMessage(copies, SEARCH_ROOT)
  );
});
