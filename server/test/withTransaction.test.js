'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { withTransaction } = require('../modules/withTransaction');

// #1060: withTransaction owns the pooled-transaction close rule that
// runInjurySync, generateMatchups and scoreMatchups each used to hand-roll
// (ADR 0033). It connects, BEGINs, runs work(client), COMMITs on return,
// and on a throw rolls back, attaches any ROLLBACK rejection as
// error.rollbackError, logs once with the label, rethrows the ORIGINAL
// error, and releases with an Error (so pg-pool destroys the socket) ONLY
// when the ROLLBACK itself rejected. Every healthy path releases bare.

test('(a) work returns a value: COMMIT is sent, released bare, value resolved', async () => {
  const fake = createFakePool([[/^SELECT/, () => ({ rows: [{ ok: 1 }] }), 'client']]);

  const result = await withTransaction(
    fake,
    async (client) => {
      await client.query('SELECT 1');
      return 'resolved-value';
    },
    { label: 'test' }
  );

  assert.equal(result, 'resolved-value', 'the wrapper resolves to what work returns');
  assert.ok(fake.calls.some((c) => c.text === 'BEGIN'), 'BEGIN was sent');
  assert.ok(fake.calls.some((c) => c.text === 'COMMIT'), 'COMMIT was sent');
  assert.equal(fake.calls.filter((c) => c.text === 'ROLLBACK').length, 0, 'no ROLLBACK on the happy path');
  // Red-tell (criterion 1): making the release unconditional (release(new Error(...))
  // on every path) reddens this on releaseArgs()[0] === undefined.
  assert.equal(fake.releaseArgs()[0], undefined, 'the healthy path releases bare');
  fake.assertClean();
});

test('(b) work throws and ROLLBACK succeeds: original error rethrown, no rollbackError, released bare', async () => {
  const fake = createFakePool([[/^SELECT/, () => { throw new Error('boom'); }, 'client']]);

  await assert.rejects(
    withTransaction(fake, async (client) => { await client.query('SELECT 1'); }, { label: 'test' }),
    (err) => {
      assert.equal(err.message, 'boom', 'the original error surfaces');
      assert.equal(err.rollbackError, undefined, 'a clean ROLLBACK attaches no rollbackError');
      return true;
    }
  );

  assert.ok(fake.calls.some((c) => c.text === 'ROLLBACK'), 'ROLLBACK was sent');
  // Red-tell (criterion 1): making the release unconditional reddens this too.
  assert.equal(fake.releaseArgs()[0], undefined, 'a clean ROLLBACK keeps its healthy connection');
  fake.assertClean();
});

test('(c) work throws and ROLLBACK rejects: original rethrown with rollbackError attached, connection destroyed', async (t) => {
  const errorLog = t.mock.method(console, 'error', () => {});
  const fake = createFakePool([
    [/^SELECT/, () => { throw new Error('boom'); }, 'client'],
    [/^ROLLBACK$/, () => { throw new Error('rollback boom'); }, 'client'],
  ]);

  // Red-tell (criterion 1): removing the ROLLBACK guard lets the rollback
  // rejection ('rollback boom') replace the original, reddening err.message.
  await assert.rejects(
    withTransaction(fake, async (client) => { await client.query('SELECT 1'); }, { label: 'test' }),
    (err) => {
      assert.equal(err.message, 'boom', 'the original error surfaces, not the rollback failure');
      assert.equal(err.rollbackError.message, 'rollback boom', 'the rollback failure is attached');
      return true;
    }
  );

  assert.ok(fake.releaseArgs()[0] instanceof Error, 'a rejecting ROLLBACK destroys the connection');
  fake.assertClean();
  assert.equal(errorLog.mock.callCount(), 1, 'the rollback failure is logged once');
});

test('(d) pool.connect() rejects: the rejection propagates untouched and no client is created', async () => {
  const connectError = new Error('connection refused by pooler');
  let workRan = false;
  const fakePool = { connect: async () => { throw connectError; } };

  // Only the message proves the original connect error survived: a TypeError
  // about release/query on an undefined client (the #1053 trap) would also
  // reject, so assert on the message, not merely that it rejected.
  await assert.rejects(
    withTransaction(fakePool, async () => { workRan = true; }, { label: 'test' }),
    /connection refused by pooler/,
  );
  assert.equal(workRan, false, 'work never runs when connect rejects');
});

test('(e) work throws a non-extensible value and ROLLBACK rejects: the destroy path is still taken', async (t) => {
  t.mock.method(console, 'error', () => {});
  const frozen = Object.freeze({});
  const fake = createFakePool([
    [/^SELECT/, () => { throw frozen; }, 'client'],
    [/^ROLLBACK$/, () => { throw new Error('rollback boom'); }, 'client'],
  ]);

  await assert.rejects(
    withTransaction(fake, async (client) => { await client.query('SELECT 1'); }, { label: 'test' }),
    (err) => {
      assert.equal(err, frozen, 'the original (non-extensible) value is rethrown, not the attach TypeError');
      return true;
    }
  );

  // Red-tell (criterion 1): attaching rollbackError before assigning the hoisted
  // variable throws on the frozen value (strict mode), leaves the hoisted variable
  // null, and releases bare - reddening this releaseArgs()[0] instanceof Error.
  assert.ok(fake.releaseArgs()[0] instanceof Error, 'the destroy path is taken even when the thrown value cannot carry rollbackError');
  fake.assertClean();
});
