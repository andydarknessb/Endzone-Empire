const { test } = require('node:test');
const assert = require('node:assert/strict');
const { logTransaction, TRANSACTION_TYPES, ActivityError } = require('../services/activity.service');

/**
 * #1134: the server declares its transaction types in one place
 * (`TRANSACTION_TYPES`) and `logTransaction` refuses anything not on that
 * list, before writing. The client's `src/entities/activity/model/
 * activityModel.test.js` keeps a hard-coded copy of this exact list as its
 * own contract test; this file only proves the server side of the guard.
 */

function fakeClient() {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows: [] };
    },
  };
}

test('TRANSACTION_TYPES is exactly the seven known types, sorted', () => {
  assert.deepEqual(TRANSACTION_TYPES, [
    'add',
    'commissioner',
    'drop',
    'recap',
    'stat_correction',
    'trade',
    'waiver',
  ]);
});

test('logTransaction refuses an unknown type before writing anything', async () => {
  const client = fakeClient();

  // Red-tell: removing the guard from logTransaction turns exactly this case
  // red (the INSERT would "succeed" against the fake and calls.length would
  // become 1) while every case in the next test stays green either way.
  await assert.rejects(
    logTransaction(client, { leagueId: 1, type: 'nonsense', detail: {} }),
    (error) => {
      assert.ok(error instanceof ActivityError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'UNKNOWN_TRANSACTION_TYPE');
      return true;
    }
  );
  assert.equal(client.calls.length, 0, 'no query runs before the type is validated');
});

test('logTransaction writes exactly one INSERT for each of the seven known types', async () => {
  for (const type of TRANSACTION_TYPES) {
    const client = fakeClient();
    await logTransaction(client, { leagueId: 1, teamId: 2, type, detail: { note: type } });
    assert.equal(client.calls.length, 1, `${type} writes exactly one query`);
    assert.match(client.calls[0].text, /INSERT INTO "transactions"/);
    assert.deepEqual(client.calls[0].params, [1, 2, type, JSON.stringify({ note: type })]);
  }
});
