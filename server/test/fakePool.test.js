const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');

test('query dispatches to the first matching handler over whitespace-normalized SQL', async () => {
  const fake = createFakePool([
    [/FROM "teams"/, (text, params) => ({ rows: [{ id: params[0] }] })],
    [/FROM "leagues"/, () => ({ rows: [] })],
  ]);
  const res = await fake.query('SELECT *\n   FROM "teams"\n  WHERE "id" = $1', [7]);
  assert.deepEqual(res.rows, [{ id: 7 }]);
});

test('every call is logged with via, normalized text and raw params', async () => {
  const fake = createFakePool([[/FROM "teams"/, () => ({ rows: [] })]]);
  const params = [7, 'x'];
  await fake.query('SELECT 1  FROM   "teams"', params);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].via, 'pool');
  assert.equal(fake.calls[0].text, 'SELECT 1 FROM "teams"');
  assert.equal(fake.calls[0].params, params, 'params are kept by reference, untouched');
});

test('an unmatched query throws, naming the normalized text', async () => {
  const fake = createFakePool([]);
  await assert.rejects(
    () => fake.query('SELECT *\n FROM "nowhere"'),
    /unexpected query: SELECT \* FROM "nowhere"/
  );
});

test('a connected client dispatches against the same table, tagged via client', async () => {
  const fake = createFakePool([[/FROM "teams"/, () => ({ rows: [{ id: 1 }] })]]);
  const client = await fake.connect();
  const res = await client.query('SELECT * FROM "teams"');
  assert.deepEqual(res.rows, [{ id: 1 }]);
  assert.deepEqual(fake.calls.map((c) => c.via), ['client']);
  client.release();
});

test('releasing a client twice throws', async () => {
  const fake = createFakePool([]);
  const client = await fake.connect();
  client.release();
  assert.throws(() => client.release(), /released twice/);
});

test('BEGIN/COMMIT/ROLLBACK are auto-answered on a client and logged, no handlers needed', async () => {
  const fake = createFakePool([]);
  const client = await fake.connect();
  assert.deepEqual((await client.query('BEGIN')).rows, []);
  assert.deepEqual((await client.query('COMMIT')).rows, []);
  client.release();
  assert.deepEqual(fake.calls.map((c) => c.text), ['BEGIN', 'COMMIT']);
});

test('COMMIT or ROLLBACK without an open transaction throws', async () => {
  const fake = createFakePool([]);
  const client = await fake.connect();
  await assert.rejects(() => client.query('COMMIT'), /COMMIT without BEGIN/);
  await assert.rejects(() => client.query('ROLLBACK'), /ROLLBACK without BEGIN/);
});

test('a transactional statement on the pool itself throws', async () => {
  const fake = createFakePool([]);
  await assert.rejects(() => fake.query('BEGIN'), /transactional statement on the pool/);
});

test('a suite handler can still override a transaction statement (e.g. to fail COMMIT)', async () => {
  const fake = createFakePool([[/^COMMIT$/, () => { throw new Error('boom'); }]]);
  const client = await fake.connect();
  await client.query('BEGIN');
  await assert.rejects(() => client.query('COMMIT'), /boom/);
});

test('assertClean passes when every client was released and no transaction left open', async () => {
  const fake = createFakePool([]);
  const client = await fake.connect();
  await client.query('BEGIN');
  await client.query('ROLLBACK');
  client.release();
  fake.assertClean();
});

test('assertClean throws on an unreleased client', async () => {
  const fake = createFakePool([]);
  await fake.connect();
  assert.throws(() => fake.assertClean(), /client never released/);
});

test('assertClean throws on a transaction left open', async () => {
  const fake = createFakePool([]);
  const client = await fake.connect();
  await client.query('BEGIN');
  client.release();
  assert.throws(() => fake.assertClean(), /transaction left open/);
});

test('verb/table matcher constructors key on statement shape, not formatting', async () => {
  const fake = createFakePool([
    [select('teams'), () => ({ rows: [{ from: 'select' }] })],
    [insert('pickem_picks'), () => ({ rows: [{ from: 'insert' }] })],
    [update('leagues'), () => ({ rows: [{ from: 'update' }] })],
    [remove('trades'), () => ({ rows: [{ from: 'delete' }] })],
  ]);
  assert.equal((await fake.query('SELECT "id",\n "name" FROM "teams" JOIN "users" ON 1=1')).rows[0].from, 'select');
  assert.equal((await fake.query('INSERT INTO "pickem_picks" ("a") VALUES ($1)')).rows[0].from, 'insert');
  assert.equal((await fake.query('UPDATE "leagues" SET "x" = $1')).rows[0].from, 'update');
  assert.equal((await fake.query('DELETE FROM "trades" WHERE "id" = $1')).rows[0].from, 'delete');
  // The quoted identifier is the boundary: "teams" must not match "teams_archive".
  await assert.rejects(() => fake.query('SELECT 1 FROM "teams_archive"'), /unexpected query/);
});

test('a matcher entry may constrain which side of the seam it answers', async () => {
  const fake = createFakePool([
    [/FROM "leagues"/, () => ({ rows: [{ side: 'client' }] }), 'client'],
    [/FROM "leagues"/, () => ({ rows: [{ side: 'pool' }] })],
  ]);
  assert.equal((await fake.query('SELECT 1 FROM "leagues"')).rows[0].side, 'pool');
  const client = await fake.connect();
  assert.equal((await client.query('SELECT 1 FROM "leagues"')).rows[0].side, 'client');
});

test('matching(re) filters the call log', async () => {
  const fake = createFakePool([[/./, () => ({ rows: [] })]]);
  await fake.query('SELECT 1 FROM "teams"');
  await fake.query('SELECT 1 FROM "leagues"');
  assert.equal(fake.matching(/FROM "teams"/).length, 1);
  assert.equal(fake.matching(/FROM/).length, 2);
});

test('install(t) routes the shared pool module through the fake for the test', async (t) => {
  const pool = require('../modules/pool');
  const fake = createFakePool([[select('teams'), () => ({ rows: [{ id: 9 }] })]]);
  fake.install(t);
  assert.deepEqual((await pool.query('SELECT 1 FROM "teams"')).rows, [{ id: 9 }]);
  const client = await pool.connect();
  assert.deepEqual((await client.query('SELECT 2 FROM "teams"')).rows, [{ id: 9 }]);
  client.release();
  assert.deepEqual(fake.calls.map((c) => c.via), ['pool', 'client']);
  fake.assertClean();
});

test('the handlers array is live: entries pushed after creation are consulted', async () => {
  const handlers = [];
  const fake = createFakePool(handlers);
  handlers.push([/FROM "teams"/, () => ({ rows: [{ late: true }] })]);
  assert.deepEqual((await fake.query('SELECT 1 FROM "teams"')).rows, [{ late: true }]);
});

test('the fake works as an injected db argument, no install needed', async () => {
  // The leagueRole.service style: the function under test takes `db` as a
  // parameter and calls db.query on it directly.
  const fake = createFakePool([[select('leagues'), (text, params) => ({ rows: [{ id: params[0] }] })]]);
  const isKnownLeague = async (db, id) => (await db.query('SELECT 1 FROM "leagues" WHERE "id" = $1', [id])).rows.length > 0;
  assert.equal(await isKnownLeague(fake, 3), true);
  assert.deepEqual(fake.calls[0].params, [3]);
});
