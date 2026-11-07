'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { leagueWrite } = require('../modules/leagueWrite');
const { logger } = require('../modules/logger');
const sentry = require('../modules/sentry');

// The League write module (CONTEXT.md, League write; ADR 0070). It owns the
// League-row lock, the transaction close (via withTransaction, ADR 0033) and the
// after-commit queue. These tests drive it against a fakePool: the call log is the
// record of statement order, and each after-commit piece stamps whether a COMMIT
// had been sent yet, so ordering is read from evidence.

const LEAGUE_ID = 1;
const LOCK = /^SELECT \* FROM "leagues" WHERE "id" = \$1 FOR NO KEY UPDATE$/;

function world(t, extra = [], { league = { id: LEAGUE_ID, name: 'Lakers' } } = {}) {
  const fake = createFakePool([
    [LOCK, () => ({ rows: league ? [league] : [] }), 'client'],
    ...extra,
  ]).install(t);
  return fake;
}

const committed = (fake) => fake.calls.some((c) => c.text === 'COMMIT');

test('the League row is locked FOR NO KEY UPDATE as the first statement after BEGIN', async (t) => {
  const fake = world(t, [[/^UPDATE "leagues"/, () => ({ rows: [] }), 'client']]);
  await leagueWrite({ leagueId: LEAGUE_ID, label: 'test' }, async ({ client }) => {
    await client.query('UPDATE "leagues" SET "name" = $1 WHERE "id" = $2', ['x', LEAGUE_ID]);
  });
  const texts = fake.calls.map((c) => c.text);
  assert.equal(texts[0], 'BEGIN', 'the write opens its transaction first');
  assert.match(texts[1], LOCK, 'the lock is the first statement after BEGIN');
  assert.ok(texts.indexOf('COMMIT') > texts.findIndex((s) => /^UPDATE "leagues"/.test(s)), 'the write lands before COMMIT');
  fake.assertClean();
});

test('the body receives the locked client and the League row; an unknown League arrives as null', async (t) => {
  const fake = world(t, [], { league: null });
  let seen;
  await leagueWrite({ leagueId: LEAGUE_ID, label: 'test' }, async (write) => {
    seen = write;
  });
  assert.equal(typeof seen.client.query, 'function', 'the locked client is passed');
  assert.equal(seen.league, null, 'an unknown League is null, not an error');
  assert.equal(typeof seen.afterCommit, 'function', 'the after-commit queue is passed');
  fake.assertClean();
});

test('a body that throws rolls back, runs no after-commit work and rethrows its own error', async (t) => {
  const fake = world(t);
  const boom = new Error('refused');
  const ran = [];
  await assert.rejects(
    leagueWrite({ leagueId: LEAGUE_ID, label: 'test' }, async ({ afterCommit }) => {
      afterCommit(() => ran.push('after'));
      throw boom;
    }),
    (error) => error === boom
  );
  assert.deepEqual(ran, [], 'the queued after-commit work never runs');
  assert.ok(fake.calls.some((c) => c.text === 'ROLLBACK'), 'the transaction rolled back');
  assert.ok(!committed(fake), 'no COMMIT was sent');
  fake.assertClean();
});

test('after-commit work runs after COMMIT, in order, and a throwing piece is reported once while the next still runs', async (t) => {
  const fake = world(t);
  const logged = t.mock.method(logger, 'error', () => {});
  const captured = t.mock.method(sentry, 'captureError', () => {});
  const order = [];
  const result = await leagueWrite({ leagueId: LEAGUE_ID, label: 'test' }, async ({ afterCommit }) => {
    afterCommit(() => order.push(['first', committed(fake)]));
    afterCommit(() => {
      order.push(['second', committed(fake)]);
      throw new Error('room is down');
    });
    afterCommit(() => order.push(['third', committed(fake)]));
    return 'body-result';
  });
  assert.equal(result, 'body-result', 'the call resolves with what the body returned');
  assert.deepEqual(
    order.map(([name]) => name),
    ['first', 'second', 'third'],
    'the pieces run in the order they were queued, and the failing one does not stop the next'
  );
  assert.ok(order.every(([, afterCommitted]) => afterCommitted), 'every piece runs after COMMIT');
  assert.equal(logged.mock.callCount(), 1, 'the failing piece is reported once through the logger');
  assert.equal(captured.mock.callCount(), 1, 'the failing piece is reported once to Sentry');
  fake.assertClean();
});

test('a nested write issues no BEGIN, lock or COMMIT, sees the outer client and League, and queues its after-commit work behind the outer commit', async (t) => {
  const fake = world(t, [[/^UPDATE "lineup_entries"/, () => ({ rows: [] }), 'client']]);
  const order = [];
  await leagueWrite({ leagueId: LEAGUE_ID, label: 'outer' }, async (outer) => {
    await leagueWrite({ leagueId: LEAGUE_ID, label: 'inner', within: outer }, async (inner) => {
      assert.equal(inner.client, outer.client, 'the nested write runs on the outer client');
      assert.equal(inner.league, outer.league, 'the nested write sees the outer League');
      inner.afterCommit(() => order.push(['inner', committed(fake)]));
      await inner.client.query('UPDATE "lineup_entries" SET "x" = 1 WHERE "league_id" = $1', [LEAGUE_ID]);
    });
    order.push(['outer-body-done', committed(fake)]);
  });
  const texts = fake.calls.map((c) => c.text);
  assert.equal(texts.filter((s) => s === 'BEGIN').length, 1, 'one BEGIN, from the outer write');
  assert.equal(texts.filter((s) => s === 'COMMIT').length, 1, 'one COMMIT, from the outer write');
  assert.equal(texts.filter((s) => LOCK.test(s)).length, 1, 'one lock, from the outer write');
  assert.deepEqual(order, [['outer-body-done', false], ['inner', true]], 'the nested piece runs only after the outer commit');
  fake.assertClean();
});

test('a nested write for another League throws', async (t) => {
  const fake = world(t);
  await assert.rejects(
    leagueWrite({ leagueId: LEAGUE_ID, label: 'outer' }, (outer) =>
      leagueWrite({ leagueId: 2, label: 'inner', within: outer }, async () => 'never')
    ),
    /League/
  );
  fake.assertClean();
});
