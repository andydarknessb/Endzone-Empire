/** @jest-environment node */

const express = require('express');
const request = require('supertest');
const fixture = require('./fixtures/trade-fairness-scenarios.json');

jest.mock('../../server/modules/auth', () => ({
  requireAuth(req, _res, next) {
    req.user = { id: 7001, username: 'trade-test-manager' };
    next();
  },
}));

jest.mock('../../server/modules/pool', () => ({ query: jest.fn() }));

jest.mock('../../server/services/projection.service', () => ({
  getWeekProjections: jest.fn(),
  getRestOfSeasonProjections: jest.fn(),
  getTradeProjectionMetrics: jest.fn(),
  getPositionDefense: jest.fn(),
}));

const pool = require('../../server/modules/pool');
const projections = require('../../server/services/projection.service');
const tradesRouter = require('../../server/routes/trades.router');

const rosterSlots = [
  { key: 'QB', count: 2, eligiblePositions: ['QB'] },
  { key: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'K', count: 2, eligiblePositions: ['K'] },
  { key: 'DL', count: 2, eligiblePositions: ['DL'] },
];

function createApp() {
  // Test-only harness: mounts a single router in-process for supertest, never
  // binds a port or serves real traffic, so CSRF middleware doesn't apply.
  const app = express(); // nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage
  app.use(express.json());
  app.use('/api/trades', tradesRouter);
  return app;
}

function configureHermeticBoundaries(scenario) {
  const playerRows = scenario.players.map(({ teamId: _teamId, ...player }) => ({
    id: player.id,
    name: player.name,
    position: player.position,
  }));
  const rosterRows = scenario.players.map((player) => ({
    team_id: player.teamId,
    player_id: player.id,
    position: player.position,
  }));

  projections.getTradeProjectionMetrics.mockResolvedValue(new Map(
    scenario.players.map((player) => [player.id, {
      seasonTotalPoints: player.seasonTotalPoints,
      perGameProjection: player.perGameProjection,
      historicalWeeklyAverage: player.historicalWeeklyAverage,
      restOfSeasonValue: player.restOfSeasonValue,
    }])
  ));

  pool.query.mockImplementation(async (sql) => {
    if (sql.includes('"owner_id" = $2')) {
      return { rows: [{ id: fixture.teams.proposer.id }] };
    }
    if (sql.includes('SELECT * FROM "leagues"')) {
      return {
        rows: [{
          id: fixture.league.id,
          current_season: fixture.league.currentSeason,
          current_week: fixture.league.currentWeek,
          regular_season_weeks: fixture.league.regularSeasonWeeks,
          roster_slots: rosterSlots,
          position_caps: {},
          bench_slots: 8,
          ir_slots: 2,
        }],
      };
    }
    if (sql.includes('FROM "teams"') && sql.includes('"id" IN ($1, $2)')) {
      return { rows: [{ id: fixture.teams.proposer.id }, { id: fixture.teams.receiver.id }] };
    }
    if (sql.includes('SELECT * FROM "players"')) return { rows: playerRows };
    if (sql.includes('FROM "team_players" JOIN "players"')) return { rows: rosterRows };
    throw new Error(`Network isolation violation: unexpected database query: ${sql}`);
  });
}

async function submitTrade(scenario) {
  configureHermeticBoundaries(scenario);
  return request(createApp()).post('/api/trades/analyze').send(scenario.payload);
}

describe('Trade Fairness/Value Analysis API', () => {
  let fetchSpy;
  let suppliedFetch;

  beforeEach(() => {
    suppliedFetch = !global.fetch;
    if (suppliedFetch) {
      Object.defineProperty(global, 'fetch', {
        configurable: true,
        writable: true,
        value: jest.fn(),
      });
    }
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(
      new Error('Network isolation violation: global fetch was called')
    );
  });

  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    if (suppliedFetch) delete global.fetch;
    jest.clearAllMocks();
  });

  test('classifies a top-five RB for top-five WR exchange as Even / Fair', async () => {
    const scenario = fixture.scenarios.balanced;
    const response = await submitTrade(scenario);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      verdict: scenario.expected.verdict,
      statusBadge: scenario.expected.statusBadge,
      isBlocked: scenario.expected.isBlocked,
      collusion_risk: scenario.expected.collusionRisk,
      fairnessMarginPct: scenario.expected.fairnessMarginPct,
    });
    expect(response.body.players).toHaveLength(2);
  });

  test('blocks an elite QB for an injured third-string kicker as a collusion risk', async () => {
    const scenario = fixture.scenarios.highImbalance;
    const response = await submitTrade(scenario);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      verdict: scenario.expected.verdict,
      statusBadge: scenario.expected.statusBadge,
      isBlocked: scenario.expected.isBlocked,
      collusion_risk: scenario.expected.collusionRisk,
      fairnessMarginPct: scenario.expected.fairnessMarginPct,
    });
    expect(response.body.receiverGets).toBeGreaterThan(response.body.proposerGets * 10);
  });

  test('aggregates season, per-game, and rest-of-season values for a 3-for-3 QB/WR/DL trade', async () => {
    const scenario = fixture.scenarios.multiPlayer;
    const response = await submitTrade(scenario);

    expect(response.status).toBe(200);
    expect(response.body.players).toHaveLength(6);
    expect(response.body).toMatchObject({
      verdict: scenario.expected.verdict,
      statusBadge: scenario.expected.statusBadge,
      isBlocked: scenario.expected.isBlocked,
      collusion_risk: scenario.expected.collusionRisk,
      fairnessMarginPct: scenario.expected.fairnessMarginPct,
      aggregates: {
        offered: scenario.expected.offeredTotals,
        requested: scenario.expected.requestedTotals,
      },
    });
    expect(response.body.fairnessMarginPct).toBeCloseTo(
      Math.abs(
        scenario.expected.offeredTotals.restOfSeasonValue -
        scenario.expected.requestedTotals.restOfSeasonValue
      ) / scenario.expected.offeredTotals.restOfSeasonValue * 100,
      2
    );
  });
});
