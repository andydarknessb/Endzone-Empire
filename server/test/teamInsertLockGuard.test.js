/**
 * The guard for #1043: every Team-insert under server/ runs behind a League-row
 * lock taken in the same function, so the unlocked Teams snapshot a Draft act
 * reads (draftAct.service.js) cannot miss a Team created mid-act.
 *
 * This file pins BOTH halves of a source-derived guard, because a guard that
 * discovers its own inputs fails silently when the DISCOVERY breaks, not only
 * when its assertion does - and the discovery set here has size ONE, so a
 * matcher a hair too narrow would empty it and leave the guard vacuously green
 * (#1043 ruling 2). So:
 *
 *  - the RULE holds (no unlocked Team-insert exists);
 *  - the SCAN actually reaches the tree (a non-emptiness floor), and finds the
 *    one known site by path - the red-tell (deleting FOR UPDATE) exercises only
 *    the rule and would stay green if the scan silently found nothing, so the
 *    scan is pinned separately here;
 *  - the FINDER is unit-tested against inline fixtures in both directions -
 *    locked vs not, order and scope sensitive, and a leagues lock told apart
 *    from a teams lock - so the assertion cannot be quietly weakened either.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SERVER_ROOTS,
  findTeamInserts,
  unlockedTeamInserts,
  scan,
  check,
} = require('../../scripts/check-team-insert-lock');

const LEAGUE_LOCK = 'SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE';
const TEAM_INSERT = 'INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, $3)';
const q = (sql) => `await client.query(\`${sql}\`);`;

test('every Team-insert under server/ takes a League row lock first', () => {
  const { violationSites } = check(SERVER_ROOTS);
  assert.deepEqual(
    violationSites,
    [],
    'A Team is inserted without a SELECT ... FROM "leagues" ... FOR UPDATE earlier in the same '
    + 'function. A Draft act reads the Teams into an unlocked snapshot and gates/deletes per Team '
    + 'from it (draftAct.service.js); a Team created without serializing behind the League lock '
    + 'could be neither gated nor wiped (#1043). Lock the League row before the insert, or bring '
    + 'the reviewer the argument for why this insert needs no such serialization.'
  );
});

// The test above passes trivially if the scan found nothing at all - a broken
// walk, a bad root, a matcher that matches no file would each make it green
// while guarding nothing. These pin the scan against the real tree from the
// other side: it must FIND the insert, and it must find the KNOWN one by path.
// Deleting FOR UPDATE (the red-tell) leaves the site perfectly discoverable, so
// it never exercises this; only these do.
test('the scan actually reaches the source tree and finds the known site', () => {
  const { inserts } = scan(SERVER_ROOTS);
  const sites = [...inserts.keys()];

  const total = [...inserts.values()].reduce((n, list) => n + list.length, 0);
  assert.ok(
    total >= 1,
    `the scan must find at least one Team-insert; got ${total}. If this is zero, the discovery `
    + 'matcher (TEAM_INSERT) has broken and the guard is asserting nothing.'
  );
  assert.ok(
    sites.includes('server/services/leagueMembership.service.js'),
    `the scan must find the one production Team-insert (joinLeague, `
    + `server/services/leagueMembership.service.js); found instead: ${sites.join(', ') || '(none)'}. `
    + 'If it moved, update this assertion to the new home; if it vanished from the scan, the matcher broke.'
  );
});

test('the scanner refuses a root outside its fixed source-tree allowlist', () => {
  assert.throws(
    () => scan(['../']),
    /scan root is not allowed/
  );
});

// --- The finder, both directions ------------------------------------------

test('finds a Team-insert (discovery works)', () => {
  const src = `async function join(client, id) {\n  ${q(LEAGUE_LOCK)}\n  ${q(TEAM_INSERT)}\n}\n`;
  assert.deepEqual(findTeamInserts(src), [{ line: 3 }]);
});

test('a Team-insert quoted in a comment is not discovered', () => {
  const src = [
    'async function join(client, id) {',
    `  // ${TEAM_INSERT}`,
    `  /* ${TEAM_INSERT} */`,
    `  ${q(LEAGUE_LOCK)}`,
    '}',
    '',
  ].join('\n');
  assert.deepEqual(findTeamInserts(src), []);
});

test('a lock before the insert in the same function is NOT a violation', () => {
  const src = `async function join(client, { leagueId }) {\n  ${q(LEAGUE_LOCK)}\n  ${q(TEAM_INSERT)}\n}\n`;
  assert.deepEqual(unlockedTeamInserts(src), []);
});

test('an insert with no lock at all is a violation', () => {
  const src = `async function addTeam(client, { leagueId }) {\n  ${q(TEAM_INSERT)}\n}\n`;
  assert.deepEqual(unlockedTeamInserts(src), [{ line: 2 }]);
});

test('a lock AFTER the insert is a violation (order matters)', () => {
  const src = `async function bad(client, id) {\n  ${q(TEAM_INSERT)}\n  ${q(LEAGUE_LOCK)}\n}\n`;
  assert.deepEqual(unlockedTeamInserts(src), [{ line: 2 }]);
});

test('a lock in a DIFFERENT function is a violation (scope matters)', () => {
  const src = [
    'async function locker(client, id) {',
    `  ${q(LEAGUE_LOCK)}`,
    '}',
    'async function inserter(client, id) {',
    `  ${q(TEAM_INSERT)}`,
    '}',
    '',
  ].join('\n');
  assert.deepEqual(unlockedTeamInserts(src), [{ line: 5 }]);
});

test('a teams lock (not a leagues lock) does not satisfy the rule', () => {
  const teamsLock = 'SELECT * FROM "teams" WHERE "id" = $1 FOR UPDATE';
  const src = `async function bad(client, id) {\n  ${q(teamsLock)}\n  ${q(TEAM_INSERT)}\n}\n`;
  assert.deepEqual(unlockedTeamInserts(src), [{ line: 3 }]);
});

test('an arrow-function handler counts as an enclosing function', () => {
  // Route handlers are arrows, and a commissioner "add team" path could land in
  // one (#1043 ruling 3), so the finder must scope by an arrow body too.
  const locked = `router.post('/x', async (req, res) => {\n  ${q(LEAGUE_LOCK)}\n  ${q(TEAM_INSERT)}\n});\n`;
  const unlocked = `router.post('/x', async (req, res) => {\n  ${q(TEAM_INSERT)}\n});\n`;
  assert.deepEqual(unlockedTeamInserts(locked), []);
  assert.deepEqual(unlockedTeamInserts(unlocked), [{ line: 2 }]);
});

// The three evasions a risk review confirmed against the first cut, pinned so
// they cannot creep back: the lock scope must be a single SQL statement, and the
// lock must be one the enclosing function itself takes.

test('a leagues READ (no lock) plus a FOR UPDATE on another table is a violation', () => {
  // Quoted SQL, so no backtick sits between the two statements; the lock must
  // still be judged per statement, not across the whole span.
  const src = [
    'async function addTeam(client, id) {',
    "  await client.query('SELECT * FROM \"leagues\" WHERE id = $1');",
    "  await client.query('SELECT * FROM \"teams\" WHERE id = $1 FOR UPDATE');",
    `  ${q(TEAM_INSERT)}`,
    '}',
    '',
  ].join('\n');
  assert.deepEqual(unlockedTeamInserts(src), [{ line: 4 }]);
});

test('two statements in one template do not combine into a leagues lock', () => {
  const src = [
    'async function addTeam(client, id) {',
    '  await client.query(`SELECT * FROM "leagues" WHERE id = $1; SELECT * FROM "teams" WHERE id = $1 FOR UPDATE`);',
    `  ${q(TEAM_INSERT)}`,
    '}',
    '',
  ].join('\n');
  assert.deepEqual(unlockedTeamInserts(src), [{ line: 3 }]);
});

test('a lock inside a nested inline helper does not satisfy an outer insert', () => {
  const src = [
    'async function addTeam(client, id) {',
    '  const lockIt = async () => {',
    `    ${q(LEAGUE_LOCK)}`,
    '  };',
    `  ${q(TEAM_INSERT)}`,
    '}',
    '',
  ].join('\n');
  assert.deepEqual(unlockedTeamInserts(src), [{ line: 5 }]);
});

test('an unbalanced brace inside a string does not mis-scope a locked insert', () => {
  const src = [
    'async function join(client, id) {',
    `  ${q(LEAGUE_LOCK)}`,
    "  logger.info('progress }');",
    `  ${q(TEAM_INSERT)}`,
    '}',
    '',
  ].join('\n');
  assert.deepEqual(unlockedTeamInserts(src), []);
});

test('a control block between lock and insert does not break scoping', () => {
  // `if (...) {` is not a function body, so the insert's enclosing function is
  // still the outer one where the lock lives.
  const src = [
    'async function join(client, { leagueId, full }) {',
    `  ${q(LEAGUE_LOCK)}`,
    '  if (full) {',
    "    throw new Error('full');",
    '  }',
    `  ${q(TEAM_INSERT)}`,
    '}',
    '',
  ].join('\n');
  assert.deepEqual(unlockedTeamInserts(src), []);
});
