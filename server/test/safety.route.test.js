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
const { createFakePool, update, select, insert } = require('./helpers/fakePool');
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

// ============================================================ POST /reports
// The report workflow accepts a report against ANY chat message, whatever its
// content shape: the route keys on the message's id and league, never on
// whether the content is text or a structured GIF, so it accepts both without
// change (#441, AC1). Both text and a structured GIF message are chat_messages
// rows referenced by id, so this one path covers both.

test('POST /reports: a member may report a chat message by id (content-agnostic)', async (t) => {
  const fake = createFakePool([
    // The report-target check: the reporter owns a team here and the message
    // belongs to this league.
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [insert('content_reports'), () => ({ rows: [{ id: 200, status: 'open', created_at: '2026-09-01T00:00:00.000Z' }] })],
  ]).install(t);

  const res = await request(app)
    .post('/api/safety/reports')
    .set('Authorization', authed(OUTSIDER))
    .send({ leagueId: LEAGUE_ID, messageId: 55, reason: 'this is abusive content' });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.status, 'open');
  // The route never inspected the message's content shape - it matched on id.
  const insertCall = fake.matching(/INSERT INTO "content_reports"/)[0];
  assert.ok(insertCall);
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

// ==================================================== GET /moderations/:id
// A history row as the SELECT projects it, still carrying columns a regression
// might leak (the actor's account id and Team identity, the author's user_id),
// so the served-key assertion is non-vacuous.
const MODERATION_ALLOWED_KEYS = [
  'id',
  'originalMessage',
  'reason',
  'hiddenAt',
  'createdAt',
  'authorTeamId',
  'authorTeamName',
].sort();

const leakyModerationRow = (over = {}) => ({
  id: 55,
  originalMessage: 'you are worthless',
  reason: 'targeted harassment',
  hiddenAt: '2026-09-01T01:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  authorTeamId: 12,
  authorTeamName: 'Sunday Scaries',
  // Columns a careless projection could leak:
  hidden_by: 5,
  moderatorTeamId: 7,
  moderatorTeamName: 'Commish Crew',
  user_id: 42,
  ...over,
});

test('GET /moderations as commissioner: original content + reason + timestamp, actor NOT served', async (t) => {
  const fake = createFakePool([
    commissionerCheckFake({ isCommissioner: true }),
    [select('chat_messages'), () => ({ rows: [leakyModerationRow()] })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/safety/moderations/${LEAGUE_ID}`)
    .set('Authorization', authed(COMMISSIONER));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 1);
  const [row] = res.body;
  // AC4: the original content, reason and timestamp are preserved for the
  // reviewer.
  assert.equal(row.originalMessage, 'you are worthless');
  assert.equal(row.reason, 'targeted harassment');
  assert.equal(row.hiddenAt, '2026-09-01T01:00:00.000Z');
  assert.deepEqual(Object.keys(row).sort(), MODERATION_ALLOWED_KEYS);
  // ACTOR EXPOSURE PENDING CORY'S RULING (#441/#378): the moderator is STORED
  // (hidden_by) but NOT served today. Flip these to the positive form if the
  // ruling exposes the actor.
  assert.equal('moderatorTeamId' in row, false, 'moderator identity not served (pending ruling)');
  assert.equal('moderatorTeamName' in row, false);
  assert.equal('hidden_by' in row, false);
  assert.equal('user_id' in row, false, 'raw author account id never served');

  // Guard the SQL projection itself, not only the JS pick: the actor is not even
  // selected, so a spread cannot reintroduce it.
  const [historyQuery] = fake.matching(/FROM "chat_messages"/);
  assert.ok(historyQuery);
  assert.doesNotMatch(historyQuery.text, /hidden_by/, 'actor account id not projected');
  assert.doesNotMatch(historyQuery.text, /"moderator"/, 'actor Team not projected');
  assert.match(historyQuery.text, /"cm"\."hidden_at" IS NOT NULL/);
});

test('GET /moderations preserves structured (GIF-shaped) content opaquely (#441 AC1)', async (t) => {
  // A structured GIF message is stored as its own content shape; the history
  // must preserve it byte-for-byte, making no text-only assumption. GIF messages
  // themselves land in #446 (blocked behind this issue); moderation is built to
  // handle their content shape in advance.
  const structured = JSON.stringify({ kind: 'gif', assetId: 'abc123', description: 'a spinning football' });
  createFakePool([
    commissionerCheckFake({ isCommissioner: true }),
    [select('chat_messages'), () => ({ rows: [leakyModerationRow({ originalMessage: structured })] })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/safety/moderations/${LEAGUE_ID}`)
    .set('Authorization', authed(COMMISSIONER));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body[0].originalMessage, structured, 'structured content preserved unchanged');
});

test('GET /moderations reads a departed author back as null Team identity, no crash', async (t) => {
  createFakePool([
    commissionerCheckFake({ isCommissioner: true }),
    [select('chat_messages'), () => ({ rows: [leakyModerationRow({ authorTeamId: null, authorTeamName: null })] })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/safety/moderations/${LEAGUE_ID}`)
    .set('Authorization', authed(COMMISSIONER));

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body[0].authorTeamId, null);
  assert.equal(res.body[0].authorTeamName, null);
});

test('GET /moderations as a non-commissioner, non-admin caller: 403', async (t) => {
  createFakePool([
    commissionerCheckFake({ isCommissioner: false }),
  ]).install(t);

  const res = await request(app)
    .get(`/api/safety/moderations/${LEAGUE_ID}`)
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
