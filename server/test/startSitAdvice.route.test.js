const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const lineupService = require('../services/lineup.service');
const projectionService = require('../services/projection.service');
const decision = require('../services/decision.service');
const teamRouter = require('../routes/team.router');
const model = require('../services/projectionModel');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'start-sit-advice-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/team', teamRouter);
const token = () => signToken({ id: 7, username: 'member' });

const ROSTER_SLOTS = [
  { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
];

const lineupEntry = (id, position, slot, overrides = {}) => ({
  id, name: `p${id}`, position, nfl_team: 'BUF', slot,
  injury_status: null, locked: false, onBye: false, bye_week: null, ...overrides,
});

const distribution = (median) => ({
  p10: median - 6, p25: median - 3, median, p75: median + 3, p90: median + 6,
});

const projectionFor = (playerId, median, extra = {}) => ({
  playerId,
  modelVersion: model.MODEL_VERSION,
  mean: median,
  ...distribution(median),
  activeProbability: 1,
  confidence: 'medium',
  sampleSize: 5,
  factors: { opponent: { available: true, pointsContribution: 0.8, opponentTeam: 'NYJ' } },
  ...extra,
});

function mockAdviceDependencies(t, {
  entries,
  projections,
  rosterSlots = ROSTER_SLOTS,
  league = { id: 3, best_ball: false, scoring_rules: null },
} = {}) {
  const projectionCalls = [];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "leagues"')) return { rows: [league] };
    if (text.includes('FROM "nfl_games"')) {
      return { rows: entries.map((e) => ({ nfl_team: e.nfl_team, opponent: 'NYJ' })) };
    }
    throw new Error(`unexpected query: ${text.slice(0, 90)}`);
  });
  t.mock.method(lineupService, 'getLineup', async () => ({
    leagueId: 3, teamId: 10, season: 2026, week: 6, currentWeek: 6,
    rosterSlots, benchSlots: 5, irSlots: 1, entries,
  }));
  t.mock.method(projectionService, 'getWeeklyProjections', async (options) => {
    projectionCalls.push(options);
    return {
      season: options.season,
      week: options.week,
      modelVersion: model.MODEL_VERSION,
      scoringHash: 'abc123',
      generatedAt: '2026-10-08T12:00:00.000Z',
      inputCutoff: '2026-10-11T17:00:00.000Z',
      sourceCoverage: {
        opponent: { status: 'available' },
        weather: { status: 'unavailable', reason: 'no verified stadium coordinates' },
        expertConsensus: { status: 'unavailable', source: null },
      },
      projections: new Map(projections),
    };
  });
  t.mock.method(projectionService, 'getPositionDefense', async () =>
    new Map([['NYJ', { RB: 21.4, WR: 15.2 }]]));
  return projectionCalls;
}

test('the advice endpoint preserves every legacy response field and type', async (t) => {
  const entries = [
    lineupEntry(1, 'RB', 'RB'),
    lineupEntry(2, 'WR', 'FLEX'),
    lineupEntry(3, 'RB', 'BENCH'),
  ];
  mockAdviceDependencies(t, {
    entries,
    projections: [
      [1, projectionFor(1, 6)],
      [2, projectionFor(2, 9)],
      [3, projectionFor(3, 18)],
    ],
  });

  const response = await request(app)
    .get('/api/team/lineup/advice?leagueId=3&season=2026&week=6')
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  const body = response.body;
  assert.equal(body.season, 2026);
  assert.equal(body.week, 6);
  assert.equal(typeof body.projectedTotal, 'number');
  assert.equal(typeof body.optimalTotal, 'number');
  assert.ok(Array.isArray(body.suggestions));
  const suggestion = body.suggestions[0];
  assert.equal(typeof suggestion.slot, 'string');
  assert.equal(typeof suggestion.gain, 'number');
  assert.equal(typeof suggestion.current.projection, 'number');
  assert.equal(typeof suggestion.suggested.projection, 'number');
  assert.equal(typeof suggestion.current.playerId, 'number');
  assert.equal(typeof suggestion.suggested.playerId, 'number');
  // Opponent display context still rides along untouched.
  assert.equal(suggestion.suggested.opponent, 'NYJ');
  assert.equal(suggestion.suggested.opponentPointsAllowed, 21.4);
});

test('the advice endpoint adds model, distribution and coverage fields', async (t) => {
  const entries = [
    lineupEntry(1, 'RB', 'RB'),
    lineupEntry(3, 'RB', 'BENCH'),
  ];
  mockAdviceDependencies(t, {
    entries,
    // RB-only, so the better bench RB is a straight swap rather than a
    // reshuffle into the (otherwise empty) FLEX.
    rosterSlots: [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] }],
    projections: [[1, projectionFor(1, 6)], [3, projectionFor(3, 18)]],
  });

  const response = await request(app)
    .get('/api/team/lineup/advice?leagueId=3')
    .set('Authorization', `Bearer ${token()}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.modelVersion, model.MODEL_VERSION);
  assert.equal(response.body.generatedAt, '2026-10-08T12:00:00.000Z');
  assert.equal(response.body.inputCutoff, '2026-10-11T17:00:00.000Z');
  assert.equal(response.body.sourceCoverage.expertConsensus.status, 'unavailable');
  assert.ok(Array.isArray(response.body.movePlan));
  assert.ok(Array.isArray(response.body.players));
  const suggestion = response.body.suggestions[0];
  assert.equal(suggestion.suggested.distribution.p90, 24);
  assert.equal(suggestion.confidence, 'medium');
  assert.ok(suggestion.probabilityBetter > 0.9);
  assert.equal(suggestion.verdict, 'start');
});

test('advice scopes the projection request to the roster and passes the league', async (t) => {
  const entries = [lineupEntry(1, 'RB', 'RB'), lineupEntry(3, 'RB', 'BENCH')];
  const calls = mockAdviceDependencies(t, {
    entries,
    projections: [[1, projectionFor(1, 6)], [3, projectionFor(3, 18)]],
    league: { id: 3, best_ball: false, scoring_rules: { receiving: { reception: 1 } } },
  });

  await decision.startSitAdvice({ leagueId: 3, userId: 7 });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].playerIds, [1, 3], 'never the whole NFL pool for one lineup');
  assert.deepEqual(calls[0].league.scoring_rules, { receiving: { reception: 1 } });
});

test('best-ball leagues still refuse advice with a 409', async (t) => {
  const projectionCalls = mockAdviceDependencies(t, {
    entries: [lineupEntry(1, 'RB', 'RB')],
    projections: [[1, projectionFor(1, 6)]],
    league: { id: 3, best_ball: true, scoring_rules: null },
  });
  // #274. This endpoint is a GET, which makes it look read-only, and it is
  // not: getLineup calls materializeLineup and INSERTs a lineup_entries row
  // for every un-materialized roster row, and getWeeklyProjections caches into
  // projection_runs and player_week_projections. Both are mocked here, so a
  // guard moved below them calls the mocks and answers the identical 409.
  const lineupReads = t.mock.method(lineupService, 'getLineup', async () => ({
    leagueId: 3, teamId: 10, season: 2026, week: 6, currentWeek: 6,
    rosterSlots: [], benchSlots: 5, irSlots: 1, entries: [],
  }));

  const response = await request(app)
    .get('/api/team/lineup/advice?leagueId=3')
    .set('Authorization', `Bearer ${token()}`);
  assert.equal(response.status, 409);
  assert.match(response.body.error, /best-ball/);
  assert.equal(lineupReads.mock.callCount(), 0, 'no lineup was materialized');
  assert.equal(projectionCalls.length, 0, 'and no projection run was cached');
});

test('a starter on a bye is reported unavailable and replaced', async (t) => {
  const entries = [
    lineupEntry(1, 'RB', 'RB', { onBye: true }),
    lineupEntry(3, 'RB', 'BENCH'),
  ];
  mockAdviceDependencies(t, {
    entries,
    projections: [[1, projectionFor(1, 20)], [3, projectionFor(3, 8)]],
  });

  const advice = await decision.startSitAdvice({ leagueId: 3, userId: 7 });
  assert.deepEqual(advice.unavailable.map((u) => [u.playerId, u.reason]), [[1, 'bye']]);
  assert.equal(advice.projectedTotal, 0);
  assert.equal(advice.suggestions[0].suggested.playerId, 3);
});

test('a DEF unit resolves its opponent even though players.nfl_team is a full team name (#423)', async (t) => {
  // players.nfl_team for a DEF is seeded as a full team name ('Denver
  // Broncos') by syncTeamDefenses, while nfl_games.nfl_team is Tank01's raw
  // abbreviation ('DEN'). getWeekOpponents must normalize both sides of that
  // comparison rather than compare them raw.
  const entries = [
    lineupEntry(1, 'DEF', 'RB', { nfl_team: 'Denver Broncos' }),
  ];
  const rosterSlots = [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['DEF'] }];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "leagues"')) return { rows: [{ id: 3, best_ball: false, scoring_rules: null }] };
    if (text.includes('FROM "nfl_games"')) return { rows: [{ nfl_team: 'DEN', opponent: 'KC' }] };
    throw new Error(`unexpected query: ${text.slice(0, 90)}`);
  });
  t.mock.method(lineupService, 'getLineup', async () => ({
    leagueId: 3, teamId: 10, season: 2026, week: 6, currentWeek: 6,
    rosterSlots, benchSlots: 5, irSlots: 1, entries,
  }));
  t.mock.method(projectionService, 'getWeeklyProjections', async (options) => ({
    season: options.season,
    week: options.week,
    modelVersion: model.MODEL_VERSION,
    scoringHash: 'abc123',
    generatedAt: '2026-10-08T12:00:00.000Z',
    inputCutoff: '2026-10-11T17:00:00.000Z',
    sourceCoverage: {
      opponent: { status: 'available' },
      weather: { status: 'unavailable', reason: 'no verified stadium coordinates' },
      expertConsensus: { status: 'unavailable', source: null },
    },
    projections: new Map([[1, projectionFor(1, 7)]]),
  }));
  t.mock.method(projectionService, 'getPositionDefense', async () =>
    new Map([['KC', { DEF: 5.5 }]]));

  const advice = await decision.startSitAdvice({ leagueId: 3, userId: 7 });
  const defPlayer = advice.players.find((p) => p.playerId === 1);
  assert.equal(defPlayer.opponent, 'KC');
  assert.equal(defPlayer.opponentPointsAllowed, 5.5);
});

test('a skill player raw-coded WSH still resolves against a raw-coded WSH schedule row (#423)', async (t) => {
  const entries = [
    lineupEntry(2, 'WR', 'RB', { nfl_team: 'WSH' }),
  ];
  const rosterSlots = [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['WR'] }];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "leagues"')) return { rows: [{ id: 3, best_ball: false, scoring_rules: null }] };
    if (text.includes('FROM "nfl_games"')) return { rows: [{ nfl_team: 'WSH', opponent: 'DAL' }] };
    throw new Error(`unexpected query: ${text.slice(0, 90)}`);
  });
  t.mock.method(lineupService, 'getLineup', async () => ({
    leagueId: 3, teamId: 10, season: 2026, week: 6, currentWeek: 6,
    rosterSlots, benchSlots: 5, irSlots: 1, entries,
  }));
  t.mock.method(projectionService, 'getWeeklyProjections', async (options) => ({
    season: options.season,
    week: options.week,
    modelVersion: model.MODEL_VERSION,
    scoringHash: 'abc123',
    generatedAt: '2026-10-08T12:00:00.000Z',
    inputCutoff: '2026-10-11T17:00:00.000Z',
    sourceCoverage: {
      opponent: { status: 'available' },
      weather: { status: 'unavailable', reason: 'no verified stadium coordinates' },
      expertConsensus: { status: 'unavailable', source: null },
    },
    projections: new Map([[2, projectionFor(2, 9)]]),
  }));
  t.mock.method(projectionService, 'getPositionDefense', async () =>
    new Map([['DAL', { WR: 12.3 }]]));

  const advice = await decision.startSitAdvice({ leagueId: 3, userId: 7 });
  const wrPlayer = advice.players.find((p) => p.playerId === 2);
  assert.equal(wrPlayer.opponent, 'DAL');
  assert.equal(wrPlayer.opponentPointsAllowed, 12.3);
});

test('advice never lists a player in two recommendations', async (t) => {
  const entries = [
    lineupEntry(1, 'RB', 'RB'),
    lineupEntry(2, 'WR', 'FLEX'),
    lineupEntry(3, 'RB', 'BENCH'),
    lineupEntry(4, 'WR', 'BENCH'),
  ];
  mockAdviceDependencies(t, {
    entries,
    projections: [
      [1, projectionFor(1, 4)],
      [2, projectionFor(2, 5)],
      [3, projectionFor(3, 22)],
      [4, projectionFor(4, 19)],
    ],
  });

  const advice = await decision.startSitAdvice({ leagueId: 3, userId: 7 });
  const mentioned = advice.suggestions.flatMap((s) => [s.current.playerId, s.suggested.playerId]);
  assert.equal(new Set(mentioned).size, mentioned.length);
  assert.equal(advice.optimalTotal, 41, 'RB 22 at RB and WR 19 at FLEX, the exact optimum');
});
