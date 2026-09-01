const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const { logger } = require('../modules/logger');
const { withAdvisoryLock } = require('../modules/advisoryLock');
const ioRegistry = require('../modules/io');
const draftEvents = require('../modules/draftEvents');
const draftService = require('../services/draft.service');
const pickClock = require('../services/pickClock.service');

/**
 * The Pick clock module owns expiry (#600, ADR 0018): the sweep, the Autopick
 * act (first eligible queue player, otherwise best available, with the snipe
 * retry), and the consecutive-timeout streak all live inside the module now.
 * These tests drive the module's PUBLIC sweep entry point,
 * pickClock.processExpiredPickClocks(), and read back the order in which the
 * on-the-clock team's candidates were attempted (via a mocked draftPlayer) and
 * the sweep's own outcome list. This suite supersedes autopick.service.test.js;
 * the candidate comparator is no longer exported, so its ordering contracts are
 * re-expressed here through the interface.
 */
const LEAGUE_ID = 1;
const SWEEP_LEAGUE = {
  id: LEAGUE_ID, draft_status: 'active', draft_paused: false, current_pick: 0,
  draft_rotation: 'snake', draft_order_overrides: null,
  // Elapsed well in the past: the sweep autopicks it (the backstop path), and
  // the module's expiry guard sees an actually-elapsed clock (#601).
  pick_deadline_at: new Date('2000-01-01T00:00:00.000Z'),
};
// autodraft:true -> the pick is not a "timeout", so the streak UPDATE branch is
// skipped and each test stays focused on candidate ordering (the same reason
// the old autopick fixture used an autodrafting single team).
const SWEEP_TEAM = { id: 55, owner_id: 7, autodraft: true };

/**
 * Installs a mock pool.query covering the whole sweep path from the interface:
 * the due-clock query (so the sweep actually selects this league), then the
 * league, the single team, season resolution, and the candidate query answered
 * with `candidates` verbatim (unordered — the module sorts them itself).
 */
function installSweepPool(t, { candidates, league = SWEEP_LEAGUE, team = SWEEP_TEAM } = {}) {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    // The backstop scans every active deadline and decides due-ness in JS now
    // (#601); this league's deadline is elapsed, so it takes the autopick path.
    if (text.includes('"pick_deadline_at" IS NOT NULL')) {
      return { rows: [{ id: league.id, pick_deadline_at: league.pick_deadline_at }] };
    }
    if (text.includes('FROM "leagues" WHERE "id" = $1')) return { rows: [league] };
    if (text.includes('FROM "teams"')) return { rows: [team] };
    if (text.includes('EXTRACT(MONTH FROM CURRENT_DATE)')) return { rows: [{ season: 2026 }] };
    if (text.includes('FROM "players"')) return { rows: candidates };
    throw new Error(`Unexpected SQL: ${text}`);
  });
}

/** Mock draftPlayer to record attempt order; sniped ids throw a 409 like the real service. */
function recordAttempts(t, { snipe = [] } = {}) {
  const attempts = [];
  t.mock.method(draftService, 'draftPlayer', async ({ playerId }) => {
    attempts.push(playerId);
    if (snipe.includes(playerId)) {
      const err = new Error('player is already rostered in this league');
      err.statusCode = 409;
      throw err;
    }
    return { player: { id: playerId }, draftComplete: false };
  });
  return attempts;
}

// --- selection-order contracts through the sweep interface -------------------

test('sweep: a queued player is chosen over best available, regardless of ADP', async (t) => {
  const queued = { id: 9, name: 'Queued Pick', adp: null, queue_rank: 1, last_season_points: null };
  const betterAdp = { id: 1, name: 'Better ADP', adp: '1.0', queue_rank: null, last_season_points: null };
  installSweepPool(t, { candidates: [betterAdp, queued] }); // seeded out of order
  const attempts = recordAttempts(t);

  const outcomes = await pickClock.processExpiredPickClocks();

  assert.deepEqual(attempts, [9], 'the team queue wins over best available');
  assert.deepEqual(outcomes, [{ leagueId: LEAGUE_ID, playerId: 9 }]);
});

test('sweep: among queued candidates, the lower queue rank is chosen first', async (t) => {
  // The rank-1 candidate's NAME deliberately sorts LAST, so this binds on the
  // queue-rank branch alone: drop that branch and the name fallback would pick
  // the rank-2 candidate (id 8) instead, going red.
  const rankTwo = { id: 8, name: 'Aaa sorts first by name', adp: null, queue_rank: 2, last_season_points: null };
  const rankOne = { id: 9, name: 'Zzz sorts last by name', adp: null, queue_rank: 1, last_season_points: null };
  installSweepPool(t, { candidates: [rankTwo, rankOne] }); // seeded out of order
  const attempts = recordAttempts(t);

  await pickClock.processExpiredPickClocks();

  assert.deepEqual(attempts, [9], 'queue rank 1 sorts before rank 2, not by name');
});

test('sweep: among unqueued candidates, ADP then last-season points then name decide, id never', async (t) => {
  // Same ADP, same (absent) points, differing only by id and name: name decides,
  // never database id. "Aaron" (id 99) must be reached before "Zeke" (id 1).
  const higherId = { id: 99, name: 'Aaron', adp: '10.0', queue_rank: null, last_season_points: null };
  const lowerId = { id: 1, name: 'Zeke', adp: '10.0', queue_rank: null, last_season_points: null };
  installSweepPool(t, { candidates: [lowerId, higherId] });
  const attempts = recordAttempts(t);

  await pickClock.processExpiredPickClocks();

  assert.deepEqual(attempts, [99], 'name breaks the tie, not id');
});

test('sweep: an unqueued ADP candidate outranks a productive no-ADP one', async (t) => {
  // ADP is the first unqueued key: an ADP player is reached before a no-ADP
  // player however productive. The producer here has the higher points, so a
  // points-first ordering would reach it first - it must not.
  const hasAdp = { id: 1, name: 'Has ADP', adp: '10.0', queue_rank: null, last_season_points: null };
  const productiveNoAdp = { id: 2, name: 'Productive', adp: null, queue_rank: null, last_season_points: '99.0' };
  installSweepPool(t, { candidates: [productiveNoAdp, hasAdp] }); // seeded out of order
  const attempts = recordAttempts(t);

  await pickClock.processExpiredPickClocks();

  assert.deepEqual(attempts, [1], 'ADP outranks production; the no-ADP producer is not reached first');
});

test('sweep: an empty queue prefers a no-ADP producer over a no-signal candidate', async (t) => {
  const withPoints = { id: 2, name: 'Has Points', adp: null, queue_rank: null, last_season_points: '50.0' };
  const noSignal = { id: 3, name: 'No Signal', adp: null, queue_rank: null, last_season_points: null };
  installSweepPool(t, { candidates: [noSignal, withPoints] }); // seeded out of order
  const attempts = recordAttempts(t);

  const outcomes = await pickClock.processExpiredPickClocks();

  // Red tell: the no-signal candidate (id 3) must NEVER be reached while a
  // producer remains; only id 2 is attempted.
  assert.deepEqual(attempts, [2]);
  assert.deepEqual(outcomes, [{ leagueId: LEAGUE_ID, playerId: 2 }]);
});

test('sweep: after a snipe, falls through to the next best candidate, never to the no-signal one', async (t) => {
  const hasAdp = { id: 1, name: 'Has ADP', adp: '5.0', queue_rank: null, last_season_points: null };
  const noAdpPoints = { id: 2, name: 'No ADP, Points', adp: null, queue_rank: null, last_season_points: '50.0' };
  const noSignal = { id: 3, name: 'No Signal', adp: null, queue_rank: null, last_season_points: null };
  installSweepPool(t, { candidates: [noSignal, noAdpPoints, hasAdp] }); // seeded out of order
  const attempts = recordAttempts(t, { snipe: [1] }); // the ADP top choice is sniped

  const outcomes = await pickClock.processExpiredPickClocks();

  // Tried the ADP player, got sniped (409), fell to the producer; id 3 (the
  // no-signal red tell) is never reached.
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(outcomes, [{ leagueId: LEAGUE_ID, playerId: 2 }]);
});

// --- the worker broadcast path: no local Socket.IO server --------------------
// Ported from the superseded autopick service suite: this is the arm the worker
// actually takes. The worker process has no local Socket.IO server, so
// emitDraftEvent publishes the committed pick to Redis for the API-side relay
// (the production path for every autopick broadcast), rather than emitting
// in-process. Pinning the exact envelope keeps a future edit from dropping or
// reshaping it.

test('sweep: with no local Socket.IO server, the committed pick is published for the API relay', async (t) => {
  installSweepPool(t, {
    candidates: [{ id: 8, name: 'Worker Pick', adp: '1.0', queue_rank: null, last_season_points: null }],
  });
  t.mock.method(ioRegistry, 'getIo', () => null);
  const published = [];
  t.mock.method(draftEvents, 'publishDraftEvent', async (event) => { published.push(event); });
  const outcome = { leagueId: LEAGUE_ID, teamId: 55, player: { id: 8, name: 'Worker Pick' }, draftComplete: false };
  t.mock.method(draftService, 'draftPlayer', async () => outcome);

  await pickClock.processExpiredPickClocks();

  assert.deepEqual(published, [{
    leagueId: LEAGUE_ID,
    event: 'draft:picked',
    payload: { ...outcome, auto: true },
  }]);
});

// --- containment: a thrown sweep is caught and the next sweep still runs ------

test('sweep containment: a rejecting due query is caught and a later sweep still runs', async (t) => {
  let dueCalls = 0;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('"pick_deadline_at" IS NOT NULL')) {
      dueCalls += 1;
      if (dueCalls === 1) throw new Error('deadline sweep query blew up');
      return { rows: [] }; // second sweep: nothing active
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  // Red tell: remove the sweep's own try/catch and this first await rejects.
  // The module's containment makes the sweep's public contract "never reject"
  // hold for ANY caller, not only the scheduler's draftTick (which has its own
  // catch); the sweep resolves to an empty outcome list here instead. (The
  // separate protection that is genuinely new to #600 - draftTick catching a
  // failure in the advisory-lock ACQUISITION, which no prior catch covered - is
  // pinned in scheduler.test.js, not here.)
  const first = await pickClock.processExpiredPickClocks();
  assert.deepEqual(first, []);

  const second = await pickClock.processExpiredPickClocks();
  assert.deepEqual(second, []);
  assert.equal(dueCalls, 2, 'both sweeps reached the query; the first did not abort the loop');
});

// --- advisory-lock release: destroy on unlock failure, log a skip ------------
// The draft-clock tick (scheduler.draftTick) runs the sweep under this lock;
// these pin the riding-along lock fixes #600 calls out.

test('advisory lock: a connection whose unlock failed is destroyed, not returned to the pool', async (t) => {
  const released = [];
  const client = {
    query: async (sql) => {
      const text = String(sql);
      if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (text.includes('pg_advisory_unlock')) throw new Error('advisory unlock RPC failed');
      throw new Error(`unexpected: ${text}`);
    },
    release: (err) => released.push(err),
  };
  t.mock.method(pool, 'connect', async () => client);

  const result = await withAdvisoryLock(23002, 'draft-clock', async () => 'work-done');

  assert.equal(result, 'work-done', 'the work still ran and returned');
  assert.equal(released.length, 1, 'the connection was released exactly once');
  // Red tell: the pre-change code called release() with no argument, returning
  // the still-locked connection to the pool. Releasing WITH an error destroys it.
  assert.ok(released[0] instanceof Error, 'released with an error => destroyed, not pooled');
});

test('advisory lock: a skipped tick (lock not acquired) is visible in the log output', async (t) => {
  const client = {
    query: async (sql) => {
      if (String(sql).includes('pg_try_advisory_lock')) return { rows: [{ locked: false }] };
      throw new Error(`unexpected: ${sql}`);
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);
  const skips = [];
  t.mock.method(logger, 'debug', (obj, msg) => skips.push({ obj, msg }));

  let ran = false;
  const result = await withAdvisoryLock(23002, 'draft-clock', async () => { ran = true; });

  assert.equal(ran, false, 'the work never ran because the lock was not acquired');
  assert.deepEqual(result, { skipped: true }, 'the skip is reported to the caller');
  assert.equal(skips.length, 1, 'the skip is logged, not silent');
  assert.match(skips[0].msg, /skip/i);
});
