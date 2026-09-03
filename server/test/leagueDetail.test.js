const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-detail-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

// Two grants, because the roster's two viewer-relative rules differ on them:
// one co-commissioner still holds their Team, and one no longer does. The
// second is why listCoCommissioners joins LEFT - a grant briefly outlives the
// team when a commissioner removes the team before revoking the role - and it
// has no Team identity to show a member.
const GRANTED_AT = '2026-08-12T10:00:00.000Z';
const GRANT_WITH_TEAM = {
  user_id: 42, username: 'alice', created_at: GRANTED_AT, teamId: 11, teamName: "Alice's Team",
};
const GRANT_WITHOUT_TEAM = {
  user_id: 43, username: 'ghost', created_at: GRANTED_AT, teamId: null, teamName: null,
};

// The market status line (#748) defaults to a fresh market - plenty of
// players, a recent ok sync - so tests that don't care about it aren't forced
// to think about it. The dedicated market tests below override adpPlayers,
// lastAdpRun and dataSyncRunsError one at a time.
function mockLeagueDetail(t, {
  isCommissioner = true,
  coCommissioners = [],
  adpPlayers = 250,
  lastAdpRun = { finished_at: new Date().toISOString() },
  dataSyncRunsError = null,
  draftStatus = 'pending',
} = {}) {
  const seen = {};
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('ownerTeamId')) {
      return { rows: [{ id: 1, owner_id: 7, name: 'Sunday Ballers', invite_code: 'invite', ownerTeamId: 11, ownerTeamName: "Alice's Team", draft_status: draftStatus }] };
    }
    if (text.includes('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('SELECT 1 FROM "leagues"')) {
      return { rows: isCommissioner ? [{ '?column?': 1 }] : [] };
    }
    if (text.includes('FROM "league_commissioners"')) return { rows: coCommissioners };
    if (text.includes('FROM "players"')) return { rows: [{ n: adpPlayers }] };
    if (text.includes('FROM "data_sync_runs"')) {
      if (dataSyncRunsError) throw dataSyncRunsError;
      return { rows: lastAdpRun ? [lastAdpRun] : [] };
    }
    if (text.includes('COUNT("team_players"."id")')) {
      seen.teamsQuery = text;
      return {
        rows: [{
          // Both `id` and `teamId`, because GET /api/league/:id projects both:
          // the raw column and the contract alias teamIdentityColumns() puts
          // beside it. A fixture carrying only `id` would let a comparison
          // against the legacy column pass while the contract one silently
          // matched nothing - which is what the co-commissioner flag reads.
          id: 11,
          teamId: 11,
          name: "Alice's Team",
          owner_id: 42, // on the raw row for viewerTeamId; stripped from serialization (#343)
          draft_position: 1,
          faab_remaining: 100,
          locked: false,
          draft_ready: true,
          roster_count: 0,
          total_points: '0',
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  return seen;
}

test('GET league detail selects and serializes team readiness', async (t) => {
  let teamsQuery = null;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('ownerTeamId')) {
      return { rows: [{ id: 1, owner_id: 7, name: 'Sunday Ballers', invite_code: 'invite', ownerTeamId: 11, ownerTeamName: "Alice's Team" }] };
    }
    if (text.includes('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('SELECT 1 FROM "leagues"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('FROM "league_commissioners"')) return { rows: [] };
    if (text.includes('FROM "players"')) return { rows: [{ n: 250 }] };
    if (text.includes('FROM "data_sync_runs"')) return { rows: [{ finished_at: new Date().toISOString() }] };
    if (text.includes('COUNT("team_players"."id")')) {
      teamsQuery = text;
      return {
        rows: [{
          id: 11,
          name: "Alice's Team",
          draft_position: 1,
          faab_remaining: 100,
          locked: false,
          draft_ready: true,
          roster_count: 0,
          total_points: '0',
        }],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app)
    .get('/api/league/1')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.match(teamsQuery, /"teams"\."draft_ready"/);
  assert.equal(response.body.teams[0].draft_ready, true);
});

test('GET league detail gives a commissioner the invite code and the ids grant and revoke need', async (t) => {
  const seen = mockLeagueDetail(t, {
    isCommissioner: true,
    coCommissioners: [GRANT_WITH_TEAM, GRANT_WITHOUT_TEAM],
  });

  const token = signToken({ id: 99, username: 'co-commish' });
  const response = await request(app)
    .get('/api/league/1')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.league.is_commissioner, true);
  assert.equal(response.body.league.invite_code, 'invite');
  // The account id rides commissioner-conditionally, decided on the same
  // boolean as invite_code an adjacent line below: DELETE
  // /co-commissioners/:userId is account-shaped, so a commissioner cannot
  // revoke without it. The username is not part of what grant and revoke need
  // and does not ride at all. grantedAt rides with the id because Team
  // identity does not identify a grant on its own (duplicate Team names are
  // valid), and a commissioner has to know which one they are revoking.
  assert.deepEqual(response.body.league.co_commissioners, [
    { user_id: 42, grantedAt: GRANTED_AT, teamId: 11, teamName: "Alice's Team" },
    // A grant whose Team is gone still reaches the commissioner who has to
    // revoke it, even though there is no Team identity left to name it by.
    { user_id: 43, grantedAt: GRANTED_AT, teamId: null, teamName: null },
  ]);
  // owner_id still rides in the SELECT so viewerTeamId can resolve off the raw
  // rows, but it is stripped from the serialized entry (#343): even a
  // commissioner reads teams[] by Team identity, and identifies a promote
  // target by teamId (the server resolves the account behind it).
  assert.match(seen.teamsQuery, /"teams"\."owner_id"/);
  assert.equal('owner_id' in response.body.teams[0], false);
});

test('GET league detail names commissioner power by Team, never by account, for a plain member', async (t) => {
  mockLeagueDetail(t, {
    isCommissioner: false,
    coCommissioners: [GRANT_WITH_TEAM, GRANT_WITHOUT_TEAM],
  });

  const token = signToken({ id: 55, username: 'member' });
  const response = await request(app)
    .get('/api/league/1')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.league.is_commissioner, false);
  assert.equal(response.body.league.invite_code, undefined);
  // Who holds power is not secret. WHICH TEAM holds it is the whole of the
  // disclosure (#324): a member can see the power without ever being handed
  // another manager's account, and the grant with no Team has no Team identity
  // to show, so it is simply not in the member-visible view.
  assert.deepEqual(response.body.league.co_commissioners, [
    { teamId: 11, teamName: "Alice's Team" },
  ]);
  for (const entry of response.body.league.co_commissioners) {
    assert.equal('user_id' in entry, false);
    assert.equal('username' in entry, false);
  }
  // And the same fact reaches the member off the Team identity they already
  // hold, so no surface has to join the roster back to a team to render it.
  assert.equal(response.body.teams[0].is_co_commissioner, true);
});

test('GET league detail flags only the teams whose manager holds a grant', async (t) => {
  mockLeagueDetail(t, { isCommissioner: false, coCommissioners: [GRANT_WITHOUT_TEAM] });

  const token = signToken({ id: 55, username: 'member' });
  const response = await request(app)
    .get('/api/league/1')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  // The flag is present and false rather than absent, so a consumer can read
  // it unconditionally - and a grant that no longer names a Team flags none.
  assert.equal(response.body.teams[0].is_co_commissioner, false);
  assert.deepEqual(response.body.league.co_commissioners, []);
});

// ---------------------------------------------------------- market (#748)

test('GET league detail carries a market object with adpPlayers, floor, lastSyncAt and stale', async (t) => {
  const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
  mockLeagueDetail(t, { adpPlayers: 250, lastAdpRun: { finished_at: recent } });

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app).get('/api/league/1').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(Object.keys(response.body.league.market).sort(), ['adpPlayers', 'floor', 'lastSyncAt', 'stale']);
  assert.equal(response.body.league.market.adpPlayers, 250);
  assert.equal(response.body.league.market.floor, 100);
  assert.equal(response.body.league.market.lastSyncAt, recent);
  assert.equal(response.body.league.market.stale, false);
});

test('GET league detail marks the market stale once the latest ok run is older than MARKET_STALE_DAYS', async (t) => {
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
  mockLeagueDetail(t, { adpPlayers: 250, lastAdpRun: { finished_at: old } });

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app).get('/api/league/1').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.league.market.stale, true);
});

test('GET league detail reports lastSyncAt null and stale true when there is no ADP run at all', async (t) => {
  mockLeagueDetail(t, { adpPlayers: 250, lastAdpRun: null });

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app).get('/api/league/1').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.league.market.lastSyncAt, null);
  assert.equal(response.body.league.market.stale, true);
});

// The maintainer applies the data_sync_runs migration as a separate step
// (#747, #748), so a read against it can find the table absent in a given
// environment. That must degrade to the same shape as "no run yet" rather
// than 500 this hot authenticated route (getSchedulerStatus's precedent,
// modules/scheduler.js).
test('GET league detail degrades to the no-run market shape, and stays 200, when data_sync_runs is absent', async (t) => {
  const tableAbsent = new Error('relation "data_sync_runs" does not exist');
  tableAbsent.code = '42P01';
  mockLeagueDetail(t, { adpPlayers: 250, dataSyncRunsError: tableAbsent });

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app).get('/api/league/1').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.league.market.lastSyncAt, null);
  assert.equal(response.body.league.market.stale, true);
});

// 758-f2: decision 3 is "pending drafts only". Gated here, at the route, so
// every consumer of the payload gets the rule for free rather than each
// re-deriving "pending" from draft_status on its own.
for (const draftStatus of ['active', 'complete']) {
  test(`GET league detail carries no market once draft_status is ${draftStatus}`, async (t) => {
    mockLeagueDetail(t, { draftStatus });

    const token = signToken({ id: 7, username: 'commissioner' });
    const response = await request(app).get('/api/league/1').set('Authorization', `Bearer ${token}`);

    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal('market' in response.body.league, false);
  });
}

test('GET league detail carries market while draft_status is pending', async (t) => {
  mockLeagueDetail(t, { draftStatus: 'pending' });

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app).get('/api/league/1').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal('market' in response.body.league, true);
});
