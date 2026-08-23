const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');

/**
 * Membership at the Team-row-returning sites (#44): every draft, trade,
 * waiver, lineup and decision path refuses a manager without a Team in the
 * league with the one standard 403, and the paths that lock the Team row
 * keep locking. Exercised through the public seams: the routers over
 * supertest and the services' exported functions, both over a fake pool.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'membership-row-sites-test-secret';
require('node:test').after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const CALLER = 9;
const authed = () => `Bearer ${signToken({ id: CALLER, username: 'u9' })}`;
const REFUSAL = 'not a member of this league';

const LEAGUE = {
  id: 3,
  name: 'Sunday Ballers',
  owner_id: 7,
  pickem_only: false,
  league_type: 'fantasy',
  draft_status: 'complete',
  draft_type: 'live',
  transactions_locked: false,
  trade_deadline: null,
  trade_veto_votes: 1,
  current_season: 2026,
  current_week: 8,
  roster_limit: 16,
  position_caps: null,
};
const TEAM = { id: 41, league_id: 3, owner_id: CALLER, name: 'Team 9', locked: false };

/**
 * SQL-substring dispatch over the shared pool AND over checked-out clients
 * (transactions dispatch through the same table). `member` is the Team row
 * the caller holds, or null for a non-member. `overrides` win over defaults.
 */
function fakeDb(t, { member = null, overrides = [] } = {}) {
  const calls = [];
  const defaults = [
    [/^(BEGIN|COMMIT|ROLLBACK)$/, () => ({ rows: [] })],
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [/FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [LEAGUE] })],
    [/FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/, () => ({ rows: member ? [member] : [] })],
    [/FROM "trades" WHERE "id" = \$1/, () => ({
      rows: [{ id: 77, league_id: 3, status: 'accepted', proposing_team_id: 51, receiving_team_id: 52 }],
    })],
    [/FROM "trade_items"/, () => ({ rows: [] })],
    [/FROM "teams" WHERE "id" IN/, () => ({ rows: [{ id: 51 }, { id: 52 }] })],
  ];
  const handlers = [...overrides, ...defaults];
  const dispatch = async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ text, params });
    for (const [pattern, handler] of handlers) {
      if (pattern.test(text)) return handler(text, params);
    }
    throw new Error(`unexpected query: ${text}`);
  };
  t.mock.method(pool, 'query', dispatch);
  t.mock.method(pool, 'connect', async () => ({ query: dispatch, release: () => {} }));
  return calls;
}

const teamLookups = (calls) => calls.filter((c) => /FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/.test(c.text));

function routesApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/draft', require('../routes/draft.router'));
  app.use('/api/trades', require('../routes/trades.router'));
  return app;
}
const routes = routesApp();

const expectRefusal = (res, label) => {
  assert.equal(res.status, 403, `${label}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.error, REFUSAL, label);
};

const rejectsAsNonMember = (promise) => assert.rejects(promise, (error) => {
  assert.equal(error.statusCode, 403);
  assert.equal(error.message, REFUSAL);
  return true;
});

// --- draft router -----------------------------------------------------------

test('draft router: GET /queue refuses a non-member with the standard 403', async (t) => {
  fakeDb(t);
  const res = await request(routes).get('/api/draft/queue?leagueId=3').set('Authorization', authed());
  expectRefusal(res, 'GET /queue');
});

test('draft router: GET /queue admits a member and reads the queue for their Team', async (t) => {
  const calls = fakeDb(t, {
    member: TEAM,
    overrides: [[/FROM "draft_queue" JOIN "players"/, () => ({ rows: [{ id: 1, name: 'QB One', rank: 1 }] })]],
  });
  const res = await request(routes).get('/api/draft/queue?leagueId=3').set('Authorization', authed());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, [{ id: 1, name: 'QB One', rank: 1 }]);
  const queueRead = calls.find((c) => /FROM "draft_queue" JOIN "players"/.test(c.text));
  assert.deepEqual(queueRead.params, [TEAM.id], 'queue is read for the member Team');
});

test('draft router: GET /league/:id/keepers refuses a non-member with the standard 403', async (t) => {
  fakeDb(t);
  const res = await request(routes).get('/api/draft/league/3/keepers').set('Authorization', authed());
  expectRefusal(res, 'GET keepers');
});

test('draft router: PUT /queue refuses a non-member and rolls back', async (t) => {
  const calls = fakeDb(t);
  const res = await request(routes)
    .put('/api/draft/queue').set('Authorization', authed()).send({ leagueId: 3, playerIds: [1, 2] });
  expectRefusal(res, 'PUT /queue');
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'), 'transaction rolled back');
  assert.ok(!calls.some((c) => /draft_queue/.test(c.text)), 'no draft_queue statement ran');
});

test('draft router: PUT /queue locks the member Team row while rewriting the queue', async (t) => {
  const calls = fakeDb(t, {
    member: TEAM,
    overrides: [[/(DELETE FROM|INSERT INTO) "draft_queue"/, () => ({ rows: [] })]],
  });
  const res = await request(routes)
    .put('/api/draft/queue').set('Authorization', authed()).send({ leagueId: 3, playerIds: [1, 2] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.teamId, TEAM.id);
  assert.equal(teamLookups(calls).length, 1);
  assert.match(teamLookups(calls)[0].text, /FOR UPDATE$/);
});

test('draft router: POST /league/:id/ready refuses a non-member without the roster-shaped wording', async (t) => {
  fakeDb(t, { overrides: [[/UPDATE "teams" SET "draft_ready"/, () => ({ rows: [] })]] });
  const res = await request(routes)
    .post('/api/draft/league/3/ready').set('Authorization', authed()).send({ ready: true });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.error, `${REFUSAL}, or the draft is not pending`);
});

// --- trades router ----------------------------------------------------------

test('trades router: GET / and POST /analyze refuse a non-member with the standard 403', async (t) => {
  fakeDb(t);
  const list = await request(routes).get('/api/trades?leagueId=3').set('Authorization', authed());
  expectRefusal(list, 'GET /trades');
  const analyze = await request(routes)
    .post('/api/trades/analyze').set('Authorization', authed())
    .send({ leagueId: 3, receivingTeamId: 52, offeredPlayerIds: [1], requestedPlayerIds: [2] });
  expectRefusal(analyze, 'POST /trades/analyze');
});

// --- draft service ----------------------------------------------------------

test('draft service: dropPlayer refuses a non-member, and locks a member Team row before reading locked', async (t) => {
  const draft = require('../services/draft.service');
  fakeDb(t);
  await rejectsAsNonMember(draft.dropPlayer({ leagueId: 3, userId: CALLER, playerId: 1 }));

  const calls = fakeDb(t, { member: { ...TEAM, locked: true } });
  await assert.rejects(draft.dropPlayer({ leagueId: 3, userId: CALLER, playerId: 1 }), {
    statusCode: 409, message: 'your team is locked by the commissioner',
  });
  assert.match(teamLookups(calls)[0].text, /FOR UPDATE$/);
});

test('draft service: undoDrop refuses a non-member with the standard 403', async (t) => {
  const draft = require('../services/draft.service');
  fakeDb(t);
  await rejectsAsNonMember(draft.undoDrop({ leagueId: 3, userId: CALLER, playerId: 1 }));
});

// --- trade service ----------------------------------------------------------

test('trade service: proposeTrade and vetoTrade refuse a non-member with the standard 403', async (t) => {
  const trades = require('../services/trade.service');
  fakeDb(t);
  await rejectsAsNonMember(trades.proposeTrade({ leagueId: 3, userId: CALLER, receivingTeamId: 52, playerIds: [1] }));
  await rejectsAsNonMember(trades.vetoTrade({ tradeId: 77, userId: CALLER }));
});

// --- waiver, lineup, decision services ---------------------------------------

test('waiver service: submitClaim refuses a non-member with the standard 403', async (t) => {
  const waivers = require('../services/waiver.service');
  fakeDb(t);
  await rejectsAsNonMember(waivers.submitClaim({ leagueId: 3, userId: CALLER, playerId: 1 }));
});

test('lineup service: getLineup refuses a non-member; setLineup locks the member Team row', async (t) => {
  const lineup = require('../services/lineup.service');
  fakeDb(t);
  await rejectsAsNonMember(lineup.getLineup({ leagueId: 3, userId: CALLER }));
  await rejectsAsNonMember(lineup.setLineup({ leagueId: 3, userId: CALLER, moves: [{ playerId: 1, slot: 'QB' }] }));

  const calls = fakeDb(t, {
    member: TEAM,
    // Stop right after the gate: the first roster read answers with an error we can recognise.
    // #106 put a finality probe ahead of that read, so answer it "not frozen"
    // (this is a live week) and the team_players read is reached as before.
    overrides: [
      [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
      [/FROM "team_players"/, () => { throw new Error('stop after gate'); }],
    ],
  });
  await assert.rejects(
    lineup.setLineup({ leagueId: 3, userId: CALLER, moves: [{ playerId: 1, slot: 'QB' }] }),
    /stop after gate/
  );
  assert.match(teamLookups(calls)[0].text, /FOR UPDATE$/);
});

test('decision service: waiverSuggestions refuses a non-member with the standard 403', async (t) => {
  const decisions = require('../services/decision.service');
  fakeDb(t);
  await rejectsAsNonMember(decisions.waiverSuggestions({ leagueId: 3, userId: CALLER }));
});

// --- waivers router ---------------------------------------------------------

test('waivers router: GET / refuses a non-member with the standard 403 and admits a member', async (t) => {
  const app = express();
  app.use(express.json());
  app.use('/api/waivers', require('../routes/waivers.router'));
  fakeDb(t);
  expectRefusal(await request(app).get('/api/waivers?leagueId=3').set('Authorization', authed()), 'GET /waivers');

  fakeDb(t, {
    member: { ...TEAM, waiver_priority: 2, faab_remaining: 55 },
    overrides: [
      [/FROM "waiver_players"/, () => ({ rows: [] })],
      [/FROM "waiver_claims"/, () => ({ rows: [] })],
    ],
  });
  const res = await request(app).get('/api/waivers?leagueId=3').set('Authorization', authed());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.myTeam.faab_remaining, 55);
  assert.equal(res.body.myTeam.waiver_priority, 2);
});
