const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

/**
 * The combined Draft-room feed route, GET /api/league/:id/draft-feed (#435).
 * A fakePool test: it pins that the route requires membership, hands the
 * cursor through, and returns the union rows shaped by type - League chat and
 * Draft activity interleaved, oldest-first. The DATABASE claims (the shared
 * sequence, real interleaving, block filter, guard) are draftActivity.pg.test.js.
 */
const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'draft-feed-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const authed = () => `Bearer ${signToken({ id: 9, username: 'member' })}`;

// The union read the route runs. Membership is answered true; the combined feed
// query returns rows already in ascending display order (the query's outermost
// ORDER BY feed_seq ASC), so the fake hands them back chat seq 7 then Pick
// activity seq 8.
function mockFeed(t, { member = true } = {}) {
  const captured = { sql: null, params: null };
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "teams" WHERE "league_id"')) {
      return { rows: member ? [{ 1: 1 }] : [] };
    }
    if (text.includes('UNION ALL') && text.includes('draft_activity')) {
      captured.sql = text;
      captured.params = params;
      return {
        rows: [
          {
            source: 'league_chat',
            id: 5,
            feed_seq: '7',
            created_at: '2026-09-01T00:00:00.000Z',
            message: 'good luck everyone',
            teamId: 12,
            teamName: 'Sunday Scaries',
            kind: null,
            player_id: null,
            player_name: null,
            player_position: null,
            player_nfl_team: null,
            round: null,
            pick_number: null,
            is_autopick: null,
          },
          {
            source: 'draft_activity',
            id: 3,
            feed_seq: '8',
            created_at: '2026-09-01T00:01:00.000Z',
            message: null,
            teamId: 11,
            teamName: 'Gridiron Ghosts',
            kind: 'pick',
            player_id: 500,
            player_name: 'Pick Me',
            player_position: 'RB',
            player_nfl_team: 'KC',
            round: 1,
            pick_number: 1,
            is_autopick: false,
          },
        ],
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });
  return captured;
}

test('GET draft-feed interleaves chat and Pick activity, oldest-first, as typed entries', async (t) => {
  mockFeed(t);
  const res = await request(app).get('/api/league/12/draft-feed').set('Authorization', authed());

  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  // Reversed to ascending: chat seq 7 first, then Pick activity seq 8.
  assert.deepEqual(res.body[0], {
    type: 'league_chat',
    id: 5,
    seq: 7,
    teamId: 12,
    teamName: 'Sunday Scaries',
    message: 'good luck everyone',
    // #441: chat feed entries carry `hidden` everywhere, the combined feed
    // included; a normal message is not hidden.
    hidden: false,
    created_at: '2026-09-01T00:00:00.000Z',
  });
  assert.deepEqual(res.body[1], {
    type: 'draft_activity',
    kind: 'pick',
    id: 3,
    seq: 8,
    teamId: 11,
    teamName: 'Gridiron Ghosts',
    player: { id: 500, name: 'Pick Me', position: 'RB', nflTeam: 'KC' },
    round: 1,
    pickNumber: 1,
    isAutopick: false,
    created_at: '2026-09-01T00:01:00.000Z',
  });
});

test('GET draft-feed hands the ?before cursor through as a bound integer', async (t) => {
  const captured = mockFeed(t);
  await request(app).get('/api/league/12/draft-feed?before=8').set('Authorization', authed());
  assert.ok(captured.params.includes(8), 'the numeric cursor rode into the query params');
});

test('GET draft-feed?after=<seq> resumes newer than the cursor on both kinds (#442)', async (t) => {
  const captured = mockFeed(t);
  await request(app).get('/api/league/12/draft-feed?after=8').set('Authorization', authed());
  assert.ok(captured.params.includes(8), 'the resume cursor rode into the query params');
  assert.match(captured.sql, /"chat_messages"\."feed_seq" > \$3/);
  assert.match(captured.sql, /"draft_activity"\."feed_seq" > \$3/);
});

test('GET draft-feed refuses a non-member', async (t) => {
  mockFeed(t, { member: false });
  const res = await request(app).get('/api/league/12/draft-feed').set('Authorization', authed());
  assert.equal(res.status, 403);
});

test('GET draft-feed rejects a non-integer league id', async (t) => {
  mockFeed(t);
  const res = await request(app).get('/api/league/abc/draft-feed').set('Authorization', authed());
  assert.equal(res.status, 400);
});
