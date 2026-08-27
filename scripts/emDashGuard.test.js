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

// --- findEmDashes: the three hit forms --------------------------------

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

test('findEmDashes: the &#8212; numeric entity is reported', () => {
  const hits = findEmDashes("const title = 'x&#8212;y';\n");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, '&#8212;');
});

// --- findEmDashes: the string-vs-comment stripper trap ----------------

// This is the case #501 named explicitly: a `//` inside a string literal
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
