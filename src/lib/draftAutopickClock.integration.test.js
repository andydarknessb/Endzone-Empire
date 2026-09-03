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
// The nothing-draftable escalation (#602) refreshes the paused clock via
// broadcastDraftState, which reads getDraftState when a Socket.IO server is
// present (this harness stands one in via the hub). The full draft-state read is
// not this suite's concern - it would issue DB queries the fake does not model -
// so stub it; the escalation's own state change is asserted on state.league.
jest.mock('../../server/modules/draftSocket', () => ({
  getDraftState: jest.fn().mockResolvedValue({ draft_paused: true }),
}));

const pool = require('../../server/modules/pool');
const ioRegistry = require('../../server/modules/io');
const lineupService = require('../../server/services/lineup.service');
const seasonService = require('../../server/services/season.service');
const { teamForPick } = require('../../server/services/draftOrder.service');
// The Pick commit moved to pick.service (#782). These tests drive the pure commit
// (commitPick) for the manual scaffold picks that advance the draft between
// autopick turns: it takes the same FOR UPDATE lock and returns the same outcome
// the old draftPlayer did, without landPick's room fan-out, so the autopick
// broadcast assertions below still count only the autopick deliveries.
const { commitPick } = require('../../server/services/pick.service');
const pickClock = require('../../server/services/pickClock.service');
// #745: autoPick and the escalation/stall paths now emit through the one Draft
// room adapter, which throws with no transport (no silent default). Register the
// adapter over this harness's FakeRealtimeHub - the same io-shaped transport the
// old getIo() path used - so every delivery assertion below is unchanged. Only
// this TEST file changes; no client source is touched.
const { createDraftRoomBroadcast, setDraftRoomBroadcast } = require('../../server/modules/draftRoomBroadcast');
const { processExpiredPickClocks } = pickClock;

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

// Drain the microtask queue enough times to let a fired in-process timer's
// async autopick (draftPlayer's whole transaction chain, all fake-DB awaits and
// therefore all microtasks) settle. Jest 27's modern fake timers fire the
// setTimeout callback synchronously but do not await the promise it returns, and
// this version has no advanceTimersByTimeAsync; the fake DB never awaits a real
// timer, so a bounded microtask flush is sufficient and deterministic.
async function flushAsync() {
  for (let i = 0; i < 100; i += 1) await Promise.resolve();
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

    // The backstop scans every active, unpaused draft that has a stored
    // deadline and decides due-ness in JS (#601); this returns the row and its
    // deadline, and the sweep splits autopick-now from arm-a-timer itself.
    if (sql.includes('WHERE "draft_status" = \'active\'') && sql.includes('"pick_deadline_at" IS NOT NULL')) {
      const l = state.league;
      const active = l.draft_status === 'active' && !l.draft_paused && l.pick_deadline_at != null;
      return { rows: active ? [{ id: l.id, pick_deadline_at: l.pick_deadline_at }] : [] };
    }
    if (sql.includes('SELECT * FROM "leagues"') && !sql.includes('FOR UPDATE')) {
      return { rows: values[0] === state.league.id ? [{ ...state.league }] : [] };
    }
    if (sql.includes('FROM "teams"') && sql.includes('ORDER BY "draft_position"')) {
      return { rows: state.teams.map((team) => ({ ...team })) };
    }
    // Need-aware ordering (#746): the on-clock team's current roster positions.
    // These fixtures leave candidates position-less below, so the need phase
    // never reorders here (that path is covered by pickClock.sweep.test.js); this
    // read just has to answer so autoPick does not throw.
    if (sql.includes('FROM "team_players"') && sql.includes('JOIN "players"') && sql.includes('"players"."position"')) {
      const teamId = values[1];
      const rows = state.teamPlayers
        .filter((entry) => entry.teamId === teamId)
        .map((entry) => ({ position: state.players.get(entry.playerId)?.position }))
        .filter((row) => row.position != null);
      return { rows };
    }
    // Need-aware ordering (#746): picks already taken (keepers) at or beyond the
    // current pick, for the must-fill guard's picks-remaining count.
    if (sql.includes('SELECT "pick_number" FROM "draft_picks"') && sql.includes('"pick_number" >= $2')) {
      const from = values[1];
      return { rows: state.draftPicks.filter((pick) => pick.pickNumber >= from).map((pick) => ({ pick_number: pick.pickNumber })) };
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
      // Unordered on purpose — the Pick clock module (pickClock.service.js)
      // now sorts candidates in JS via the shared bestAvailable comparator, the
      // same way real Postgres results aren't pre-sorted by this fake.
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
    // onResumed's league read (#599): resolves the on-clock team and clock policy
    // for a resume. Used by the #602 escalate->resume case.
    if (sql.includes('SELECT "current_pick", "draft_type"') && sql.includes('FROM "leagues"')) {
      const l = state.league;
      return { rows: values[0] === l.id ? [{
        current_pick: l.current_pick,
        draft_type: l.draft_type ?? 'snake',
        draft_rotation: l.draft_rotation ?? 'snake',
        draft_order_overrides: l.draft_order_overrides ?? null,
        pick_time_seconds: l.pick_time_seconds,
        autodraft_delay_seconds: l.autodraft_delay_seconds,
      }] : [] };
    }
    // armInPlace (#599): the two-param re-arm-in-place UPDATE (resume, autodraft
    // toggle) - no current_pick, no draft_paused. Mirrors now() + make_interval.
    if (sql.includes('UPDATE "leagues"') && sql.includes('"pick_deadline_at" = CASE')
        && values.length === 2 && !sql.includes('"current_pick"')) {
      if (values[0] === state.league.id) {
        state.league.pick_deadline_at = values[1] == null ? null : new Date(Date.now() + values[1] * 1000);
      }
      return { rows: [{ pick_deadline_at: state.league.pick_deadline_at }] };
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
    // The nothing-draftable escalation (#602) pauses and clears the clock in one
    // statement, leaving current_pick untouched so the same team is on the clock
    // at resume. Persist it so a repeat sweep sees the paused league.
    if (sql.includes('UPDATE "leagues"') && sql.includes('SET "draft_paused" = true')) {
      if (values[0] === state.league.id) {
        state.league.draft_paused = true;
        state.league.pick_deadline_at = null;
      }
      return { rows: [] };
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
    setDraftRoomBroadcast(createDraftRoomBroadcast(hub, 'io'));
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
    // Tear down any in-process expiry timer this test armed BEFORE dropping the
    // fake clock: the registry is a module singleton, so a leaked timer would
    // fire under the next test's state.
    pickClock.cancelAllExpiryTimers();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    benchAcquiredPlayerSpy.mockRestore();
    if (suppliedFetch) delete global.fetch;
    jest.useRealTimers();
    setDraftRoomBroadcast(null);
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

  test('expired autodraft delay selects the best ADP player in an otherwise untimed draft', async () => {
    const state = install(createState({
      deadline: new Date(Date.now()),
      players: [player(101, 'QB', 1), player(102, 'RB', 2)],
    }));
    state.league.pick_time_seconds = 0;
    state.teams[0].autodraft = true;
    hub.connect(TEAM_A.owner_id);

    const outcomes = await processExpiredPickClocks();

    expect(outcomes).toEqual([{ leagueId: LEAGUE_ID, playerId: 101 }]);
    expect(state.draftPicks).toEqual([
      { leagueId: LEAGUE_ID, teamId: TEAM_A.id, playerId: 101, pickNumber: 1 },
    ]);
    expect(hub.deliveries.find((delivery) => delivery.event === 'draft:picked')?.payload)
      .toMatchObject({ teamId: TEAM_A.id, player: { id: 101 }, auto: true });
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
    const manual = commitPick({
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
      const finalPickIndex = state.teams.length * 2 - 1;
      for (let pickIndex = 0; pickIndex < state.teams.length * 2; pickIndex += 1) {
        const team = teamForPick(pickIndex, state.teams);
        const available = [...state.players.values()].find(
          (candidate) => !state.teamPlayers.some((entry) => entry.playerId === candidate.id)
        );
        expect(available).toBeDefined();

        // Take the turn per its kind, then assert the observed shape against the
        // expected shape once, unconditionally: the branch chooses only the
        // action and builds the two shapes, so no expect sits inside the
        // conditional (jest/no-conditional-expect). Each shape pins exactly what
        // the per-branch asserts pinned - an autodraft turn returns one outcome
        // naming the league and the expected player; a manual turn returns the
        // picking team's id and a draftComplete flag true only on the final pick.
        let observed;
        let expected;
        if (team.autodraft) {
          state.league.pick_deadline_at = new Date(Date.now());
          const outcomes = await processExpiredPickClocks();
          observed = { outcomes };
          expected = { outcomes: [{ leagueId: LEAGUE_ID, playerId: available.id }] };
        } else {
          const outcome = await commitPick({
            leagueId: LEAGUE_ID,
            userId: team.owner_id,
            playerId: available.id,
          });
          observed = { teamId: outcome.teamId, draftComplete: outcome.draftComplete };
          expected = { teamId: team.id, draftComplete: pickIndex === finalPickIndex };
        }
        expect(observed).toEqual(expected);
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

  // --- hybrid expiry: the in-process timer fires on time (#601) ---------------

  test('the in-process timer fires an armed deadline that elapses, with the backstop sweep firing nothing', async () => {
    const state = install(createState({
      // Two seconds out: still in the future, so the backstop sweep autopicks
      // nothing (its due filter is <= now); it arms an in-process timer instead.
      deadline: new Date(Date.now() + 2000),
      players: [player(101, 'QB', 1), player(102, 'RB', 2), player(103, 'WR', 3)],
      queue: [[TEAM_A.id, 101, 1]],
    }));
    hub.connect(TEAM_A.owner_id);

    // One backstop pass. The deadline is in the future, so it commits nothing
    // and arms the timer. Red tell: disable the arming branch of the sweep
    // (armExpiryTimer in processExpiredPickClocks) and this test stays empty at
    // the end, because with the deadline in the future the backstop can never be
    // the thing that fires it - only the timer can.
    const backstop = await processExpiredPickClocks();
    expect(backstop).toEqual([]);
    expect(state.draftPicks).toHaveLength(0);

    // Time reaches the deadline. The sweep is not run again, so only the armed
    // in-process timer can produce the pick.
    jest.advanceTimersByTime(2000);
    await flushAsync();

    expect(state.draftPicks).toEqual([
      { leagueId: LEAGUE_ID, teamId: TEAM_A.id, playerId: 101, pickNumber: 1 },
    ]);
    expect(hub.deliveries.find((delivery) => delivery.event === 'draft:picked')?.payload)
      .toMatchObject({ teamId: TEAM_A.id, player: { id: 101 }, auto: true });
  });

  test('a deadline already elapsed at startup, with no timer armed, is swept on the first backstop pass', async () => {
    const state = install(createState({
      // Elapsed five seconds ago, as if written while the worker was down.
      deadline: new Date(Date.now() - 5000),
      players: [player(101, 'QB', 1), player(102, 'RB', 2)],
      queue: [[TEAM_A.id, 101, 1]],
    }));
    hub.connect(TEAM_A.owner_id);

    // A fresh process armed no timer for this deadline (the Map is empty), so
    // advancing time fires nothing.
    jest.advanceTimersByTime(60000);
    await flushAsync();
    expect(state.draftPicks).toHaveLength(0);

    // The backstop recovers it on its first pass: this is the restart path.
    const outcomes = await processExpiredPickClocks();
    expect(outcomes).toEqual([{ leagueId: LEAGUE_ID, playerId: 101 }]);
    expect(state.draftPicks).toEqual([
      { leagueId: LEAGUE_ID, teamId: TEAM_A.id, playerId: 101, pickNumber: 1 },
    ]);
  });

  test('two expiry firings for one deadline commit exactly one Pick', async () => {
    // A timed league (default 30s): after User A's expiry autopick, User B is on
    // the clock with a freshly armed 30s deadline - firmly in the future.
    const state = install(createState({
      deadline: new Date(Date.now()),
      players: [player(101, 'QB', 1), player(102, 'RB', 2), player(103, 'WR', 3), player(104, 'TE', 4)],
      queue: [[TEAM_A.id, 101, 1]],
    }));
    hub.connect(TEAM_A.owner_id);

    // First firing: the in-process timer. It commits User A's pick and advances
    // the turn to User B (whose 30s clock is now in the future).
    pickClock.armExpiryTimer(LEAGUE_ID, state.league.pick_deadline_at);
    jest.advanceTimersByTime(1);
    await flushAsync();
    expect(state.draftPicks).toHaveLength(1);
    expect(state.league.current_pick).toBe(1);

    // Second firing for the same expiry beat: a sweep straggler / double-fired
    // timer reaches autoPick after the turn advanced. User B's clock has not
    // elapsed, so the expiry guard declines and commits no second Pick. Red
    // tell: remove that guard and this instead autopicks User B early, leaving
    // two committed picks.
    const straggler = await pickClock.autoPick({ leagueId: LEAGUE_ID });
    expect(straggler).toBeNull();
    expect(state.draftPicks).toHaveLength(1);
    expect(state.draftPicks[0]).toEqual({ leagueId: LEAGUE_ID, teamId: TEAM_A.id, playerId: 101, pickNumber: 1 });
  });

  // --- nothing-draftable expiry pauses the draft loudly (#602) -----------------
  // The on-clock team has NO draftable candidate (here: every player is already
  // rostered, so the candidate pool is empty). Instead of spinning forever on the
  // elapsed deadline, the module pauses the draft, clears the clock, commits no
  // Pick, and appends a STALLED Draft-activity entry naming the stuck team.

  // Named teams: the escalation entry must NAME the stuck team, so these carry a
  // name the assertions read back off the broadcast entry.
  const STUCK_TEAM = { id: 71, owner_id: 701, draft_position: 1, autodraft: false, locked: false, name: 'MinneApple' };
  const OTHER_TEAM = { id: 72, owner_id: 702, draft_position: 2, autodraft: false, locked: false, name: 'Rivals' };

  function stalledState() {
    // One player, already rostered to the OTHER team, so the stuck team (on the
    // clock at pick 0) has an empty candidate pool: nothing draftable.
    return install(createState({
      deadline: new Date(Date.now()),
      teams: [STUCK_TEAM, OTHER_TEAM],
      players: [player(101, 'QB', 1)],
      roster: [[OTHER_TEAM.id, 101]],
    }));
  }

  const stalledDeliveries = () => hub.deliveries
    .filter((d) => d.event === 'draft:activity' && d.payload && d.payload.kind === 'stalled');

  test('an expired clock with nothing draftable pauses the draft loudly, commits no pick, names the stuck team', async () => {
    const state = stalledState();
    hub.connect(STUCK_TEAM.owner_id);
    hub.connect(OTHER_TEAM.owner_id);

    const outcomes = await processExpiredPickClocks();

    // The sweep committed nothing (the escalation returns no autopick outcome).
    expect(outcomes).toEqual([]);
    // Assertion set the pre-change behaviour fails all three of (see the PR's
    // red-tell demonstration): the draft is paused, the deadline is cleared,
    // and no Pick was committed. The stuck team stays on the clock (current_pick
    // unchanged), the paused-then-resumed repair shape.
    expect(state.league.draft_paused).toBe(true);
    expect(state.league.pick_deadline_at).toBeNull();
    expect(state.draftPicks).toHaveLength(0);
    expect(state.league.current_pick).toBe(0);

    // The escalation is readable in the feed: exactly one STALLED entry, naming
    // the stuck team, with no Pick facts (a lifecycle event, not a Pick).
    const stalled = stalledDeliveries();
    expect(stalled).toHaveLength(1);
    expect(stalled[0].payload.teamName).toBe('MinneApple');
    expect(stalled[0].payload).not.toHaveProperty('player');
  });

  test('repeat sweeps after the escalation commit nothing and append no duplicate entry', async () => {
    const state = stalledState();
    hub.connect(STUCK_TEAM.owner_id);

    // First sweep escalates and pauses. Further sweeps skip the paused league
    // entirely (its due query filters draft_paused=false), so they select
    // nothing and append no second entry. Red tell: without the pause, the
    // second sweep still finds the elapsed deadline and escalates again, leaving
    // TWO stalled entries for one stuck turn.
    await processExpiredPickClocks();
    await processExpiredPickClocks();
    await processExpiredPickClocks();

    expect(state.draftPicks).toHaveLength(0);
    expect(state.league.draft_paused).toBe(true);
    expect(stalledDeliveries()).toHaveLength(1);
  });

  test('two concurrent nothing-draftable firings pause once and append exactly one entry', async () => {
    // The idempotency that made #602 sequence behind #601: a timer fire and a
    // backstop sweep (modelled here as two concurrent autoPick calls) can both
    // reach the nothing-draftable turn. Both pass autoPick's top-of-function
    // draft_paused check (neither has paused yet); the FOR UPDATE re-check inside
    // escalateNothingDraftable is what holds them to ONE pause and ONE entry.
    const state = stalledState();
    hub.connect(STUCK_TEAM.owner_id);

    const [a, b] = await Promise.all([
      pickClock.autoPick({ leagueId: LEAGUE_ID }),
      pickClock.autoPick({ leagueId: LEAGUE_ID }),
    ]);

    // Neither firing commits a Pick; both return null (nothing draftable).
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(state.draftPicks).toHaveLength(0);
    expect(state.league.draft_paused).toBe(true);
    // Exactly one STALLED entry despite two firings: the loser rolled back.
    expect(stalledDeliveries()).toHaveLength(1);
  });

  test('a resume on the escalated league re-arms the SAME stuck team, by its own policy, not a skipped turn', async () => {
    // The stuck team (on the clock at pick 0) is timed and NOT autodrafting, so
    // its policy is the full 30s pick clock. The OTHER team is made autodrafting,
    // whose policy would be the 2s delay - so the two teams' policies now DIFFER.
    // That is what gives the assertion teeth: a resume that armed the wrong team
    // (a skipped turn advancing current_pick to the other team) or the wrong
    // policy would yield ~2s, and the >25s assertion below goes red. With both
    // teams non-autodrafting the two policies were both 30s and team identity was
    // discriminated by nothing.
    const state = stalledState();
    state.teams[1].autodraft = true;

    await processExpiredPickClocks();
    expect(state.league.draft_paused).toBe(true);
    expect(state.league.current_pick).toBe(0);

    const resumeClient = await pool.connect();
    const armedAt = await pickClock.onResumed(resumeClient, { leagueId: LEAGUE_ID });
    resumeClient.release();

    // Resume arms the STUCK team's own policy - the full 30s pick clock - not the
    // autodrafting other team's 2s delay: proof the same team (current_pick
    // untouched) is on the clock and got its own policy, per #599 arming.
    expect(armedAt).not.toBeNull();
    const secondsOut = (new Date(armedAt).getTime() - Date.now()) / 1000;
    expect(secondsOut).toBeGreaterThan(25);
    expect(secondsOut).toBeLessThanOrEqual(30);
    expect(state.league.current_pick).toBe(0);
  });
});
