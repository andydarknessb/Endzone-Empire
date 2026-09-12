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

// Raw pickem_result.champions shape as archived: teamName plus scoring
// fields. seasonArchive() narrows each element to the canonical
// { teamId, name, avatarUrl, avatarStaticUrl } shape on the wire.
const rawPickemChampions = [
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

const canonicalPickemChampions = [
  { teamId: 10, name: 'Archived Aces', avatarUrl: '/aces.png', avatarStaticUrl: null },
  { teamId: 99, name: 'Departed Champs', avatarUrl: null, avatarStaticUrl: '/departed.png' },
];

// No-trophy/no-draft-grades lateral aggregate columns: array_agg over zero
// matching rows yields one row of NULLs (not zero rows), which
// seasonArchive.service.js's zipTrophies reads back as [].
const NO_TROPHIES = {
  trophy_ids: null,
  trophy_league_ids: null,
  trophy_team_ids: null,
  trophy_seasons: null,
  trophy_weeks: null,
  trophy_types: null,
  trophy_labels: null,
  trophy_datas: null,
  trophy_awarded_ats: null,
  trophy_team_names: null,
};
const NO_DRAFT_GRADES = { draft_grades: null };

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
              champions: rawPickemChampions,
              provenance: { source: 'season_completion' },
              declaredAt: '2027-01-11T06:00:00.000Z',
            }),
            trophy_ids: [77],
            trophy_league_ids: [5],
            trophy_team_ids: [777],
            trophy_seasons: [2026],
            trophy_weeks: [0],
            trophy_types: ['pickem_champion'],
            trophy_labels: ["2026 Pick'em Champion"],
            trophy_datas: [{}],
            trophy_awarded_ats: [new Date('2027-01-05T00:00:00.000Z')],
            trophy_team_names: ['Wrong Live Winner'],
            ...NO_DRAFT_GRADES,
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
            ...NO_TROPHIES,
            ...NO_DRAFT_GRADES,
          },
        ],
      };
    }
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
  assert.deepEqual(response.body.seasons[0].champions, canonicalPickemChampions);
  assert.equal('champion' in response.body.seasons[0], false);
  assert.equal(response.body.seasons[0].trophies[0].team_name, 'Wrong Live Winner');
  assert.equal(response.body.seasons[1].outcome, 'no_champion');
  assert.deepEqual(response.body.seasons[1].champions, []);
  assert.equal('champion' in response.body.seasons[1], false);
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
            ...NO_TROPHIES,
            ...NO_DRAFT_GRADES,
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
            ...NO_TROPHIES,
            ...NO_DRAFT_GRADES,
          },
        ],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const token = signToken({ id: 7, username: 'member' });

  const response = await request(app)
    .get('/api/league/5/history')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.seasons[0].champions, null);
  assert.equal('champion' in response.body.seasons[0], false);
  assert.equal('champion' in response.body.seasons[1], false);
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
// pins the served contract that guarantee produces. Because the route serves
// the standings column verbatim, the fixture (not any write-path code) is what
// this assertion reads; the exact-key-set assertion was demonstrated
// non-vacuous by seeding a fixture row carrying `username` (see the PR body),
// which makes it fail, proving the assertion is live rather than always-passing.
//
// This list is hard-coded on purpose and is NOT the migration's
// FORBIDDEN_ACCOUNT_KEYS: it is the SERVED contract, so it adds champion_user_id
// (account identity that lives in its own column and must stay off the wire).
// It exists to fail if a forbidden key ever reaches the response; importing a
// shared constant would make the assertion a tautology. Do not merge it with
// the migration's list.
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
            pickem_result: { outcome: 'champions', mode: 'straight', champions: rawPickemChampions, provenance: { source: 'season_completion' }, declaredAt: '2027-01-11T06:00:00.000Z' },
            ...NO_TROPHIES,
            ...NO_DRAFT_GRADES,
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
            ...NO_TROPHIES,
            ...NO_DRAFT_GRADES,
          },
        ],
      };
    }
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

// allTime (#1212): the League's all-time Team roster. The exact shape is
// { teamId, name, avatarUrl, championships, wins, losses, ties } — no
// avatarStaticUrl, unlike a season's `champions` element.
test('GET history allTime: sums championships and Record across seasons, from current Team identity', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('FROM "league_history"')) {
      const identityColumns = {
        all_team_ids: [10, 20],
        all_team_names: ['Current Aces', 'Current Barons'],
        all_team_avatar_urls: ['/current-aces.png', null],
      };
      return {
        rows: [
          {
            season: 2026,
            standings: [
              { teamId: 10, name: 'Legacy Aces', wins: 8, losses: 5, ties: 1, pf: 1, pa: 1, winPct: 0.6, streak: 'W1', rank: 1 },
              { teamId: 20, name: 'Legacy Barons', wins: 5, losses: 8, ties: 0, pf: 1, pa: 1, winPct: 0.4, streak: 'L1', rank: 2 },
            ],
            pickem_only: false,
            champion_team_id: 10,
            champion_name: 'Legacy Aces',
            champion_avatar_url: null,
            champion_avatar_static_url: null,
            pickem_result: null,
            ...NO_TROPHIES,
            ...NO_DRAFT_GRADES,
            ...identityColumns,
          },
          {
            season: 2025,
            standings: [
              { teamId: 10, name: 'Legacy Aces', wins: 10, losses: 3, ties: 0, pf: 1, pa: 1, winPct: 0.77, streak: 'W3', rank: 1 },
              { teamId: 20, name: 'Legacy Barons', wins: 3, losses: 10, ties: 0, pf: 1, pa: 1, winPct: 0.23, streak: 'L3', rank: 2 },
            ],
            pickem_only: false,
            champion_team_id: null,
            champion_name: null,
            champion_avatar_url: null,
            champion_avatar_static_url: null,
            pickem_result: null,
            ...NO_TROPHIES,
            ...NO_DRAFT_GRADES,
            ...identityColumns,
          },
        ],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const token = signToken({ id: 7, username: 'member' });

  const response = await request(app)
    .get('/api/league/5/history')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.allTime, [
    { teamId: 10, name: 'Current Aces', avatarUrl: '/current-aces.png', championships: 1, wins: 18, losses: 8, ties: 1 },
    { teamId: 20, name: 'Current Barons', avatarUrl: null, championships: 0, wins: 8, losses: 18, ties: 0 },
  ]);
});

test("GET history allTime: a pick'em Team has no Record (never 0); co-champions each still count, and a NON-champion pick'em Team still gets a row", async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('FROM "league_history"')) {
      return {
        rows: [
          {
            season: 2026,
            standings: [
              { teamId: 30, name: 'Pickem Aces', points: 171, correct: 120, incorrect: 10, pushes: 0, pending: 0, made: 130, weekly: {}, rank: 1 },
              { teamId: 40, name: 'Pickem Barons', points: 171, correct: 120, incorrect: 10, pushes: 0, pending: 0, made: 130, weekly: {}, rank: 1 },
              // Red-tell (#1212): a non-champion pick'em Team (never in
              // `champions`, so nothing but this standings row would ever add
              // it to allTime) must still appear, with championships: 0 and
              // Record: null - the row-set rule is "any archived standings OR
              // champions", not "champions, or a standings row with a
              // numeric wins".
              { teamId: 45, name: 'Pickem Ravens', points: 90, correct: 60, incorrect: 70, pushes: 0, pending: 0, made: 130, weekly: {}, rank: 3 },
            ],
            pickem_only: true,
            champion_team_id: null,
            champion_name: null,
            champion_avatar_url: null,
            champion_avatar_static_url: null,
            pickem_result: {
              outcome: 'champions',
              mode: 'straight',
              champions: [
                { teamId: 30, teamName: 'Pickem Aces', avatarUrl: null, avatarStaticUrl: null, points: 171, correct: 120, mode: 'straight' },
                { teamId: 40, teamName: 'Pickem Barons', avatarUrl: null, avatarStaticUrl: null, points: 171, correct: 120, mode: 'straight' },
              ],
              provenance: { source: 'season_completion' },
              declaredAt: '2027-01-11T06:00:00.000Z',
            },
            ...NO_TROPHIES,
            ...NO_DRAFT_GRADES,
            all_team_ids: [30, 40, 45],
            all_team_names: ['Pickem Aces', 'Pickem Barons', 'Pickem Ravens'],
            all_team_avatar_urls: [null, null, null],
          },
        ],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const token = signToken({ id: 7, username: 'member' });

  const response = await request(app)
    .get('/api/league/5/history')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.allTime, [
    { teamId: 30, name: 'Pickem Aces', avatarUrl: null, championships: 1, wins: null, losses: null, ties: null },
    { teamId: 40, name: 'Pickem Barons', avatarUrl: null, championships: 1, wins: null, losses: null, ties: null },
    { teamId: 45, name: 'Pickem Ravens', avatarUrl: null, championships: 0, wins: null, losses: null, ties: null },
  ]);
});

test('GET history allTime: a gone Team still gets a row (name/avatarUrl null); a current Team with no archived season does not appear', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('FROM "league_history"')) {
      return {
        rows: [
          {
            season: 2026,
            standings: [
              { teamId: 50, name: 'Archived Gone Team', wins: 4, losses: 9, ties: 0, pf: 1, pa: 1, winPct: 0.3, streak: 'L2', rank: 2 },
            ],
            pickem_only: false,
            champion_team_id: 50,
            champion_name: 'Archived Gone Team',
            champion_avatar_url: null,
            champion_avatar_static_url: null,
            pickem_result: null,
            ...NO_TROPHIES,
            ...NO_DRAFT_GRADES,
            // team 50 (in the archive) has no current teams row; team 60 is a
            // current Team with no archived season and must not appear below.
            all_team_ids: [60],
            all_team_names: ['Brand New Team'],
            all_team_avatar_urls: [null],
          },
        ],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const token = signToken({ id: 7, username: 'member' });

  const response = await request(app)
    .get('/api/league/5/history')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.allTime, [
    { teamId: 50, name: null, avatarUrl: null, championships: 1, wins: 4, losses: 9, ties: 0 },
  ]);
});

test('GET history allTime: order is championships desc, then wins desc (null sorts as 0), then teamId asc', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (text.startsWith('SELECT 1 FROM "teams"')) return { rows: [{ '?column?': 1 }] };
    if (text.includes('FROM "league_history"')) {
      return {
        rows: [
          {
            season: 2026,
            standings: [
              { teamId: 100, name: 'Team 100', wins: 5, losses: 5, ties: 0, pf: 1, pa: 1, winPct: 0.5, streak: 'W1', rank: 1 },
              { teamId: 50, name: 'Team 50', wins: 5, losses: 5, ties: 0, pf: 1, pa: 1, winPct: 0.5, streak: 'W1', rank: 1 },
              { teamId: 200, name: 'Team 200', wins: 3, losses: 7, ties: 0, pf: 1, pa: 1, winPct: 0.3, streak: 'L1', rank: 3 },
            ],
            pickem_only: false,
            champion_team_id: null,
            champion_name: null,
            champion_avatar_url: null,
            champion_avatar_static_url: null,
            pickem_result: null,
            ...NO_TROPHIES,
            ...NO_DRAFT_GRADES,
            all_team_ids: [100, 50, 200],
            all_team_names: ['Team 100', 'Team 50', 'Team 200'],
            all_team_avatar_urls: [null, null, null],
          },
        ],
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const token = signToken({ id: 7, username: 'member' });

  const response = await request(app)
    .get('/api/league/5/history')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.allTime.map((row) => row.teamId), [50, 100, 200]);
});
