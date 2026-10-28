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

test('sendPushToUsers gives every send a 10 s timeout so a hung endpoint cannot hold the tick', async (t) => {
  const { delivered } = deliveryWorld(t);
  const webPush = require('web-push');

  await push.sendPushToUsers([1], payload);

  assert.equal(delivered.length, 1);
  assert.equal(webPush.sendNotification.mock.calls[0].arguments[2].timeout, 10000);
});

// --- Endpoint validation and the ten-per-user cap (#2542) --------------------

// A user's subscriptions as the fake pool holds them: `rows` is the table, so a
// test can save past the cap and see what is left. Deliverability is not modelled.
function saveWorld(t, rows = []) {
  const fake = createFakePool([
    [/^INSERT INTO "push_subscriptions"/, (text, [userId, endpoint, keys]) => {
      rows.push({ id: rows.length + 1, user_id: userId, endpoint, keys, created_at: rows.length, updated_at: rows.length });
      return { rows: [] };
    }],
    [/^DELETE FROM "push_subscriptions"/, (text, [userId, limit]) => {
      const keep = new Set(rows
        .filter((row) => row.user_id === userId)
        .sort((a, b) => b.updated_at - a.updated_at || b.id - a.id)
        .slice(0, limit));
      for (const row of rows.filter((r) => r.user_id === userId && !keep.has(r))) rows.splice(rows.indexOf(row), 1);
      return { rows: [] };
    }],
  ]).install(t);
  return { fake, rows };
}

const keys = { p256dh: 'p', auth: 'a' };
const fcm = (n) => `https://fcm.googleapis.com/wp/${n}`;

test('saveSubscription rejects http, unlisted, IP-literal, lookalike and off-spec subdomain endpoints with 400 and writes no row', async (t) => {
  const { fake } = saveWorld(t);
  const rejected = [
    'http://fcm.googleapis.com/wp/1',
    'https://push.evil.example/wp/1',
    'https://127.0.0.1/wp/1',
    'https://fcm.googleapis.com.evil.example/wp/1',
    'https://evil.fcm.googleapis.com/wp/1', // subdomains are allowed for WNS only
  ];

  for (const endpoint of rejected) {
    await assert.rejects(
      push.saveSubscription({ userId: 1, subscription: { endpoint, keys } }),
      (err) => err.statusCode === 400,
      endpoint
    );
  }
  assert.equal(fake.matching(/^INSERT INTO "push_subscriptions"/).length, 0);
});

test('saveSubscription accepts a real-shaped endpoint on each of the four push services', async (t) => {
  const { fake, rows } = saveWorld(t);
  const accepted = [
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAA',
    'https://web.push.apple.com/QGVsbG8',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ];

  for (const endpoint of accepted) await push.saveSubscription({ userId: 1, subscription: { endpoint, keys } });

  assert.deepEqual(rows.map((row) => row.endpoint), accepted);
  assert.equal(fake.matching(/^INSERT INTO "push_subscriptions"/).length, 4);
});

test('an eleventh subscription leaves ten rows and drops the oldest', async (t) => {
  const { fake, rows } = saveWorld(t);
  // Another Manager's subscription must not be touched by the prune.
  await push.saveSubscription({ userId: 2, subscription: { endpoint: fcm(99), keys } });

  for (let n = 1; n <= 11; n += 1) {
    await push.saveSubscription({ userId: 1, subscription: { endpoint: fcm(n), keys } });
  }

  const mine = rows.filter((row) => row.user_id === 1).map((row) => row.endpoint);
  assert.equal(mine.length, 10);
  assert.deepEqual(mine, Array.from({ length: 10 }, (_, i) => fcm(i + 2)));
  assert.equal(rows.filter((row) => row.user_id === 2).length, 1);
  const prunes = fake.matching(/^DELETE FROM "push_subscriptions"/).filter((call) => call.params[0] === 1);
  assert.equal(prunes.length, 11, 'every save asks for the cap');
  assert.deepEqual(prunes[0].params, [1, 10]);
  // The world above keeps the newest ten itself, so pin the statement's own
  // scoping and ordering: a wrong direction or a missing user filter would
  // delete the wrong Manager's rows and the row assertions would not notice.
  assert.match(
    prunes[0].text,
    /^DELETE FROM "push_subscriptions" WHERE "user_id" = \$1 AND "id" NOT IN \( SELECT "id" FROM "push_subscriptions" WHERE "user_id" = \$1 ORDER BY "updated_at" DESC, "id" DESC LIMIT \$2 \)$/
  );
});

test('sendPushToUsers abandons a send that never settles, logs it, and carries on to the next subscription', async (t) => {
  const { delivered } = deliveryWorld(t);
  const webPush = require('web-push');
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(args.join(' ')); });
  // The first send trickles forever (the socket idle timer never trips); the second is fine.
  webPush.sendNotification.mock.mockImplementationOnce(() => new Promise(() => {}));
  webPush.sendNotification.mock.mockImplementation(async (sub, json) => { delivered.push({ endpoint: sub.endpoint, json }); });
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const done = push.sendPushToUsers([1, 2], payload);
  while (webPush.sendNotification.mock.calls.length < 1) await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(15_000);
  const result = await done;

  assert.deepEqual(result, { sent: 1 });
  assert.equal(delivered.length, 1);
  assert.match(errors.join('\n'), /push send failed: .*timed out/);
});
