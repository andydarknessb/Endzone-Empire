const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const { parseCookieHeader } = require('../modules/refreshCookie');
const { handleUnhandledError } = require('../modules/errorHandler');
const authRouter = require('../routes/auth.router');
const teamRouter = require('../routes/team.router');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'bad-input-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const bearer = () => `Bearer ${signToken({ id: 42, username: 'alice' })}`;
const refuseDb = (t) => t.mock.method(pool, 'query', async () => {
  throw new Error('the database must not be reached for a refused input');
});

function sqlError(code, message) {
  return Object.assign(new Error(message), { code });
}

function answerGlobalError(err) {
  const res = {
    statusCode: null,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  handleUnhandledError(err, { id: 'req-bad-input' }, res, () => {
    throw new Error('the global handler must answer, not pass the error on');
  });
  return res;
}

test('an out-of-range id (SQLSTATE 22003) reaching the global handler answers 400', () => {
  const res = answerGlobalError(sqlError('22003', 'value "99999999999999999999" is out of range for type integer'));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Invalid input');
  assert.equal(res.body.requestId, 'req-bad-input');
});

test('a non-integer id (SQLSTATE 22P02) reaching the global handler answers 400', () => {
  const res = answerGlobalError(sqlError('22P02', 'invalid input syntax for type integer: "abc"'));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, 'Invalid input');
});

test('an unrelated error still answers 500 without its detail', () => {
  const res = answerGlobalError(new Error('connection to db.internal refused'));
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, 'Internal server error');
});

// Without the fix the route's async handler throws before its try, and nothing
// answers; the timeout turns that hang into a failure.
test('a Cookie header with a bad percent sequence is ignored, so an optional refresh answers 204', { timeout: 10000 }, async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  const response = await request(app)
    .post('/api/auth/refresh?optional=1')
    .set('Cookie', 'endzone_refresh=%E0%A4%A');
  assert.equal(response.status, 204);
});

test('parseCookieHeader drops the malformed pair and keeps the rest', () => {
  assert.deepEqual(parseCookieHeader('theme=dark; endzone_refresh=%E0%A4%A'), { theme: 'dark' });
});

test('PUT /api/team/:id refuses a blank or 121-character rename with 400 before any SQL', async (t) => {
  refuseDb(t);
  const app = express();
  app.use(express.json());
  app.use('/api/team', teamRouter);
  for (const name of ['   ', 'x'.repeat(121)]) {
    const response = await request(app)
      .put('/api/team/5')
      .set('Authorization', bearer())
      .send({ name });
    assert.equal(response.status, 400, `name of length ${name.length}`);
  }
});

test('POST /api/league refuses a blank or 121-character League name with 400 before any SQL', async (t) => {
  refuseDb(t);
  const app = express();
  app.use(express.json());
  app.use('/api/league', leagueRouter);
  const blank = await request(app)
    .post('/api/league')
    .set('Authorization', bearer())
    .send({ name: '   ', teamName: 'Eve Picks' });
  assert.equal(blank.status, 400);
  assert.equal(blank.body.error, 'League name is required');
  const long = await request(app)
    .post('/api/league')
    .set('Authorization', bearer())
    .send({ name: 'x'.repeat(121), teamName: 'Eve Picks' });
  assert.equal(long.status, 400);
  assert.equal(long.body.error, 'League name must be 120 characters or fewer');
});

// A real PNG, so the only reason for the 400 is the extra field: without the
// field limit this upload would reach the avatar service and its SQL (refused here).
test('POST /api/team/:id/avatar refuses an extra text field with 400', async (t) => {
  refuseDb(t);
  const app = express();
  app.use(express.json());
  app.use('/api/team', teamRouter);
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 5, g: 5, b: 200 } } })
    .png()
    .toBuffer();
  const response = await request(app)
    .post('/api/team/5/avatar')
    .set('Authorization', bearer())
    .field('note', 'extra text field')
    .attach('avatar', png, { filename: 'a.png', contentType: 'image/png' });
  assert.equal(response.status, 400);
});
