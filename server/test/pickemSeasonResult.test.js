const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { declare, resultOf } = require('../services/pickemSeasonResult.service');

function resultWorld() {
  let stored = null;
  const trophies = [];
  const db = createFakePool([
    [/^INSERT INTO "pickem_season_results"/, (text, params) => {
      if (stored) return { rows: [] };
      stored = {
        league_id: params[0],
        season: params[1],
        outcome: params[2],
        scoring_mode: params[3],
        champions: JSON.parse(params[4]),
        provenance: { source: 'season_completion' },
        declared_at: '2027-01-11T06:00:00.000Z',
      };
      return { rows: [stored] };
    }],
    [/^SELECT .* FROM "pickem_season_results"/, () => ({ rows: stored ? [stored] : [] })],
    [/^INSERT INTO "trophies"/, (text, params) => {
      trophies.push({
        leagueId: params[0], teamId: params[1], season: params[2], week: params[3],
        type: params[4], label: params[5], data: JSON.parse(params[6]),
      });
      return { rows: [{ id: trophies.length }] };
    }],
  ]);
  return { db, trophies, stored: () => stored };
}

test('declare snapshots the champion and resultOf reads the declared result', async () => {
  const world = resultWorld();
  const standings = [
    {
      rank: 1,
      userId: 100,
      username: 'alice',
      teamId: 10,
      teamName: 'Sunday Ballers',
      avatarUrl: 'https://cdn.example/team.png',
      avatarStaticUrl: 'https://cdn.example/team-static.png',
      points: 2,
      correct: 2,
    },
    {
      rank: 2,
      userId: 101,
      username: 'bob',
      teamId: 11,
      teamName: 'Bob Squad',
      avatarUrl: null,
      avatarStaticUrl: null,
      points: 1,
      correct: 1,
    },
  ];

  const declared = await declare({
    db: world.db, leagueId: 1, season: 2026, standings, mode: 'straight',
  });

  const champion = {
    teamId: 10,
    teamName: 'Sunday Ballers',
    avatarUrl: 'https://cdn.example/team.png',
    avatarStaticUrl: 'https://cdn.example/team-static.png',
    points: 2,
    correct: 2,
    mode: 'straight',
  };
  assert.deepEqual(declared, {
    leagueId: 1,
    season: 2026,
    outcome: 'champions',
    mode: 'straight',
    champions: [champion],
    provenance: { source: 'season_completion' },
    declaredAt: '2027-01-11T06:00:00.000Z',
    awarded: [{ type: 'pickem_champion', teamId: 10, label: "2026 Pick'em Champion" }],
  });
  assert.deepEqual(await resultOf({ db: world.db, leagueId: 1, season: 2026 }), {
    leagueId: 1,
    season: 2026,
    outcome: 'champions',
    mode: 'straight',
    champions: [champion],
    provenance: { source: 'season_completion' },
    declaredAt: '2027-01-11T06:00:00.000Z',
  });
  assert.deepEqual(world.trophies, [{
    leagueId: 1,
    teamId: 10,
    season: 2026,
    week: 0,
    type: 'pickem_champion',
    label: "2026 Pick'em Champion",
    data: { points: 2, correct: 2, mode: 'straight' },
  }]);
});

test('resultOf distinguishes a declared no-champion season from a missing result', async () => {
  const declaredWorld = resultWorld();
  const declaration = await declare({
    db: declaredWorld.db,
    leagueId: 2,
    season: 2026,
    mode: 'confidence',
    standings: [
      {
        rank: 1,
        userId: 200,
        username: 'casey',
        teamId: 20,
        teamName: 'Casey Crew',
        avatarUrl: null,
        avatarStaticUrl: null,
        points: 0,
        correct: 0,
      },
    ],
  });
  assert.deepEqual(declaration, {
    leagueId: 2,
    season: 2026,
    outcome: 'no_champion',
    mode: 'confidence',
    champions: [],
    provenance: { source: 'season_completion' },
    declaredAt: '2027-01-11T06:00:00.000Z',
    awarded: [],
  });
  assert.deepEqual(
    await resultOf({ db: declaredWorld.db, leagueId: 2, season: 2026 }),
    {
      leagueId: 2,
      season: 2026,
      outcome: 'no_champion',
      mode: 'confidence',
      champions: [],
      provenance: { source: 'season_completion' },
      declaredAt: '2027-01-11T06:00:00.000Z',
    }
  );

  const missingWorld = resultWorld();
  assert.deepEqual(await resultOf({ db: missingWorld.db, leagueId: 2, season: 2025 }), {
    leagueId: 2,
    season: 2025,
    outcome: 'missing',
    mode: null,
    champions: [],
    provenance: null,
    declaredAt: null,
  });
  assert.deepEqual(declaredWorld.trophies, []);
});

test('declare refuses a champion whose historical Team identity is incomplete', async () => {
  const complete = {
    rank: 1,
    userId: 300,
    username: 'devon',
    teamId: 30,
    teamName: 'Devon Defense',
    avatarUrl: null,
    avatarStaticUrl: null,
    points: 4,
    correct: 4,
  };
  const incomplete = [
    ['Team id', { teamId: null }],
    ['Team name', { teamName: '   ' }],
  ];

  for (const [label, missing] of incomplete) {
    const world = resultWorld();
    await assert.rejects(
      declare({
        db: world.db,
        leagueId: 3,
        season: 2026,
        mode: 'straight',
        standings: [{ ...complete, ...missing }],
      }),
      (error) => error.code === 'PICKEM_SEASON_RESULT_IDENTITY_REQUIRED',
      label
    );
    assert.equal(world.stored(), null, `${label}: invalid declaration must not be inserted`);
    assert.deepEqual(world.trophies, [], `${label}: invalid declaration must not project a trophy`);
  }
});

test('declare is idempotent for an identical result and rejects a conflict', async () => {
  const world = resultWorld();
  const alice = {
    rank: 1,
    userId: 400,
    username: 'alice',
    teamId: 40,
    teamName: 'Alice Eleven',
    avatarUrl: null,
    avatarStaticUrl: null,
    points: 12,
    correct: 10,
  };
  const bob = {
    rank: 2,
    userId: 401,
    username: 'bob',
    teamId: 41,
    teamName: 'Bob Eleven',
    avatarUrl: null,
    avatarStaticUrl: null,
    points: 11,
    correct: 9,
  };

  const first = await declare({
    db: world.db, leagueId: 4, season: 2026, standings: [alice, bob], mode: 'straight',
  });
  const retry = await declare({
    db: world.db, leagueId: 4, season: 2026, standings: [alice, bob], mode: 'straight',
  });

  assert.deepEqual(retry, { ...first, awarded: [] });
  assert.equal(world.trophies.length, 1, 'an identical retry does not project the trophy again');

  await assert.rejects(
    declare({
      db: world.db,
      leagueId: 4,
      season: 2026,
      standings: [{ ...bob, rank: 1, points: 13, correct: 11 }, alice],
      mode: 'straight',
    }),
    (error) => error.code === 'PICKEM_SEASON_RESULT_CONFLICT'
  );
  assert.deepEqual(
    (await resultOf({ db: world.db, leagueId: 4, season: 2026 })).champions.map((row) => row.teamId),
    [40]
  );
  assert.equal(world.trophies.length, 1, 'a conflict does not append another winner');
});

test('declare refuses an invalid scoring mode or incomplete scoring snapshot before writing', async () => {
  const champion = {
    rank: 1,
    userId: 500,
    username: 'erin',
    teamId: 50,
    teamName: 'Erin Eleven',
    avatarUrl: null,
    avatarStaticUrl: null,
    points: 9,
    correct: 8,
  };
  const invalid = [
    ['mode', 'weekly', champion],
    ['points', 'straight', { ...champion, points: undefined }],
    ['null points', 'straight', { ...champion, points: null }],
    ['blank points', 'straight', { ...champion, points: '   ' }],
    ['correct picks', 'straight', { ...champion, correct: -1 }],
    ['null correct picks', 'straight', { ...champion, correct: null }],
  ];

  for (const [label, mode, row] of invalid) {
    const world = resultWorld();
    await assert.rejects(
      declare({ db: world.db, leagueId: 5, season: 2026, standings: [row], mode }),
      (error) => error.code === 'PICKEM_SEASON_RESULT_INVALID',
      label
    );
    assert.equal(world.stored(), null, `${label}: invalid declaration must not be inserted`);
  }
});
