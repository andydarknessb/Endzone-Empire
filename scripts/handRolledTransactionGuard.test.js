/**
 * Proves scripts/check-hand-rolled-transaction.js (#1068, spec #1061).
 *
 * Two kinds of test, and both are needed. The FIXTURE tests feed synthetic
 * sources to the pure analyzer so each rule has a red case and a green case
 * that do not depend on the tree staying a particular shape: a bare ROLLBACK
 * outside the allowlist is red, an allowlist entry with no rule is red, two
 * sites sharing a label are red, and a file that only calls withTransaction is
 * green. The REAL-TREE tests pin the analyzer against the actual server so a
 * broken walk or a mis-resolved unit cannot pass by finding nothing: the guard
 * must be green on the real allowlist, and with an empty allowlist it must
 * still FIND the two ruled hand-rolled sites (else the scan is not reaching
 * them and every future violation would slip through the same hole).
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWLIST,
  SCAN_ROOTS,
  findHits,
  findLabels,
  analyze,
  check,
} = require('./check-hand-rolled-transaction');

const src = (file, source) => ({ file, source });

// ---------------------------------------------------------------------------
// Real tree: the guard's actual job.
// ---------------------------------------------------------------------------

test('the real tree is clean under the shipped allowlist', () => {
  const { unlisted, stale, ruleless, duplicateLabels } = check();
  assert.deepEqual(unlisted, [], 'a hand-rolled transaction site is outside withTransaction and the allowlist');
  assert.deepEqual(stale, [], 'an allowlist entry no longer matches any code');
  assert.deepEqual(ruleless, [], 'an allowlist entry has no rule');
  assert.deepEqual(duplicateLabels, [], 'two withTransaction sites share a label');
});

// The clean test above passes trivially if the scan reached nothing. This one
// pins it from the other side: with an empty allowlist the scan must surface
// the two ruled hand-rolled sites, resolved to the exact units the allowlist
// names - the module-level function and the route.
test('with an empty allowlist the scan reaches both ruled sites', () => {
  const { unlisted } = check(SCAN_ROOTS, { allowlist: [] });
  assert.ok(unlisted.length >= 4, `empty allowlist must report every hit; got ${unlisted.length}`);
  assert.ok(
    unlisted.some((v) => v.includes('server/services/leagueSettings.service.js') && v.includes('updateLeagueSettings')),
    'the leagueSettings hits must resolve to updateLeagueSettings, not to the nested rejectUpdate closure'
  );
  assert.ok(
    unlisted.some((v) => v.includes('server/routes/league.router.js') && v.includes('GET /:id/matchups/:matchupId')),
    'the matchup-route hits must resolve to the route handler by its method and path'
  );
});

test('the two exempt lock modules never appear as findings', () => {
  const { unlisted } = check(SCAN_ROOTS, { allowlist: [] });
  assert.ok(!unlisted.some((v) => v.includes('advisoryLock.js')), 'advisoryLock.js is exempt (ADR 0033 Ruling 2)');
  assert.ok(!unlisted.some((v) => v.includes('liveGameEngine.js')), 'liveGameEngine.js is exempt (ADR 0033 Ruling 2)');
  assert.ok(!unlisted.some((v) => v.includes('withTransaction.js')), 'the wrapper itself is exempt');
});

test('every shipped allowlist entry carries a real rule', () => {
  for (const entry of ALLOWLIST) {
    assert.ok(entry.file, 'an allowlist entry has no file');
    assert.ok(entry.function, `${entry.file}: an allowlist entry has no function`);
    assert.ok(
      typeof entry.rule === 'string' && entry.rule.trim().length > 20,
      `${entry.file} :: ${entry.function}: the rule is the entry's whole purpose; if it cannot be written down, that is the finding`
    );
  }
});

// ---------------------------------------------------------------------------
// Red fixtures: each rule fails on the shape it is meant to catch.
// ---------------------------------------------------------------------------

test('red: a bare query(ROLLBACK) outside the allowlist is a finding', () => {
  const source = [
    'async function doThing(pool) {',
    '  const client = await pool.connect();',
    '  try { await client.query(\'BEGIN\'); } catch (e) {',
    '    await client.query(\'ROLLBACK\');',
    '    throw e;',
    '  } finally { client.release(); }',
    '}',
    '',
  ].join('\n');
  const { unlisted } = analyze([src('server/services/thing.service.js', source)], { allowlist: [] });
  assert.ok(unlisted.some((v) => v.includes('ROLLBACK') && v.includes('doThing')), unlisted.join('\n'));
  assert.ok(unlisted.some((v) => v.includes('BEGIN')));
  assert.ok(unlisted.some((v) => v.includes('release')));
});

test('red: an allowlist entry with an empty rule fails', () => {
  const { ruleless } = analyze([], {
    allowlist: [{ file: 'server/services/x.service.js', function: 'foo', rule: '   ' }],
  });
  assert.equal(ruleless.length, 1);
  assert.match(ruleless[0], /no rule/);
});

test('red: an allowlist entry describing no code is stale', () => {
  const { stale } = analyze([src('server/services/x.service.js', 'async function foo(){ return 1; }\n')], {
    allowlist: [{ file: 'server/services/x.service.js', function: 'foo', rule: 'a rule long enough to pass' }],
  });
  assert.equal(stale.length, 1);
  assert.match(stale[0], /no hand-rolled transaction found/);
});

test('red: two withTransaction sites sharing a label is a finding, naming both', () => {
  const source = [
    'async function a(pool){ return withTransaction(pool, async (c) => c, { label: \'dup\' }); }',
    'async function b(pool){ return withTransaction(pool, async (c) => c, { label: \'dup\' }); }',
    '',
  ].join('\n');
  const { duplicateLabels } = analyze([src('server/services/dup.service.js', source)]);
  assert.equal(duplicateLabels.length, 1);
  assert.match(duplicateLabels[0], /label 'dup'/);
  assert.match(duplicateLabels[0], /dup\.service\.js:1/);
  assert.match(duplicateLabels[0], /dup\.service\.js:2/);
});

test('red: two unlabelled withTransaction sites collide on the default label', () => {
  const source = [
    'async function a(pool){ return withTransaction(pool, async (c) => c); }',
    'async function b(pool){ return withTransaction(pool, async (c) => c); }',
    '',
  ].join('\n');
  const { duplicateLabels } = analyze([src('server/services/nolabel.service.js', source)]);
  assert.equal(duplicateLabels.length, 1);
  assert.match(duplicateLabels[0], /default label/);
});

// ---------------------------------------------------------------------------
// Green fixtures: the guard leaves correct code alone.
// ---------------------------------------------------------------------------

test('green: a file that only calls withTransaction has no findings', () => {
  const source = [
    'const { withTransaction } = require(\'../modules/withTransaction\');',
    'async function submit(pool){',
    '  return withTransaction(pool, async (client) => {',
    '    await client.query(\'INSERT INTO x VALUES (1)\');',
    '    return client;',
    '  }, { label: \'submit-x\' });',
    '}',
    '',
  ].join('\n');
  const result = analyze([src('server/services/ok.service.js', source)]);
  assert.deepEqual(result.unlisted, []);
  assert.deepEqual(result.duplicateLabels, []);
});

test('green: a plain data query is not a transaction statement', () => {
  // `query('SELECT ...')` / `query('INSERT ...')` are ordinary reads and writes,
  // not BEGIN/COMMIT/ROLLBACK, and must never be reported.
  const hits = findHits('async function r(c){ await c.query(\'SELECT 1\'); await c.query(\'UPDATE t SET x=1\'); }');
  assert.deepEqual(hits, []);
});

// ---------------------------------------------------------------------------
// Scan shapes: quote styles, template literals, whitespace, attribution.
// ---------------------------------------------------------------------------

test('a transaction statement is caught in any quote style and as a template literal', () => {
  const single = findHits('async function f(c){ await c.query(\'ROLLBACK\'); }');
  const dbl = findHits('async function f(c){ await c.query("ROLLBACK"); }');
  const tmpl = findHits('async function f(c){ await c.query(`ROLLBACK`); }');
  const spaced = findHits('async function f(c){ await c.query(`  begin  `); }');
  assert.equal(single.length, 1);
  assert.equal(dbl.length, 1);
  assert.equal(tmpl.length, 1);
  assert.equal(spaced.length, 1, 'whitespace-tolerant, case-insensitive');
  assert.equal(spaced[0].kind, 'BEGIN');
});

test('a control statement built from a non-literal is out of scope', () => {
  // The guard reads source literals, not runtime values; `query(BEGIN_SQL)` is
  // not what a copy-pasted hand-rolled site writes.
  const hits = findHits('const BEGIN_SQL = \'BEGIN\';\nasync function f(c){ await c.query(BEGIN_SQL); }');
  assert.deepEqual(hits, []);
});

test('a hit in a nested .catch callback is attributed to the owning function', () => {
  const source = 'async function owner(c){ await c.query(\'ROLLBACK\').catch(() => {}); }';
  const hits = findHits(source);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].unit, 'owner');
});

test('a route handler is named by its method and path', () => {
  const source = 'router.get(\'/:id/matchups/:matchupId\', async (req, res) => { await client.query(\'BEGIN\'); });';
  const hits = findHits(source);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].unit, 'GET /:id/matchups/:matchupId');
});

test('a hit at module top level resolves to no unit', () => {
  const hits = findHits('await client.query(\'ROLLBACK\');');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].unit, null);
  const { unlisted } = analyze([src('server/services/top.service.js', 'await client.query(\'ROLLBACK\');\n')], { allowlist: [] });
  assert.ok(unlisted[0].includes('<module top level>'));
});

test('findLabels reads the label only from withTransaction call sites', () => {
  // A `label:` key on some other object (a draft slot, say) is not a
  // withTransaction label and must not be collected.
  const source = [
    'const slot = { label: \'WR\' };',
    'async function f(pool){ return withTransaction(pool, async (c) => c, { label: \'real\' }); }',
    '',
  ].join('\n');
  const labels = findLabels(source);
  assert.deepEqual(labels.map((l) => l.label), ['real']);
});

test('scan roots are fixed: an arbitrary root is refused', () => {
  assert.throws(() => check(['../'], {}), /scan root is not allowed/);
});

test('a test file is never scanned', () => {
  const source = 'async function t(c){ await c.query(\'ROLLBACK\'); }';
  const { unlisted } = analyze([src('server/services/x.test.js', source)], { allowlist: [] });
  assert.deepEqual(unlisted, []);
});
