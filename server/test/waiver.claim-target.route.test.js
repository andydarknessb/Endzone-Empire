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

// --- GET /api/waivers myClaims carries the Winning bid (#1611, ADR 0049) -----
// The fake pool answers what the route asks; the assertions are on what it
// asks (whose claims, which columns) and on what it hands back.
const { createFakePool, select } = require('./helpers/fakePool');

test('GET /api/waivers: myClaims carry the winning team and Winning bid, and only the caller\'s own claims are read', async (t) => {
  const lostClaim = {
    id: 1, team_id: 31, player_id: 500, bid: 9, status: 'lost',
    winning_team_id: 32, winning_team_name: 'Rivals', winning_bid: 23, player_name: 'T. Spears',
  };
  const fake = createFakePool([
    [/^SELECT \* FROM "teams" WHERE "league_id"/, () => ({ rows: [{ id: 31, league_id: 1, owner_id: 7 }] })],
    [select('leagues'), () => ({ rows: [{ waiver_type: 'faab' }] })],
    [select('waiver_players'), () => ({ rows: [] })],
    [select('waiver_claims'), () => ({ rows: [lostClaim] })],
  ]).install(t);

  const token = signToken({ id: 7, username: 'member' });
  const response = await request(app)
    .get('/api/waivers?leagueId=1')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.myClaims[0].winning_team_name, 'Rivals');
  assert.equal(response.body.myClaims[0].winning_bid, 23);

  const claimsQuery = fake.matching(select('waiver_claims'))[0];
  assert.match(claimsQuery.text, /"winning_team_name"/, 'the winning team is named by the route');
  assert.match(claimsQuery.text, /"waiver_claims"\.\*/, 'the Winning bid rides on the claim row');
  assert.match(claimsQuery.text, /"winner"\."id" = "waiver_claims"\."winning_team_id"/, 'the name comes from the winning team');
  assert.match(claimsQuery.text, /WHERE "waiver_claims"\."team_id" = \$1/, 'only the caller\'s team\'s claims');
  assert.deepEqual(claimsQuery.params, [31], 'no other team is ever queried, so no other losing bid is returned');
});
