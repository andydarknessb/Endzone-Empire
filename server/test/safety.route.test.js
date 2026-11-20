/**
 * #441: the safety router serves Commissioner Hide and nothing else. The block
 * list, the content reports and the moderation-history route were deleted
 * (#2754): no screen used them, and the block list handed a member the usernames
 * of everyone in their Leagues. This file pins that the seven removed routes are
 * no longer served, and keeps the Hide contract: the reason, the commissioner and
 * admin gate, the first-hide-wins flag and the chat_messages-only scope (AC6).
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, update, select } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const safetyRouter = require('../routes/safety.router');

const previousSecret = process.env.JWT_SECRET;
const previousAdmins = process.env.PLATFORM_ADMIN_IDS;
process.env.JWT_SECRET = 'safety-route-test-secret';
process.env.PLATFORM_ADMIN_IDS = '9';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
  if (previousAdmins === undefined) delete process.env.PLATFORM_ADMIN_IDS;
  else process.env.PLATFORM_ADMIN_IDS = previousAdmins;
});

const app = express();
app.use(express.json());
app.use('/api/safety', safetyRouter);

const LEAGUE_ID = 3;
const COMMISSIONER = { id: 5, username: 'commish' };
const ADMIN = { id: 9, username: 'platform-admin' };
const OUTSIDER = { id: 7, username: 'nobody' };

const authed = (user) => `Bearer ${signToken({ id: user.id, username: user.username })}`;

function commissionerCheckFake({ isCommissioner }) {
  return [
    /^SELECT 1 FROM "leagues" WHERE "id" = \$1 AND/,
    () => ({ rows: isCommissioner ? [{ '?column?': 1 }] : [] }),
  ];
}

// ====================================================== removed routes (#2754)
// An authenticated call to a route the router no longer mounts falls through to
// the app's 404. The fake pool has no statements, so a route that still ran would
// fail the query instead of answering 404.
test('the block, report and moderation-history routes are no longer served (#2754)', async (t) => {
  createFakePool([]).install(t);
  const removed = [
    ['get', '/api/safety/blocks'],
    ['post', '/api/safety/blocks'],
    ['delete', '/api/safety/blocks/22'],
    ['post', '/api/safety/reports'],
    ['get', `/api/safety/reports/${LEAGUE_ID}`],
    ['put', '/api/safety/reports/101'],
    ['get', `/api/safety/moderations/${LEAGUE_ID}`],
  ];
  for (const [method, path] of removed) {
    const res = await request(app)[method](path).set('Authorization', authed(COMMISSIONER));
    assert.equal(res.status, 404, `${method.toUpperCase()} ${path} is no longer served`);
  }
});

// =============================================================== POST /hide
// A hidden chat_messages row as the UPDATE ... RETURNING projects it.
const hiddenRow = (over = {}) => ({
  id: 55,
  feed_seq: 9,
  created_at: '2026-09-01T00:00:00.000Z',
  user_id: 42,
  hidden_at: '2026-09-01T01:00:00.000Z',
  ...over,
});

test('POST /hide as commissioner: flags the message hidden with actor and reason', async (t) => {
  const fake = createFakePool([
    commissionerCheckFake({ isCommissioner: true }),
    [update('chat_messages'), () => ({ rows: [hiddenRow()] })],
  ]).install(t);

  const res = await request(app)
    .post('/api/safety/hide')
    .set('Authorization', authed(COMMISSIONER))
    .send({ leagueId: LEAGUE_ID, messageId: 55, reason: 'targeted harassment' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  const upd = fake.matching(/^UPDATE "chat_messages"/)[0];
  assert.ok(upd, 'the hide UPDATE ran');
  assert.match(upd.text, /"hidden_at" = now\(\)/);
  assert.match(upd.text, /"hidden_by" = \$1/);
  assert.match(upd.text, /"hidden_reason" = \$2/);
  // First hide wins: a re-hide never overwrites the recorded actor/reason.
  assert.match(upd.text, /"hidden_at" IS NULL/);
  assert.deepEqual(upd.params, [COMMISSIONER.id, 'targeted harassment', 55, LEAGUE_ID]);
});

test('POST /hide as platform admin is allowed', async (t) => {
  createFakePool([
    commissionerCheckFake({ isCommissioner: false }),
    [update('chat_messages'), () => ({ rows: [hiddenRow()] })],
  ]).install(t);

  const res = await request(app)
    .post('/api/safety/hide')
    .set('Authorization', authed(ADMIN))
    .send({ leagueId: LEAGUE_ID, messageId: 55, reason: 'targeted harassment' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('POST /hide as a non-commissioner, non-admin caller: 403, nothing hidden', async (t) => {
  const fake = createFakePool([
    commissionerCheckFake({ isCommissioner: false }),
  ]).install(t);

  const res = await request(app)
    .post('/api/safety/hide')
    .set('Authorization', authed(OUTSIDER))
    .send({ leagueId: LEAGUE_ID, messageId: 55, reason: 'targeted harassment' });

  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(fake.matching(/^UPDATE "chat_messages"/).length, 0, 'no hide ran');
});

test('POST /hide requires a reason of 10..500 chars', async (t) => {
  createFakePool([]).install(t);
  const res = await request(app)
    .post('/api/safety/hide')
    .set('Authorization', authed(COMMISSIONER))
    .send({ leagueId: LEAGUE_ID, messageId: 55, reason: 'too short' });
  assert.equal(res.status, 400, JSON.stringify(res.body));
});

test('POST /hide of a non-chat / unknown id: 404, and only chat_messages is ever touched (AC6)', async (t) => {
  // The UPDATE matches no chat_messages row (a Draft-activity id, or nothing),
  // and the existence probe finds none either. Moderation is structurally
  // unable to reach anything but chat_messages, so Draft activity can never be
  // hidden.
  const fake = createFakePool([
    commissionerCheckFake({ isCommissioner: true }),
    [update('chat_messages'), () => ({ rows: [] })],
    [select('chat_messages'), () => ({ rows: [] })],
  ]).install(t);

  const res = await request(app)
    .post('/api/safety/hide')
    .set('Authorization', authed(COMMISSIONER))
    .send({ leagueId: LEAGUE_ID, messageId: 999999, reason: 'targeted harassment' });

  assert.equal(res.status, 404, JSON.stringify(res.body));
  // Every write this route made was against chat_messages, never any other
  // store (there is no draft_activity table for it to reach, and this proves
  // the hide never widens beyond chat_messages).
  const writes = fake.calls.filter((c) => /^(UPDATE|INSERT|DELETE)/.test(c.text));
  assert.ok(writes.every((c) => /"chat_messages"/.test(c.text)), 'only chat_messages is written');
});

test('POST /hide of an already-hidden message: idempotent 200, no re-hide', async (t) => {
  createFakePool([
    commissionerCheckFake({ isCommissioner: true }),
    [update('chat_messages'), () => ({ rows: [] })],
    [select('chat_messages'), () => ({ rows: [{ hidden_at: '2026-09-01T01:00:00.000Z' }] })],
  ]).install(t);

  const res = await request(app)
    .post('/api/safety/hide')
    .set('Authorization', authed(COMMISSIONER))
    .send({ leagueId: LEAGUE_ID, messageId: 55, reason: 'targeted harassment' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.alreadyHidden, true);
});
