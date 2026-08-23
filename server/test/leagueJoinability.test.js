const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const {
  buildDiscoverQuery,
  discoverLeagues,
  joinPublicLeague,
  decideJoinRequest,
  previewLeagueByInviteCode,
} = require('../services/discovery.service');
const { joinableWhereSql } = require('../services/leaguePhase');

/**
 * Joinability with a reason (#55): Discover hides leagues that will not
 * accept a team; public join, join-request approval and the invite-code join
 * refuse them with 409 and a reason a manager can read; the invite preview
 * says whether the league is joinable and why not. The regression this pins:
 * a public pick'em-only league whose season is complete used to be listed
 * and joinable because "draft_status = 'pending'" is forever true for a
 * league that has no draft.
 */

/* ------------------------------------------------------------------ *
 * Harness: SQL-substring dispatch over a mocked pool + txn client      *
 * (prior art: commissioner.rollover.test.js).                          *
 * ------------------------------------------------------------------ */

function mockClient(t, handlers) {
  const calls = [];
  const dispatch = (via) => async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ via, text, params });
    for (const [pattern, handler] of handlers) {
      if (pattern.test(text)) return handler(text, params);
    }
    throw new Error(`unexpected query: ${text}`);
  };
  t.mock.method(pool, 'query', dispatch('pool'));
  t.mock.method(pool, 'connect', async () => ({ query: dispatch('client'), release: () => {} }));
  return calls;
}

const TXN = [
  [/^BEGIN$/, () => ({ rows: [] })],
  [/^COMMIT$/, () => ({ rows: [] })],
  [/^ROLLBACK$/, () => ({ rows: [] })],
];

const inserted = (calls) => calls.filter((c) => /INSERT INTO "teams"/.test(c.text));
const committed = (calls) => calls.some((c) => c.text === 'COMMIT');

const COMPLETED_PICKEM = {
  id: 7, name: 'Office Pick\'em', owner_id: 100, is_public: true, join_approval: false,
  max_teams: 50, pickem_only: true, draft_status: 'pending', season_status: 'complete', current_season: 2026,
};
const ROLLED_OVER_PICKEM = { ...COMPLETED_PICKEM, season_status: 'regular', current_season: 2027 };
const FANTASY_DRAFTED = {
  id: 8, name: 'Dynasty', owner_id: 100, is_public: true, join_approval: false,
  max_teams: 12, pickem_only: false, draft_status: 'complete', season_status: 'regular',
};

/* ------------------------------------------------------------------ *
 * Discover                                                            *
 * ------------------------------------------------------------------ */

test('buildDiscoverQuery: the WHERE uses the joinable rule, not a bare draft-status comparison', () => {
  const { whereClause, params } = buildDiscoverQuery({ userId: 42 });
  assert.equal(whereClause, `"leagues"."is_public" = true AND ${joinableWhereSql('leagues')}`);
  assert.deepEqual(params, [42]);
  // The rule itself: fantasy while pre-draft, pick'em-only until the season completes.
  assert.match(whereClause, /"leagues"\."pickem_only" = false AND "leagues"\."draft_status" = 'pending'/);
  assert.match(whereClause, /"leagues"\."pickem_only" = true AND "leagues"\."season_status" <> 'complete'/);
});

test('discoverLeagues emits the joinable fragment so a completed pick\'em-only pool is absent and an in-season or rolled-over one is present', async (t) => {
  let sql = '';
  t.mock.method(pool, 'query', async (text) => {
    sql = String(text).replace(/\s+/g, ' ').trim();
    return { rows: [] };
  });
  await discoverLeagues({ userId: 1 });
  assert.ok(sql.includes(joinableWhereSql('leagues')), sql);
  assert.doesNotMatch(sql, /WHERE "leagues"\."is_public" = true AND "leagues"\."draft_status" = 'pending'/);
});

/* ------------------------------------------------------------------ *
 * joinPublicLeague                                                    *
 * ------------------------------------------------------------------ */

test('joinPublicLeague refuses a completed public pick\'em-only league with 409 season-complete and inserts nothing', async (t) => {
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [COMPLETED_PICKEM] })],
  ]);
  await assert.rejects(
    () => joinPublicLeague({ leagueId: 7, userId: 5, username: 'eve', teamName: null }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.reason, 'season-complete');
      assert.match(error.message, /season/i);
      return true;
    }
  );
  assert.equal(inserted(calls).length, 0);
  assert.equal(committed(calls), false);
});

test('joinPublicLeague refuses a fantasy league past pre-draft with 409 draft-started (the historic message)', async (t) => {
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [FANTASY_DRAFTED] })],
  ]);
  await assert.rejects(
    () => joinPublicLeague({ leagueId: 8, userId: 5, username: 'eve' }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.reason, 'draft-started');
      assert.equal(error.message, 'league draft already started');
      return true;
    }
  );
  assert.equal(inserted(calls).length, 0);
});

test('joinPublicLeague accepts a team into a rolled-over public pick\'em-only league', async (t) => {
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [ROLLED_OVER_PICKEM] })],
    [/SELECT 1 FROM "teams"/, () => ({ rows: [] })],
    [/SELECT COUNT\(\*\)::int AS n FROM "teams"/, () => ({ rows: [{ n: 3 }] })],
    [/INSERT INTO "teams"/, (_text, params) => ({ rows: [{ id: 99, league_id: 7, owner_id: params[1], name: params[2] }] })],
  ]);
  const result = await joinPublicLeague({ leagueId: 7, userId: 5, username: 'eve', teamName: 'Eve Picks' });
  assert.equal(result.pending, false);
  assert.equal(result.team.id, 99);
  assert.equal(inserted(calls).length, 1);
  assert.deepEqual(inserted(calls)[0].params, [7, 5, 'Eve Picks', 4]);
  assert.equal(committed(calls), true);
});

/* ------------------------------------------------------------------ *
 * decideJoinRequest (approval after the league stopped being joinable) *
 * ------------------------------------------------------------------ */

test('approving a pending join request into a completed pick\'em-only league is refused with 409 season-complete', async (t) => {
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "id" = \$1 AND .*FOR UPDATE/, () => ({ rows: [{ ...COMPLETED_PICKEM, join_approval: true }] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [{ ...COMPLETED_PICKEM, join_approval: true }] })],
    [/FROM "join_requests" JOIN "users"/, () => ({ rows: [{ id: 3, user_id: 5, username: 'eve', team_name: null, status: 'pending' }] })],
  ]);
  await assert.rejects(
    () => decideJoinRequest({ leagueId: 7, ownerId: 100, requestId: 3, approve: true }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.reason, 'season-complete');
      return true;
    }
  );
  assert.equal(inserted(calls).length, 0);
});

test('denying a join request never consults joinability (a closed league can still clear its queue)', async (t) => {
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "id" = \$1 AND .*FOR UPDATE/, () => ({ rows: [{ ...COMPLETED_PICKEM, join_approval: true }] })],
    [/FROM "join_requests" JOIN "users"/, () => ({ rows: [{ id: 3, user_id: 5, username: 'eve', team_name: null, status: 'pending' }] })],
    [/UPDATE "join_requests" SET "status" = 'denied'/, () => ({ rows: [] })],
    [/INSERT INTO "notifications"|INSERT INTO "activity"|notif/i, () => ({ rows: [{ id: 1 }] })],
  ]);
  const result = await decideJoinRequest({ leagueId: 7, ownerId: 100, requestId: 3, approve: false });
  assert.deepEqual(result, { status: 'denied' });
  assert.equal(committed(calls), true);
});

/* ------------------------------------------------------------------ *
 * Invite preview (service)                                             *
 * ------------------------------------------------------------------ */

test('previewLeagueByInviteCode ships joinable + joinReason and none of the three raw inputs (dropped in the contract step)', async (t) => {
  const row = {
    id: 7, name: 'Office Pick\'em', maxTeams: 50, teamCount: 3, pickemOnly: true, pickemEnabled: true,
    isPublic: false, ownerUsername: 'alice', draft_status: 'pending', season_status: 'complete', pickem_only: true,
  };
  t.mock.method(pool, 'query', async () => ({ rows: [row] }));
  const preview = await previewLeagueByInviteCode({ code: 'e402e816', userId: 9 });
  assert.equal(preview.joinable, false);
  assert.equal(preview.joinReason, 'season-complete');
  assert.equal('draft_status' in preview, false, 'draft status is an input, not a preview field');
  assert.equal('season_status' in preview, false, 'season status is an input, not a preview field');
  assert.equal('pickem_only' in preview, false, 'pickem_only is an input, not a preview field');
});

/* ------------------------------------------------------------------ *
 * Routes over supertest                                                *
 * ------------------------------------------------------------------ */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-joinability-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});
const authed = (userId = 9) => `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

function makeApp() {
  delete require.cache[require.resolve('../routes/league.router')];
  const app = express();
  app.use(express.json());
  app.use('/api/league', require('../routes/league.router'));
  return app;
}

test('GET /preview: a completed pick\'em-only league previews as not joinable, season complete, no raw statuses', async (t) => {
  const app = makeApp();
  const row = {
    id: 7, name: 'Office Pick\'em', maxTeams: 50, teamCount: 3, scoringPreset: null, bestBall: false,
    pickemOnly: true, pickemEnabled: true, joinApproval: false, draftDate: null, createdAt: '2026-08-01T00:00:00.000Z',
    alreadyMember: false, myRequestStatus: null, isPublic: false, ownerUsername: 'alice',
    draft_status: 'pending', season_status: 'complete', pickem_only: true,
  };
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (/"leagues"\."invite_code" = \$\d/.test(text)) {
      assert.match(text, /"leagues"\."season_status" AS "season_status"/, 'the lookup reads season status');
      return { rows: [row] };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const res = await request(app).get('/api/league/preview?code=e402e816').set('Authorization', authed());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.joinable, false);
  assert.equal(res.body.joinReason, 'season-complete');
  assert.equal('draft_status' in res.body, false);
  assert.equal(res.body.pickemOnly, true);
  assert.equal('season_status' in res.body, false);
});

test('GET /preview: an in-season pick\'em-only league is joinable with no reason; a drafted fantasy league is not, draft-started', async (t) => {
  const app = makeApp();
  const base = {
    id: 7, name: 'x', maxTeams: 12, teamCount: 3, scoringPreset: null, bestBall: false, pickemEnabled: false,
    joinApproval: false, draftDate: null, createdAt: '2026-08-01T00:00:00.000Z', alreadyMember: false,
    myRequestStatus: null, isPublic: false, ownerUsername: 'alice',
  };
  let row = { ...base, pickemOnly: true, draft_status: 'pending', season_status: 'regular', pickem_only: true };
  t.mock.method(pool, 'query', async () => ({ rows: [row] }));
  let res = await request(app).get('/api/league/preview?code=e402e816').set('Authorization', authed());
  assert.equal(res.status, 200);
  assert.equal(res.body.joinable, true);
  assert.equal(res.body.joinReason, null);

  row = { ...base, pickemOnly: false, draft_status: 'active', season_status: 'regular', pickem_only: false };
  res = await request(app).get('/api/league/preview?code=e402e816').set('Authorization', authed());
  assert.equal(res.status, 200);
  assert.equal(res.body.joinable, false);
  assert.equal(res.body.joinReason, 'draft-started');
  assert.equal('draft_status' in res.body, false);
});

test('POST /join (invite code): a completed pick\'em-only league is refused 409 with the season-complete reason and no team is created', async (t) => {
  const app = makeApp();
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "invite_code" = \$1 FOR UPDATE/, () => ({ rows: [{ ...COMPLETED_PICKEM, invite_code: 'e402e816' }] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [COMPLETED_PICKEM] })],
  ]);
  const res = await request(app).post('/api/league/join').set('Authorization', authed()).send({ inviteCode: 'e402e816' });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.reason, 'season-complete');
  assert.match(res.body.error, /season/i);
  assert.equal(inserted(calls).length, 0);
  assert.equal(committed(calls), false);
});

test('POST /join (invite code): a fantasy league past pre-draft is refused 409 draft-started with the historic message', async (t) => {
  const app = makeApp();
  mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "invite_code" = \$1 FOR UPDATE/, () => ({ rows: [{ ...FANTASY_DRAFTED, invite_code: 'abcdef01' }] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [FANTASY_DRAFTED] })],
  ]);
  const res = await request(app).post('/api/league/join').set('Authorization', authed()).send({ inviteCode: 'abcdef01' });
  assert.equal(res.status, 409);
  assert.deepEqual(res.body, { error: 'league draft already started', reason: 'draft-started' });
});

test('POST /join (invite code): an in-season (rolled-over) pick\'em-only league accepts the team', async (t) => {
  const app = makeApp();
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "invite_code" = \$1 FOR UPDATE/, () => ({ rows: [{ ...ROLLED_OVER_PICKEM, invite_code: 'e402e816' }] })],
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [ROLLED_OVER_PICKEM] })],
    [/SELECT 1 FROM "teams"/, () => ({ rows: [] })],
    [/SELECT COUNT\(\*\)::int AS n FROM "teams"/, () => ({ rows: [{ n: 3 }] })],
    [/INSERT INTO "teams"/, (_text, params) => ({ rows: [{ id: 99, league_id: 7, owner_id: params[1], name: params[2] }] })],
  ]);
  const res = await request(app).post('/api/league/join').set('Authorization', authed())
    .send({ inviteCode: 'e402e816', teamName: 'Rolled Over FC' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.team.id, 99);
  assert.equal(inserted(calls).length, 1);
  assert.equal(committed(calls), true);
});

test('POST /:id/join-public: the 409 body carries the reason', async (t) => {
  const app = makeApp();
  mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [COMPLETED_PICKEM] })],
  ]);
  const res = await request(app).post('/api/league/7/join-public').set('Authorization', authed()).send({});
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.reason, 'season-complete');
  assert.match(res.body.error, /season/i);
});
