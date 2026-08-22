const mockPoolConnect = jest.fn();
const mockLogTransaction = jest.fn().mockResolvedValue(undefined);
const mockNotifyLeague = jest.fn().mockResolvedValue(undefined);
const mockSupabaseFrom = jest.fn(() => ({
  upsert: jest.fn().mockResolvedValue({ data: null, error: null }),
}));
const mockSupabaseClient = { from: mockSupabaseFrom };

jest.mock('../../server/modules/pool', () => ({ connect: mockPoolConnect }));
jest.mock('../../server/services/activity.service', () => ({
  logTransaction: mockLogTransaction,
  notify: jest.fn().mockResolvedValue(undefined),
  notifyLeague: mockNotifyLeague,
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabaseClient),
}));

const { createClient } = require('@supabase/supabase-js');
const { rolloverSeason } = require('../../server/services/commissioner.service');

const LEAGUE_ID = 77;
const COMMISSIONER_USER_ID = 900;

function completedSeasonState() {
  return {
    league: {
      id: LEAGUE_ID,
      owner_id: COMMISSIONER_USER_ID,
      current_season: 2025,
      current_week: 17,
      season_status: 'complete',
      faab_budget: 150,
    },
    teams: [
      { id: 11, league_id: LEAGUE_ID, owner_id: 101, name: 'Gridiron Kings', faab_remaining: 8 },
      { id: 12, league_id: LEAGUE_ID, owner_id: 102, name: 'Fourth and Long', faab_remaining: 44 },
      { id: 13, league_id: LEAGUE_ID, owner_id: 103, name: 'Sunday Scaries', faab_remaining: 0 },
      { id: 14, league_id: LEAGUE_ID, owner_id: 104, name: 'Goal Line Stand', faab_remaining: 91 },
    ],
    rosters: [
      { team_id: 11, player_id: 501, player_name: 'Alpha Quarterback', position: 'QB', nfl_team: 'KC' },
      { team_id: 11, player_id: 502, player_name: 'Bravo Receiver', position: 'WR', nfl_team: 'BUF' },
      { team_id: 12, player_id: 503, player_name: 'Charlie Runner', position: 'RB', nfl_team: 'DET' },
      { team_id: 13, player_id: 504, player_name: 'Delta Tight End', position: 'TE', nfl_team: 'SF' },
      { team_id: 14, player_id: 505, player_name: 'Echo Kicker', position: 'K', nfl_team: 'DAL' },
    ],
    matchups: [
      { week: 1, home_team_id: 11, away_team_id: 12, home_score: 120, away_score: 101, final: true, is_playoff: false },
      { week: 1, home_team_id: 13, away_team_id: 14, home_score: 87, away_score: 99, final: true, is_playoff: false },
      { week: 2, home_team_id: 11, away_team_id: 14, home_score: 133, away_score: 110, final: true, is_playoff: false },
      { week: 2, home_team_id: 12, away_team_id: 13, home_score: 95, away_score: 90, final: true, is_playoff: false },
      { week: 17, home_team_id: 11, away_team_id: 12, home_score: 141, away_score: 139, final: true, is_playoff: true, is_consolation: false },
    ],
    trophies: [
      { team_id: 11, season: 2025, week: 1, type: 'weekly_high', label: 'Week 1 High Score', data: { points: 120 }, awarded_at: '2025-09-09T00:00:00.000Z' },
      { team_id: 14, season: 2025, week: 2, type: 'comeback', label: 'Biggest Comeback', data: { probability: 0.08 }, awarded_at: '2025-09-16T00:00:00.000Z' },
    ],
    history: null,
    committed: false,
    rolledBack: false,
  };
}

function transactionHarness(state) {
  const queryLog = [];
  let currentStateChanged = false;

  const client = {
    release: jest.fn(),
    query: jest.fn(async (sql, values = []) => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      queryLog.push({ sql: normalized, values: [...values] });

      if (normalized === 'BEGIN') return { rows: [] };
      if (normalized === 'COMMIT') {
        state.committed = true;
        return { rows: [] };
      }
      if (normalized === 'ROLLBACK') {
        state.rolledBack = true;
        return { rows: [] };
      }
      // requireCommissioner selects the league plus an is_commissioner flag
      // (owner or co-commissioner) — the caller here is the owner.
      if (normalized.includes('FROM "leagues"') && normalized.includes('FOR UPDATE')) {
        return { rows: [{ ...state.league, is_commissioner: true }] };
      }
      if (normalized.includes('SELECT "id", "name", "owner_id" FROM "teams"')) {
        return { rows: state.teams.map((team) => ({ ...team })) };
      }
      if (normalized.includes('SELECT * FROM "matchups"')) {
        return { rows: state.matchups.map((matchup) => ({ ...matchup })) };
      }
      if (normalized.includes('FROM "team_players"') && normalized.includes('JOIN "players"')) {
        return { rows: state.rosters.map((roster) => ({ ...roster })) };
      }
      if (normalized.startsWith('DELETE FROM "trophies"')) {
        state.trophies = state.trophies.filter(
          (trophy) => !(trophy.season === values[1] && trophy.week === 0 && trophy.type === 'champion')
        );
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith('INSERT INTO "trophies"')) {
        if (currentStateChanged) throw new Error('trophy archive occurred after active-state mutation');
        const champion = {
          team_id: values[1],
          season: values[2],
          week: 0,
          type: 'champion',
          label: values[3],
          data: {},
          awarded_at: '2026-01-02T00:00:00.000Z',
        };
        state.trophies = state.trophies.filter(
          (trophy) => !(trophy.season === values[2] && trophy.week === 0 && trophy.type === 'champion')
        );
        state.trophies.push(champion);
        return { rows: [], rowCount: 1 };
      }
      if (normalized.includes('FROM "trophies" WHERE')) {
        return {
          rows: state.trophies
            .filter((trophy) => trophy.season === values[1])
            .sort((a, b) => a.week - b.week || a.type.localeCompare(b.type))
            .map((trophy) => ({ ...trophy })),
        };
      }
      if (normalized.startsWith('INSERT INTO "league_history"')) {
        if (currentStateChanged) throw new Error('history archive occurred after active-state mutation');
        state.history = {
          league_id: values[0],
          season: values[1],
          champion_team_id: values[2],
          champion_user_id: values[3],
          standings: JSON.parse(values[4]),
          rosters: JSON.parse(values[5]),
          awards: JSON.parse(values[6]),
        };
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith('DELETE FROM "team_players"')) {
        currentStateChanged = true;
        state.rosters = [];
        return { rows: [], rowCount: 5 };
      }
      if (normalized.startsWith('UPDATE "teams" SET "faab_remaining"')) {
        currentStateChanged = true;
        state.teams.forEach((team) => {
          team.faab_remaining = values[0];
        });
        return { rows: [], rowCount: state.teams.length };
      }
      if (normalized.startsWith('UPDATE "leagues"')) {
        currentStateChanged = true;
        state.league.current_season = values[0];
        state.league.current_week = 1;
        state.league.season_status = 'regular';
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
  };

  return { client, queryLog };
}

describe('multi-season rollover transaction', () => {
  let state;
  let queryLog;
  let result;
  let fetchSpy;

  beforeAll(async () => {
    state = completedSeasonState();
    const harness = transactionHarness(state);
    queryLog = harness.queryLog;
    mockPoolConnect.mockResolvedValue(harness.client);
    createClient('https://supabase.test.invalid', 'test-only-key');
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(
      new Error('Network isolation violation: global fetch was called')
    );

    result = await rolloverSeason({
      leagueId: LEAGUE_ID,
      userId: COMMISSIONER_USER_ID,
      keepers: [],
    });
  });

  afterAll(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('archives final standings, roster snapshots, and trophies before reset queries', () => {
    const trophyWriteIndex = queryLog.findIndex(({ sql }) => sql.startsWith('INSERT INTO "trophies"'));
    const historyWriteIndex = queryLog.findIndex(({ sql }) => sql.startsWith('INSERT INTO "league_history"'));
    const rosterResetIndex = queryLog.findIndex(({ sql }) => sql.startsWith('DELETE FROM "team_players"'));
    const leagueResetIndex = queryLog.findIndex(({ sql }) => sql.startsWith('UPDATE "leagues"'));

    expect(trophyWriteIndex).toBeGreaterThan(-1);
    expect(historyWriteIndex).toBeGreaterThan(trophyWriteIndex);
    expect(rosterResetIndex).toBeGreaterThan(historyWriteIndex);
    expect(leagueResetIndex).toBeGreaterThan(rosterResetIndex);
    expect(state.history.season).toBe(2025);
    expect(state.history.standings).toHaveLength(4);
    expect(state.history.rosters).toHaveLength(5);
    expect(state.history.awards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'champion', team_id: 11 }),
        expect.objectContaining({ type: 'weekly_high', team_id: 11 }),
        expect.objectContaining({ type: 'comeback', team_id: 14 }),
      ])
    );
  });

  test('advances the season, resets configured FAAB, and empties all rosters', () => {
    expect(result).toEqual({
      leagueId: LEAGUE_ID,
      archivedSeason: 2025,
      newSeason: 2026,
      championTeamId: 11,
      championUserId: 101,
    });
    expect(state.league).toEqual(expect.objectContaining({
      current_season: 2026,
      current_week: 1,
      season_status: 'regular',
    }));
    expect(state.teams.every(({ faab_remaining }) => faab_remaining === 150)).toBe(true);
    expect(state.rosters).toEqual([]);
    expect(state.committed).toBe(true);
    expect(state.rolledBack).toBe(false);
  });

  test('retains the champion user pointer after next-season team changes', () => {
    state.teams.find(({ id }) => id === 11).name = 'Renamed Next Season';
    state.teams = state.teams.filter(({ id }) => id !== 11);

    expect(state.history.champion_team_id).toBe(11);
    expect(state.history.champion_user_id).toBe(101);
    expect(state.history.standings.find(({ teamId }) => teamId === 11).name).toBe('Gridiron Kings');
  });

  test('uses only mocked persistence boundaries with no Supabase or fetch traffic', () => {
    expect(jest.isMockFunction(createClient)).toBe(true);
    expect(jest.isMockFunction(mockSupabaseFrom)).toBe(true);
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
