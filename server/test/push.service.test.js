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

test('sendPushOnce logs a delivery failure instead of throwing, and keeps the ledger row', async (t) => {
  world(t);
  t.mock.method(console, 'error', () => {});
  push.sendPushToUsers.mock.mockImplementation(async () => { throw new Error('subscriptions down'); });

  assert.deepEqual(await once(), { sent: 0, skipped: 0 });
  assert.deepEqual(await once(), { sent: 0, skipped: 1 }); // the row stayed
});

// --- Banter on delivery (#2125) ---------------------------------------------

// Two users each hold one subscription; `banterOff` have banter: false stored.
// web-push is stood in for, and every delivered JSON string is captured.
function deliveryWorld(t, { banterOff = [] } = {}) {
  const webPush = require('web-push');
  const delivered = [];
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  t.after(() => { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; });
  t.mock.method(webPush, 'setVapidDetails', () => {});
  t.mock.method(webPush, 'sendNotification', async (sub, json) => { delivered.push({ endpoint: sub.endpoint, json }); });
  const fake = createFakePool([
    [/^SELECT "id", "user_id", "endpoint", "keys" FROM "push_subscriptions"/, (text, [ids]) => ({
      rows: ids.map((user_id) => ({ id: user_id * 10, user_id, endpoint: `https://push.test/${user_id}`, keys: {} })),
    })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({
      rows: banterOff.map((user_id) => ({ user_id, prefs: { banter: false } })),
    })],
  ]).install(t);
  return { fake, delivered };
}

test('sendPushToUsers appends banter as a second body line for users with banter on, never in the JSON', async (t) => {
  const { fake, delivered } = deliveryWorld(t, { banterOff: [2] });

  const result = await push.sendPushToUsers([1, 2], { ...payload, banter: 'Kickers.' });

  assert.deepEqual(result, { sent: 2 });
  const bodies = Object.fromEntries(delivered.map((d) => [d.endpoint, JSON.parse(d.json)]));
  assert.equal(bodies['https://push.test/1'].body, 'B\nKickers.');
  assert.equal(bodies['https://push.test/2'].body, 'B');
  for (const d of delivered) {
    assert.equal('banter' in JSON.parse(d.json), false);
    assert.equal(JSON.parse(d.json).title, 'T');
    assert.equal(JSON.parse(d.json).url, '/#/x');
  }
  assert.equal(fake.matching(/notification_prefs/).length, 1, 'one prefs lookup per call');
});

test('sendPushToUsers without banter makes no prefs query and sends the payload as given', async (t) => {
  const { fake, delivered } = deliveryWorld(t);

  await push.sendPushToUsers([1, 2], payload);
  await push.sendPushToUsers([1], { ...payload, banter: '' });

  assert.equal(fake.matching(/notification_prefs/).length, 0);
  assert.equal(delivered.length, 3);
  for (const d of delivered) assert.deepEqual(JSON.parse(d.json), payload);
});
