'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWLIST,
  OWNER_FILE,
  findLeagueLocks,
  analyze,
  check,
} = require('./check-league-write-locks');

// A synthetic League lock outside the module is red.
test('a League row lock outside the module is reported', () => {
  const { unlisted } = analyze([{
    file: 'server/services/synthetic.service.js',
    source: 'await client.query(`SELECT * FROM "leagues" WHERE "id" = $1 FOR NO KEY UPDATE`, [id]);',
  }], { allowlist: [] });
  assert.equal(unlisted.length, 1);
  assert.match(unlisted[0], /server\/services\/synthetic\.service\.js:1: FOR NO KEY UPDATE outside the League write module/);
});

// The same lock inside the module is green.
test('the same lock inside the owner module is exempt', () => {
  const { unlisted } = analyze([{
    file: OWNER_FILE,
    source: 'await client.query(`SELECT * FROM "leagues" WHERE "id" = $1 FOR NO KEY UPDATE`, [id]);',
  }], { allowlist: [] });
  assert.deepEqual(unlisted, []);
});

// An allowlist entry that matches nothing is red.
test('an allowlist entry whose lock is gone is stale', () => {
  const { stale } = analyze(
    [{ file: 'server/services/synthetic.service.js', source: 'SELECT 1' }],
    { allowlist: [{ file: 'server/services/synthetic.service.js', count: 1, rule: 'x', ticket: '#2693' }] }
  );
  assert.equal(stale.length, 1);
  assert.match(stale[0], /allowlist says 1 League locks, found 0/);
});

test('a listed file with more locks than its count is over-count', () => {
  const source = '`SELECT 1 FROM "leagues" WHERE "id" = $1 FOR UPDATE`;\n`SELECT 1 FROM "leagues" WHERE "id" = $2 FOR UPDATE`;';
  const { overCount } = analyze(
    [{ file: 'server/routes/x.router.js', source }],
    { allowlist: [{ file: 'server/routes/x.router.js', count: 1, rule: 'x', ticket: '#2697' }] }
  );
  assert.equal(overCount.length, 1);
  assert.match(overCount[0], /2 League locks, allowlist says 1/);
});

test('an allowlist entry with no rule or no ticket is reported', () => {
  const { ruleless } = analyze([], {
    allowlist: [{ file: 'server/routes/x.router.js', count: 1, rule: '  ' }],
  });
  assert.equal(ruleless.length, 2);
});

// The lock option's ternary is read with the literal that carries it.
test('a multi-line statement whose lock is a ternary option is a hit', () => {
  const source = [
    'const result = await client.query(',
    '  `SELECT * FROM "leagues" WHERE "id" = $1' + String.fromCharCode(36) + '{forUpdate ? \' FOR NO KEY UPDATE\' : \'\'}`,',
    '  [leagueId]',
    ');',
  ].join('\n');
  const hits = findLeagueLocks(source);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});

test('a lock OF leagues in a join is a hit', () => {
  const hits = findLeagueLocks('`SELECT * FROM "leagues" ORDER BY "leagues"."id" FOR NO KEY UPDATE OF "leagues"`');
  assert.equal(hits.length, 1);
});

test('a row lock that names only teams is not a League lock', () => {
  const hits = findLeagueLocks(
    '`SELECT "id", "locked" FROM "teams" WHERE "id" = $1 FOR UPDATE`'
  );
  assert.deepEqual(hits, []);
});

test('a join that locks only the team OF clause is not a League lock', () => {
  const hits = findLeagueLocks(
    '`SELECT * FROM "leagues" l JOIN "teams" t ON t."league_id" = l."id" WHERE t."id" = $1 FOR UPDATE OF t`'
  );
  assert.deepEqual(hits, []);
});

test('a board version advance on leagues is a hit', () => {
  const hits = findLeagueLocks(
    'await client.query(`UPDATE "leagues" SET "board_version" = "board_version" + 1 WHERE "id" = $1`);'
  );
  assert.equal(hits.length, 1);
  assert.match(hits[0].code, /board version/);
});

test('a multi-line board version advance is a hit', () => {
  const hits = findLeagueLocks('`UPDATE "leagues"\n  SET "draft_status" = $2,\n  "board_version" = "board_version" + 1\n WHERE "id" = $1`');
  assert.equal(hits.length, 1);
});

test('a leagues read with no lock is not a hit', () => {
  assert.deepEqual(findLeagueLocks('`SELECT * FROM "leagues" WHERE "id" = $1`'), []);
});

// The real tree, with the allowlist emptied, names exactly the sites it still
// holds. Account deletion is the one standing exception; every other entry is
// a site a later ticket converts.
test('the real tree, with the allowlist emptied, holds exactly the sites the allowlist covers', () => {
  const { unlisted, stale, overCount, ruleless } = check({ allowlist: [] });
  assert.deepEqual([stale, overCount, ruleless], [[], [], []]);
  const perFile = {};
  for (const line of unlisted) {
    const file = line.split(':')[0];
    perFile[file] = (perFile[file] || 0) + 1;
  }
  assert.deepEqual(perFile, Object.fromEntries(ALLOWLIST.map((entry) => [entry.file, entry.count])));
});

// The guard's real job: the shipped allowlist describes the shipped tree.
test('the real tree passes the shipped allowlist', () => {
  assert.deepEqual(check(), { unlisted: [], overCount: [], stale: [], ruleless: [] });
});

// Lower-case SQL locks the same row, so it is a hit too.
test('a lower-case row lock is a hit', () => {
  const hits = findLeagueLocks('await c.query(`select * from "leagues" where "id" = $1 for no key update`);');
  assert.equal(hits.length, 1);
});

// A backtick in a comment must not open a literal that hides the real lock after it.
test('a backtick inside a comment does not hide a lock on the next line', () => {
  const hits = findLeagueLocks(
    '// a lone ` backtick in a comment\nawait c.query(`SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`);'
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
});
