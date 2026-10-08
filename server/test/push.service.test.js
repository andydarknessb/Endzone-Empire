const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert } = require('./helpers/fakePool');
const push = require('../services/push.service');

const payload = { title: 'T', body: 'B', url: '/#/x' };
const SENT_TO = [];

// A fake pool whose push_events insert models the unique index, and whose
// notification_prefs rows say which users have `lineupReminder` off.
function world(t, { optedOut = [] } = {}) {
  const ledger = new Set();
  const fake = createFakePool([
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({
      rows: optedOut.map((user_id) => ({ user_id, prefs: { lineupReminder: false } })),
    })],
    [insert('push_events'), (text, [userIds, ...key]) => ({
      rows: userIds
        .filter((id) => !ledger.has([id, ...key].join('|')) && ledger.add([id, ...key].join('|')))
        .map((user_id) => ({ user_id })),
    })],
  ]).install(t);
  SENT_TO.length = 0;
  t.mock.method(push, 'sendPushToUsers', async (userIds) => {
    SENT_TO.push(...userIds);
    return { sent: userIds.length };
  });
  return fake;
}

const once = (fingerprint = 'sent', userIds = [1]) => push.sendPushOnce({
  userIds, prefKey: 'lineupReminder', kind: 'lineup-reminder', subject: '7:2026:9', fingerprint, payload,
});

test('sendPushOnce sends exactly once for the same (user, kind, subject, fingerprint)', async (t) => {
  world(t);

  assert.deepEqual(await once(), { sent: 1, skipped: 0 });
  assert.deepEqual(await once(), { sent: 0, skipped: 1 });

  assert.deepEqual(SENT_TO, [1]);
});

test('sendPushOnce sends again when the fingerprint changes', async (t) => {
  world(t);

  await once('Q');
  await once('O');

  assert.deepEqual(SENT_TO, [1, 1]);
});

test('sendPushOnce does not send to a user with the pref off, and writes no ledger row for them', async (t) => {
  const fake = world(t, { optedOut: [2] });

  assert.deepEqual(await once('sent', [1, 2, 2]), { sent: 1, skipped: 1 });

  assert.deepEqual(SENT_TO, [1]);
  assert.deepEqual(fake.matching(insert('push_events'))[0].params[0], [1]);
});

test('sendPushOnce with nobody wanting it makes no ledger write and no send', async (t) => {
  const fake = world(t, { optedOut: [2] });

  assert.deepEqual(await once('sent', [2]), { sent: 0, skipped: 1 });

  assert.equal(fake.matching(insert('push_events')).length, 0);
  assert.deepEqual(SENT_TO, []);
});
