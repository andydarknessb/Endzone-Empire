const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');

/**
 * GET /api/league/preview?code=<invite_code>: what a manager holding an
 * invite link learns about the league before joining. Exercised over
 * supertest with a fake pool; the response mirrors the Discover card's shape
 * so the client renders both with the same chips.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-preview-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const CALLER = 9;
const authed = (userId = CALLER) => `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

/**
 * Require the router fresh per app so a test that exercises the preview rate
 * limiter gets its own store (the limiter's Map is module-instance state;
 * precedent: public.router.test.js).
 */
function makeApp() {
  delete require.cache[require.resolve('../routes/league.router')];
  const app = express();
  app.use(express.json());
  app.use('/api/league', require('../routes/league.router'));
  return app;
}
const app = makeApp();

// A pick'em-only league run by alice with 3 of 12 members, mid-season; the caller is not one of them.
// seasonStatus is what the lookup reads to answer joinability; it is never shipped.
const PICKEM_ROW = {
  id: 7, name: 'Office Pick\'em', maxTeams: 12, teamCount: 3, scoringPreset: null, bestBall: false,
  pickemOnly: true, pickemEnabled: true, joinApproval: false, draftDate: null, createdAt: '2026-08-01T00:00:00.000Z',
  alreadyMember: false, myRequestStatus: null, isPublic: false, ownerUsername: 'alice', draftStatus: 'pending',
  seasonStatus: 'regular',
};
const { seasonStatus: _seasonStatus, ...PICKEM_PREVIEW } = PICKEM_ROW;

/** The pool answers the invite-code lookup with `row` (or nothing), recording the params it saw. */
function fakeDb(t, { row = PICKEM_ROW } = {}) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ text, params });
    if (/"leagues"\."invite_code" = \$\d/.test(text)) return { rows: row ? [row] : [] };
    throw new Error(`unexpected query: ${text}`);
  });
  return calls;
}

test('a valid invite code previews the league in the Discover card shape, without echoing the code', async (t) => {
  const calls = fakeDb(t);
  const res = await request(app).get('/api/league/preview?code=e402e816').set('Authorization', authed());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  // Joinability rides along (an in-season pick'em-only pool accepts teams); draftStatus
  // is kept for the client's current invite warning (expand step, see #55).
  assert.deepEqual(res.body, { ...PICKEM_PREVIEW, openSlots: true, joinable: true, joinReason: null });
  // Looked up by the code the caller sent, scoped to the caller for alreadyMember,
  // and the projection never selects the code back out.
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].text.split(' FROM "leagues"')[0], /invite_code/, 'select list must not carry the code');
  assert.ok(calls[0].params.includes('e402e816'));
  assert.ok(calls[0].params.includes(CALLER));
});

test('an unknown code is a plain 404, and a missing code a 400 without touching the database', async (t) => {
  const calls = fakeDb(t, { row: null });
  const unknown = await request(app).get('/api/league/preview?code=deadbeef').set('Authorization', authed());
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { error: 'no league with that invite code' });
  const missing = await request(app).get('/api/league/preview').set('Authorization', authed());
  assert.equal(missing.status, 400);
  assert.equal(calls.length, 1, 'only the unknown-code lookup reached the pool');
});

test('previews are rate limited per caller so invite codes cannot be enumerated cheaply', async (t) => {
  const limited = makeApp();
  fakeDb(t, { row: null });
  const statuses = [];
  for (let i = 0; i < 40; i++) {
    const res = await request(limited).get(`/api/league/preview?code=${i.toString(16).padStart(8, '0')}`).set('Authorization', authed(77));
    statuses.push(res.status);
    if (res.status === 429) {
      assert.ok(res.headers['retry-after'], 'a 429 says when to retry');
      break;
    }
  }
  assert.ok(statuses.includes(429), `expected a 429 within 40 probes, got ${statuses.join(',')}`);
  assert.ok(statuses.filter((s) => s === 404).length >= 10, 'ordinary use is not throttled');
});
