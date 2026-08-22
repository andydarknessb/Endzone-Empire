const test = require('node:test');
const assert = require('node:assert/strict');
const { stripComments, hasColorLiteral, findViolations } = require('./check-color-literals');

// findViolations() is the entry point these tests exercise: it strips
// comments out of a fabricated file's text (no filesystem access, no real
// SRC walk) and reports which lines still carry a color literal afterward.
function violationLines(text, ext = '.js') {
  return findViolations('fixture' + ext, ext, text).map((v) => v.split(': ').slice(1).join(': '));
}

// 1. `// see issue #116 for details` -> not flagged.
test('a bare issue reference in a // line comment is not flagged', () => {
  const text = "// see issue #116 for details\nconst x = 1;";
  assert.deepEqual(violationLines(text), []);
});

// 2. `/* see issue #116 for details */` (whole-line block comment) -> not flagged.
test('a bare issue reference in a whole-line block comment is not flagged', () => {
  const text = "/* see issue #116 for details */\nconst x = 1;";
  assert.deepEqual(violationLines(text), []);
});

// An issue reference doesn't have to be at the start of a comment or a line
// to be misread — the false positive the fleet hit repeatedly was a bare
// #NNN anywhere inside a // or /* */ comment.
test('a bare issue reference mid-comment (not at line start) is not flagged', () => {
  const text = "doSomething(); // fixes #122 - trailing comment on a code line";
  assert.deepEqual(violationLines(text), []);
});

test('a bare issue reference inside a /* */ comment that is not at the start of the line is not flagged', () => {
  const text = "doSomething(); /* see #122 */";
  assert.deepEqual(violationLines(text), []);
});

// 3. `/* eslint-disable-next-line */ x = 1` -> the comment portion is
// stripped, but real code on the same line (if it had a color literal)
// would still be flagged.
test('a leading block comment on a line is stripped, leaving no violation when the code has none', () => {
  const text = "/* eslint-disable-next-line */ x = 1;";
  assert.deepEqual(violationLines(text), []);
});

test('a leading block comment does not shield a color literal in the code that follows it on the same line', () => {
  const text = "/* eslint-disable-next-line */ const c = '#fff123';";
  const lines = violationLines(text);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /#fff123/);
});

// 4. A literal inside ANY comment shape is NOT flagged — deliberate behavior
// change from the prior exemption-based checker, which only special-cased
// digit-only issue references and only recognized `//` and `*`-continuation
// block comments.
test('a real hex literal inside a single-line block comment is not flagged (deliberate behavior change)', () => {
  const text = "/* #abc123 test color */\nconst x = 1;";
  assert.deepEqual(violationLines(text), []);
});

test('a real hex literal inside a // comment is not flagged', () => {
  const text = "// #abc123 test color\nconst x = 1;";
  assert.deepEqual(violationLines(text), []);
});

test('a multi-line /** ... */ block with leading * continuations strips a literal on a continuation line', () => {
  const text = [
    '/**',
    ' * uses #abc123 as an example color',
    ' */',
    'const x = 1;',
  ].join('\n');
  assert.deepEqual(violationLines(text), []);
});

// Multi-line JSX comment whose continuation lines do NOT start with `*` —
// the exact shape that slipped past the old line-prefix isCommentLine
// (PR #152 / issue #121).
test('a multi-line JSX comment without leading * continuations strips a literal on a continuation line', () => {
  const text = [
    'function Banner() {',
    '  return (',
    '    <div>',
    '      {/* first line',
    '          #121 in a continuation with no leading * ',
    '       */}',
    '    </div>',
    '  );',
    '}',
  ].join('\n');
  assert.deepEqual(violationLines(text), []);
});

test('a real hex literal inside that same no-leading-* JSX comment shape is not flagged', () => {
  const text = [
    '{/* first line',
    '    #abc123 in a continuation with no leading * ',
    ' */}',
  ].join('\n');
  assert.deepEqual(violationLines(text), []);
});

// 5. A real color literal outside any comment (plain code line) is always
// flagged.
test('a hex literal on a plain code line is flagged', () => {
  const text = "const c = '#fff123';";
  const lines = violationLines(text);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /#fff123/);
});

test('an rgb()/hsl() literal on a plain code line is flagged', () => {
  assert.equal(violationLines("const c = 'rgba(0, 0, 0, 0.5)';").length, 1);
  assert.equal(violationLines("const c = 'hsl(0, 0%, 0%)';").length, 1);
});

test('a quoted named-color literal on a plain code line is flagged', () => {
  const lines = violationLines("const c = 'goldenrod';");
  assert.equal(lines.length, 1);
});

// 6. String and template-literal contents are not mistaken for comments.
test('a // inside a single-quoted string does not start a fake line comment', () => {
  // If the '//' in the URL were misread as a comment start, the rest of the
  // line (including the real hex literal) would be silently swallowed.
  const text = "const url = 'http://example.com'; const c = '#123abc';";
  const lines = violationLines(text);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /#123abc/);
});

test('a // inside a double-quoted string does not start a fake line comment', () => {
  const text = 'const url = "http://example.com"; const c = "#123abc";';
  const lines = violationLines(text);
  assert.equal(lines.length, 1);
});

test('a // inside a template literal does not start a fake line comment', () => {
  const text = 'const url = `http://example.com`; const c = `#123abc`;';
  const lines = violationLines(text);
  assert.equal(lines.length, 1);
});

test('a /* inside a quoted string does not start a fake block comment', () => {
  // If '/*' inside the string opened a real block comment, it would eat
  // through to the next literal '*/' anywhere later in the file, silently
  // swallowing real code (and any color literals in it) along the way.
  const text = "const s = 'not /* a comment'; const c = '#123abc';";
  const lines = violationLines(text);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /#123abc/);
});

// A regex literal's character class can legally contain `/*`-shaped text
// (e.g. `/[/*]/`). Without regex-literal awareness, the scan would reach
// that inner `/*` on its next pass and misread it as a block-comment start,
// silently swallowing every line after it — including a real, unallowlisted
// color literal — up to the next stray `*/` (or end of file).
test('a /* inside a regex literal character class does not start a fake block comment', () => {
  const text = "const parts = s.split(/[/*]/);\nconst BRAND_RED = '#ff0000';";
  const lines = violationLines(text);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /#ff0000/);
});

test('a // inside a regex literal character class does not start a fake line comment', () => {
  const text = "const parts = s.split(/[/x]/);\nconst BRAND_RED = '#ff0000';";
  const lines = violationLines(text);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /#ff0000/);
});

// Plain division must still work: a bare `/` that isn't in an
// expression-start position is not mistaken for a regex literal.
test('division is not mistaken for a regex literal', () => {
  const text = "const half = total / 2; const c = '#123abc';";
  const lines = violationLines(text);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /#123abc/);
});

// var() fallbacks stay exempt (unrelated to comment-stripping, but a
// pre-existing behavior this rewrite must not disturb).
test('a var() fallback hex is still exempt outside any comment', () => {
  assert.deepEqual(violationLines("color: var(--text-color, #ffffff);", '.css'), []);
});

// CSS has no // line comments; a literal `//` in CSS is not comment syntax
// and any code around it is scanned normally.
test('.css files do not treat // as a comment starter', () => {
  const text = '/* real comment #abc123 */\n.foo { color: #123abc; }';
  const lines = violationLines(text, '.css');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /#123abc/);
});

test('.css block comments are still stripped', () => {
  const text = '/* #abc123 */\n.foo { color: red; }';
  assert.deepEqual(violationLines(text, '.css'), []);
});

// stripComments() itself: line-count / line-number preservation, which the
// violation-reporting depends on for accurate line numbers.
test('stripComments preserves the number of lines in the file', () => {
  const text = [
    '/* a',
    '   multi-line',
    '   block comment */',
    'const x = 1; // trailing',
    'const y = 2;',
  ].join('\n');
  const strippedLineCount = stripComments(text, '.js').split('\n').length;
  assert.equal(strippedLineCount, text.split('\n').length);
});

test('hasColorLiteral flags hex/rgb/named but not bare text', () => {
  assert.equal(hasColorLiteral("color: #fff;"), true);
  assert.equal(hasColorLiteral("color: rgba(0,0,0,.5);"), true);
  assert.equal(hasColorLiteral("color: goldenrod;"), true);
  assert.equal(hasColorLiteral("const x = 1;"), false);
});
