const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const { logger } = require('../modules/logger');
const { withAdvisoryLock } = require('../modules/advisoryLock');
const { installRecordingBroadcast } = require('./helpers/recordingBroadcast');
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
 * league, the team rotation, the on-clock team's current roster positions and
 * the taken (keeper) pick numbers that feed the need-aware ordering (#746), the
 * season resolution, and the candidate query answered with `candidates`
 * verbatim (unordered — the module orders them itself). `rosterPositions` is the
 * on-clock team's drafted positions and `takenPicks` the 1-based pick numbers
 * already occupied; both default to empty so the pre-#746 cases are unchanged.
 */
function installSweepPool(
  t,
  { candidates, league = SWEEP_LEAGUE, team = SWEEP_TEAM, teams = [team], rosterPositions = [], takenPicks = [] } = {}
) {
  // autoPick emits the committed pick through the one Draft room adapter (#745),
  // which throws with no transport (no silent default). Inject a recording
  // broadcast so every sweep test has an honest transport and the worker-path
  // test below can read back the exact adapter call. Returned so that test can
  // assert on it; the candidate-ordering tests ignore the return.
  const broadcast = installRecordingBroadcast(t);
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    // The backstop scans every active deadline and decides due-ness in JS now
    // (#601); this league's deadline is elapsed, so it takes the autopick path.
    if (text.includes('"pick_deadline_at" IS NOT NULL')) {
      return { rows: [{ id: league.id, pick_deadline_at: league.pick_deadline_at }] };
    }
    if (text.includes('FROM "leagues" WHERE "id" = $1')) return { rows: [league] };
    if (text.includes('FROM "draft_picks"')) return { rows: takenPicks.map((n) => ({ pick_number: n })) };
    // The on-clock team's current roster positions (need-aware ordering, #746).
    // Distinct from the candidate query (FROM "players") and the team rotation
    // (FROM "teams") by its FROM "team_players".
    if (text.includes('FROM "team_players"')) return { rows: rosterPositions.map((p) => ({ position: p })) };
    if (text.includes('FROM "teams"')) return { rows: teams };
    if (text.includes('EXTRACT(MONTH FROM CURRENT_DATE)')) return { rows: [{ season: 2026 }] };
    if (text.includes('FROM "players"')) return { rows: candidates };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  return broadcast;
}

// A MinneApple-shaped starting lineup: QB, RBx2, WRx2, TE, FLEX, K, DEF.
const MINNEAPPLE_ROSTER_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', label: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

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

// --- need-aware phases: Starting needs before the bench (#746, ADR 0026) -----

test('sweep: the MinneApple wedge - a needed TE is drafted over a lower-ADP QB', async (t) => {
  // Twelve-team, fifteen-round MinneApple shape at pick 52 (0-based 51, round 5,
  // K/DEF window still closed). The on-clock team holds three QBs and no TE, so
  // only one QB starts and the TE slot is open. A QB of LOWER ADP and a TE of
  // HIGHER ADP are available: raw Best available would take the QB; the need
  // phase must take the TE, because the TE fills a Starting need and a fourth QB
  // does not. Red tell: make fillsStartingNeed return true for every candidate
  // and the QB (lower ADP) is drafted instead.
  const te = { id: 200, name: 'Needed TE', adp: '20.0', position: 'TE', queue_rank: null, last_season_points: null };
  const qb = { id: 201, name: 'Fourth QB', adp: '10.0', position: 'QB', queue_rank: null, last_season_points: null };
  const leagueA = { ...SWEEP_LEAGUE, current_pick: 51, draft_rounds: 15, roster_slots: MINNEAPPLE_ROSTER_SLOTS };
  const teamsA = Array.from({ length: 12 }, (_, i) => ({ id: 101 + i, owner_id: 1101 + i, autodraft: true, draft_position: i + 1 }));
  installSweepPool(t, {
    candidates: [qb, te], // seeded lower-ADP-first
    league: leagueA,
    teams: teamsA,
    rosterPositions: ['QB', 'QB', 'QB'],
  });
  const attempts = recordAttempts(t);

  await pickClock.processExpiredPickClocks();

  assert.deepEqual(attempts, [200], 'the TE fills a Starting need; the lower-ADP fourth QB does not');
});

test('sweep: must-fill guard - with as many picks as open needs, a K/DEF beats a lower-ADP WR', async (t) => {
  // A team in round 12 of 15 (the K/DEF window is still CLOSED) whose only open
  // starting needs are K and DEF, and whose remaining picks equal those two open
  // needs (two of its later picks are keepers, pre-inserted as draft_picks rows).
  // The must-fill guard fires: it overrides the K/DEF window and drafts a K or a
  // DEF even though the lowest-ADP player available is a WR that fills nothing.
  // Red tell: drop the must-fill guard and the closed K/DEF window strands both,
  // leaving the WR (which the guard exists to refuse) as the pick.
  const wr = { id: 300, name: 'Cheap WR', adp: '1.0', position: 'WR', queue_rank: null, last_season_points: null };
  const k = { id: 301, name: 'A Kicker', adp: '50.0', position: 'K', queue_rank: null, last_season_points: null };
  const def = { id: 302, name: 'A Defense', adp: '60.0', position: 'DEF', queue_rank: null, last_season_points: null };
  // current_pick 11 => round 12 (single team, so ceil math is exact); 15 rounds
  // => picks 12..15 remain, and marking pick numbers 14 and 15 as keepers leaves
  // exactly two remaining picks against the two open needs.
  const leagueB = { ...SWEEP_LEAGUE, current_pick: 11, draft_rounds: 15, roster_slots: MINNEAPPLE_ROSTER_SLOTS };
  const rosterB = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB']; // QB, RBx2, WRx2, TE, FLEX(RB) all filled; K/DEF open
  installSweepPool(t, {
    candidates: [wr, k, def],
    league: leagueB,
    team: { id: 55, owner_id: 7, autodraft: true },
    rosterPositions: rosterB,
    takenPicks: [14, 15],
  });
  const attempts = recordAttempts(t);

  await pickClock.processExpiredPickClocks();

  assert.deepEqual(attempts, [301], 'the must-fill guard drafts the K (a need) over the lower-ADP WR');
});

test('sweep: control - the same league with roster_slots [] takes the raw Best available', async (t) => {
  // The exact case (b) row but with NO starting slots: nothing fills a need, the
  // must-fill guard cannot fire, and autopick collapses to raw Best available -
  // the lowest-ADP WR. This is the pair to the must-fill case: it proves the
  // K/DEF pick there came from the need logic, not from the ordering at large.
  // Making fillsStartingNeed return true for every candidate leaves this GREEN
  // (there are still no slots to fill) while it turns the MinneApple case red.
  const wr = { id: 300, name: 'Cheap WR', adp: '1.0', position: 'WR', queue_rank: null, last_season_points: null };
  const k = { id: 301, name: 'A Kicker', adp: '50.0', position: 'K', queue_rank: null, last_season_points: null };
  const def = { id: 302, name: 'A Defense', adp: '60.0', position: 'DEF', queue_rank: null, last_season_points: null };
  const leagueC = { ...SWEEP_LEAGUE, current_pick: 11, draft_rounds: 15, roster_slots: [] };
  installSweepPool(t, {
    candidates: [k, def, wr], // seeded so raw Best available (the WR) is not first
    league: leagueC,
    team: { id: 55, owner_id: 7, autodraft: true },
    rosterPositions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB'],
    takenPicks: [14, 15],
  });
  const attempts = recordAttempts(t);

  await pickClock.processExpiredPickClocks();

  assert.deepEqual(attempts, [300], 'no starting slots => raw Best available, the lowest-ADP WR');
});

test('sweep: must-fill with its need-fillers sniped falls to the tail, not to escalation', async (t) => {
  // The must-fill guard fires (two open needs, K and DEF; two picks remaining),
  // but both K/DEF are sniped between candidate selection and the pick. The
  // normal phases ride along as a fallback tail (ADR 0026), so autopick degrades
  // to the draftable WR instead of walking into escalateNothingDraftable with a
  // player still on the board. Red tell: an early `return [...queued,
  // ...mustFillers]` drops the WR and this drafts nothing (755-f1).
  const wr = { id: 400, name: 'Fallback WR', adp: '1.0', position: 'WR', queue_rank: null, last_season_points: null };
  const k = { id: 401, name: 'A Kicker', adp: '50.0', position: 'K', queue_rank: null, last_season_points: null };
  const def = { id: 402, name: 'A Defense', adp: '60.0', position: 'DEF', queue_rank: null, last_season_points: null };
  // current_pick 13 => round 14 of 15 (single team), two picks remain and no
  // keepers, so picks-remaining is 2 against the two open needs (K, DEF).
  const league = { ...SWEEP_LEAGUE, current_pick: 13, draft_rounds: 15, roster_slots: MINNEAPPLE_ROSTER_SLOTS };
  // QB, RBx2, WRx2, TE, FLEX(RB) filled (7 starters); K and DEF are the two open
  // needs, matching the two remaining picks so the must-fill guard fires.
  const roster = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB'];
  installSweepPool(t, {
    candidates: [wr, k, def],
    league,
    team: { id: 55, owner_id: 7, autodraft: true },
    rosterPositions: roster,
  });
  const attempts = recordAttempts(t, { snipe: [401, 402] });

  const outcomes = await pickClock.processExpiredPickClocks();

  assert.deepEqual(attempts, [401, 402, 400], 'K then DEF sniped, then the WR from the fallback tail');
  assert.deepEqual(outcomes, [{ leagueId: LEAGUE_ID, playerId: 400 }], 'the WR is drafted, not an escalation');
});

// --- the worker broadcast path: through the one Draft room adapter -----------
// The worker process has no local Socket.IO server, so autoPick reaches the room
// through the one Draft room adapter (#745), which in the worker publishes over
// the Redis emitter transport (#744). Injecting the recording broadcast in place
// of that transport lets this pin the exact adapter call - pickLanded with the
// committed outcome, marked auto - without a live socket or Redis, and proves
// the committed pick is no longer dropped the way the old getIo()-null path
// risked.

test('sweep: the committed pick reaches the room through the adapter (pickLanded, auto:true)', async (t) => {
  const broadcast = installSweepPool(t, {
    candidates: [{ id: 8, name: 'Worker Pick', adp: '1.0', queue_rank: null, last_season_points: null }],
  });
  const outcome = { leagueId: LEAGUE_ID, teamId: 55, player: { id: 8, name: 'Worker Pick' }, draftComplete: false };
  t.mock.method(draftService, 'draftPlayer', async () => outcome);

  await pickClock.processExpiredPickClocks();

  assert.deepEqual(broadcast.calls, [
    { method: 'pickLanded', leagueId: LEAGUE_ID, payload: { ...outcome, auto: true } },
  ]);
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
