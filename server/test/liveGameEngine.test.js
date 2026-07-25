const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLiveGameEntry,
  mapTank01Status,
  finalTransitions,
  nextPollPlan,
  activeClockSource,
  configuredClockSource,
} = require('../modules/liveGameEngine');

// --- mapTank01Status ---------------------------------------------------------

test('mapTank01Status: gameStatusCode 0 -> scheduled', () => {
  assert.equal(mapTank01Status({ gameStatusCode: '0', gameStatus: 'Not Started Yet' }), 'scheduled');
});

test('mapTank01Status: gameStatusCode 2 -> final', () => {
  assert.equal(mapTank01Status({ gameStatusCode: '2', gameStatus: 'Completed' }), 'final');
});

test('mapTank01Status: any other code -> in_progress', () => {
  assert.equal(mapTank01Status({ gameStatusCode: '1', gameStatus: 'In Progress' }), 'in_progress');
  assert.equal(mapTank01Status({ gameStatusCode: '3', gameStatus: 'Halftime' }), 'in_progress');
});

test('mapTank01Status: falls back to gameStatus text when code is missing/unfamiliar', () => {
  assert.equal(mapTank01Status({ gameStatus: 'Final' }), 'final');
  assert.equal(mapTank01Status({ gameStatus: 'Scheduled' }), 'scheduled');
  assert.equal(mapTank01Status({ gameStatus: 'Live' }), 'in_progress');
});

test('mapTank01Status: handles a missing/empty entry', () => {
  assert.equal(mapTank01Status(null), 'in_progress');
  assert.equal(mapTank01Status({}), 'in_progress');
});

// --- normalizeLiveGameEntry --------------------------------------------------

const SAMPLE_FINAL_ENTRY = {
  away: 'DAL',
  home: 'PHI',
  gameTime_epoch: '1757031600.0',
  gameID: '20250904_DAL@PHI',
  awayPts: '20',
  homePts: '24',
  gameClock: '',
  lineScore: { period: 'Final', gameClock: '' },
  gameStatus: 'Completed',
  gameStatusCode: '2',
};

test('normalizeLiveGameEntry: well-formed final entry maps correctly', () => {
  const result = normalizeLiveGameEntry(SAMPLE_FINAL_ENTRY, { season: 2025, week: 1 });
  assert.deepEqual(result, {
    tank01GameId: '20250904_DAL@PHI',
    season: 2025,
    week: 1,
    homeTeam: 'PHI',
    awayTeam: 'DAL',
    gameStatus: 'final',
    startTime: new Date(1757031600 * 1000),
    currentScoreHome: 24,
    currentScoreAway: 20,
    quarter: 'Final',
    timeRemaining: null,
  });
});

test('normalizeLiveGameEntry: not-started entry has null scores/clock/quarter treated as 0/null', () => {
  const result = normalizeLiveGameEntry(
    {
      away: 'DEN',
      home: 'KC',
      gameTime_epoch: '1789431300.0',
      gameID: '20260914_DEN@KC',
      awayPts: '',
      homePts: '',
      gameClock: '',
      gameStatus: 'Not Started Yet',
      gameStatusCode: '0',
    },
    { season: 2026, week: 1 }
  );
  assert.equal(result.gameStatus, 'scheduled');
  assert.equal(result.currentScoreHome, 0);
  assert.equal(result.currentScoreAway, 0);
  assert.equal(result.quarter, null);
  assert.equal(result.timeRemaining, null);
});

test('normalizeLiveGameEntry: live entry carries quarter + clock as raw strings', () => {
  const result = normalizeLiveGameEntry(
    {
      away: 'BUF',
      home: 'NYJ',
      gameID: '20260101_BUF@NYJ',
      awayPts: '14',
      homePts: '10',
      gameClock: '8:42',
      lineScore: { period: 'Q3', gameClock: '8:42' },
      gameStatus: 'In Progress',
      gameStatusCode: '1',
    },
    { season: 2026, week: 17 }
  );
  assert.equal(result.gameStatus, 'in_progress');
  assert.equal(result.quarter, 'Q3');
  assert.equal(result.timeRemaining, '8:42');
  assert.equal(result.currentScoreHome, 10);
  assert.equal(result.currentScoreAway, 14);
});

test('normalizeLiveGameEntry: missing gameID -> null', () => {
  assert.equal(normalizeLiveGameEntry({ home: 'KC', away: 'DEN' }, { season: 2026, week: 1 }), null);
});

test('normalizeLiveGameEntry: missing home/away -> null', () => {
  assert.equal(normalizeLiveGameEntry({ gameID: 'x' }, { season: 2026, week: 1 }), null);
});

test('normalizeLiveGameEntry: null/undefined entry -> null', () => {
  assert.equal(normalizeLiveGameEntry(null, { season: 2026, week: 1 }), null);
  assert.equal(normalizeLiveGameEntry(undefined, { season: 2026, week: 1 }), null);
});

// --- finalTransitions (recap generation trigger) -----------------------------

test('finalTransitions: only games newly final this tick are returned', () => {
  const prior = new Map([
    ['g1', 'in_progress'], // -> final: generate
    ['g2', 'final'],       // already final: skip (no duplicate)
    ['g3', 'scheduled'],   // still scheduled: skip
  ]);
  const rows = [
    { tank01_game_id: 'g1', game_status: 'final' },
    { tank01_game_id: 'g2', game_status: 'final' },
    { tank01_game_id: 'g3', game_status: 'scheduled' },
  ];
  assert.deepEqual(finalTransitions(prior, rows), ['g1']);
});

test('finalTransitions: a game unseen before that arrives final is generated', () => {
  const prior = new Map(); // no prior row (first time we ever saw it)
  const rows = [{ tank01_game_id: 'gNew', game_status: 'final' }];
  assert.deepEqual(finalTransitions(prior, rows), ['gNew']);
});

test('finalTransitions: nothing to do when no game is final', () => {
  const prior = new Map([['g1', 'in_progress']]);
  const rows = [{ tank01_game_id: 'g1', game_status: 'in_progress' }];
  assert.deepEqual(finalTransitions(prior, rows), []);
});

// --- nextPollPlan (the whole quota story for the live clock) ------------------
//
// Code defaults: ESPN 30s, Tank01 fallback 10min, idle beat 60s. These assert
// the defaults, so a future env override can't silently change the contract.

const ESPN_MS = 30 * 1000;
const FAST_MS = 10 * 60 * 1000;
const IDLE_MS = 60 * 1000;
const NOW = Date.UTC(2026, 8, 13, 18, 30); // Sunday 2:30pm ET, mid early-window

test('nextPollPlan: a game in progress polls at the ESPN cadence', () => {
  const plan = nextPollPlan({
    statuses: [{ status: 'in_progress', startTime: new Date(NOW - 30 * 60 * 1000) }],
    now: NOW,
    clockSource: 'espn',
    windowOpen: true,
  });
  assert.deepEqual(plan, { callApi: true, nextDelayMs: ESPN_MS, reason: 'in-progress' });
});

test('nextPollPlan: the Tank01 fallback polls far slower than ESPN', () => {
  const plan = nextPollPlan({
    statuses: [{ status: 'in_progress', startTime: new Date(NOW - 30 * 60 * 1000) }],
    now: NOW,
    clockSource: 'tank01',
    windowOpen: true,
  });
  assert.equal(plan.callApi, true);
  assert.equal(plan.nextDelayMs, FAST_MS);
});

test('nextPollPlan: degraded quota doubles the PAID cadence only', () => {
  const args = {
    statuses: [{ status: 'in_progress', startTime: new Date(NOW - 30 * 60 * 1000) }],
    now: NOW,
    quotaMode: 'degraded',
    windowOpen: true,
  };
  assert.equal(nextPollPlan({ ...args, clockSource: 'tank01' }).nextDelayMs, FAST_MS * 2);
  // ESPN is free; there's no reason to slow it down.
  assert.equal(nextPollPlan({ ...args, clockSource: 'espn' }).nextDelayMs, ESPN_MS);
});

test('nextPollPlan: a kickoff that just passed polls for the flip to in_progress', () => {
  const plan = nextPollPlan({
    statuses: [{ status: 'scheduled', startTime: new Date(NOW - 90 * 1000) }],
    now: NOW,
    clockSource: 'espn',
    windowOpen: true,
  });
  assert.equal(plan.callApi, true);
  assert.equal(plan.reason, 'kickoff-passed');
});

test('nextPollPlan: an open window with no rows yet polls (never seen these games)', () => {
  const plan = nextPollPlan({ statuses: [], now: NOW, clockSource: 'espn', windowOpen: true });
  assert.equal(plan.callApi, true);
  assert.equal(plan.reason, 'window-open-unseen');
});

test('nextPollPlan: before kickoff there is no call, just a cheap wake-up', () => {
  const plan = nextPollPlan({
    statuses: [],
    nextKickoffAt: new Date(NOW + 40 * 60 * 1000),
    now: NOW,
    clockSource: 'espn',
    windowOpen: false,
  });
  assert.deepEqual(plan, { callApi: false, nextDelayMs: IDLE_MS, reason: 'awaiting-kickoff' });
});

test('nextPollPlan: a kickoff sooner than the idle beat wakes us at kickoff', () => {
  const plan = nextPollPlan({
    statuses: [],
    nextKickoffAt: new Date(NOW + 20 * 1000),
    now: NOW,
    clockSource: 'espn',
    windowOpen: false,
  });
  assert.equal(plan.callApi, false);
  assert.equal(plan.nextDelayMs, 20 * 1000);
});

test('nextPollPlan: the gap between Sunday slates costs nothing', () => {
  // 1pm games final, 4:05pm games still scheduled — an open 8h window, but
  // nothing to ask about yet.
  const plan = nextPollPlan({
    statuses: [
      { status: 'final', startTime: new Date(NOW - 3 * 60 * 60 * 1000) },
      { status: 'scheduled', startTime: new Date(NOW + 95 * 60 * 1000) },
    ],
    nextKickoffAt: new Date(NOW + 95 * 60 * 1000),
    now: NOW,
    clockSource: 'espn',
    windowOpen: true,
  });
  assert.equal(plan.callApi, false);
  assert.equal(plan.reason, 'awaiting-kickoff');
});

test('nextPollPlan: everything final -> idle, no call (the old 8h tail is gone)', () => {
  const plan = nextPollPlan({
    statuses: [
      { status: 'final', startTime: new Date(NOW - 4 * 60 * 60 * 1000) },
      { status: 'final', startTime: new Date(NOW - 3 * 60 * 60 * 1000) },
    ],
    nextKickoffAt: null,
    now: NOW,
    clockSource: 'espn',
    windowOpen: true, // still inside the 8h kickoff window
  });
  assert.deepEqual(plan, { callApi: false, nextDelayMs: IDLE_MS, reason: 'idle' });
});

test('nextPollPlan: nothing scheduled at all -> idle, no call', () => {
  assert.deepEqual(nextPollPlan(), { callApi: false, nextDelayMs: IDLE_MS, reason: 'idle' });
});

test('nextPollPlan: a stale scheduled row older than the 8h window stops polling', () => {
  const plan = nextPollPlan({
    statuses: [{ status: 'scheduled', startTime: new Date(NOW - 30 * 60 * 60 * 1000) }],
    now: NOW,
    clockSource: 'espn',
    windowOpen: true,
  });
  assert.equal(plan.callApi, false);
});

test('nextPollPlan: quota exhaustion silences the PAID path, not the free one', () => {
  const args = {
    statuses: [{ status: 'in_progress', startTime: new Date(NOW - 30 * 60 * 1000) }],
    now: NOW,
    windowOpen: true,
  };
  for (const mode of ['essential-only', 'blocked']) {
    const paid = nextPollPlan({ ...args, clockSource: 'tank01', quotaMode: mode });
    assert.deepEqual(paid, { callApi: false, nextDelayMs: IDLE_MS, reason: 'quota-blocked' });
    const free = nextPollPlan({ ...args, clockSource: 'espn', quotaMode: mode });
    assert.equal(free.callApi, true, `ESPN keeps running while quota is ${mode}`);
  }
});

// --- clock source selection --------------------------------------------------

test('clock source defaults to ESPN and can be pinned to Tank01', () => {
  const original = process.env.LIVE_CLOCK_SOURCE;
  try {
    delete process.env.LIVE_CLOCK_SOURCE;
    assert.equal(configuredClockSource(), 'espn');
    assert.equal(activeClockSource(), 'espn');
    process.env.LIVE_CLOCK_SOURCE = 'tank01';
    assert.equal(configuredClockSource(), 'tank01');
    assert.equal(activeClockSource(), 'tank01');
    process.env.LIVE_CLOCK_SOURCE = 'anything-else';
    assert.equal(configuredClockSource(), 'espn');
  } finally {
    if (original === undefined) delete process.env.LIVE_CLOCK_SOURCE;
    else process.env.LIVE_CLOCK_SOURCE = original;
  }
});
