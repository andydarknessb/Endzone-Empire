const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const {
  isPickemOnly,
  assertFantasyLeague,
  requireFantasyLeague,
} = require('../services/leagueType');

const PICKEM_MESSAGE = "this is a pick'em league; it has no draft, rosters, or matchups";

/* ------------------------------------------------------------------ *
 * isPickemOnly (pure)                                                 *
 * ------------------------------------------------------------------ */

test('isPickemOnly reads the leagues.pickem_only flag and nothing else', () => {
  assert.equal(isPickemOnly({ pickem_only: true }), true);
  assert.equal(isPickemOnly({ pickem_only: false }), false);
  assert.equal(isPickemOnly({ id: 3, name: 'Ballers' }), false);
  assert.equal(isPickemOnly(null), false);
  assert.equal(isPickemOnly(undefined), false);
});

/* ------------------------------------------------------------------ *
 * assertFantasyLeague (db-backed)                                     *
 * ------------------------------------------------------------------ */

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ text: String(sql).replace(/\s+/g, ' ').trim(), params });
      return { rows };
    },
  };
}

test("assertFantasyLeague throws 409 PICKEM_ONLY_LEAGUE for a pick'em-only league", async () => {
  const db = fakeDb([{ pickem_only: true }]);
  await assert.rejects(
    () => assertFantasyLeague(db, 7),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'PICKEM_ONLY_LEAGUE');
      assert.equal(error.message, PICKEM_MESSAGE);
      return true;
    }
  );
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /SELECT "pickem_only" FROM "leagues" WHERE "id" = \$1/);
  assert.deepEqual(db.calls[0].params, [7]);
});

test('assertFantasyLeague passes a fantasy league through', async () => {
  const db = fakeDb([{ pickem_only: false }]);
  await assertFantasyLeague(db, 7);
});

test('assertFantasyLeague leaves not-found to the caller (no row means no throw)', async () => {
  const db = fakeDb([]);
  await assertFantasyLeague(db, 7);
});

/* ------------------------------------------------------------------ *
 * requireFantasyLeague (Express middleware, mounted like the routers) *
 * ------------------------------------------------------------------ */

function appWith(middleware, { mount = '/league/:id', route = '/league/:id/thing' } = {}) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.use(mount, middleware);
  router.all(route, (req, res) => res.json({ reached: true, method: req.method }));
  app.use('/api/x', router);
  return app;
}

function mockLeagueLookup(t, rows) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    calls.push({ text: String(sql).replace(/\s+/g, ' ').trim(), params });
    return { rows };
  });
  return calls;
}

test("requireFantasyLeague 409s a write to a pick'em-only league and never reaches the route", async (t) => {
  const calls = mockLeagueLookup(t, [{ pickem_only: true }]);
  const app = appWith(requireFantasyLeague());
  const res = await request(app).post('/api/x/league/3/thing').send({});
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: PICKEM_MESSAGE, code: 'PICKEM_ONLY_LEAGUE' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [3]);
});

test('requireFantasyLeague passes a write to a fantasy league through', async (t) => {
  mockLeagueLookup(t, [{ pickem_only: false }]);
  const app = appWith(requireFantasyLeague());
  const res = await request(app).put('/api/x/league/3/thing').send({});
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { reached: true, method: 'PUT' });
});

test("requireFantasyLeague lets GETs through by default without even asking the database (writesOnly)", async (t) => {
  const calls = mockLeagueLookup(t, [{ pickem_only: true }]);
  const app = appWith(requireFantasyLeague());
  const res = await request(app).get('/api/x/league/3/thing');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { reached: true, method: 'GET' });
  assert.equal(calls.length, 0);
});

test('requireFantasyLeague({ writesOnly: false }) blocks GETs too', async (t) => {
  mockLeagueLookup(t, [{ pickem_only: true }]);
  const app = appWith(requireFantasyLeague({ writesOnly: false }));
  const res = await request(app).get('/api/x/league/3/thing');
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'PICKEM_ONLY_LEAGUE');
});

test('requireFantasyLeague({ param }) reads the named route param', async (t) => {
  const calls = mockLeagueLookup(t, [{ pickem_only: true }]);
  const app = appWith(requireFantasyLeague({ param: 'leagueId' }), {
    mount: '/league/:leagueId',
    route: '/league/:leagueId/thing',
  });
  const res = await request(app).post('/api/x/league/12/thing').send({});
  assert.equal(res.status, 409);
  assert.deepEqual(calls[0].params, [12]);
});

test('requireFantasyLeague leaves a malformed id to the route (no lookup, no verdict)', async (t) => {
  const calls = mockLeagueLookup(t, [{ pickem_only: true }]);
  const app = appWith(requireFantasyLeague());
  const res = await request(app).post('/api/x/league/abc/thing').send({});
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

test('requireFantasyLeague leaves an unknown league to the route (no row, no verdict)', async (t) => {
  mockLeagueLookup(t, []);
  const app = appWith(requireFantasyLeague());
  const res = await request(app).post('/api/x/league/3/thing').send({});
  assert.equal(res.status, 200);
});

test('requireFantasyLeague answers 500 JSON (not an HTML stack) when the lookup itself fails', async (t) => {
  t.mock.method(pool, 'query', async () => { throw new Error('connection reset'); });
  const errorLog = t.mock.method(console, 'error', () => {});
  const app = appWith(requireFantasyLeague());
  const res = await request(app).post('/api/x/league/3/thing').send({});
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'failed to check league type' });
  assert.ok(errorLog.mock.callCount() >= 1);
});

/* ------------------------------------------------------------------ *
 * Route seams: the guards as mounted in the real routers              *
 * ------------------------------------------------------------------ */

const { signToken } = require('../modules/auth');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-mode-route-test-secret';
require('node:test').after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const CALLER = 9;
const authed = (userId = CALLER) =>
  `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

function routesApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/league', require('../routes/league.router'));
  app.use('/api/draft', require('../routes/draft.router'));
  app.use('/api/scoring', require('../routes/scoring.router'));
  app.use('/api/commissioner', require('../routes/commissioner.router'));
  app.use('/api/pickem', require('../routes/pickem.router'));
  return app;
}
const routes = routesApp();

/**
 * SQL-substring dispatch over the shared pool, mirroring the harness in
 * pickem.router.test.js. `overrides` are matched before the defaults, so a
 * test can change one statement's answer without restating the rest.
 * Defaults describe a caller who is a member but NOT a commissioner.
 */
function mockPool(t, { pickemOnly, overrides = [] }) {
  const calls = [];
  const defaults = [
    [/^(BEGIN|COMMIT|ROLLBACK)$/, () => ({ rows: [] })],
    [/SELECT "pickem_only" FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [{ pickem_only: pickemOnly }] })],
    [/SELECT 1 FROM "leagues"/, () => ({ rows: [] })], // not a commissioner
    [/AS "is_commissioner" FROM "leagues"/, () => // commissioner.service's probe: not a commissioner
      ({ rows: [{ id: 3, pickem_only: pickemOnly, is_commissioner: false }] })],
    [/FROM "teams" WHERE "league_id"/, () => ({ rows: [{ id: 41, owner_id: CALLER, locked: false }] })],
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
  // Transactions dispatch through the same table so a guard that fails to
  // fire surfaces as an "unexpected query" instead of a real connection.
  t.mock.method(pool, 'connect', async () => ({ query: dispatch, release: () => {} }));
  return calls;
}

const expectPickemOnly409 = (res, label) => {
  assert.equal(res.status, 409, `${label}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.code, 'PICKEM_ONLY_LEAGUE', label);
  assert.equal(res.body.error, PICKEM_MESSAGE, label);
};

// --- scoring.router blanket mount -----------------------------------------

test("scoring: POST advance-week and POST schedule 409 for a pick'em-only league before any commissioner check", async (t) => {
  const calls = mockPool(t, { pickemOnly: true });
  for (const path of ['/api/scoring/league/3/advance-week', '/api/scoring/league/3/schedule']) {
    const res = await request(routes).post(path).set('Authorization', authed()).send({});
    expectPickemOnly409(res, path);
  }
  assert.ok(!calls.some((c) => /SELECT 1 FROM "leagues"/.test(c.text)), 'guard answered before the commissioner probe');
});

test('scoring: the same writes pass through for a fantasy league (reach the commissioner check)', async (t) => {
  mockPool(t, { pickemOnly: false });
  for (const path of ['/api/scoring/league/3/advance-week', '/api/scoring/league/3/schedule']) {
    const res = await request(routes).post(path).set('Authorization', authed()).send({});
    assert.equal(res.status, 403, path);
    assert.equal(res.body.error, 'only the commissioner can do this', path);
  }
});

test("scoring: a GET under /league/:id still answers for a pick'em-only league (writesOnly)", async (t) => {
  mockPool(t, {
    pickemOnly: true,
    overrides: [[/FROM "teams"/, () => ({ rows: [] })]],
  });
  const res = await request(routes).get('/api/scoring/league/3/standings').set('Authorization', authed());
  assert.notEqual(res.status, 409);
});

// --- draft.router blanket mount -------------------------------------------

test("draft: POST order (a write under /league/:id) 409s for a pick'em-only league", async (t) => {
  mockPool(t, { pickemOnly: true });
  const res = await request(routes)
    .post('/api/draft/league/3/order').set('Authorization', authed()).send({ randomize: true });
  expectPickemOnly409(res, 'draft order');
});

test("draft: GET keepers under /league/:id still answers for a pick'em-only league (writesOnly)", async (t) => {
  mockPool(t, {
    pickemOnly: true,
    overrides: [[/FROM "keepers"/, () => ({ rows: [] })]],
  });
  const res = await request(routes).get('/api/draft/league/3/keepers').set('Authorization', authed());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test("draft: GET /mine excludes pick'em-only leagues from Draft Central", async (t) => {
  const calls = mockPool(t, {
    pickemOnly: false,
    overrides: [[/FROM "leagues"/, () => ({ rows: [] })]],
  });
  const res = await request(routes).get('/api/draft/mine').set('Authorization', authed());
  assert.equal(res.status, 200);
  const mine = calls.find((c) => /"draft_status" IN \('active', 'pending'\)/.test(c.text));
  assert.ok(mine, 'the Draft Central query ran');
  assert.match(mine.text, /"pickem_only" = false/);
});

// --- league.router: start-draft + PUT /:id ---------------------------------

test("league: POST start-draft 409s PICKEM_ONLY_LEAGUE for a pick'em-only league without opening a transaction", async (t) => {
  const calls = mockPool(t, { pickemOnly: true });
  const res = await request(routes).post('/api/league/3/start-draft').set('Authorization', authed()).send({});
  expectPickemOnly409(res, 'start-draft');
  assert.ok(!calls.some((c) => c.text === 'BEGIN'), 'no transaction was opened');
});

test('league: POST start-draft passes through for a fantasy league (reaches startDraft)', async (t) => {
  mockPool(t, {
    pickemOnly: false,
    overrides: [[/SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () =>
      ({ rows: [{ id: 3, owner_id: 1, draft_status: 'pending', pickem_only: false }] })]],
  });
  const res = await request(routes).post('/api/league/3/start-draft').set('Authorization', authed()).send({});
  assert.equal(res.status, 403);
  assert.equal(res.body.error, 'only the commissioner can start this draft');
});

const statusRow = (over = {}) => ({
  draft_status: 'pending', draft_type: 'snake', min_teams: 2, max_teams: 10, draft_date: null,
  roster_slots: [], bench_slots: 0, ir_slots: 0, position_caps: {}, roster_limit: 15,
  keepers_enabled: false, keeper_count: 0, pickem_only: true, team_count: 3, ...over,
});
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

function putPool(t, { pickemOnly, status = {} }) {
  return mockPool(t, {
    pickemOnly,
    overrides: [
      [/SELECT "draft_status", "draft_type"/, () => ({ rows: [statusRow({ pickem_only: pickemOnly, ...status })] })],
      [/^UPDATE "leagues"/, () => ({ rows: [{ id: 3, name: 'Ballers', pickem_only: pickemOnly }], rowCount: 1 })],
      // Best-effort post-commit fan-out for a (re)scheduled draft; answered so it stays quiet.
      [/INSERT INTO "notifications"/, () => ({ rows: [] })],
    ],
  });
}

test("league: PUT with draftDate 409s naming the field for a pick'em-only league and never updates", async (t) => {
  const calls = putPool(t, { pickemOnly: true });
  const res = await request(routes).put('/api/league/3').set('Authorization', authed()).send({ draftDate: FUTURE });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'PICKEM_ONLY_LEAGUE');
  assert.equal(res.body.error, "these settings do not apply to a pick'em league: draftDate");
  assert.ok(!calls.some((c) => c.text.startsWith('UPDATE "leagues"')), 'no UPDATE ran');
});

test("league: PUT with always-editable fantasy settings (waivers/trades) is refused too for a pick'em-only league", async (t) => {
  // waiverType/tradeVetoVotes are not draft-frozen, so the status SELECT never
  // used to run for them; the guard has to force it to learn the league type.
  const calls = putPool(t, { pickemOnly: true });
  const res = await request(routes).put('/api/league/3').set('Authorization', authed())
    .send({ waiverType: 'faab', tradeVetoVotes: 4 });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'PICKEM_ONLY_LEAGUE');
  assert.equal(res.body.error, "these settings do not apply to a pick'em league: waiverType, tradeVetoVotes");
  assert.ok(!calls.some((c) => c.text.startsWith('UPDATE "leagues"')), 'no UPDATE ran');
});

test("league: PUT with a keeper setting (the transactional FOR UPDATE path) rolls back and 409s for a pick'em-only league", async (t) => {
  const calls = putPool(t, { pickemOnly: true });
  const res = await request(routes).put('/api/league/3').set('Authorization', authed()).send({ keepersEnabled: true });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'PICKEM_ONLY_LEAGUE');
  assert.equal(res.body.error, "these settings do not apply to a pick'em league: keepersEnabled");
  assert.ok(calls.some((c) => c.text === 'BEGIN'), 'the transaction opened');
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'), 'the transaction rolled back');
  assert.ok(!calls.some((c) => c.text === 'COMMIT'));
  assert.ok(!calls.some((c) => c.text.startsWith('UPDATE "leagues"')), 'no UPDATE ran');
});

test("league: PUT with a scoring preset names scoringPreset (what was sent), not the derived scoringRules", async (t) => {
  putPool(t, { pickemOnly: true });
  const res = await request(routes).put('/api/league/3').set('Authorization', authed()).send({ scoringPreset: 'ppr' });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, "these settings do not apply to a pick'em league: scoringPreset");
});

test("league: PUT with only name succeeds for a pick'em-only league", async (t) => {
  const calls = putPool(t, { pickemOnly: true });
  const res = await request(routes).put('/api/league/3').set('Authorization', authed()).send({ name: 'Renamed' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(calls.some((c) => c.text.startsWith('UPDATE "leagues"')), 'the UPDATE ran');
});

test("league: PUT with name + maxTeams succeeds for a pick'em-only league (size limits stay editable)", async (t) => {
  const calls = putPool(t, { pickemOnly: true });
  const res = await request(routes).put('/api/league/3').set('Authorization', authed())
    .send({ name: 'Renamed', maxTeams: 12 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(calls.some((c) => c.text.startsWith('UPDATE "leagues"')), 'the UPDATE ran');
});

test('league: PUT with draftDate passes through for a fantasy league', async (t) => {
  putPool(t, { pickemOnly: false });
  const res = await request(routes).put('/api/league/3').set('Authorization', authed()).send({ draftDate: FUTURE });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('league: a fantasy league can still change waiver settings after its draft has started (forced SELECT must not lock admin edits)', async (t) => {
  putPool(t, { pickemOnly: false, status: { draft_status: 'active' } });
  const res = await request(routes).put('/api/league/3').set('Authorization', authed()).send({ waiverType: 'faab' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

/* ------------------------------------------------------------------ *
 * Service seams: defense in depth behind the routes                   *
 * ------------------------------------------------------------------ */

const expectPickemOnlyError = (error) => {
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, 'PICKEM_ONLY_LEAGUE');
  assert.equal(error.message, PICKEM_MESSAGE);
  return true;
};

/** A checked-out client whose queries dispatch through a substring table. */
function txClient(handlers) {
  const calls = [];
  const client = {
    release: () => calls.push('RELEASE'),
    query: async (sql, params) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push(text);
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [] };
      for (const [pattern, handler] of handlers) {
        if (pattern.test(text)) return handler(text, params);
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  return { calls, client };
}

const PICKEM_LEAGUE_ROW = {
  id: 3, owner_id: CALLER, pickem_only: true, draft_status: 'pending', draft_type: 'snake',
  min_teams: 2, max_teams: 10, current_season: 2026, current_week: 1, best_ball: false,
  transactions_locked: false, trade_deadline_week: null, waiver_type: 'priority',
};

test("startDraft refuses a pick'em-only league under its row lock, even for the scheduler (userId null)", async (t) => {
  const { startDraft } = require('../services/draftStart.service');
  const tx = txClient([
    [/SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [PICKEM_LEAGUE_ROW] })],
  ]);
  t.mock.method(pool, 'connect', async () => tx.client);
  await assert.rejects(() => startDraft({ leagueId: 3, userId: null }), expectPickemOnlyError);
  assert.ok(tx.calls.includes('ROLLBACK'));
  assert.ok(!tx.calls.some((sql) => /^(INSERT|UPDATE)/.test(sql)), 'nothing was written');
});

test("processScheduledDrafts never scans pick'em-only leagues (a set draft_date must not open a draft room)", async (t) => {
  const { processScheduledDrafts } = require('../services/draftSchedule.service');
  const calls = mockPool(t, {
    pickemOnly: true,
    overrides: [[/FROM "leagues"/, () => ({ rows: [] })]],
  });
  await processScheduledDrafts({ now: new Date() });
  const scan = calls.find((c) => /"draft_status" = 'pending' AND "draft_date" IS NOT NULL/.test(c.text));
  assert.ok(scan, 'the auto-start scan ran');
  assert.match(scan.text, /"pickem_only" = false/);
});

// --- commissioner.router: six explicit guards, three routes deliberately open ---

const COMMISSIONER_FANTASY_WRITES = [
  ['put', '/api/commissioner/league/3/teams/41/lineup', { moves: [{ playerId: 1, slot: 'QB' }] }],
  ['put', '/api/commissioner/league/3/matchups/5', { homeScore: 10, awayScore: 20 }],
  ['put', '/api/commissioner/league/3/transactions-lock', { locked: true }],
  ['put', '/api/commissioner/league/3/teams/41/lock', { locked: true }],
  ['put', '/api/commissioner/league/3/teams/41/faab', { faabRemaining: 10 }],
  ['post', '/api/commissioner/league/3/force-transaction', { teamId: 41, action: 'drop', playerId: 1 }],
];

test("commissioner: the six fantasy mutations 409 for a pick'em-only league", async (t) => {
  mockPool(t, { pickemOnly: true });
  for (const [method, path, body] of COMMISSIONER_FANTASY_WRITES) {
    const res = await request(routes)[method](path).set('Authorization', authed()).send(body);
    expectPickemOnly409(res, `${method.toUpperCase()} ${path}`);
  }
});

test('commissioner: the same six pass through for a fantasy league (reach the service)', async (t) => {
  const calls = mockPool(t, { pickemOnly: false });
  for (const [method, path, body] of COMMISSIONER_FANTASY_WRITES) {
    const res = await request(routes)[method](path).set('Authorization', authed()).send(body);
    assert.equal(res.status, 403, `${method.toUpperCase()} ${path}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, 'only the commissioner can do this', `${method.toUpperCase()} ${path}`);
  }
  // Every one asked the league type and went on to the service (transaction opened or commissioner probed).
  assert.equal(calls.filter((c) => /SELECT "pickem_only"/.test(c.text)).length, COMMISSIONER_FANTASY_WRITES.length);
});

test("commissioner: rollover, remove member and avatar moderation stay open for a pick'em-only league", async (t) => {
  const calls = mockPool(t, { pickemOnly: true });
  const open = [
    ['post', '/api/commissioner/league/3/rollover', { keepers: [] }],
    ['delete', '/api/commissioner/league/3/teams/41', {}],
    ['delete', '/api/commissioner/league/3/teams/41/avatar', {}],
  ];
  for (const [method, path, body] of open) {
    const res = await request(routes)[method](path).set('Authorization', authed()).send(body);
    assert.notEqual(res.body.code, 'PICKEM_ONLY_LEAGUE', `${method.toUpperCase()} ${path}`);
  }
  assert.equal(calls.filter((c) => /SELECT "pickem_only"/.test(c.text)).length, 0, 'no league-type lookup for open routes');
});

// --- service one-liners: no orphaned fantasy rows ---------------------------

const LEAGUE_ROW_SQL = /SELECT \* FROM "leagues" WHERE "id" = \$1/;
const TEAM_ROW = { id: 41, league_id: 3, owner_id: CALLER, locked: false, faab_remaining: 100 };

test("submitClaim (waivers) refuses a pick'em-only league before any claim row exists", async (t) => {
  const { submitClaim } = require('../services/waiver.service');
  const tx = txClient([[LEAGUE_ROW_SQL, () => ({ rows: [PICKEM_LEAGUE_ROW] })]]);
  t.mock.method(pool, 'connect', async () => tx.client);
  await assert.rejects(
    () => submitClaim({ leagueId: 3, userId: CALLER, playerId: 1, dropPlayerId: null, bid: 0 }),
    expectPickemOnlyError
  );
  assert.ok(!tx.calls.some((sql) => /^INSERT/.test(sql)), 'nothing was written');
});

test("proposeTrade refuses a pick'em-only league before any trade row exists", async (t) => {
  const { proposeTrade } = require('../services/trade.service');
  const tx = txClient([[LEAGUE_ROW_SQL, () => ({ rows: [PICKEM_LEAGUE_ROW] })]]);
  t.mock.method(pool, 'connect', async () => tx.client);
  await assert.rejects(
    () => proposeTrade({ leagueId: 3, userId: CALLER, receivingTeamId: 42, playerIds: [1] }),
    expectPickemOnlyError
  );
  assert.ok(!tx.calls.some((sql) => /^INSERT/.test(sql)), 'nothing was written');
});

test("respondToTrade (accept) refuses a pick'em-only league too: the check lives in the shared trade-window gate", async (t) => {
  // Unreachable in practice (no trade can be proposed there), but the ticket
  // puts the guard in/beside assertBeforeDeadline so every trade answer shares it.
  const { respondToTrade } = require('../services/trade.service');
  const tx = txClient([
    [/SELECT \* FROM "trades" WHERE "id" = \$1 FOR UPDATE/, () =>
      ({ rows: [{ id: 5, league_id: 3, status: 'pending', proposing_team_id: 42, receiving_team_id: 41 }] })],
    [LEAGUE_ROW_SQL, () => ({ rows: [PICKEM_LEAGUE_ROW] })],
    [/FROM "trade_items"/, () => ({ rows: [] })],
    [/SELECT \* FROM "teams" WHERE "id" IN/, () =>
      ({ rows: [{ id: 41, owner_id: CALLER, name: 'Mine' }, { id: 42, owner_id: 77, name: 'Theirs' }] })],
  ]);
  t.mock.method(pool, 'connect', async () => tx.client);
  await assert.rejects(
    () => respondToTrade({ tradeId: 5, userId: CALLER, action: 'accept' }),
    expectPickemOnlyError
  );
  assert.ok(!tx.calls.some((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql)), 'nothing was written');
});

test("setLineup refuses a pick'em-only league before materializing a lineup", async (t) => {
  const { setLineup } = require('../services/lineup.service');
  const tx = txClient([
    [LEAGUE_ROW_SQL, () => ({ rows: [PICKEM_LEAGUE_ROW] })],
    [/SELECT \* FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/, () => ({ rows: [TEAM_ROW] })],
  ]);
  t.mock.method(pool, 'connect', async () => tx.client);
  // Message-only (no code) on purpose: team.router renders coded errors as
  // { error: code, message }, and the lineup screen toasts `error` verbatim.
  await assert.rejects(
    () => setLineup({ leagueId: 3, userId: CALLER, week: 1, moves: [{ playerId: 1, slot: 'QB' }] }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, PICKEM_MESSAGE);
      assert.equal(error.code, null);
      return true;
    }
  );
  assert.ok(!tx.calls.some((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql)), 'nothing was written');
});

test("draftPlayer (free-agent add) refuses a pick'em-only league with the league-type error, not the generic 'draft has not started'", async (t) => {
  const { draftPlayer } = require('../services/draft.service');
  const tx = txClient([[LEAGUE_ROW_SQL, () => ({ rows: [PICKEM_LEAGUE_ROW] })]]);
  t.mock.method(pool, 'connect', async () => tx.client);
  await assert.rejects(
    () => draftPlayer({ leagueId: 3, userId: CALLER, playerId: 1 }),
    expectPickemOnlyError
  );
  assert.ok(!tx.calls.some((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql)), 'nothing was written');
});

// --- pickem.router: a pick'em league always has pick'em -----------------------

function pickemSettingsPool(t, { pickemOnly }) {
  return mockPool(t, {
    pickemOnly,
    overrides: [
      [/SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })], // commissioner
      // The full projection is pinned on purpose: the guard reads league.pickem_only,
      // so a narrowed SELECT must fall through to "unexpected query", not be answered.
      [/SELECT "id", "name", "current_season", "current_week", "pickem_only" FROM "leagues"/, () =>
        ({ rows: [{ id: 3, name: 'Ballers', current_season: 2026, current_week: 1, pickem_only: pickemOnly }] })],
      [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'straight' }] })],
      [/SELECT 1 FROM "pickem_picks"/, () => ({ rows: [] })],
      [/INSERT INTO "pickem_settings"/, () => ({ rows: [] })],
      [/INSERT INTO "transactions"/, () => ({ rows: [] })],
    ],
  });
}

test("pickem settings: turning pick'em off is refused for a pick'em-only league (409, nothing written)", async (t) => {
  const calls = pickemSettingsPool(t, { pickemOnly: true });
  const res = await request(routes)
    .put('/api/pickem/league/3/settings').set('Authorization', authed()).send({ enabled: false });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'PICKEM_ONLY_LEAGUE');
  assert.match(res.body.error, /pick'em league/);
  assert.ok(!calls.some((c) => /INSERT INTO "pickem_settings"/.test(c.text)), 'settings were not written');
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'), 'the transaction rolled back');
});

test("pickem settings: the scoring mode stays editable for a pick'em-only league", async (t) => {
  const calls = pickemSettingsPool(t, { pickemOnly: true });
  const res = await request(routes)
    .put('/api/pickem/league/3/settings').set('Authorization', authed()).send({ mode: 'confidence' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { enabled: true, mode: 'confidence', isCommissioner: true });
  assert.ok(calls.some((c) => /INSERT INTO "pickem_settings"/.test(c.text)));
});

test("pickem settings: a fantasy league can still turn pick'em off", async (t) => {
  pickemSettingsPool(t, { pickemOnly: false });
  const res = await request(routes)
    .put('/api/pickem/league/3/settings').set('Authorization', authed()).send({ enabled: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.enabled, false);
});

// --- draft.router: the one write whose league id travels in the body --------

test("draft: PUT /queue (leagueId in the body, outside /league/:id) 409s for a pick'em-only league and writes nothing", async (t) => {
  const calls = mockPool(t, { pickemOnly: true });
  const res = await request(routes)
    .put('/api/draft/queue').set('Authorization', authed()).send({ leagueId: 3, playerIds: [1, 2] });
  expectPickemOnly409(res, 'PUT /queue');
  assert.ok(!calls.some((c) => /draft_queue/.test(c.text)), 'no draft_queue statement ran');
});

test('draft: PUT /queue passes through for a fantasy league', async (t) => {
  mockPool(t, {
    pickemOnly: false,
    overrides: [
      [/DELETE FROM "draft_queue"/, () => ({ rows: [] })],
      [/INSERT INTO "draft_queue"/, () => ({ rows: [] })],
    ],
  });
  const res = await request(routes)
    .put('/api/draft/queue').set('Authorization', authed()).send({ leagueId: 3, playerIds: [1, 2] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test("draft: GET /queue still answers for a pick'em-only league (writesOnly)", async (t) => {
  mockPool(t, {
    pickemOnly: true,
    overrides: [[/FROM "draft_queue"/, () => ({ rows: [] })]],
  });
  const res = await request(routes).get('/api/draft/queue?leagueId=3').set('Authorization', authed());
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('requireFantasyLeague({ from: "body" }) reads the id from the request body', async (t) => {
  const calls = mockLeagueLookup(t, [{ pickem_only: true }]);
  const app = express();
  app.use(express.json());
  app.put('/queue', requireFantasyLeague({ param: 'leagueId', from: 'body' }), (req, res) => res.json({ reached: true }));
  const res = await request(app).put('/queue').send({ leagueId: 12, playerIds: [] });
  assert.equal(res.status, 409);
  assert.deepEqual(calls[0].params, [12]);
});
