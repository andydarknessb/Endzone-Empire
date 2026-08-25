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

function mockLeagueDetail(t, { isCommissioner = true, coCommissioners = [] } = {}) {
  const seen = {};
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('owner_username')) {
      return { rows: [{ id: 1, owner_id: 7, name: 'Sunday Ballers', invite_code: 'invite', owner_username: 'alice' }] };
    }
    if (text.includes('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('SELECT 1 FROM "leagues"')) {
      return { rows: isCommissioner ? [{ '?column?': 1 }] : [] };
    }
    if (text.includes('FROM "league_commissioners"')) return { rows: coCommissioners };
    if (text.includes('COUNT("team_players"."id")')) {
      seen.teamsQuery = text;
      return {
        rows: [{
          id: 11,
          name: "Alice's Team",
          owner_id: 42,
          draft_position: 1,
          faab_remaining: 100,
          locked: false,
          draft_ready: true,
          owner: 'alice',
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
    if (text.includes('owner_username')) {
      return { rows: [{ id: 1, owner_id: 7, name: 'Sunday Ballers', invite_code: 'invite', owner_username: 'alice' }] };
    }
    if (text.includes('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('SELECT 1 FROM "leagues"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('FROM "league_commissioners"')) return { rows: [] };
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
          owner: 'alice',
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
  // The promote list is account-shaped for the same reason.
  assert.match(seen.teamsQuery, /"teams"\."owner_id"/);
  assert.equal(response.body.teams[0].owner_id, 42);
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
