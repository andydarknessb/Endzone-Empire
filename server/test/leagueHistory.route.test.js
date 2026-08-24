const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

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
