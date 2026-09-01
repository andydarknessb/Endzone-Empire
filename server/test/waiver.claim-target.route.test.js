const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const waivers = require('../services/waiver.service');
const waiverRouter = require('../routes/waivers.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'waiver-claim-target-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use('/api/waivers', waiverRouter);

test('GET claim-target returns the server-approved blanket-waiver player', async (t) => {
  const original = waivers.claimTarget;
  const calls = [];
  waivers.claimTarget = async (args) => {
    calls.push(args);
    return { id: 8, name: 'Blanket Waiver Player', position: 'WR', nfl_team: 'DAL' };
  };
  t.after(() => {
    if (original === undefined) delete waivers.claimTarget;
    else waivers.claimTarget = original;
  });

  const token = signToken({ id: 7, username: 'member' });
  const response = await request(app)
    .get('/api/waivers/claim-target?leagueId=1&playerId=8')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.player, {
    id: 8,
    name: 'Blanket Waiver Player',
    position: 'WR',
    nfl_team: 'DAL',
  });
  assert.deepEqual(calls, [{ leagueId: 1, userId: 7, playerId: 8 }]);
});
