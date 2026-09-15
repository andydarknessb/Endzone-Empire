const test = require('node:test');
const assert = require('node:assert/strict');
const { lockTwoKeyXact } = require('../modules/advisoryLock');

/**
 * lockTwoKeyXact is a thin two-key pg_advisory_xact_lock wrapper for a caller
 * that already owns its own transaction (unlike withAdvisoryLock, which owns
 * one itself) - added for trophy.service.js's weekly high score reconcile
 * (#1411), routed through this module rather than a raw query at the call
 * site because ADR 0036/#1206's check:hand-rolled-sync-run guard confines
 * every pg_advisory_xact_lock call to a short, documented allowlist of files.
 * It has no lock-acquisition behavior of its own to verify (that's Postgres'),
 * so these tests just pin the one contract callers rely on: it issues the
 * blocking two-key lock query on the CALLER's client, with the given keys, in
 * order, and neither swallows nor reshapes a failure.
 */
function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return handler ? handler(text, params) : { rows: [] };
    },
  };
}

test('lockTwoKeyXact issues a blocking two-key advisory lock query on the given client, with the given keys in order', async () => {
  const client = fakeClient();
  await lockTwoKeyXact(client, 7, 202605);

  assert.equal(client.calls.length, 1, 'exactly one query, on the caller\'s own client - never the ambient pool');
  assert.equal(client.calls[0].text, 'SELECT pg_advisory_xact_lock($1, $2)');
  assert.deepEqual(client.calls[0].params, [7, 202605]);
});

test('lockTwoKeyXact propagates a rejected lock query, never swallows it', async () => {
  const client = fakeClient(() => { throw new Error('lock query failed'); });
  await assert.rejects(lockTwoKeyXact(client, 1, 2), /lock query failed/);
});
