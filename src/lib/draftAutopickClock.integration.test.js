/** @jest-environment node */

const { performance } = require('node:perf_hooks');

jest.mock('../../server/modules/pool', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));
jest.mock('../../server/modules/io', () => ({
  getIo: jest.fn(),
  setIo: jest.fn(),
}));

const pool = require('../../server/modules/pool');
const ioRegistry = require('../../server/modules/io');
const lineupService = require('../../server/services/lineup.service');
const seasonService = require('../../server/services/season.service');
const { teamForPick } = require('../../server/services/draftOrder.service');
const { draftPlayer } = require('../../server/services/draft.service');
const { processExpiredPickClocks } = require('../../server/services/autopick.service');

const LEAGUE_ID = 7001;
const TEAM_A = { id: 71, owner_id: 701, draft_position: 1, autodraft: false, locked: false };
const TEAM_B = { id: 72, owner_id: 702, draft_position: 2, autodraft: false, locked: false };
const MIXED_TEAMS = Array.from({ length: 13 }, (_, index) => ({
  id: 100 + index,
  owner_id: 1100 + index,
  draft_position: index + 1,
  autodraft: [1, 4, 7, 10, 12].includes(index),
  locked: false,
}));
const ROSTER_SLOTS = [
  { key: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', count: 1, eligiblePositions: ['RB'] },
  { key: 'WR', count: 1, eligiblePositions: ['WR'] },
  { key: 'TE', count: 1, eligiblePositions: ['TE'] },
];

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Third arg is the player's ADP (#142 best available: ADP, then last
// completed season's points, then name — never database id). Lower sorts
// first, same convention the old default_rank fixture used.
function player(id, position, adp) {
  return { id, name: `Player ${id}`, position, nfl_team: `NFL-${id}`, adp, last_season_points: null };
}

function createState({
  currentPick = 0,
  deadline,
  players,
  roster = [],
  queue = [],
  teams = [TEAM_A, TEAM_B],
  draftRounds = 4,
  rosterLimit = 4,
  rosterSlots = ROSTER_SLOTS,
  positionCaps = { QB: 1, RB: 1, WR: 1, TE: 1 },
}) {
  return {
    league: {
      id: LEAGUE_ID,
      owner_id: TEAM_A.owner_id,
      draft_status: 'active',
      current_pick: currentPick,
      draft_paused: false,
      pick_time_seconds: 30,
      autodraft_delay_seconds: 2,
      pick_deadline_at: deadline,
      roster_limit: rosterLimit,
      // Fixed at draft start (ADR 0005): this league is already 'active', so
      // draftPlayer reads this instead of recomputing from roster_limit/ir_slots.
      draft_rounds: draftRounds,
      roster_slots: rosterSlots,
      position_caps: positionCaps,
      waiver_period_hours: 24,
    },
    teams: teams.map((team) => ({ ...team, consecutive_timeouts: 0 })),
    players: new Map(players.map((entry) => [entry.id, entry])),
    teamPlayers: roster.map(([teamId, playerId]) => ({ leagueId: LEAGUE_ID, teamId, playerId })),
    draftQueue: queue.map(([teamId, playerId, rank]) => ({ teamId, playerId, rank })),
    draftPicks: [],
  };
}

class FakeRealtimeHub {
  constructor() {
    this.subscribers = new Map();
    this.deliveries = [];
  }

  connect(userId, room = `league:${LEAGUE_ID}`) {
    if (!this.subscribers.has(room)) this.subscribers.set(room, new Set());
    this.subscribers.get(room).add(userId);
  }

  disconnect(userId) {
    for (const subscribers of this.subscribers.values()) subscribers.delete(userId);
  }

  to(room) {
    return {
      emit: (event, payload) => {
        this.deliveries.push({
          room,
          event,
          payload,
          deliveredAt: performance.now(),
          deliveredTo: [...(this.subscribers.get(room) || [])],
        });
      },
    };
  }
}

class FakeDraftDatabase {
  constructor(state) {
    this.state = state;
    this.sql = [];
    this.lockHolder = null;
    this.lockWaiters = [];
    this.lockAttempts = 0;
    this.maxLockWaiters = 0;
    this.candidateGate = null;
    this.candidateRead = null;
    this.firstLockAcquired = null;
    this.firstLockRelease = null;
    this.lockContended = null;
    this.pauseFirstLock = false;
  }

  pauseCandidateSelection() {
    this.candidateRead = deferred();
    this.candidateGate = deferred();
  }

  releaseCandidateSelection() {
    this.candidateGate.resolve();
  }

  holdFirstTransactionUntilContended() {
    this.pauseFirstLock = true;
    this.firstLockAcquired = deferred();
    this.firstLockRelease = deferred();
    this.lockContended = deferred();
  }

  releaseFirstTransaction() {
    this.firstLockRelease.resolve();
  }

  async acquireLeagueLock(client) {
    this.lockAttempts += 1;
    if (!this.lockHolder) {
      this.lockHolder = client;
      client.hasLeagueLock = true;
      if (this.pauseFirstLock) {
        this.pauseFirstLock = false;
        this.firstLockAcquired.resolve();
        await this.firstLockRelease.promise;
      }
      return;
    }

    const waiter = deferred();
    this.lockWaiters.push({ client, waiter });
    this.maxLockWaiters = Math.max(this.maxLockWaiters, this.lockWaiters.length);
    this.lockContended?.resolve();
    await waiter.promise;
    client.hasLeagueLock = true;
  }

  releaseLeagueLock(client) {
    if (!client.hasLeagueLock || this.lockHolder !== client) return;
    client.hasLeagueLock = false;
    const next = this.lockWaiters.shift();
    if (!next) {
      this.lockHolder = null;
      return;
    }
    this.lockHolder = next.client;
    next.waiter.resolve();
  }

  connect = async () => {
    const client = {
      hasLeagueLock: false,
      query: async (sql, values = []) => this.clientQuery(client, sql, values),
      release: jest.fn(),
    };
    return client;
  };

  query = async (sql, values = []) => {
    this.sql.push(sql);
    const { state } = this;

    if (sql.includes('WHERE "draft_status" = \'active\'') && sql.includes('"pick_deadline_at" <= now()')) {
      const due = state.league.pick_deadline_at && state.league.pick_deadline_at.getTime() <= Date.now();
      return { rows: due ? [{ id: state.league.id }] : [] };
    }
    if (sql.includes('SELECT * FROM "leagues"') && !sql.includes('FOR UPDATE')) {
      return { rows: values[0] === state.league.id ? [{ ...state.league }] : [] };
    }
    if (sql.includes('FROM "teams"') && sql.includes('ORDER BY "draft_position"')) {
      return { rows: state.teams.map((team) => ({ ...team })) };
    }
    // #142: lastCompletedNflSeason()'s calendar resolution — the exact year
    // doesn't matter to these fixtures, only that it resolves.
    if (sql.includes('EXTRACT(MONTH FROM CURRENT_DATE)')) {
      return { rows: [{ season: 2026 }] };
    }
    if (sql.includes('LEFT JOIN "draft_queue"')) {
      this.candidateRead?.resolve();
      if (this.candidateGate) await this.candidateGate.promise;
      const teamId = values[1];
      const rostered = new Set(state.teamPlayers.map((entry) => entry.playerId));
      const rankByPlayer = new Map(
        state.draftQueue
          .filter((entry) => entry.teamId === teamId)
          .map((entry) => [entry.playerId, entry.rank])
      );
      // Unordered on purpose — autopick.service.js now sorts candidates in
      // JS via the shared bestAvailable comparator, the same way real
      // Postgres results aren't pre-sorted by this fake.
      const candidates = [...state.players.values()]
        .filter((entry) => !rostered.has(entry.id))
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          adp: entry.adp ?? null,
          queue_rank: rankByPlayer.get(entry.id) ?? null,
          last_season_points: entry.last_season_points ?? null,
        }));
      return { rows: candidates };
    }
    if (sql.includes('SET "consecutive_timeouts" = "consecutive_timeouts" + 1')) {
      const team = state.teams.find((entry) => entry.id === values[0]);
      team.consecutive_timeouts += 1;
      return { rows: [{ consecutive_timeouts: team.consecutive_timeouts }] };
    }
    if (sql.includes('SET "autodraft" = true')) {
      state.teams.find((entry) => entry.id === values[0]).autodraft = true;
      return { rows: [] };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  };

  async clientQuery(client, sql, values) {
    this.sql.push(sql);
    const { state } = this;
    if (sql === 'BEGIN') return { rows: [] };
    if (sql === 'COMMIT' || sql === 'ROLLBACK') {
      this.releaseLeagueLock(client);
      return { rows: [] };
    }
    if (sql.includes('SELECT * FROM "leagues"') && sql.includes('FOR UPDATE')) {
      await this.acquireLeagueLock(client);
      return { rows: values[0] === state.league.id ? [{ ...state.league }] : [] };
    }
    if (sql.includes('FROM "teams"') && sql.includes('ORDER BY "draft_position"')) {
      return { rows: state.teams.map((team) => ({ ...team })) };
    }
    if (sql.includes('FROM "players"') && sql.includes('WHERE "id" = $1')) {
      const found = state.players.get(values[0]);
      // nfl_team rides along for the Draft-activity snapshot (#435).
      return { rows: found ? [{ id: found.id, name: found.name, position: found.position, nfl_team: found.nfl_team ?? null }] : [] };
    }
    if (sql.includes('SELECT COUNT(*)::int AS n FROM "team_players"') && !sql.includes('JOIN "players"')) {
      return { rows: [{ n: state.teamPlayers.filter((entry) => entry.teamId === values[0]).length }] };
    }
    if (sql.includes('SELECT COUNT(*)::int AS n FROM "team_players"') && sql.includes('JOIN "players"')) {
      const [teamId, position] = values;
      const n = state.teamPlayers.filter((entry) =>
        entry.teamId === teamId && (Array.isArray(position)
          ? position.includes(state.players.get(entry.playerId)?.position)
          : state.players.get(entry.playerId)?.position === position)
      ).length;
      return { rows: [{ n }] };
    }
    if (sql.includes('SELECT COUNT(*)::int AS n FROM "draft_picks"')) {
      return { rows: [{ n: state.draftPicks.length }] };
    }
    if (sql.includes('SELECT "pick_number" FROM "draft_picks"')) {
      return { rows: state.draftPicks.map((pick) => ({ pick_number: pick.pickNumber })) };
    }
    if (sql.includes('INSERT INTO "draft_picks"')) {
      const [leagueId, teamId, playerId, pickNumber] = values;
      const duplicate = state.draftPicks.some((pick) =>
        pick.leagueId === leagueId && (pick.playerId === playerId || pick.pickNumber === pickNumber)
      );
      if (duplicate) throw Object.assign(new Error('unique violation'), { code: '23505' });
      state.draftPicks.push({ leagueId, teamId, playerId, pickNumber });
      // RETURNING "id": draftPlayer reads it to pass source_pick_id to the Pick
      // activity (#436). A monotonic id mirrors the serial column.
      return { rows: [{ id: state.draftPicks.length }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO "draft_activity"')) {
      // The Pick's Draft activity, appended in the same transaction (#435). The
      // trigger allocates feed_seq; the fake hands one back on RETURNING.
      const seq = state.draftPicks.length;
      return { rows: [{ id: seq, feed_seq: String(seq), created_at: new Date().toISOString() }], rowCount: 1 };
    }
    if (sql.includes('UPDATE "leagues"') && sql.includes('SET "current_pick"')) {
      const [currentPick, draftStatus, leagueId, clockSeconds] = values;
      if (leagueId !== state.league.id) return { rows: [] };
      state.league.current_pick = currentPick;
      state.league.draft_status = draftStatus;
      state.league.pick_deadline_at = clockSeconds == null
        ? null
        : new Date(Date.now() + clockSeconds * 1000);
      return { rows: [{ pick_deadline_at: state.league.pick_deadline_at }] };
    }
    if (sql.includes('SET "waivers_clear_at"')) return { rows: [] };
    if (sql.includes('SET "consecutive_timeouts" = 0')) {
      state.teams.find((entry) => entry.id === values[0]).consecutive_timeouts = 0;
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO "team_players"')) {
      const [leagueId, teamId, playerId] = values;
      if (state.teamPlayers.some((entry) => entry.leagueId === leagueId && entry.playerId === playerId)) {
        throw Object.assign(new Error('unique violation'), { code: '23505' });
      }
      state.teamPlayers.push({ leagueId, teamId, playerId });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected transaction query: ${sql}`);
  }
}

describe('live snake-draft expiry and autopick integration', () => {
  let database;
  let hub;
  let fetchSpy;
  let suppliedFetch;
  let benchAcquiredPlayerSpy;

  function install(state) {
    database = new FakeDraftDatabase(state);
    hub = new FakeRealtimeHub();
    pool.query.mockImplementation(database.query);
    pool.connect.mockImplementation(database.connect);
    ioRegistry.getIo.mockReturnValue(hub);
    return state;
  }

  beforeEach(() => {
    // This harness owns draft-clock serialization and realtime delivery. The
    // draft service seam separately proves that a roster write benches the
    // acquisition, so keep lineup persistence out of this fake database.
    benchAcquiredPlayerSpy = jest.spyOn(lineupService, 'benchAcquiredPlayer').mockResolvedValue();
    jest.useFakeTimers({ doNotFake: ['performance'] });
    jest.setSystemTime(new Date('2026-09-06T17:00:00.000Z'));
    suppliedFetch = !global.fetch;
    if (suppliedFetch) {
      Object.defineProperty(global, 'fetch', { configurable: true, writable: true, value: jest.fn() });
    }
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(
      new Error('Network isolation violation: external fetch attempted')
    );
  });

  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    benchAcquiredPlayerSpy.mockRestore();
    if (suppliedFetch) delete global.fetch;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('expired User A clock selects the first queue player who fits, rosters once, and advances within 100ms', async () => {
    const state = install(createState({
      deadline: new Date(Date.now()),
      players: [player(900, 'QB', 900), player(101, 'QB', 1), player(102, 'RB', 2), player(103, 'WR', 3)],
      roster: [[TEAM_A.id, 900]],
      queue: [[TEAM_A.id, 101, 1], [TEAM_A.id, 102, 2], [TEAM_A.id, 103, 3]],
    }));
    hub.connect(TEAM_A.owner_id);
    hub.connect(TEAM_B.owner_id);
    const startedAt = performance.now();

    const outcomes = await processExpiredPickClocks();

    expect(outcomes).toEqual([{ leagueId: LEAGUE_ID, playerId: 102 }]);
    expect(state.draftPicks).toEqual([
      { leagueId: LEAGUE_ID, teamId: TEAM_A.id, playerId: 102, pickNumber: 1 },
    ]);
    expect(state.teamPlayers.filter((entry) => entry.teamId === TEAM_A.id).map((entry) => entry.playerId))
      .toEqual([900, 102]);
    expect(state.draftPicks).toHaveLength(1);

    const broadcast = hub.deliveries.find((delivery) => delivery.event === 'draft:picked');
    expect(broadcast).toBeDefined();
    // The broadcast attributes the pick by Team at the root and marks it auto;
    // the old account `by` object (its userId was the owner's account id) is
    // gone from the wire (#344).
    expect(broadcast.payload).toMatchObject({
      teamId: TEAM_A.id,
      player: { id: 102, position: 'RB' },
      nextTeamId: TEAM_B.id,
      auto: true,
    });
    expect(broadcast.payload).not.toHaveProperty('by');
    expect(broadcast.deliveredAt - startedAt).toBeLessThanOrEqual(100);
  });

  test('offline User B with an empty queue receives the best ADP player fitting an open starting slot', async () => {
    const state = install(createState({
      currentPick: 1,
      deadline: new Date(Date.now()),
      players: [player(901, 'QB', 900), player(201, 'QB', 1), player(202, 'WR', 2), player(203, 'RB', 3)],
      roster: [[TEAM_B.id, 901]],
      queue: [],
    }));
    hub.connect(TEAM_A.owner_id);
    hub.connect(TEAM_B.owner_id);
    hub.connect(999);
    hub.disconnect(TEAM_B.owner_id);

    const outcomes = await processExpiredPickClocks();

    expect(outcomes).toEqual([{ leagueId: LEAGUE_ID, playerId: 202 }]);
    expect(state.draftPicks).toEqual([
      { leagueId: LEAGUE_ID, teamId: TEAM_B.id, playerId: 202, pickNumber: 2 },
    ]);
    expect(state.teamPlayers.filter((entry) => entry.teamId === TEAM_B.id).map((entry) => entry.playerId))
      .toEqual([901, 202]);
    const broadcast = hub.deliveries.find((delivery) => delivery.event === 'draft:picked');
    expect(broadcast.deliveredTo).toContain(999);
    expect(broadcast.deliveredTo).not.toContain(TEAM_B.owner_id);
  });

  test('manual click at 0.01 seconds and an in-flight autodraft serialize to exactly one committed pick', async () => {
    jest.setSystemTime(new Date('2026-09-06T16:59:59.990Z'));
    const deadline = new Date(Date.now() + 10);
    const state = install(createState({
      deadline,
      players: [player(301, 'RB', 1), player(302, 'WR', 2), player(303, 'TE', 3)],
      queue: [[TEAM_A.id, 301, 1]],
    }));
    database.pauseCandidateSelection();
    database.holdFirstTransactionUntilContended();
    jest.advanceTimersByTime(10);

    const automatic = processExpiredPickClocks();
    await database.candidateRead.promise;
    const manual = draftPlayer({
      leagueId: LEAGUE_ID,
      userId: TEAM_A.owner_id,
      playerId: 302,
    });
    await database.firstLockAcquired.promise;
    database.releaseCandidateSelection();
    await database.lockContended.promise;
    database.releaseFirstTransaction();

    const [automaticResult, manualResult] = await Promise.allSettled([automatic, manual]);

    expect(manualResult.status).toBe('fulfilled');
    expect(automaticResult).toEqual({ status: 'fulfilled', value: [] });
    expect(state.draftPicks).toEqual([
      { leagueId: LEAGUE_ID, teamId: TEAM_A.id, playerId: 302, pickNumber: 1 },
    ]);
    expect(state.teamPlayers).toEqual([
      { leagueId: LEAGUE_ID, teamId: TEAM_A.id, playerId: 302 },
    ]);
    expect(state.league.current_pick).toBe(1);
    expect(database.sql.filter((sql) => sql.includes('FOR UPDATE')).length).toBeGreaterThanOrEqual(2);
    expect(database.maxLockWaiters).toBe(1);
  });

  test('a 13-team draft completes with mixed manual and autodraft turns, preserving every slot and roster', async () => {
    const state = install(createState({
      deadline: new Date(Date.now()),
      teams: MIXED_TEAMS,
      draftRounds: 2,
      rosterLimit: 2,
      rosterSlots: [{ key: 'QB', count: 2, eligiblePositions: ['QB'] }],
      positionCaps: {},
      players: Array.from({ length: 26 }, (_, index) => player(1300 + index, 'QB', index + 1)),
    }));
    const seasonGeneration = jest.spyOn(seasonService, 'generateRegularSeason').mockResolvedValue();

    try {
      const manualTeams = state.teams.filter((team) => !team.autodraft);
      const autoTeams = state.teams.filter((team) => team.autodraft);
      for (let pickIndex = 0; pickIndex < state.teams.length * 2; pickIndex += 1) {
        const team = teamForPick(pickIndex, state.teams);
        const available = [...state.players.values()].find(
          (candidate) => !state.teamPlayers.some((entry) => entry.playerId === candidate.id)
        );
        expect(available).toBeDefined();

        if (team.autodraft) {
          state.league.pick_deadline_at = new Date(Date.now());
          const outcomes = await processExpiredPickClocks();
          expect(outcomes).toHaveLength(1);
          expect(outcomes[0]).toEqual({ leagueId: LEAGUE_ID, playerId: available.id });
        } else {
          const outcome = await draftPlayer({
            leagueId: LEAGUE_ID,
            userId: team.owner_id,
            playerId: available.id,
          });
          expect(outcome.teamId).toBe(team.id);
          expect(outcome.draftComplete).toBe(pickIndex === state.teams.length * 2 - 1);
        }
      }

      expect(manualTeams.length).toBeGreaterThan(0);
      expect(autoTeams.length).toBeGreaterThan(0);
      expect(state.draftPicks).toHaveLength(26);
      expect(state.draftPicks.map((pick) => pick.pickNumber)).toEqual(
        Array.from({ length: 26 }, (_, index) => index + 1)
      );
      expect(state.draftPicks.map((pick) => pick.teamId)).toEqual(
        Array.from({ length: 26 }, (_, index) => teamForPick(index, state.teams).id)
      );
      expect(state.teamPlayers).toHaveLength(26);
      expect(new Set(state.teamPlayers.map((entry) => entry.teamId)).size).toBe(13);
      expect(state.league.draft_status).toBe('complete');
      expect(state.league.current_pick).toBe(26);
      expect(state.league.pick_deadline_at).toBeNull();
      expect(seasonGeneration).toHaveBeenCalledTimes(1);

      const picked = hub.deliveries.filter((delivery) => delivery.event === 'draft:picked');
      expect(picked).toHaveLength(10);
      expect(picked.every((delivery) => delivery.payload.auto === true)).toBe(true);
      expect(new Set(picked.map((delivery) => delivery.payload.teamId))).toEqual(
        new Set(autoTeams.map((team) => team.id))
      );
    } finally {
      seasonGeneration.mockRestore();
    }
  });
});
