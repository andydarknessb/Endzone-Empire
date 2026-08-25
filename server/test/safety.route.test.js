/**
 * #378: GET /api/safety/reports/:leagueId (the commissioner/platform-admin
 * content-report list) selected `content_reports.*` plus a JOIN onto
 * `users` for `reporter_username`, so a league commissioner could learn
 * which member filed a report. Maintainer ruling (2026-08-25): a
 * commissioner may not see reporter or resolver identity, no moderation
 * exception. This pins the EXACT key set of a served report row, in the
 * style of the `league_history` (#342) and `scoring standings` (#373) route
 * guards: a report row is seeded still carrying `reporter_id`,
 * `resolved_by` and `reporter_username`, and the test fails if the handler
 * spreads the raw row instead of picking the allowlisted fields.
 *
 * GET /api/safety/blocks is ruled intentional as-is (#378): it is the
 * caller's own block list, keyed on the id the block/unblock routes take.
 * It gets a shape pin here too, so the contract stays deliberate.
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
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

const REPORT_ALLOWED_KEYS = [
  'id',
  'league_id',
  'message_id',
  'reason',
  'status',
  'resolved_at',
  'created_at',
  'updated_at',
].sort();

// A `content_reports` row still carrying the leaked identity columns, as if
// a regression re-added `.*` and the `users` JOIN. Seeding them (rather than
// omitting them) is what makes the test non-vacuous: it fails if the handler
// spreads the raw row into the response instead of picking the allowlist.
const leakyReportRow = (over = {}) => ({
  id: 101,
  league_id: LEAGUE_ID,
  message_id: 55,
  reason: 'spam content',
  status: 'open',
  resolved_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  reporter_id: 42,
  resolved_by: null,
  reporter_username: 'sneaky-reporter',
  ...over,
});

function commissionerCheckFake({ isCommissioner }) {
  return [
    /^SELECT 1 FROM "leagues" WHERE "id" = \$1 AND/,
    () => ({ rows: isCommissioner ? [{ '?column?': 1 }] : [] }),
  ];
}

function reportsListFake(t, { isCommissioner }) {
  return createFakePool([
    commissionerCheckFake({ isCommissioner }),
    [/^SELECT .* FROM "content_reports"/, () => ({ rows: [leakyReportRow()] })],
  ]).install(t);
}

test('GET /reports/:leagueId as commissioner: served row carries only the allowlisted keys', async (t) => {
  const fake = reportsListFake(t, { isCommissioner: true });

  const res = await request(app)
    .get(`/api/safety/reports/${LEAGUE_ID}`)
    .set('Authorization', authed(COMMISSIONER));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 1);
  const [row] = res.body;
  assert.deepEqual(Object.keys(row).sort(), REPORT_ALLOWED_KEYS);
  assert.equal('reporter_id' in row, false, 'reporter identity is gone (#378)');
  assert.equal('resolved_by' in row, false, 'resolver identity is gone (#378)');
  assert.equal('reporter_username' in row, false, 'reporter username is gone (#378)');

  // Guard the SQL projection itself, not just the JS-side pick: the fake
  // pool returns the same seeded row regardless of the query text, so
  // without this the test would stay green even if `content_reports.*`
  // and the `users` JOIN came back.
  const [reportQuery] = fake.matching(/FROM "content_reports"/);
  assert.ok(reportQuery, 'the report-list query ran');
  assert.doesNotMatch(reportQuery.text, /content_reports"\.\*|SELECT \*/, 'no `.*` projection (#378)');
  assert.doesNotMatch(reportQuery.text, /JOIN "users"/, 'no users JOIN (#378)');
  assert.match(
    reportQuery.text,
    /^SELECT "id", "league_id", "message_id", "reason", "status", "resolved_at", "created_at", "updated_at" FROM "content_reports"/
  );
});

test('GET /reports/:leagueId as platform admin: same allowlist, no distinction for admins', async (t) => {
  reportsListFake(t, { isCommissioner: false });

  const res = await request(app)
    .get(`/api/safety/reports/${LEAGUE_ID}`)
    .set('Authorization', authed(ADMIN));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 1);
  const [row] = res.body;
  assert.deepEqual(Object.keys(row).sort(), REPORT_ALLOWED_KEYS);
  assert.equal('reporter_id' in row, false);
  assert.equal('resolved_by' in row, false);
  assert.equal('reporter_username' in row, false);
});

test('GET /reports/:leagueId as a non-commissioner, non-admin caller: 403', async (t) => {
  reportsListFake(t, { isCommissioner: false });

  const res = await request(app)
    .get(`/api/safety/reports/${LEAGUE_ID}`)
    .set('Authorization', authed(OUTSIDER));

  assert.equal(res.status, 403, JSON.stringify(res.body));
});

test('GET /blocks: served row carries exactly id, username, created_at for the caller', async (t) => {
  createFakePool([
    [
      /^SELECT "users"\."id", "users"\."username", "user_blocks"\."created_at" FROM "user_blocks"/,
      () => ({ rows: [{ id: 22, username: 'blocked-user', created_at: '2026-08-01T00:00:00.000Z' }] }),
    ],
  ]).install(t);

  const res = await request(app)
    .get('/api/safety/blocks')
    .set('Authorization', authed(COMMISSIONER));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 1);
  assert.deepEqual(Object.keys(res.body[0]).sort(), ['created_at', 'id', 'username'].sort());
});
