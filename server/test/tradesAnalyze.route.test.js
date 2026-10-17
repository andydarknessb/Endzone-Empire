const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const decision = require('../services/decision.service');
const tradesRouter = require('../routes/trades.router');
const { createFakePool, select } = require('./helpers/fakePool');

/**
 * POST /api/trades/analyze with a `tradeId` analyzes that trade's own items as
 * its own proposing and receiving teams, for any league member (wave 3,
 * ruling 6). Without it the compose/counter behaviour is unchanged: the viewer
 * is the proposer.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'trades-analyze-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/trades', tradesRouter);

const bearer = (id) => `Bearer ${signToken({ id, username: `u${id}` })}`;

// Trade 9 in league 1: team 41 (owner 7) offers player 21 for team 42's (owner 8) player 22.
// Owner 9 holds team 43, uninvolved. Owner 10 is in no team of league 1.
const TEAMS = { 7: { id: 41 }, 8: { id: 42 }, 9: { id: 43 } };
const TRADE = { id: 9, league_id: 1, proposing_team_id: 41, receiving_team_id: 42 };
// GET /api/trades shows an uninvolved member only `accepted` trades; analyze-by-id follows that rule.
const ITEMS = [
  { trade_id: 9, from_team_id: 41, to_team_id: 42, player_id: 21 },
  { trade_id: 9, from_team_id: 42, to_team_id: 41, player_id: 22 },
];

function world(t, { analyzed, status = 'pending' }) {
  createFakePool([
    [select('teams'), (text, params) => ({ rows: TEAMS[params[1]] ? [TEAMS[params[1]]] : [] })],
    [select('trades'), (text, params) => {
      const [id, leagueId, viewerTeamId] = params;
      const seen = status === 'accepted' || [TRADE.proposing_team_id, TRADE.receiving_team_id].includes(viewerTeamId);
      return { rows: id === TRADE.id && leagueId === TRADE.league_id && seen ? [{ ...TRADE, status }] : [] };
    }],
    [select('trade_items'), () => ({ rows: ITEMS })],
  ]).install(t);
  t.mock.method(decision, 'analyzeTrade', async (args) => {
    analyzed.push(args);
    return { verdict: 'fair' };
  });
}

const body = (extra) => ({
  leagueId: 1, receivingTeamId: 99, offeredPlayerIds: [1], requestedPlayerIds: [2], ...extra,
});

test('the receiving manager analyzes an incoming offer as its own two teams', async (t) => {
  const analyzed = [];
  world(t, { analyzed });
  const res = await request(app).post('/api/trades/analyze').set('Authorization', bearer(8)).send(body({ tradeId: 9 }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(analyzed, [{
    leagueId: 1, proposingTeamId: 41, receivingTeamId: 42, offeredPlayerIds: [21], requestedPlayerIds: [22],
  }]);
});

test('an uninvolved league member analyzes an accepted trade', async (t) => {
  const analyzed = [];
  world(t, { analyzed, status: 'accepted' });
  const res = await request(app).post('/api/trades/analyze').set('Authorization', bearer(9)).send(body({ tradeId: 9 }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(analyzed[0].proposingTeamId, 41);
  assert.equal(analyzed[0].receivingTeamId, 42);
});

test('an uninvolved league member cannot analyze a pending trade by id: 404, as the list does not show it', async (t) => {
  const analyzed = [];
  world(t, { analyzed });
  const res = await request(app).post('/api/trades/analyze').set('Authorization', bearer(9)).send(body({ tradeId: 9 }));
  assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(analyzed.length, 0);
});

test('a non-member is refused 403 and nothing is analyzed', async (t) => {
  const analyzed = [];
  world(t, { analyzed });
  const res = await request(app).post('/api/trades/analyze').set('Authorization', bearer(10)).send(body({ tradeId: 9 }));
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(analyzed.length, 0);
});

test('a tradeId from another league is a 404', async (t) => {
  const analyzed = [];
  world(t, { analyzed });
  const res = await request(app).post('/api/trades/analyze').set('Authorization', bearer(8)).send(body({ tradeId: 77 }));
  assert.equal(res.status, 404, JSON.stringify(res.body));
  assert.equal(analyzed.length, 0);
});

test('without a tradeId the viewer is still the proposer (compose behaviour unchanged)', async (t) => {
  const analyzed = [];
  world(t, { analyzed });
  const res = await request(app).post('/api/trades/analyze').set('Authorization', bearer(7)).send(body());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(analyzed, [{
    leagueId: 1, proposingTeamId: 41, receivingTeamId: 99, offeredPlayerIds: [1], requestedPlayerIds: [2],
  }]);
});
