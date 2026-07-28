const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CORRECTION_WINDOW_ERROR,
  CorrectionWindowError,
  assertManualCorrectionWindow,
  diffMatchupScores,
  isCorrectionDay,
} = require('../services/correction.service');

const matchup = (id, home, away, overrides = {}) => ({
  id,
  week: 3,
  final: true,
  is_playoff: false,
  home_score: home,
  away_score: away,
  ...overrides,
});

test('identical scores before and after produce no changes', () => {
  const rows = [matchup(1, 100.5, 90.25), matchup(2, 80, 80)];
  assert.deepEqual(diffMatchupScores(rows, rows), []);
});

test('a moved score is reported with before/after values', () => {
  const before = [matchup(1, 100, 90)];
  const after = [matchup(1, 97.5, 90)];
  const changes = diffMatchupScores(before, after);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].before, { home: 100, away: 90 });
  assert.deepEqual(changes[0].after, { home: 97.5, away: 90 });
  assert.equal(changes[0].winnerFlipped, false);
});

test('a correction that changes the winner sets winnerFlipped', () => {
  const changes = diffMatchupScores([matchup(1, 100, 99)], [matchup(1, 98, 99)]);
  assert.equal(changes[0].winnerFlipped, true);
});

test('win becoming a tie counts as a flipped result', () => {
  const changes = diffMatchupScores([matchup(1, 100, 99)], [matchup(1, 99, 99)]);
  assert.equal(changes[0].winnerFlipped, true);
});

test('both scores moving without changing the winner is not a flip', () => {
  const changes = diffMatchupScores([matchup(1, 100, 90)], [matchup(1, 102, 95)]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].winnerFlipped, false);
});

test('finality and playoff flags pass through from the before rows', () => {
  const before = [matchup(1, 50, 60, { final: true, is_playoff: true })];
  const after = [matchup(1, 65, 60)];
  const changes = diffMatchupScores(before, after);
  assert.equal(changes[0].final, true);
  assert.equal(changes[0].isPlayoff, true);
  assert.equal(changes[0].winnerFlipped, true);
});

test('matchups missing from the after set are skipped, not crashed on', () => {
  const changes = diffMatchupScores([matchup(1, 10, 5)], []);
  assert.deepEqual(changes, []);
});

test('multiple matchups: only the changed ones are reported', () => {
  const before = [matchup(1, 100, 90), matchup(2, 70, 75), matchup(3, 60, 50)];
  const after = [matchup(1, 100, 90), matchup(2, 77, 75), matchup(3, 60, 50)];
  const changes = diffMatchupScores(before, after);
  assert.deepEqual(changes.map((c) => c.matchupId), [2]);
  assert.equal(changes[0].winnerFlipped, true); // 70-75 loss became 77-75 win
});

test('isCorrectionDay uses exact UTC Tuesday/Wednesday boundaries', () => {
  assert.equal(isCorrectionDay('2026-07-06T23:59:59.999Z'), false);
  assert.equal(isCorrectionDay('2026-07-07T00:00:00.000Z'), true);
  assert.equal(isCorrectionDay('2026-07-08T23:59:59.999Z'), true);
  assert.equal(isCorrectionDay('2026-07-09T00:00:00.000Z'), false);
});

test('manual correction allows only the immediate past week during the UTC window', () => {
  const result = assertManualCorrectionWindow({
    requestedSeason: 2026,
    requestedWeek: 8,
    activeSeason: 2026,
    activeWeek: 9,
    timestamp: '2026-10-06T00:00:00.000Z',
  });

  assert.equal(result.correctionWeek, 8);
  assert.equal(result.checkedAt.toISOString(), '2026-10-06T00:00:00.000Z');
});

test('manual correction blocks a week older than the immediate past week', () => {
  assert.throws(
    () => assertManualCorrectionWindow({
      requestedSeason: 2026,
      requestedWeek: 7,
      activeSeason: 2026,
      activeWeek: 9,
      timestamp: '2026-10-06T12:00:00.000Z',
    }),
    (error) =>
      error instanceof CorrectionWindowError &&
      error.statusCode === 403 &&
      error.code === CORRECTION_WINDOW_ERROR.code &&
      error.message === CORRECTION_WINDOW_ERROR.message
  );
});

test('manual correction blocks the immediate past week outside Tuesday/Wednesday UTC', () => {
  for (const timestamp of ['2026-10-05T23:59:59.999Z', '2026-10-08T00:00:00.000Z']) {
    assert.throws(
      () => assertManualCorrectionWindow({
        requestedSeason: 2026,
        requestedWeek: 8,
        activeSeason: 2026,
        activeWeek: 9,
        timestamp,
      }),
      CorrectionWindowError
    );
  }
});

test('manual correction fails closed for cross-season, week-one, and ambiguous timestamps', () => {
  const attempts = [
    { requestedSeason: 2025, requestedWeek: 18, activeSeason: 2026, activeWeek: 1, timestamp: '2026-09-08T12:00:00Z' },
    { requestedSeason: 2026, requestedWeek: 8, activeSeason: 2026, activeWeek: 9, timestamp: '2026-10-06T12:00:00' },
    { requestedSeason: 2026, requestedWeek: 8, activeSeason: 2026, activeWeek: 9, timestamp: 'not-a-date' },
  ];
  for (const attempt of attempts) {
    assert.throws(() => assertManualCorrectionWindow(attempt), CorrectionWindowError);
  }
});

// ---- scheduled corrections spend no Tank01 quota -----------------------------

const poolModule = require('../modules/pool');
const correctionSvc = require('../services/correction.service');
const scoringSvc = require('../services/scoring.service');
const nflverse = require('../services/nflverseSync.service');

function stubOneInSeasonLeague(t) {
  t.mock.method(poolModule, 'query', async (sql) => {
    if (String(sql).includes('FROM "leagues"')) {
      return { rows: [{ id: 42, current_season: 2026, current_week: 4 }] };
    }
    return { rows: [] };
  });
}

test('resyncPriorWeeks defaults to nflverse and never calls Tank01', async (t) => {
  stubOneInSeasonLeague(t);
  let tankCalls = 0;
  let nflverseArgs = null;
  t.mock.method(scoringSvc, 'syncWeekStats', async () => {
    tankCalls += 1;
    return { plays: [] };
  });
  t.mock.method(nflverse, 'correctWeekFromNflverse', async (args) => {
    nflverseArgs = args;
    return { playersUpdated: 10 };
  });
  t.mock.method(correctionSvc, 'correctLeagueWeek', async () => ({ leagueId: 42, changes: [] }));

  await correctionSvc.resyncPriorWeeks();

  assert.equal(tankCalls, 0, 'no quota spent on a scheduled correction');
  // Prior week of a league sitting on week 4, and league re-scoring is handled
  // by the per-league loop below it, not twice.
  assert.deepEqual(nflverseArgs, { season: 2026, week: 3, rescoreLeagues: false });
});

test('resyncPriorWeeks can still be asked for the Tank01 source explicitly', async (t) => {
  stubOneInSeasonLeague(t);
  let tankArgs = null;
  t.mock.method(scoringSvc, 'syncWeekStats', async (args) => {
    tankArgs = args;
    return { plays: [] };
  });
  t.mock.method(correctionSvc, 'correctLeagueWeek', async () => ({ leagueId: 42, changes: [] }));

  const prevKey = process.env.RAPID_API_KEY;
  const prevHost = process.env.RAPID_API_HOST;
  process.env.RAPID_API_KEY = 'test-key';
  process.env.RAPID_API_HOST = 'test-host';
  try {
    await correctionSvc.resyncPriorWeeks({ source: 'tank01' });
  } finally {
    if (prevKey === undefined) delete process.env.RAPID_API_KEY;
    else process.env.RAPID_API_KEY = prevKey;
    if (prevHost === undefined) delete process.env.RAPID_API_HOST;
    else process.env.RAPID_API_HOST = prevHost;
  }
  assert.deepEqual(tankArgs, { season: 2026, week: 3 });
});

test('resyncPriorWeeks skips the Tank01 source without credentials', async () => {
  const prevKey = process.env.RAPID_API_KEY;
  delete process.env.RAPID_API_KEY;
  try {
    const out = await correctionSvc.resyncPriorWeeks({ source: 'tank01' });
    assert.match(out.skipped, /RapidAPI credentials/);
  } finally {
    if (prevKey !== undefined) process.env.RAPID_API_KEY = prevKey;
  }
});

// ---- corrections invalidate BOTH projection caches ---------------------------

/**
 * A stat correction rewrites the history the following week's projections were
 * computed from. Two caches hold those numbers and they need opposite
 * treatment: the legacy pool-wide `player_projections` cache is refreshed, and
 * the versioned `projection_runs` cache (per scoring profile, per player) is
 * invalidated and rebuilt lazily. Before this, only the first happened, so the
 * start/sit engine kept serving pre-correction numbers indefinitely.
 */
const projectionSvc = require('../services/projection.service');

/**
 * Stubs the pool and records the per-league matchup reads.
 *
 * `correctLeagueWeek` is called through a module-local binding, so it cannot be
 * mocked from outside; it is left to run for real and short-circuits on the
 * empty `matchups` read. That read is therefore the honest observation point
 * for "the per-league loop was still entered".
 */
function stubLeagues(t, leagues) {
  const correctedLeagueIds = [];
  t.mock.method(poolModule, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "leagues"')) return { rows: leagues };
    if (text.includes('FROM "matchups"')) correctedLeagueIds.push(params[0]);
    return { rows: [] };
  });
  return correctedLeagueIds;
}

/** Mocks the two cache-maintenance calls and records their arguments. */
function stubCaches(t, { onLegacy, onInvalidate } = {}) {
  const legacy = [];
  const invalidated = [];
  t.mock.method(nflverse, 'correctWeekFromNflverse', async () => ({ playersUpdated: 1 }));
  t.mock.method(projectionSvc, 'getWeekProjections', async (args) => {
    legacy.push(args);
    if (onLegacy) return onLegacy(args);
    return new Map();
  });
  t.mock.method(projectionSvc, 'invalidateWeeklyProjectionRuns', async (args) => {
    invalidated.push(args);
    if (onInvalidate) return onInvalidate(args);
    return { deletedRuns: 2 };
  });
  return { legacy, invalidated };
}

test('a corrected week refreshes the legacy cache AND invalidates the versioned one', async (t) => {
  stubLeagues(t, [{ id: 42, current_season: 2026, current_week: 4 }]);
  const seen = stubCaches(t);

  await correctionSvc.resyncPriorWeeks();

  assert.equal(seen.legacy.length, 1, 'the legacy refresh must not be dropped');
  assert.equal(seen.legacy[0].season, 2026);
  assert.equal(seen.legacy[0].week, 4, 'the week AFTER the corrected week 3');
  assert.equal(seen.legacy[0].refresh, true);

  assert.equal(seen.invalidated.length, 1, 'the versioned cache must be invalidated too');
  assert.deepEqual(seen.invalidated[0], { season: 2026, fromWeek: 4 });
  // The corrected week itself is history now; what went stale is every week
  // whose projections were computed FROM it — week 4 onward, which is what
  // fromWeek (as opposed to an exact week) hands the helper.
  assert.notEqual(seen.invalidated[0].fromWeek, 3, 'starting at week 3 would clear the wrong cache');
});

test('invalidation runs once per corrected season/week, not once per league', async (t) => {
  // Three leagues share week 3; a fourth is a week ahead, so it corrects week 4.
  const correctedLeagueIds = stubLeagues(t, [
    { id: 1, current_season: 2026, current_week: 4 },
    { id: 2, current_season: 2026, current_week: 4 },
    { id: 3, current_season: 2026, current_week: 4 },
    { id: 4, current_season: 2026, current_week: 5 },
  ]);
  const seen = stubCaches(t);

  await correctionSvc.resyncPriorWeeks();

  assert.deepEqual(correctedLeagueIds.sort(), [1, 2, 3, 4], 'every league is still re-scored');
  assert.equal(
    seen.invalidated.length,
    2,
    'one invalidation per distinct (season, week), not one per league'
  );
  assert.deepEqual(
    seen.invalidated.map((a) => a.fromWeek).sort(),
    [4, 5],
    'each corrected week invalidates from the week after it onward'
  );
  assert.equal(seen.legacy.length, 2, 'the legacy refresh is also per-week, not per-league');
});

test('one cache-maintenance failure does not prevent attempting the other', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => { logs.push(args); });

  const correctedLeagueIds = stubLeagues(t, [{ id: 42, current_season: 2026, current_week: 4 }]);
  const seen = stubCaches(t, {
    onLegacy: () => { throw new Error('legacy cache exploded'); },
  });

  await assert.rejects(
    correctionSvc.resyncPriorWeeks(),
    /cache maintenance operation\(s\) failed/,
    'the pass must surface the failure so the scheduler retries instead of stamping the day'
  );

  assert.equal(
    seen.invalidated.length,
    1,
    'a legacy refresh failure must not skip the versioned invalidation'
  );
  assert.deepEqual(correctedLeagueIds, [42], 'nor must it skip re-scoring the leagues');
  const logged = logs.find((l) => String(l[0]).includes('legacy projection refresh failed'));
  assert.ok(logged, 'the failure is logged');
  assert.deepEqual(logged.slice(1, 3), [2026, 4], 'with season and week context');
});

test('a failed invalidation surfaces AFTER the leagues are corrected', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => { logs.push(args); });

  const correctedLeagueIds = stubLeagues(t, [{ id: 42, current_season: 2026, current_week: 4 }]);
  const seen = stubCaches(t, {
    onInvalidate: () => { throw new Error('delete failed'); },
  });

  const rejection = await correctionSvc.resyncPriorWeeks().then(
    () => assert.fail('a failed invalidation must reject, or the scheduler stamps the day'),
    (err) => err
  );

  assert.equal(seen.legacy.length, 1, 'the legacy refresh still happened');
  assert.deepEqual(correctedLeagueIds, [42], 'and the correction itself ran to completion first');
  assert.deepEqual(
    rejection.cacheFailures,
    [{ op: 'run invalidation', season: 2026, week: 4, message: 'delete failed' }],
    'the aggregate error carries the exact failed operations'
  );
  const logged = logs.find((l) => String(l[0]).includes('invalidation failed'));
  assert.ok(logged, 'the failure is also logged as it happens');
  assert.deepEqual(logged.slice(1, 3), [2026, 4], 'with season and week context');
});

test('a failure in one corrected week does not skip cache maintenance for the next', async (t) => {
  t.mock.method(console, 'error', () => {});

  // Two distinct corrected weeks: leagues on week 4 (correcting week 3) and
  // week 5 (correcting week 4). Week 4's invalidation fails; week 5's whole
  // maintenance pass and every league correction must still run before the
  // aggregate error is thrown.
  const correctedLeagueIds = stubLeagues(t, [
    { id: 1, current_season: 2026, current_week: 4 },
    { id: 2, current_season: 2026, current_week: 5 },
  ]);
  const seen = stubCaches(t, {
    onInvalidate: ({ fromWeek }) => {
      if (fromWeek === 4) throw new Error('first week delete failed');
      return { deletedRuns: 1 };
    },
  });

  const rejection = await correctionSvc.resyncPriorWeeks().then(
    () => assert.fail('the aggregate failure must still reject'),
    (err) => err
  );

  assert.equal(seen.legacy.length, 2, 'both weeks got their legacy refresh');
  assert.deepEqual(
    seen.invalidated.map((a) => a.fromWeek).sort(),
    [4, 5],
    'both weeks got their invalidation ATTEMPT'
  );
  assert.deepEqual(correctedLeagueIds.sort(), [1, 2], 'every league was still corrected');
  assert.equal(rejection.cacheFailures.length, 1, 'only the one real failure is reported');
  assert.equal(rejection.cacheFailures[0].week, 4);
});
