const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const { TEAM_IDENTITY_FIELDS } = require('../services/teamIdentity');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-history-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const champions = [
  {
    teamId: 10,
    teamName: 'Archived Aces',
    avatarUrl: '/aces.png',
    avatarStaticUrl: null,
    points: 171,
    correct: 120,
    mode: 'straight',
  },
  {
    teamId: 99,
    teamName: 'Departed Champs',
    avatarUrl: null,
    avatarStaticUrl: '/departed.png',
    points: 171,
    correct: 120,
    mode: 'straight',
  },
];

test("GET history returns archived Pick'em champions and explicit no-champion state", async (t) => {
  let historySql = null;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('FROM "league_history"')) {
      historySql = text;
      return {
        rows: [
          {
            season: 2026,
            standings: [{ teamId: 11, name: 'Drifted Leader', rank: 1, points: 180, correct: 121 }],
            champion_team_id: null,
            champion_name: null,
            champion_avatar_url: null,
            champion_avatar_static_url: null,
            pickem_result: JSON.stringify({
              outcome: 'champions',
              mode: 'straight',
              champions,
              provenance: { source: 'season_completion' },
              declaredAt: '2027-01-11T06:00:00.000Z',
            }),
          },
          {
            season: 2025,
            standings: [],
            champion_team_id: null,
            champion_name: null,
            champion_avatar_url: null,
            champion_avatar_static_url: null,
            pickem_result: {
              outcome: 'no_champion',
              mode: 'straight',
              champions: [],
              provenance: { source: 'legacy_league_history_awards' },
              declaredAt: '2026-01-11T06:00:00.000Z',
            },
          },
        ],
      };
    }
    if (text.includes('FROM "trophies" JOIN "teams"')) {
      return { rows: [{ id: 77, week: 0, type: 'pickem_champion', team_id: 777, team_name: 'Wrong Live Winner' }] };
    }
    if (text.includes('FROM "league_analytics"')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const token = signToken({ id: 7, username: 'member' });

  const response = await request(app)
    .get('/api/league/5/history')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.match(historySql, /"league_history"\."pickem_result"/);
  assert.match(historySql, /"leagues"\."pickem_only"/);
  assert.equal(response.body.seasons[0].outcome, 'champions');
  assert.deepEqual(response.body.seasons[0].champions, champions);
  assert.deepEqual(response.body.seasons[0].champion, {
    teamId: 10,
    name: 'Archived Aces',
    avatarUrl: '/aces.png',
    avatarStaticUrl: null,
  });
  assert.equal(response.body.seasons[0].champion.name, 'Archived Aces');
  assert.equal(response.body.seasons[0].trophies[0].team_name, 'Wrong Live Winner');
  assert.equal(response.body.seasons[1].outcome, 'no_champion');
  assert.deepEqual(response.body.seasons[1].champions, []);
  assert.equal(response.body.seasons[1].champion, null);
});

test("GET history never promotes an ambiguous Pick'em legacy pointer as a champion", async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('FROM "league_history"')) {
      return {
        rows: [
          {
            season: 2026,
            standings: [],
            pickem_only: true,
            pickem_result: null,
            champion_team_id: 10,
            champion_name: 'Ambiguous Legacy Winner',
            champion_avatar_url: null,
            champion_avatar_static_url: null,
          },
          {
            season: 2025,
            standings: [],
            pickem_only: false,
            pickem_result: null,
            champion_team_id: 20,
            champion_name: 'Fantasy Champion',
            champion_avatar_url: '/fantasy.png',
            champion_avatar_static_url: null,
          },
        ],
      };
    }
    if (text.includes('FROM "trophies" JOIN "teams"')) return { rows: [] };
    if (text.includes('FROM "league_analytics"')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const token = signToken({ id: 7, username: 'member' });

  const response = await request(app)
    .get('/api/league/5/history')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.seasons[0].champions, null);
  assert.equal(response.body.seasons[0].champion, null);
  assert.deepEqual(response.body.seasons[1].champion, {
    teamId: 20,
    name: 'Fantasy Champion',
    avatarUrl: '/fantasy.png',
    avatarStaticUrl: null,
  });
});

// The frozen archive is served to every league member, so a served standings
// row must name a manager by Team identity only, never by an account id (#342,
// #115). The identity half is the Team id (TEAM_IDENTITY_FIELDS[0]) plus the
// archived Team-name label `name` - the history archive predates the live
// `teamName` wire key and keys/labels its rows by `name`, which the client
// renders (a null name becomes "Former manager"). The account-identity keys
// below are each forbidden on every row and, for champion_user_id, anywhere in
// the response. The guarantee is enforced at WRITE time (the rollover builder
// and the league_history_standings CHECK), not by cleaning on read; this test
// pins the served contract that guarantee produces. Demonstrated red before the
// write-path change by seeding a fixture row that still carried `username` (see
// the PR body); it fails the exact-key-set assertion.
const FORBIDDEN_ACCOUNT_KEYS = ['userId', 'username', 'user_id', 'email', 'owner_id', 'champion_user_id'];

test('GET history serves standings by Team identity only, for both league types', async (t) => {
  // Post-migration shapes: pick'em standings (Team identity + scoring totals)
  // and fantasy standings (Team identity + win/loss record). Neither carries an
  // account identifier.
  const pickemStandings = [
    { teamId: 11, name: 'Bob Squad', points: 5, correct: 3, incorrect: 2, pushes: 0, pending: 0, made: 5, weekly: { 18: 5 }, rank: 1 },
    { teamId: null, name: null, points: 0, correct: 0, incorrect: 0, pushes: 0, pending: 0, made: 0, weekly: {}, rank: 2 },
  ];
  const fantasyStandings = [
    { teamId: 20, name: 'Gridiron Kings', wins: 10, losses: 3, ties: 0, pf: 1500.5, pa: 1200.25, winPct: 0.769, streak: 'W3', rank: 1 },
  ];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('FROM "league_history"')) {
      // The endpoint must not even SELECT champion_user_id (account identity at
      // rest that is out of scope for the rewrite but must stay off the wire).
      assert.equal(/champion_user_id/.test(text), false, 'history endpoint never selects champion_user_id');
      return {
        rows: [
          {
            season: 2026,
            standings: pickemStandings,
            pickem_only: true,
            champion_team_id: null,
            champion_name: null,
            champion_avatar_url: null,
            champion_avatar_static_url: null,
            pickem_result: { outcome: 'champions', mode: 'straight', champions, provenance: { source: 'season_completion' }, declaredAt: '2027-01-11T06:00:00.000Z' },
          },
          {
            season: 2025,
            standings: fantasyStandings,
            pickem_only: false,
            champion_team_id: 20,
            champion_name: 'Gridiron Kings',
            champion_avatar_url: null,
            champion_avatar_static_url: null,
            pickem_result: null,
          },
        ],
      };
    }
    if (text.includes('FROM "trophies" JOIN "teams"')) return { rows: [] };
    if (text.includes('FROM "league_analytics"')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const token = signToken({ id: 7, username: 'member' });

  const response = await request(app)
    .get('/api/league/5/history')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);

  const [pickemSeason, fantasySeason] = response.body.seasons;

  // Exact key set per league type, and every account key forbidden on each row.
  const [identityIdField] = TEAM_IDENTITY_FIELDS; // 'teamId'
  const assertRowShape = (row, expectedKeys) => {
    assert.deepEqual(Object.keys(row).sort(), [...expectedKeys].sort());
    assert.ok(identityIdField in row, `served row carries the Team id (${identityIdField})`);
    for (const forbidden of FORBIDDEN_ACCOUNT_KEYS) {
      assert.equal(forbidden in row, false, `served standings row must not carry ${forbidden}`);
    }
  };

  for (const row of pickemSeason.standings) {
    assertRowShape(row, ['teamId', 'name', 'points', 'correct', 'incorrect', 'pushes', 'pending', 'made', 'weekly', 'rank']);
  }
  for (const row of fantasySeason.standings) {
    assertRowShape(row, ['teamId', 'name', 'wins', 'losses', 'ties', 'pf', 'pa', 'winPct', 'streak', 'rank']);
  }

  // A gone-Team row survives to the wire as teamId/name null (the client renders
  // "Former manager"), not by falling back to any account field.
  assert.deepEqual(pickemSeason.standings[1].teamId, null);
  assert.deepEqual(pickemSeason.standings[1].name, null);

  // champion_user_id appears nowhere in the served payload.
  assert.equal(JSON.stringify(response.body).includes('champion_user_id'), false);
});
