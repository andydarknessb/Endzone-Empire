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
    // #274, and this entry is the point of the change rather than a detail.
    //
    // Before it, every write on every refusal path in this file landed on the
    // `unexpected query` throw below, and each refusal test passed because of
    // that throw. That is not an assertion. It PASSES TODAY while reporting a
    // fixture-completeness error rather than the safety property, and it would
    // EVAPORATE SILENTLY the first time someone registered one of these
    // statements for an unrelated convenience - with no test turning red at
    // the moment the protection disappeared.
    //
    // Answering every write permissively, last, removes that crutch for the
    // WRITE verbs, so assertNoWrites() below is a real assertion rather than a
    // decoration.
    //
    // Scoped honestly, because overclaiming here would be the same sin: this
    // entry does not register the READS that sit between a gate and its first
    // write, and several services have some. Fully load-bearing today are
    // PUT /queue and the dropPlayer locked-team case, where nothing
    // unregistered sits in between. At submitClaim, undoDrop and
    // waiverSuggestions a moved gate still dies on an unregistered SELECT
    // first, so those keep partial incidental protection and their counts are
    // a floor rather than the whole proof. Registering those reads is the
    // follow-up; it is per-service fixture work, not one line.
    //
    // On the migration rule in helpers/fakePool.js: adding this line is
    // touching a hand-rolled fake, so the rule fires and this is a deliberate
    // deviation from it rather than an oversight. Migrating would not be a
    // like-for-like swap - this fake dispatches pool.query and a checked-out
    // client through ONE function with no transaction state, while the helper
    // enforces transactions and would start throwing on the BEGIN/COMMIT
    // sequences all fourteen tests here rely on. That is a behaviour change to
    // a suite this ticket is only meant to add assertions to. The one fake in
    // this series that DID get migrated (commissionerAvatar.route.test.js) had
    // no call log at all, so there was nothing to count without migrating.
    [/^(INSERT INTO|UPDATE|DELETE FROM) /, () => ({ rows: [], rowCount: 1 })],
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

/**
 * #274: a membership refusal must prove the row site never wrote.
 *
 * Seven of the eight sites refuse INSIDE an open transaction, several of them
 * only after a league read and a lock check, so "nothing has happened yet" is
 * not a defence: a requireMember moved below the write would write, roll back,
 * and rethrow the identical 403.
 *
 * waiverSuggestions is the exception and is worth knowing about rather than
 * glossing: its requireMember runs on the POOL (decision.service.js:867),
 * before pool.connect() and BEGIN. Its write still needs proving - the
 * materializeLineup INSERT lives in a transaction it opens later - but the
 * gate itself is not inside one, so do not reason about it from the rule
 * above.
 *
 * The count is over every write verb rather than one table because these are
 * eight different services with eight different write sets, and the property
 * being asserted is the same for all of them: a refused caller changes
 * nothing.
 *
 * deepEqual against [] rather than a count of 0 on purpose: it is strictly
 * more informative than a count, since the failure NAMES the statements that
 * ran instead of only saying how many. Same reasoning as the account-deletion
 * suite's verb sweep.
 */
const writes = (calls) => calls.filter((c) => /^(INSERT INTO|UPDATE|DELETE FROM) /.test(c.text));
const assertNoWrites = (calls, label) => assert.deepEqual(
  writes(calls).map((c) => c.text),
  [],
  `${label}: a refused caller wrote nothing`
);

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
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'), 'transaction rolled back'); // complementary only
  assert.ok(!calls.some((c) => /draft_queue/.test(c.text)), 'no draft_queue statement ran');
  assertNoWrites(calls, 'PUT /queue');
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

// #274, documented exemption (no write count applies here, and asserting one
// would be WRONG): this refusal is produced BY the mutation rather than by a
// guard above it. The route issues exactly one UPDATE whose WHERE clause IS
// the membership test, and the 403 is triggered by that statement matching no
// row. The UPDATE always runs, so there is no work a guard could sink below.
//
// What the test needed instead: the override answers { rows: [] } for ANY
// params, so the 403 was manufactured by the fixture, not by the statement's
// scoping. Dropping either conjunct from the production SQL could not fail
// this test. Pin the predicate instead of the count.
test('draft router: POST /league/:id/ready refuses a non-member without the roster-shaped wording', async (t) => {
  const calls = fakeDb(t, { overrides: [[/UPDATE "teams" SET "draft_ready"/, () => ({ rows: [] })]] });
  const res = await request(routes)
    .post('/api/draft/league/3/ready').set('Authorization', authed()).send({ ready: true });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.error, `${REFUSAL}, or the draft is not pending`);
  const ready = writes(calls).filter((c) => /^UPDATE "teams" SET "draft_ready"/.test(c.text));
  assert.equal(ready.length, 1, 'the single scoped UPDATE is the refusal mechanism');
  assert.match(ready[0].text, /"owner_id" = \$3/, 'scoped to the caller, which is the membership test');
  assert.match(ready[0].text, /"draft_status" = 'pending'/, 'and to a pending draft');
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
  const nonMember = fakeDb(t);
  await rejectsAsNonMember(draft.dropPlayer({ leagueId: 3, userId: CALLER, playerId: 1 }));
  assertNoWrites(nonMember, 'dropPlayer non-member');

  const calls = fakeDb(t, { member: { ...TEAM, locked: true } });
  await assert.rejects(draft.dropPlayer({ leagueId: 3, userId: CALLER, playerId: 1 }), {
    statusCode: 409, message: 'your team is locked by the commissioner',
  });
  assert.match(teamLookups(calls)[0].text, /FOR UPDATE$/);
  // The locked-team guard sits directly above the DELETE FROM "team_players".
  assertNoWrites(calls, 'dropPlayer locked team');
});

test('draft service: undoDrop refuses a non-member with the standard 403', async (t) => {
  const draft = require('../services/draft.service');
  const calls = fakeDb(t);
  await rejectsAsNonMember(draft.undoDrop({ leagueId: 3, userId: CALLER, playerId: 1 }));
  assertNoWrites(calls, 'undoDrop');
});

// --- trade service ----------------------------------------------------------

test('trade service: proposeTrade and vetoTrade refuse a non-member with the standard 403', async (t) => {
  const trades = require('../services/trade.service');
  const calls = fakeDb(t);
  await rejectsAsNonMember(trades.proposeTrade({ leagueId: 3, userId: CALLER, receivingTeamId: 52, playerIds: [1] }));
  await rejectsAsNonMember(trades.vetoTrade({ tradeId: 77, userId: CALLER }));
  // Neither gate is in a "nothing has happened yet" position: requireMember
  // runs several statements into an open transaction, after the league read
  // and the deadline and lock checks.
  assertNoWrites(calls, 'proposeTrade / vetoTrade');
});

// --- waiver, lineup, decision services ---------------------------------------

test('waiver service: submitClaim refuses a non-member with the standard 403', async (t) => {
  const waivers = require('../services/waiver.service');
  const calls = fakeDb(t);
  await rejectsAsNonMember(waivers.submitClaim({ leagueId: 3, userId: CALLER, playerId: 1 }));
  assertNoWrites(calls, 'submitClaim');
});

test('lineup service: getLineup refuses a non-member; setLineup locks the member Team row', async (t) => {
  const lineup = require('../services/lineup.service');
  const nonMember = fakeDb(t);
  await rejectsAsNonMember(lineup.getLineup({ leagueId: 3, userId: CALLER }));
  await rejectsAsNonMember(lineup.setLineup({ leagueId: 3, userId: CALLER, moves: [{ playerId: 1, slot: 'QB' }] }));
  // getLineup's leg is read-only; setLineup's is not, and materializeLineup
  // writes lineup_entries before any slot is applied.
  assertNoWrites(nonMember, 'setLineup non-member');

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
  const calls = fakeDb(t);
  await rejectsAsNonMember(decisions.waiverSuggestions({ leagueId: 3, userId: CALLER }));
  // Easy to mistake for read-only: waiverSuggestions reads like a query but
  // calls materializeLineup inside its own BEGIN/COMMIT, so it really does
  // INSERT lineup_entries rows.
  assertNoWrites(calls, 'waiverSuggestions');
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
