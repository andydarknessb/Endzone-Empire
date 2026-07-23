/** @jest-environment node */

const express = require('express');
const request = require('supertest');
const fixture = require('./fixtures/lineup-lock-timeline.json');

jest.mock('../../server/modules/auth', () => ({
  requireAuth(req, _res, next) {
    req.user = { id: 7, username: 'timeline-manager' };
    next();
  },
}));
jest.mock('../../server/modules/pool', () => ({ connect: jest.fn() }));
// team.router transitively pulls in supabaseAdmin.js, which calls the real
// createClient() on import whenever .env supplies SUPABASE_* vars. That in turn
// references the Fetch API's global Headers, which Jest 27's sandboxed node
// environment doesn't expose (unlike Node itself) — so the import throws
// "Headers is not defined". This suite never touches Supabase, so stub the
// client out (same pattern as multiSeasonRollover.integration.test.js).
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ storage: { from: jest.fn() } })),
}));

const pool = require('../../server/modules/pool');
const teamRouter = require('../../server/routes/team.router');
const { lockedNflTeams } = require('../../server/services/lineup.service');

function createDatabaseFixture() {
  const { league, players, timeline } = fixture;
  const state = {
    rostered: new Set([players.playerA.id, players.playerB.id]),
    slots: new Map([
      [players.playerA.id, players.playerA.slot],
      [players.playerB.id, players.playerB.slot],
    ]),
    waiverPlayers: new Set(),
    transactions: [],
  };
  const playerRows = [players.playerA, players.playerB].map((player) => ({
    player_id: player.id,
    position: player.position,
    nfl_team: player.nflTeam,
  }));
  const games = [players.playerA, players.playerB].map((player) => ({
    nfl_team: player.nflTeam,
    kickoff_at: new Date(player.kickoffAt),
  }));

  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, values = []) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT * FROM "leagues"')) {
        return {
          rows: [{
            id: league.id,
            current_season: league.season,
            current_week: league.week,
            best_ball: false,
            roster_slots: [{ key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] }],
            bench_slots: 1,
            ir_slots: 0,
          }],
        };
      }
      if (sql.includes('SELECT * FROM "teams"')) {
        return { rows: [{ id: league.teamId, owner_id: league.userId, locked: false }] };
      }
      if (sql.includes('SELECT "id", "locked" FROM "teams"')) {
        return { rows: [{ id: league.teamId, locked: false }] };
      }
      if (sql.includes('SELECT "team_players"."player_id"') && sql.includes('FROM "team_players"')) {
        return { rows: playerRows.filter((row) => state.rostered.has(row.player_id)) };
      }
      if (sql.includes('SELECT "player_id" FROM "lineup_entries"')) {
        return {
          rows: playerRows
            .filter((row) => state.rostered.has(row.player_id))
            .map((row) => ({ player_id: row.player_id })),
        };
      }
      if (sql.includes('SELECT "lineup_entries"."player_id"')) {
        return {
          rows: playerRows
            .filter((row) => state.rostered.has(row.player_id))
            .map((row) => ({ ...row, slot: state.slots.get(row.player_id) })),
        };
      }
      if (sql.includes('FROM "nfl_games"') && sql.includes('"kickoff_at" <= $3')) {
        const serverNow = new Date(values[2]);
        return { rows: games.filter((game) => game.kickoff_at <= serverNow) };
      }
      if (sql.includes('UPDATE "lineup_entries" SET "slot"')) {
        state.slots.set(values[4], values[0]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('DELETE FROM "team_players"')) {
        const playerId = values[1];
        if (!state.rostered.delete(playerId)) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [{ id: playerId }] };
      }
      if (sql.includes('SELECT "waiver_period_hours" FROM "leagues"')) {
        return { rows: [{ waiver_period_hours: 24 }] };
      }
      if (sql.includes('INSERT INTO "waiver_players"')) {
        state.waiverPlayers.add(values[1]);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes('INSERT INTO "transactions"')) {
        state.transactions.push({ type: values[2], detail: JSON.parse(values[3]) });
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected database query: ${sql}`);
    }),
  };

  return { client, state };
}

function createApp() {
  // Test-only harness: mounts a single router in-process for supertest, never
  // binds a port or serves real traffic, so CSRF middleware doesn't apply.
  const app = express(); // nosemgrep: javascript.express.security.audit.express-check-csurf-middleware-usage.express-check-csurf-middleware-usage
  app.use(express.json());
  app.use('/api/team', teamRouter);
  return app;
}

describe('individual-player lineup lock timeline', () => {
  let client;
  let state;
  let fetchSpy;
  let suppliedFetch;

  beforeEach(() => {
    jest.useFakeTimers();
    ({ client, state } = createDatabaseFixture());
    pool.connect.mockResolvedValue(client);
    suppliedFetch = !global.fetch;
    if (suppliedFetch) {
      Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: jest.fn() });
    }
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(
      new Error('Network isolation violation: global fetch was called')
    );
  });

  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    if (suppliedFetch) delete global.fetch;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('permits the same FLEX/bench swap one second before Player A kicks off', async () => {
    jest.setSystemTime(new Date(fixture.timeline.beforeKickoff));

    const response = await request(createApp())
      .post(fixture.requests.swap.path)
      .send(fixture.requests.swap.body);

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(2);
    expect(state.slots.get(fixture.players.playerA.id)).toBe('BENCH');
    expect(state.slots.get(fixture.players.playerB.id)).toBe('FLEX');
  });

  test('locks Player A at the exact 13:00:00 kickoff boundary', async () => {
    jest.setSystemTime(new Date(fixture.timeline.playerAKickoff));

    const response = await request(createApp())
      .post(fixture.requests.swap.path)
      .send(fixture.requests.swap.body);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe('LINEUP_LOCKED');
    expect(state.slots.get(fixture.players.playerA.id)).toBe('FLEX');
    expect(state.slots.get(fixture.players.playerB.id)).toBe('BENCH');
  });

  test('rejects Player A at 13:00:01 but still permits dropping unlocked Player B at 13:01:00', async () => {
    jest.setSystemTime(new Date(fixture.timeline.lockedSwapAttempt));

    const swapResponse = await request(createApp())
      .post(fixture.requests.swap.path)
      .send(fixture.requests.swap.body);

    expect(swapResponse.status).toBe(409);
    expect(swapResponse.body).toEqual({
      error: 'LINEUP_LOCKED',
      message: 'that player is locked — his game has started',
    });
    expect(state.slots.get(fixture.players.playerA.id)).toBe('FLEX');
    expect(state.slots.get(fixture.players.playerB.id)).toBe('BENCH');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('"kickoff_at" <= $3'),
      [fixture.league.season, fixture.league.week, new Date(fixture.timeline.lockedSwapAttempt)]
    );

    jest.setSystemTime(new Date(fixture.timeline.benchTransactionAttempt));
    const lockedTeams = await lockedNflTeams(client, {
      season: fixture.league.season,
      week: fixture.league.week,
    });
    expect(lockedTeams).toEqual(new Set([fixture.players.playerA.nflTeam]));
    expect(lockedTeams.has(fixture.players.playerB.nflTeam)).toBe(false);

    const dropResponse = await request(createApp()).delete(fixture.requests.dropPlayerB.path);

    expect(dropResponse.status).toBe(200);
    expect(dropResponse.body).toEqual({
      leagueId: fixture.league.id,
      teamId: fixture.league.teamId,
      playerId: fixture.players.playerB.id,
    });
    expect(state.rostered.has(fixture.players.playerA.id)).toBe(true);
    expect(state.rostered.has(fixture.players.playerB.id)).toBe(false);
    expect(state.waiverPlayers.has(fixture.players.playerB.id)).toBe(true);
    expect(state.transactions).toEqual([
      { type: 'drop', detail: { playerId: fixture.players.playerB.id } },
    ]);
  });
});
