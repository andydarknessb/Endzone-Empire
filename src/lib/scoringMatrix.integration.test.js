const mockRapidApiGet = jest.fn();
const mockSupabaseUpsert = jest.fn().mockResolvedValue({ data: [], error: null });
const mockSupabaseSelect = jest.fn().mockReturnValue({
  eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }),
});
const mockSupabaseClient = {
  from: jest.fn().mockReturnValue({ upsert: mockSupabaseUpsert, select: mockSupabaseSelect }),
  channel: jest.fn(),
  removeChannel: jest.fn(),
};

jest.mock('axios', () => ({
  create: jest.fn(() => ({ get: mockRapidApiGet })),
}));
jest.mock('../../server/modules/pool', () => ({ query: jest.fn() }));
jest.mock('../../server/modules/io', () => ({ getIo: jest.fn(() => null) }));
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

const axios = require('axios');
const pool = require('../../server/modules/pool');
const { createClient } = require('@supabase/supabase-js');
const payload = require('./fixtures/tank01-scoring-matrix.json');
const {
  calculateFantasyPoints,
  extractPlayByPlayBonusStats,
  isValidTierArray,
  normalizeTank01IdpStats,
  normalizeTank01Stats,
  rulesForLeague,
  syncWeekStats,
} = require('../../server/services/scoring.service');

const ORIGINAL_ENV = {
  rapidApiKey: process.env.RAPID_API_KEY,
  rapidApiHost: process.env.RAPID_API_HOST,
  supabaseUrl: process.env.REACT_APP_SUPABASE_URL,
  supabaseKey: process.env.REACT_APP_SUPABASE_ANON_KEY,
};

const MATRIX_RULES = rulesForLeague({
  scoring_rules: {
    passing: {
      yards: 0.1,
      yardageBonus: [
        { min: 0, max: 99, points: 0 },
        { min: 100, max: 149, points: 5 },
        { min: 150, max: null, points: 10 },
      ],
    },
    rushing: {
      yards: 0.15,
      yardageBonus: [
        { min: 0, max: 99, points: 0 },
        { min: 100, max: 149, points: 5 },
        { min: 150, max: null, points: 10 },
      ],
    },
    kicking: {
      fieldGoal: [
        { min: 0, max: 39, points: 3 },
        { min: 40, max: 49, points: 4 },
        { min: 50, max: null, points: 5, pointsPerYardOverMin: 0.1 },
      ],
    },
    idp: {
      soloTackle: 1,
      assistedTackle: 0.5,
      sackYards: -0.1,
    },
  },
});

let fetchSpy;
let suppliedFetch = false;

beforeAll(() => {
  process.env.RAPID_API_KEY = 'unit-test-key';
  process.env.RAPID_API_HOST = 'tank01.test.invalid';
  process.env.REACT_APP_SUPABASE_URL = 'https://supabase.test.invalid';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  if (!global.fetch) {
    suppliedFetch = true;
    Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: jest.fn() });
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  axios.create.mockReturnValue({ get: mockRapidApiGet });
  createClient.mockReturnValue(mockSupabaseClient);
  mockSupabaseClient.from.mockReturnValue({
    upsert: mockSupabaseUpsert,
    select: mockSupabaseSelect,
  });
  mockSupabaseUpsert.mockResolvedValue({ data: [], error: null });
  fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(
    new Error('Network isolation violation: global fetch was called')
  );
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

afterAll(() => {
  const restoreEnv = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restoreEnv('RAPID_API_KEY', ORIGINAL_ENV.rapidApiKey);
  restoreEnv('RAPID_API_HOST', ORIGINAL_ENV.rapidApiHost);
  restoreEnv('REACT_APP_SUPABASE_URL', ORIGINAL_ENV.supabaseUrl);
  restoreEnv('REACT_APP_SUPABASE_ANON_KEY', ORIGINAL_ENV.supabaseKey);
  if (suppliedFetch) delete global.fetch;
});

describe('custom scoring matrix', () => {
  test('scores fractional passing and rushing yardage exactly to two decimals', () => {
    expect(calculateFantasyPoints({ passingYards: 99 }, MATRIX_RULES)).toBe(9.9);
    expect(calculateFantasyPoints(payload.edgeCases.fractionalYardage, MATRIX_RULES)).toBe(14.85);
  });

  test.each([
    [99, 14.85, 0],
    [100, 20, 5],
    [149, 27.35, 5],
    [150, 32.5, 10],
    [151, 32.65, 10],
  ])('applies exactly one rushing yardage tier at %i yards', (yards, expectedTotal, expectedBonus) => {
    const basePoints = Math.round(yards * 0.15 * 100) / 100;
    const total = calculateFantasyPoints({ rushingYards: yards }, MATRIX_RULES);

    expect(total).toBe(expectedTotal);
    expect(Math.round((total - basePoints) * 100) / 100).toBe(expectedBonus);
  });

  test.each([
    [1, 3],
    [39, 3],
    [40, 4],
    [49, 4],
    [50, 5],
    [53, 5.3],
  ])('scores a %i-yard field goal as %s points', (distance, expected) => {
    expect(calculateFantasyPoints({ fieldGoalDistances: [distance] }, MATRIX_RULES)).toBe(expected);
  });

  test('prices every made field goal independently before summing', () => {
    expect(
      calculateFantasyPoints(
        { fieldGoalDistances: payload.edgeCases.fieldGoalDistances },
        MATRIX_RULES
      )
    ).toBe(24.3);
  });

  test('combines solo and assisted tackles and deducts sack yardage', () => {
    expect(calculateFantasyPoints(payload.edgeCases.idp, MATRIX_RULES)).toBe(6.7);
  });

  test('preserves incremental tier rates through league-rule validation', () => {
    expect(MATRIX_RULES.kicking.fieldGoal[2]).toEqual({
      min: 50,
      max: null,
      points: 5,
      pointsPerYardOverMin: 0.1,
    });
    expect(isValidTierArray(MATRIX_RULES.kicking.fieldGoal)).toBe(true);
    expect(
      isValidTierArray([
        { min: 0, max: 50, points: 3 },
        { min: 50, max: null, points: 5, pointsPerYardOverMin: 0.1 },
      ])
    ).toBe(false);
  });
});

describe('Tank01 payload normalization', () => {
  test('normalizes string rushing stats before fractional scoring', () => {
    const stats = normalizeTank01Stats(payload.boxScore.playerStats['rush-99']);

    expect(stats.rushingYards).toBe(99);
    expect(calculateFantasyPoints(stats, MATRIX_RULES)).toBe(14.85);
  });

  test('derives split tackles as total tackles minus solo tackles', () => {
    const stats = normalizeTank01IdpStats(payload.boxScore.playerStats['idp-1']);

    expect(stats.soloTackle).toBe(4);
    expect(stats.assistedTackle).toBe(3);
  });

  test('extracts the individual made-kick distance from play-by-play', () => {
    const bonuses = extractPlayByPlayBonusStats(payload.boxScore.allPlayByPlay);

    expect(bonuses.get('kick-53').fieldGoalDistances).toEqual([53]);
    expect(calculateFantasyPoints(bonuses.get('kick-53'), MATRIX_RULES)).toBe(5.3);
  });
});

describe('isolated Tank01 ingestion and database update', () => {
  test('uses mocked Axios and PostgreSQL boundaries without fetch or Supabase traffic', async () => {
    mockRapidApiGet.mockImplementation(async (path) => {
      if (path === '/getNFLGamesForWeek') {
        return { data: { statusCode: 200, body: payload.games } };
      }
      if (path === '/getNFLBoxScore') {
        return { data: { statusCode: 200, body: payload.boxScore } };
      }
      throw new Error(`Unexpected Tank01 path: ${path}`);
    });
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM "players" WHERE "external_id" IS NOT NULL')) {
        return {
          rows: [
            { id: 101, external_id: 'rush-99', name: 'Boundary Runner', position: 'RB', nfl_team: 'SEA' },
            { id: 102, external_id: 'kick-53', name: 'Long Kicker', position: 'K', nfl_team: 'BAL' },
            { id: 103, external_id: 'idp-1', name: 'Split Tackler', position: 'LB', nfl_team: 'PIT' },
          ],
        };
      }
      if (sql.includes('FROM "players" WHERE "position" = \'DEF\'')) return { rows: [] };
      if (sql.includes('FROM "player_stats"')) return { rows: [] };
      if (sql.includes('FROM "nfl_games"')) return { rows: [] };
      if (sql.includes('INSERT INTO "player_stats"')) return { rowCount: 1 };
      throw new Error(`Unexpected database query: ${sql}`);
    });

    const result = await syncWeekStats({ season: 2026, week: 1 });

    expect(result).toEqual({
      season: 2026,
      week: 1,
      playersUpdated: 3,
      gamesProcessed: 1,
      plays: [
        {
          playerId: 102,
          name: 'Long Kicker',
          position: 'K',
          nflTeam: 'BAL',
          opponent: null,
          type: 'fieldGoal',
          tdDelta: 1,
          pointsDelta: 5,
          isTouchdown: false,
        },
      ],
    });
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'https://tank01.test.invalid',
        headers: expect.objectContaining({ 'X-RapidAPI-Key': 'unit-test-key' }),
      })
    );
    expect(mockRapidApiGet).toHaveBeenNthCalledWith(1, '/getNFLGamesForWeek', {
      params: { week: 1, seasonType: 'reg', season: 2026 },
    });
    expect(mockRapidApiGet).toHaveBeenNthCalledWith(2, '/getNFLBoxScore', {
      params: {
        gameID: '20260913_SEA@BAL',
        playByPlay: 'true',
        fantasyPoints: 'false',
      },
    });

    const upserts = pool.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO "player_stats"'));
    expect(upserts).toHaveLength(3);
    expect(upserts.map(([, values]) => [values[0], values[4]])).toEqual([
      [101, 9.9],
      [102, 5],
      [103, 7.5],
    ]);
    expect(mockSupabaseClient.from).not.toHaveBeenCalled();
  });
});

describe('Supabase JS mock layout', () => {
  test('provides inert query and write methods for client-side tests', async () => {
    const client = createClient('https://supabase.test.invalid', 'unit-test-anon-key');

    expect(client).toBe(mockSupabaseClient);
    expect(jest.isMockFunction(client.from)).toBe(true);
    expect(jest.isMockFunction(client.channel)).toBe(true);
    expect(jest.isMockFunction(client.removeChannel)).toBe(true);
    await expect(client.from('player_stats').upsert([{ player_id: 101 }])).resolves.toEqual({
      data: [],
      error: null,
    });
  });
});
