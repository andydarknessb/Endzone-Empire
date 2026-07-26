const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const scoring = require('../services/scoring.service');
const nflverseSync = require('../services/nflverseSync.service');
const scoringRouter = require('../routes/scoring.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'schedule-sync-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/scoring', scoringRouter);

const authed = () => `Bearer ${signToken({ id: 7, username: 'member' })}`;

test('sync-schedule source=nflverse routes to the free games.csv backfill, never Tank01', async (t) => {
  const nflverse = t.mock.method(nflverseSync, 'syncScheduleFromNflverse', async () => ({
    season: 2026, gamesInFile: 272, rowsInserted: 48,
  }));
  const tank01 = t.mock.method(scoring, 'syncSchedule', async () => {
    throw new Error('must not spend Tank01 quota');
  });

  const res = await request(app)
    .post('/api/scoring/sync-schedule')
    .set('Authorization', authed())
    .send({ season: 2026, source: 'nflverse' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { season: 2026, gamesInFile: 272, rowsInserted: 48 });
  assert.equal(nflverse.mock.callCount(), 1);
  assert.deepEqual(nflverse.mock.calls[0].arguments[0], { season: 2026 });
  assert.equal(tank01.mock.callCount(), 0);
});

test('sync-schedule defaults to the Tank01 source', async (t) => {
  const tank01 = t.mock.method(scoring, 'syncSchedule', async () => ({
    season: 2026, gamesUpserted: 544,
  }));

  const res = await request(app)
    .post('/api/scoring/sync-schedule')
    .set('Authorization', authed())
    .send({ season: 2026 });

  assert.equal(res.status, 200);
  assert.equal(res.body.gamesUpserted, 544);
  assert.equal(tank01.mock.callCount(), 1);
});

test('sync-schedule rejects an unknown source with 400', async () => {
  const res = await request(app)
    .post('/api/scoring/sync-schedule')
    .set('Authorization', authed())
    .send({ season: 2026, source: 'espn' });
  assert.equal(res.status, 400);
});
