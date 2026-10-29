'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ALLOWLIST,
  OWNER_FILE,
  findWrites,
  analyze,
  check,
} = require('./check-roster-move-writes');

// The issue's acceptance sweep, run through the same analyzer the guard uses:
// with the allowlist emptied, the real tree must report exactly the four bulk
// writes, nothing else. If a fifth site appears, or one of the four moves out
// from under its entry, this goes red before the guard's own message does.
test('the real tree has exactly the four bulk writes beside the module', () => {
  const { unlisted, stale, overCount, ruleless } = check({ allowlist: [] });
  assert.deepEqual(stale, []);
  assert.deepEqual(overCount, []);
  assert.deepEqual(ruleless, []);
  const sites = unlisted
    .map((line) => line.split(' outside ')[0].replace(/:\d+: (INSERT INTO|DELETE FROM) "team_players"/, ''))
    .sort();
  assert.deepEqual(sites, [
    'server/routes/draft.router.js',
    'server/services/commissioner.service.js',
    'server/services/commissioner.service.js',
    'server/services/draftStart.service.js',
  ]);
});

// The guard's real job: the shipped allowlist describes the shipped tree.
test('the real tree passes the shipped allowlist', () => {
  assert.deepEqual(check(), {
    unlisted: [], overCount: [], stale: [], ruleless: [],
  });
});

test('a DELETE in an unlisted file is reported', () => {
  const { unlisted } = analyze([{
    file: 'server/services/waiver.service.js',
    source: 'await client.query(\n  `DELETE FROM "team_players" WHERE "team_id" = $1`,\n  [teamId]\n);',
  }]);
  assert.equal(unlisted.length, 1);
  assert.match(unlisted[0], /server\/services\/waiver\.service\.js:2: DELETE FROM "team_players"/);
});

test('an INSERT in an unlisted file is reported', () => {
  const { unlisted } = analyze([{
    file: 'server/routes/league.router.js',
    source: 'client.query(`INSERT INTO "team_players" ("league_id") VALUES ($1)`)',
  }]);
  assert.equal(unlisted.length, 1);
  assert.match(unlisted[0], /INSERT INTO "team_players"/);
});

test('an UPDATE that moves a player is reported too', () => {
  // `UPDATE ... SET "team_id"` is a roster move the codebase refuses on purpose
  // (#197: it keeps the giving team's created_at), so a site that reached for it
  // must not slip past the guard.
  const { unlisted } = analyze([{
    file: 'server/services/trade.service.js',
    source: 'client.query(`UPDATE "team_players" SET "team_id" = $1 WHERE "player_id" = $2`)',
  }]);
  assert.equal(unlisted.length, 1);
  assert.match(unlisted[0], /UPDATE "team_players"/);
});

test('the module itself is exempt', () => {
  const { unlisted } = analyze([{
    file: OWNER_FILE,
    source: 'INSERT INTO "team_players" ... DELETE FROM "team_players" ...',
  }]);
  assert.deepEqual(unlisted, []);
});

test('tests and migrations are out of scope', () => {
  const { unlisted } = analyze([
    { file: 'server/test/rosterMove.service.test.js', source: 'DELETE FROM "team_players"' },
    { file: 'server/db/migrations/20260101000000_x.js', source: 'INSERT INTO "team_players"' },
  ]);
  assert.deepEqual(unlisted, []);
});

// The count is the second half of the rule: a fifth write in a listed file is a
// new single-player site riding on a bulk entry's exemption.
test('a listed file writing more than its count is reported', () => {
  const { overCount } = analyze(
    [{ file: 'server/routes/draft.router.js', source: 'DELETE FROM "team_players"\nDELETE FROM "team_players"' }],
    { allowlist: ALLOWLIST }
  );
  assert.equal(overCount.length, 1);
  assert.match(overCount[0], /2 Roster writes, allowlist says 1/);
});

test('an entry whose write is gone is stale', () => {
  const { stale } = analyze(
    [{ file: 'server/routes/draft.router.js', source: 'SELECT 1' }],
    { allowlist: [ALLOWLIST[0]] }
  );
  assert.equal(stale.length, 1);
  assert.match(stale[0], /allowlist says 1 Roster writes, found 0/);
});

test('an allowlist entry with no rule is reported', () => {
  const { ruleless } = analyze([], {
    allowlist: [{ file: 'server/routes/draft.router.js', count: 1, rule: '  ' }],
  });
  assert.equal(ruleless.length, 1);
  assert.match(ruleless[0], /no rule/);
});

test('findWrites reports the line and the write it found', () => {
  assert.deepEqual(
    findWrites('SELECT 1;\n  `DELETE FROM "team_players" WHERE "id" = $1`'),
    [{ line: 2, code: 'DELETE FROM "team_players"' }]
  );
});
