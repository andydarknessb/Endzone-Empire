const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseAdrEntries,
  findDuplicates,
  findGaps,
  evaluate,
  buildViolationMessage,
} = require('./check-adr-uniqueness');

// These tests exercise the pure logic only: parsing a pre-captured list of
// filenames and deciding what it means. Nothing here touches the real
// docs/adr/ directory.

test('parseAdrEntries: a clean, gapless set parses one entry per file', () => {
  const filenames = [
    '0001-abandon-homeaway-activation.md',
    '0002-teams-rows-are-membership.md',
  ];
  const { entries, ignored } = parseAdrEntries(filenames);
  assert.deepEqual(
    entries.map((e) => [e.number, e.file]),
    [
      [1, '0001-abandon-homeaway-activation.md'],
      [2, '0002-teams-rows-are-membership.md'],
    ]
  );
  assert.deepEqual(ignored, []);
});

test('parseAdrEntries: a non-ADR file (README, template) is ignored, not crashed on', () => {
  const filenames = [
    '0001-abandon-homeaway-activation.md',
    'README.md',
    'TEMPLATE.md',
    '.gitkeep',
  ];
  const { entries, ignored } = parseAdrEntries(filenames);
  assert.deepEqual(entries.map((e) => e.file), ['0001-abandon-homeaway-activation.md']);
  assert.deepEqual(ignored, ['README.md', 'TEMPLATE.md', '.gitkeep']);
});

test('findDuplicates: a clean set with no repeated numeric prefix reports nothing', () => {
  const { entries } = parseAdrEntries([
    '0001-abandon-homeaway-activation.md',
    '0002-teams-rows-are-membership.md',
    '0003-article-imagery-is-inline-svg.md',
  ]);
  assert.deepEqual(findDuplicates(entries), []);
});

test('findDuplicates: two files sharing a numeric prefix (the live #307 collision) are reported together, both filenames named', () => {
  const { entries } = parseAdrEntries([
    '0001-abandon-homeaway-activation.md',
    '0005-fix-draft-rounds-at-start.md',
    '0005-snapshot-draft-rounds-at-start.md',
  ]);
  const dupes = findDuplicates(entries);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].number, 5);
  assert.deepEqual(dupes[0].files.sort(), [
    '0005-fix-draft-rounds-at-start.md',
    '0005-snapshot-draft-rounds-at-start.md',
  ]);
});

test('findGaps: a contiguous 0001..0008 sequence has no gaps', () => {
  const { entries } = parseAdrEntries([
    '0001-a.md',
    '0002-b.md',
    '0003-c.md',
    '0004-d.md',
    '0005-e.md',
    '0006-f.md',
    '0007-g.md',
    '0008-h.md',
  ]);
  assert.deepEqual(findGaps(entries), []);
});

test('findGaps: a missing number in the middle of the range is reported', () => {
  const { entries } = parseAdrEntries(['0001-a.md', '0002-b.md', '0004-d.md']);
  assert.deepEqual(findGaps(entries), [3]);
});

test('findGaps: missing 0001 itself (as if it were deleted) is reported', () => {
  const { entries } = parseAdrEntries(['0002-b.md', '0003-c.md']);
  assert.deepEqual(findGaps(entries), [1]);
});

test('findGaps: multiple missing numbers are all reported, in order', () => {
  const { entries } = parseAdrEntries(['0001-a.md', '0004-d.md']);
  assert.deepEqual(findGaps(entries), [2, 3]);
});

test('findGaps: a duplicate prefix does not itself count as a gap (that number is present)', () => {
  const { entries } = parseAdrEntries(['0001-a.md', '0002-b.md', '0002-c.md']);
  assert.deepEqual(findGaps(entries), []);
});

test('evaluate: a clean, gapless, duplicate-free set is ok', () => {
  const { entries } = parseAdrEntries(['0001-a.md', '0002-b.md', '0003-c.md']);
  assert.deepEqual(evaluate(entries), { ok: true, duplicates: [], gaps: [] });
});

test('evaluate: a deliberate duplicate is reported as not ok (proves the check can fail)', () => {
  const { entries } = parseAdrEntries([
    '0001-fix-draft-rounds-at-start.md',
    '0001-snapshot-draft-rounds-at-start.md',
  ]);
  const result = evaluate(entries);
  assert.equal(result.ok, false);
  assert.equal(result.duplicates.length, 1);
  assert.deepEqual(result.gaps, []);
});

test('evaluate: a gap alone (no duplicates) is also reported as not ok', () => {
  const { entries } = parseAdrEntries(['0001-a.md', '0003-c.md']);
  const result = evaluate(entries);
  assert.equal(result.ok, false);
  assert.deepEqual(result.duplicates, []);
  assert.deepEqual(result.gaps, [2]);
});

test('evaluate: an empty ADR set is ok (nothing to collide or gap)', () => {
  assert.deepEqual(evaluate([]), { ok: true, duplicates: [], gaps: [] });
});

test('buildViolationMessage: names both colliding filenames for a duplicate', () => {
  const { entries } = parseAdrEntries([
    '0005-fix-draft-rounds-at-start.md',
    '0005-snapshot-draft-rounds-at-start.md',
  ]);
  const result = evaluate(entries);
  const message = buildViolationMessage(result);
  assert.match(message, /0005-fix-draft-rounds-at-start\.md/);
  assert.match(message, /0005-snapshot-draft-rounds-at-start\.md/);
});

test('buildViolationMessage: names the missing number for a gap', () => {
  const { entries } = parseAdrEntries(['0001-a.md', '0003-c.md']);
  const result = evaluate(entries);
  const message = buildViolationMessage(result);
  assert.match(message, /0002/);
});
