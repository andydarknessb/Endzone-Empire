const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normaliseLines,
  compareAdr,
  evaluate,
  buildViolationMessage,
  buildSuccessMessage,
} = require('./check-adr-immutability');

// Pure logic only: base and head texts are handed in as strings. Nothing here
// runs git or touches the real docs/adr/ directory.

const BASE = [
  '# nfl_games uniqueness is enforced on the team code, not the raw code',
  '',
  'Status: accepted (2026-08-26)',
  '',
  '`nfl_games` holds one row per NFL team per week.',
  '',
  '## Why',
  '',
  'Four sites rest on the same unstated invariant.',
].join('\n');

test('normaliseLines: CRLF and a trailing newline do not change the lines', () => {
  assert.deepEqual(normaliseLines('a\r\nb\r\n'), ['a', 'b']);
  assert.deepEqual(normaliseLines('a\nb'), ['a', 'b']);
  assert.deepEqual(normaliseLines('a\nb\n\n'), ['a', 'b']);
});

test('compareAdr: an identical file is ok', () => {
  assert.deepEqual(compareAdr(BASE, BASE), { ok: true });
});

test('compareAdr: the same file with CRLF endings and a trailing newline is ok (checkout policy is not a rewrite)', () => {
  assert.deepEqual(compareAdr(BASE, `${BASE.replace(/\n/g, '\r\n')}\r\n`), { ok: true });
});

test('compareAdr: appending an amendment below the last line is ok', () => {
  const head = `${BASE}\n\n## Amendment (2026-09-01)\n\nThe production read is now 1,700 rows.`;
  assert.deepEqual(compareAdr(BASE, head), { ok: true });
});

test('compareAdr: changing the Status: line to Superseded is ok', () => {
  const head = BASE.replace('Status: accepted (2026-08-26)', 'Status: superseded by ADR 0013 (2026-09-01)');
  assert.deepEqual(compareAdr(BASE, head), { ok: true });
});

test('compareAdr: rewriting a body line is a violation naming the line (the blind spot this guard closes)', () => {
  const head = BASE.replace('Four sites rest on the same unstated invariant.', 'Three sites rest on the same unstated invariant.');
  const result = compareAdr(BASE, head);
  assert.equal(result.ok, false);
  assert.equal(result.line, 9);
  assert.match(result.reason, /existing line changed/);
  assert.match(result.reason, /Four sites/);
  assert.match(result.reason, /Three sites/);
});

test('compareAdr: rewriting the title is a violation at line 1', () => {
  const head = BASE.replace('# nfl_games uniqueness', '# nfl_games identity');
  const result = compareAdr(BASE, head);
  assert.equal(result.ok, false);
  assert.equal(result.line, 1);
});

test('compareAdr: replacing the Status: line with something that is not a Status: line is a violation', () => {
  const head = BASE.replace('Status: accepted (2026-08-26)', 'Accepted 2026-08-26');
  const result = compareAdr(BASE, head);
  assert.equal(result.ok, false);
  assert.equal(result.line, 3);
  assert.match(result.reason, /must stay a Status: line/);
});

test('compareAdr: inserting a line between existing lines is a violation (append-only means at the end)', () => {
  const head = BASE.replace('## Why\n', '## Why\n\nInserted context.\n');
  const result = compareAdr(BASE, head);
  assert.equal(result.ok, false);
  assert.equal(result.line, 8);
});

test('compareAdr: removing lines from the end is a violation', () => {
  const head = BASE.split('\n').slice(0, -2).join('\n');
  const result = compareAdr(BASE, head);
  assert.equal(result.ok, false);
  assert.match(result.reason, /shortened from 9 to 7 lines/);
});

test('compareAdr: a deleted ADR is a violation', () => {
  const result = compareAdr(BASE, null);
  assert.equal(result.ok, false);
  assert.match(result.reason, /deleted or renamed/);
});

test('evaluate: only ADR-named files on base are examined; README is ignored and a new ADR on head is not examined', () => {
  const base = new Map([
    ['0001-a.md', BASE],
    ['README.md', '# ADRs'],
  ]);
  const head = new Map([
    ['0001-a.md', BASE],
    ['README.md', '# ADRs, reworded'],
    ['0002-b.md', 'brand new'],
  ]);
  const result = evaluate(base, head);
  assert.equal(result.ok, true);
  assert.deepEqual(result.examined, ['0001-a.md']);
  assert.deepEqual(result.ignored, ['README.md']);
});

test('evaluate: a renamed ADR (same number, new slug) is reported as deleted under its base name', () => {
  const base = new Map([['0001-a.md', BASE]]);
  const head = new Map([['0001-a-renamed.md', BASE]]);
  const result = evaluate(base, head);
  assert.equal(result.ok, false);
  assert.equal(result.violations[0].file, '0001-a.md');
  assert.match(result.violations[0].reason, /deleted or renamed/);
});

test('evaluate: a deliberate rewrite in one of several ADRs is reported for that file only (proves the check can fail)', () => {
  const base = new Map([
    ['0001-a.md', BASE],
    ['0002-b.md', BASE],
  ]);
  const head = new Map([
    ['0001-a.md', BASE],
    ['0002-b.md', BASE.replace('one row per NFL team', 'two rows per NFL team')],
  ]);
  const result = evaluate(base, head);
  assert.equal(result.ok, false);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].file, '0002-b.md');
  assert.equal(result.violations[0].line, 5);
});

test('buildViolationMessage: names the file, the line, and the base ref', () => {
  const base = new Map([['0002-b.md', BASE]]);
  const head = new Map([['0002-b.md', BASE.replace('## Why', '## Why not')]]);
  const message = buildViolationMessage(evaluate(base, head), 'abc123');
  assert.match(message, /0002-b\.md \(line 7\)/);
  assert.match(message, /abc123/);
  assert.match(message, /append-only/);
});

test('buildSuccessMessage: counts the examined ADRs, names the base ref, and names ignored files', () => {
  const base = new Map([
    ['0001-a.md', BASE],
    ['0002-b.md', BASE],
    ['TEMPLATE.md', 'x'],
  ]);
  const result = evaluate(base, base);
  const message = buildSuccessMessage(result, 'origin/integration');
  assert.match(message, /2 merged ADRs on origin\/integration/);
  assert.match(message, /Ignored 1 file /);
  assert.match(message, /TEMPLATE\.md/);
});
