const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTestFile,
  isExcludedDir,
  isAllowlisted,
  stripComments,
  findEmDashes,
  findViolations,
  formatViolation,
  ALLOWLIST,
} = require('./emDashGuard');

// Issue #501: the no-em-dash house-style rule had no consumer (ADR 0016,
// following ADR 0010's "a convention ships with its consumer"). This check
// joins the `guards` npm script directly -- no scripts/ci/check-*.js
// runner, no `check:` wrapper, no .github/workflows edit -- following the
// shape of scripts/eslintRuleScoping.test.js and
// scripts/agentDocsOrphans.test.js: a node:test file whose assertions read
// the real tree, run today by `npm run guards`.
//
// findEmDashes is pure (source text in, hits with line numbers out), so
// the "both directions" the guard needs to prove -- it fails on a live em
// dash, and moving that character into a comment clears the same failure
// -- is testable without touching a filesystem at all.

function lines(hits) {
  return hits.map((h) => h.line);
}

// --- findEmDashes: reported in code ----------------------------------

test('findEmDashes: an em dash in a string literal is reported with its line', () => {
  const source = "const msg = 'operation failed—see logs';\n";
  const hits = findEmDashes(source);
  assert.deepEqual(lines(hits), [1]);
});

test('findEmDashes: an em dash in a template literal is reported with its line', () => {
  const source = 'const msg = `n failed—see summary`;\n';
  const hits = findEmDashes(source);
  assert.deepEqual(lines(hits), [1]);
});

test('findEmDashes: an em dash in JSX text is reported with its line', () => {
  const source = [
    'function Recap() {',
    '  return <P>a legitimate watch—not proof of anything.</P>;',
    '}',
    '',
  ].join('\n');
  const hits = findEmDashes(source);
  assert.deepEqual(lines(hits), [2]);
});

// --- findEmDashes: not reported in comments ---------------------------

test('findEmDashes: an em dash in a // line comment is not reported', () => {
  const source = '// note—not user-facing\nconst x = 1;\n';
  assert.deepEqual(findEmDashes(source), []);
});

test('findEmDashes: an em dash in a /* */ block comment is not reported', () => {
  const source = '/* note—not user-facing */\nconst x = 1;\n';
  assert.deepEqual(findEmDashes(source), []);
});

test('findEmDashes: an em dash in a JSX {/* */} comment is not reported', () => {
  const source = [
    'function Recap() {',
    '  return (',
    '    <div>',
    '      {/* draft note—not user-facing */}',
    '      <P>clean copy.</P>',
    '    </div>',
    '  );',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(findEmDashes(source), []);
});

// --- findEmDashes: the hit forms ---------------------------------------
//
// Per PR #504 review: an HTML numeric character reference is a generative
// space, not a fixed list of spellings -- &#8212;, &#08212;, &#x2014; and
// &#X2014; all render as the same em dash. The pattern matches the whole
// reference SHAPE (optional leading zeros, either case of a hex `x`), so
// this covers named + decimal + hex, with and without padding, not just
// the two example spellings a first pass matched literally.

test('findEmDashes: the raw U+2014 character is reported', () => {
  const hits = findEmDashes("const a = 'x—y';\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, '—');
});

test('findEmDashes: the &mdash; entity is reported', () => {
  const hits = findEmDashes("const title = 'x&mdash;y';\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, '&mdash;');
});

test('findEmDashes: the &#8212; decimal numeric entity is reported', () => {
  const hits = findEmDashes("const title = 'x&#8212;y';\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, '&#8212;');
});

test('findEmDashes: a zero-padded decimal entity (&#08212;) is reported', () => {
  const hits = findEmDashes("const title = 'x&#08212;y';\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, '&#08212;');
});

test('findEmDashes: a many-zero-padded decimal entity (&#0008212;) is reported', () => {
  const hits = findEmDashes("const title = 'x&#0008212;y';\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, '&#0008212;');
});

test('findEmDashes: the lowercase hex entity (&#x2014;) is reported', () => {
  const hits = findEmDashes("const title = 'x&#x2014;y';\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, '&#x2014;');
});

test('findEmDashes: the uppercase-X hex entity (&#X2014;) is reported', () => {
  const hits = findEmDashes("const title = 'x&#X2014;y';\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, '&#X2014;');
});

test('findEmDashes: a zero-padded hex entity (&#x02014;) is reported', () => {
  const hits = findEmDashes("const title = 'x&#x02014;y';\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, '&#x02014;');
});

// A decimal or hex reference for a DIFFERENT codepoint that merely shares a
// prefix or suffix with the em dash's must not match -- the trailing `;`
// anchors the reference so &#88212; (a different, larger number) and
// &#82128; (a different codepoint entirely) are correctly ignored, even
// though both contain the substring "8212".
test('findEmDashes: a decimal entity that only shares digits with 8212 is not reported', () => {
  assert.deepEqual(findEmDashes("const x = 'a&#88212;b';\n"), []);
  assert.deepEqual(findEmDashes("const x = 'a&#82128;b';\n"), []);
});

// The en dash's own numeric entities (U+2013 = 8211 decimal, x2013 hex)
// must not be swept in by a pattern broadened to catch em-dash padding --
// ADR 0016 is explicit that en dashes are a different, untouched convention.
test('findEmDashes: the en dash\'s own numeric entities are not reported', () => {
  assert.deepEqual(findEmDashes("const x = 'a&#8211;b';\n"), []);
  assert.deepEqual(findEmDashes("const x = 'a&#x2013;b';\n"), []);
});

// Deliberately out of scope, per the guard's docblock: an unterminated
// numeric reference (no trailing `;`) is not a well-formed HTML character
// reference and is not matched.
test('findEmDashes: an unterminated numeric reference (no trailing ;) is not reported', () => {
  assert.deepEqual(findEmDashes("const x = 'a&#8212b';\n"), []);
});

// --- findEmDashes: the string-vs-comment stripper trap ----------------

// This is the case the triage-brief comment on #501 named explicitly: a `//` inside a string literal
// (a URL) must not be misread as the start of a line comment, which would
// silently swallow the rest of the line -- including a real em dash later
// on it. Changing stripComments to treat every `//` as a comment start
// (dropping the quoted-string handling) turns this test red, because the
// stripper would then blank out everything from the URL's `//` onward,
// including the em dash that follows it.
test('an em dash later on the same line as a \'https://...\' string is still reported', () => {
  const source = "const msg = 'see https://example.com/docs—read it';\n";
  const hits = findEmDashes(source);
  assert.deepEqual(lines(hits), [1]);
});

test('an em dash before the URL string on the same line is also still reported', () => {
  const source = "const msg = 'read this—see https://example.com/docs';\n";
  const hits = findEmDashes(source);
  assert.deepEqual(lines(hits), [1]);
});

// --- stripComments: line numbers are preserved -------------------------

test('stripComments preserves line numbers across a stripped block comment', () => {
  const source = ['const a = 1;', '/* multi', 'line', 'comment */', 'const b = 2;', ''].join('\n');
  const stripped = stripComments(source);
  assert.equal(stripped.split('\n').length, source.split('\n').length);
});

// --- isTestFile / isExcludedDir / isAllowlisted -------------------------

test('isTestFile: a .test.jsx file is a test file', () => {
  assert.ok(isTestFile('src/content/articles/articles.test.js'));
  assert.ok(isTestFile('src/components/App/App.test.jsx'));
});

test('isTestFile: a non-test .jsx file is not a test file', () => {
  assert.ok(!isTestFile('src/content/articles/preseason-week-2-recap.jsx'));
});

test('isExcludedDir: server/db/migrations is excluded', () => {
  assert.ok(isExcludedDir('server/db/migrations/20260710000001_initial_schema.js'));
});

test('isExcludedDir: a sibling server directory is not excluded', () => {
  assert.ok(!isExcludedDir('server/services/correction.service.js'));
});

test('the allowlist is empty at merge', () => {
  assert.deepEqual(
    ALLOWLIST,
    [],
    'ALLOWLIST is expected to be empty; every entry needs a reason a reader can check'
  );
});

test('isAllowlisted: an entry with an unmatched path is not allowlisted', () => {
  assert.ok(!isAllowlisted('src/components/App/App.jsx'));
});

// --- EM_DASH_PATTERN is global, matching multiple hits per line --------

test('EM_DASH_PATTERN matches every occurrence, not just the first', () => {
  const hits = findEmDashes("const a = 'x—y—z';\n");
  assert.equal(hits.length, 2);
});

// --- Real tree ----------------------------------------------------------

// The guard itself: read the real tree and fail if any em dash slipped
// past the fixes this PR made. A failure here names file, line and the
// offending text, plus the replacement rule, so an IC who trips it can fix
// it without opening the ADR.
test('the real tree carries no em dash in scanned, non-test, non-excluded source', () => {
  const violations = findViolations();
  assert.deepEqual(
    violations.map(formatViolation),
    [],
    violations.length > 0
      ? '\nNo em dashes in user-facing copy. Replace with real prose punctuation, ' +
        'the middot label separator, a hyphen in a score, or a plain "-" in an ' +
        'empty cell -- see docs/adr/0016-no-em-dashes-in-user-facing-copy.md.\n'
      : undefined
  );
});
