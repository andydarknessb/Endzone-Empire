const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const push = require('../services/push.service');

const payload = { title: 'T', body: 'B', url: '/#/x' };

// --- Banter on delivery (#2125) ---------------------------------------------

// Two users each hold one subscription; `banterOff` have banter: false stored.
// web-push is stood in for, and every delivered JSON string is captured.
function deliveryWorld(t, { banterOff = [], noSubs = false, prefsError = null } = {}) {
  const webPush = require('web-push');
  const delivered = [];
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  t.after(() => { delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY; });
  t.mock.method(webPush, 'setVapidDetails', () => {});
  t.mock.method(webPush, 'sendNotification', async (sub, json) => { delivered.push({ endpoint: sub.endpoint, json }); });
  const fake = createFakePool([
    [/^SELECT "id", "user_id", "endpoint", "keys" FROM "push_subscriptions"/, (text, [ids]) => ({
      rows: noSubs ? [] : ids.map((user_id) => ({ id: user_id * 10, user_id, endpoint: `https://push.test/${user_id}`, keys: {} })),
    })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => {
      if (prefsError) throw prefsError;
      return { rows: banterOff.map((user_id) => ({ user_id, prefs: { banter: false } })) };
    }],
    [/^DELETE FROM "push_subscriptions" WHERE "id"/, () => ({ rows: [] })],
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

test('sendPushToUsers sends the plain body to every subscription when the banter prefs lookup throws', async (t) => {
  const { delivered } = deliveryWorld(t, { prefsError: new Error('pool timeout') });
  t.mock.method(console, 'error', () => {});

  const result = await push.sendPushToUsers([1, 2], { ...payload, banter: 'Kickers.' });

  assert.deepEqual(result, { sent: 2 });
  assert.equal(delivered.length, 2);
  for (const d of delivered) {
    assert.deepEqual(JSON.parse(d.json), payload);
    assert.equal('banter' in JSON.parse(d.json), false);
  }
  assert.equal(console.error.mock.calls[0].arguments[0], 'banter prefs lookup failed, sending plain:');
  assert.equal(console.error.mock.calls[0].arguments[1], 'pool timeout');
});

test('sendPushToUsers with banter but no subscriptions makes no prefs query', async (t) => {
  const { fake, delivered } = deliveryWorld(t, { noSubs: true });

  const result = await push.sendPushToUsers([1, 2], { ...payload, banter: 'Kickers.' });

  assert.deepEqual(result, { sent: 0 });
  assert.equal(fake.matching(/notification_prefs/).length, 0);
  assert.equal(delivered.length, 0);
});

test('sendPushToUsers deletes a 410 subscription by id when the payload carries banter', async (t) => {
  const { fake } = deliveryWorld(t);
  const webPush = require('web-push');
  webPush.sendNotification.mock.mockImplementation(async (sub) => {
    if (sub.endpoint === 'https://push.test/2') throw Object.assign(new Error('gone'), { statusCode: 410 });
  });

  const result = await push.sendPushToUsers([1, 2], { ...payload, banter: 'Kickers.' });

  assert.deepEqual(result, { sent: 1 });
  const deletes = fake.matching(/^DELETE FROM "push_subscriptions" WHERE "id"/);
  assert.equal(deletes.length, 1);
  assert.deepEqual(deletes[0].params, [20]);
});

test('sendPushToUsers without banter makes no prefs query and sends the payload as given', async (t) => {
  const { fake, delivered } = deliveryWorld(t);

  await push.sendPushToUsers([1, 2], payload);
  await push.sendPushToUsers([1], { ...payload, banter: '' });

  assert.equal(fake.matching(/notification_prefs/).length, 0);
  assert.equal(delivered.length, 3);
  for (const d of delivered) assert.deepEqual(JSON.parse(d.json), payload);
});
