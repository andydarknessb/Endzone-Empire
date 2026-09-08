// Tests for the shrink-only envelope conformance guard (#973, ADR 0032).
//
// Two halves, following scripts/checkDraftHarnessCoverage.test.js:
//   - the classifier, driven by hand-written object literals parsed here, so
//     each of the three non-conforming shapes and each conforming shape is
//     pinned without depending on what the routers happen to contain today;
//   - the comparison, driven by synthetic enumerations, so growth, a new file,
//     a stale entry and a vacuous scan each produce their own message.
// A final test runs the real guard over the real checkout: it must be green,
// and it must have enumerated a nonzero number of emitters.
const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('@babel/parser');

const {
  ALLOWLIST,
  SHAPES,
  classifyObject,
  compare,
  enumerateEmitters,
  runGuard,
  DEFAULT_ROOT,
} = require('./envelopeConformance');

/** Parses `({ ... })` and hands back the ObjectExpression node. */
function objectOf(source) {
  const ast = parser.parse(`(${source})`, { sourceType: 'script' });
  return ast.program.body[0].expression;
}

test('classifier: { error: <code>, message: <sentence> } is code-in-error-with-message', () => {
  assert.equal(
    classifyObject(objectOf("{ error: error.code, message: error.message }")),
    SHAPES.CODE_IN_ERROR_WITH_MESSAGE
  );
});

test('classifier: an error field holding a .code member is code-in-error', () => {
  assert.equal(classifyObject(objectOf('{ error: error.code }')), SHAPES.CODE_IN_ERROR);
});

test('classifier: an error field holding a SCREAMING_CASE literal is code-in-error', () => {
  assert.equal(
    classifyObject(objectOf("{ error: 'DATABASE_TEMPORARILY_UNAVAILABLE' }")),
    SHAPES.CODE_IN_ERROR
  );
});

test('classifier: { error: <sentence>, code } is code-beside-error', () => {
  assert.equal(
    classifyObject(objectOf("{ error: error.message, code: error.code }")),
    SHAPES.CODE_BESIDE_ERROR
  );
});

test('classifier: a conditional code spread beside an error sentence is code-beside-error', () => {
  assert.equal(
    classifyObject(
      objectOf("{ error: error.message, ...(error.code ? { code: error.code } : {}) }")
    ),
    SHAPES.CODE_BESIDE_ERROR
  );
});

test('classifier: the target { code, message } envelope conforms', () => {
  assert.equal(classifyObject(objectOf("{ code: error.code, message: error.message }")), null);
});

test('classifier: a codeless { error: <sentence> } conforms, it carries no code', () => {
  assert.equal(classifyObject(objectOf("{ error: 'failed to remove team' }")), null);
  // Sentence case, not SCREAMING_CASE: the literal rule must not swallow copy.
  assert.equal(classifyObject(objectOf("{ error: 'League id must be positive' }")), null);
});

test('classifier: a success payload with neither key conforms', () => {
  assert.equal(classifyObject(objectOf('{ id: 1, name: team.name }')), null);
});

function enumeration(findings, sendCount = 100) {
  return { findings, sendCount };
}

const ONE_ALLOWED = [
  { file: 'server/routes/a.router.js', shape: SHAPES.CODE_BESIDE_ERROR, count: 1, reason: 'x' },
];

test('comparison: the allowed count passes', () => {
  const result = compare(
    enumeration([{ file: 'server/routes/a.router.js', line: 10, shape: SHAPES.CODE_BESIDE_ERROR }]),
    ONE_ALLOWED
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.messages, []);
});

test('comparison: one more site in an allowlisted file fails as GREW', () => {
  const result = compare(
    enumeration([
      { file: 'server/routes/a.router.js', line: 10, shape: SHAPES.CODE_BESIDE_ERROR },
      { file: 'server/routes/a.router.js', line: 20, shape: SHAPES.CODE_BESIDE_ERROR },
    ]),
    ONE_ALLOWED
  );
  assert.equal(result.ok, false);
  assert.match(result.messages[0], /GREW: server\/routes\/a\.router\.js .* allowed 1 but has 2/);
});

test('comparison: a non-conforming emitter in an unlisted file fails as NEW', () => {
  const result = compare(
    enumeration([
      { file: 'server/routes/a.router.js', line: 10, shape: SHAPES.CODE_BESIDE_ERROR },
      { file: 'server/routes/b.router.js', line: 5, shape: SHAPES.CODE_IN_ERROR_WITH_MESSAGE },
    ]),
    ONE_ALLOWED
  );
  assert.equal(result.ok, false);
  assert.match(result.messages.join('\n'), /NEW non-conforming emitter: server\/routes\/b\.router\.js/);
});

test('comparison: the same file growing a DIFFERENT shape fails as NEW, not silently', () => {
  const result = compare(
    enumeration([
      { file: 'server/routes/a.router.js', line: 10, shape: SHAPES.CODE_BESIDE_ERROR },
      { file: 'server/routes/a.router.js', line: 30, shape: SHAPES.CODE_IN_ERROR },
    ]),
    ONE_ALLOWED
  );
  assert.equal(result.ok, false);
  assert.match(result.messages.join('\n'), /NEW non-conforming emitter: server\/routes\/a\.router\.js/);
});

test('comparison: shrinking without lowering the count fails as STALE', () => {
  const result = compare(enumeration([]), ONE_ALLOWED);
  assert.equal(result.ok, false);
  assert.match(result.messages.join('\n'), /STALE allowlist entry: server\/routes\/a\.router\.js/);
});

test('comparison: a partial shrink also fails as STALE so the count comes down', () => {
  const twoAllowed = [
    { file: 'server/routes/a.router.js', shape: SHAPES.CODE_BESIDE_ERROR, count: 2, reason: 'x' },
  ];
  const result = compare(
    enumeration([{ file: 'server/routes/a.router.js', line: 10, shape: SHAPES.CODE_BESIDE_ERROR }]),
    twoAllowed
  );
  assert.equal(result.ok, false);
  assert.match(result.messages.join('\n'), /allowed 2 but only 1 remain/);
});

test('comparison: a scan that found no emitters at all fails rather than passing vacuously', () => {
  const result = compare(enumeration([], 0), []);
  assert.equal(result.ok, false);
  assert.match(result.messages.join('\n'), /ZERO json emitters/);
});

test('the real checkout is green and the scan is not vacuous', () => {
  const result = runGuard(DEFAULT_ROOT);
  assert.equal(result.ok, true, result.messages.join('\n'));
  assert.ok(result.sendCount > 100, `expected a real scan, saw ${result.sendCount} emitters`);
});

test('the migrated commissioner, scoring and team routers no longer appear', () => {
  const { findings } = enumerateEmitters(DEFAULT_ROOT);
  const migrated = [
    'server/routes/commissioner.router.js',
    'server/routes/scoring.router.js',
    'server/routes/team.router.js',
  ];
  for (const file of migrated) {
    assert.equal(
      findings.filter((f) => f.file === file).length,
      0,
      `${file} still emits a non-conforming envelope`
    );
  }
  assert.equal(
    ALLOWLIST.some((entry) => migrated.includes(entry.file)),
    false,
    'a migrated router is still on the allowlist'
  );
});
