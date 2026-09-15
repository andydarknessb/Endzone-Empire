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
const recapSvc = require('../services/recap.service');
const montecarlo = require('../services/montecarlo.service');
const trophySvc = require('../services/trophy.service');
const { createFakePool } = require('./helpers/fakePool');

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

// ---- #1409: a stat correction rebuilds the stored weekly recap --------------
//
// correctLeagueWeek is the one place BOTH the scheduled Tuesday/Wednesday
// pass and the manual commissioner correction route (scoring.router.js'
// POST /league/:id/correct-week) land, so a rebuild wired in here covers both
// with no separate code path. The recap is rebuilt SILENTLY: only
// `computeAndStoreWeeklyRecap` is called, never `announceWeeklyRecap` - the
// correction's own "scores were updated" notice is the one announcement.

/**
 * A one-matchup, two-team world wired for: an initial `generateWeeklyRecap`
 * seed (the advance-week path, pre-correction score), then
 * correctLeagueWeek's own before/after snapshots and
 * computeAndStoreWeeklyRecap's rebuild queries. `scoring.scoreMatchups` is
 * mocked to a no-op (as commissionerAlertFanout.test.js does) and the
 * "after" snapshot rows stand in for what it would have written. The
 * matchups+teams join is called twice - once by the seed, once by the
 * rebuild - and answers with the pre-correction score the first time, the
 * corrected score every time after.
 */
function correctionRecapWorld({ beforeHome, beforeAway, afterHome, afterAway, final = true, isPlayoff = false }) {
  let matchupsJoinCalls = 0;
  return createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 1, week: 5, final, is_playoff: isPlayoff, home_score: beforeHome, away_score: beforeAway }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 1, home_score: afterHome, away_score: afterAway }],
    })],
    [/^SELECT "matchups"\.\*/, () => {
      matchupsJoinCalls += 1;
      const corrected = matchupsJoinCalls > 1;
      return {
        rows: [{
          id: 1, final, home_team_id: 1, away_team_id: 2,
          home_team_name: 'Team A', away_team_name: 'Team B',
          home_score: corrected ? afterHome : beforeHome,
          away_score: corrected ? afterAway : beforeAway,
        }],
      };
    }],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [{ id: 7, scoring_rules: null }] })],
    [/^INSERT INTO "league_analytics"/, () => ({ rows: [] })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 101 }] })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
}

test('#1409: a correction rebuilds the stored recap from the corrected scores, with no second announcement', async (t) => {
  const fake = correctionRecapWorld({ beforeHome: 90, beforeAway: 80, afterHome: 115, afterAway: 80 });
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));

  // Seed: the advance-week path already computed, stored AND announced the
  // recap from the pre-correction score - exactly what production looks like
  // right before Tuesday's correction runs.
  await recapSvc.generateWeeklyRecap({ leagueId: 7, season: 2026, week: 5 });

  const outcome = await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  assert.equal(outcome.changes.length, 1);
  const stored = fake.matching(/INSERT INTO "league_analytics"/);
  assert.equal(stored.length, 2, 'the seed store, then the rebuild');
  const rebuilt = JSON.parse(stored[1].params[3]);
  assert.equal(rebuilt.facts.highestScorer.team, 'Team A');
  assert.equal(
    rebuilt.facts.highestScorer.points,
    115,
    'the rebuilt recap reflects the corrected score, not the pre-correction one'
  );

  // Exactly the ORIGINAL feed entry and member notification survive - the
  // correction rebuilt the recap silently, not a second "week N recap is
  // in" announcement.
  const recapFeedEntries = fake.matching(/INSERT INTO "transactions"/).filter((c) => c.params[2] === 'recap');
  const recapNotifications = fake.matching(/INSERT INTO "notifications"/).filter((c) => c.params[2] === 'recap');
  assert.equal(recapFeedEntries.length, 1, 'the original recap feed entry, not a second one');
  assert.equal(recapNotifications.length, 1, 'the original recap notification, not a second one');
  // The correction's own notice is the one announcement for the correction
  // itself, and it still fires exactly once.
  const correctionFeedEntries = fake.matching(/INSERT INTO "transactions"/)
    .filter((c) => c.params[2] === 'stat_correction');
  assert.equal(correctionFeedEntries.length, 1);
});

test('#1409: the recap rebuild runs AFTER the stat_correction log/notify, not before', async (t) => {
  // formal-001-f1: the rebuild makes several pool queries and awaits an
  // un-timed-out llmNarrative call, so it must not sit between the scores
  // committing and the correction being logged/announced - a crash there
  // would leave the correction with no record at all, and a later run's
  // "before" snapshot (already post-correction) would never re-detect it to
  // retry. The log/notify transaction is the one thing that has to land
  // first.
  const fake = correctionRecapWorld({ beforeHome: 90, beforeAway: 80, afterHome: 115, afterAway: 80 });
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));

  await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  const statCorrectionIdx = fake.calls.findIndex(
    (c) => /INSERT INTO "transactions"/.test(c.text) && c.params[2] === 'stat_correction'
  );
  const recapStoreIdx = fake.calls.findIndex((c) => /INSERT INTO "league_analytics"/.test(c.text));
  assert.ok(statCorrectionIdx >= 0, 'the stat_correction feed entry was written');
  assert.ok(recapStoreIdx >= 0, 'the recap was rebuilt');
  assert.ok(
    statCorrectionIdx < recapStoreIdx,
    'the correction is logged and announced before the recap rebuild runs'
  );
});

test('#1409: a recap rebuild still runs when the log/notify transaction itself throws', async (t) => {
  // formal-001-f1: the scores are committed either way, so losing the log/
  // notify step must not also lose the rebuild.
  const beforeHome = 90; const beforeAway = 80; const afterHome = 115; const afterAway = 80;
  const fake = createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 1, week: 5, final: true, is_playoff: false, home_score: beforeHome, away_score: beforeAway }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 1, home_score: afterHome, away_score: afterAway }],
    })],
    [/^SELECT "matchups"\.\*/, () => ({
      rows: [{
        id: 1, final: true, home_team_id: 1, away_team_id: 2,
        home_team_name: 'Team A', away_team_name: 'Team B',
        home_score: afterHome, away_score: afterAway,
      }],
    })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [{ id: 7, scoring_rules: null }] })],
    [/^INSERT INTO "league_analytics"/, () => ({ rows: [] })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => { throw new Error('owner lookup exploded'); }],
  ]);
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  t.mock.method(console, 'error', () => {});

  await assert.rejects(
    correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 }),
    /owner lookup exploded/
  );

  const stored = fake.matching(/INSERT INTO "league_analytics"/);
  assert.equal(stored.length, 1, 'the recap is still rebuilt even though the log/notify transaction failed');
  fake.assertClean();
});

test('#1409: a correction that changes nothing leaves the stored recap untouched, including its generated-at stamp', async (t) => {
  const fake = createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 1, week: 5, final: true, is_playoff: false, home_score: 90, away_score: 80 }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 1, home_score: 90, away_score: 80 }], // unchanged
    })],
  ]);
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));

  const outcome = await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  assert.deepEqual(outcome.changes, []);
  assert.equal(
    fake.calls.some((c) => /league_analytics/.test(c.text)),
    false,
    'no score movement means the recap store is never even queried'
  );
  fake.assertClean();
});

test('#1409: a correction on a matchup that was not yet final never touches the recap', async (t) => {
  const fake = createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 1, week: 5, final: false, is_playoff: false, home_score: 90, away_score: 80 }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 1, home_score: 100, away_score: 80 }],
    })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [] })],
  ]);
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));

  const outcome = await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  assert.equal(outcome.changes.length, 1, 'the score change is still logged');
  assert.equal(
    fake.calls.some((c) => /league_analytics|FROM "leagues"/.test(c.text)),
    false,
    'a non-final matchup change never rebuilds a recap - there is nothing finalized to recap yet'
  );
  fake.assertClean();
});

test('#1409: a recap rebuild failure is logged and never blocks the correction pass', async (t) => {
  const fake = correctionRecapWorld({ beforeHome: 90, beforeAway: 80, afterHome: 115, afterAway: 80 });
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  t.mock.method(recapSvc, 'computeAndStoreWeeklyRecap', async () => { throw new Error('recap boom'); });
  const logs = [];
  t.mock.method(console, 'error', (...args) => { logs.push(args); });

  const outcome = await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  assert.equal(outcome.changes.length, 1, 'the correction pass still records its changes');
  assert.equal(
    fake.matching(/INSERT INTO "transactions"/).filter((c) => c.params[2] === 'stat_correction').length,
    1,
    'and still completes its own log/notify step'
  );
  const logged = logs.find((l) => String(l[0]).includes('recap rebuild failed'));
  assert.ok(logged, 'the recap rebuild failure is logged');
});

// ---- #1410: power rankings recompute before the post-correction recap rebuild --
//
// The advance-week chain (scoring.router.js:462-475) runs
// montecarlo.computeLeagueOdds before building the recap, "odds first so the
// recap reads fresh playoff numbers" - the recap reads the latest stored
// `power_rankings` league_analytics row directly (recap.service.js), so odds
// must be stored before the rebuild for the recap to see them. The
// correction path matches that order on both the success path and the
// catch-before-rethrow path, without touching #1409's order (log/notify
// before any post-correction analytics work) or its rethrow.

/**
 * Extends correctionRecapWorld's one-matchup, two-team shape with the
 * league_analytics `power_rankings` read the recap's playoff-odds fact uses.
 * `rankingsInserts` records every power_rankings row written, in order (push
 * a pre-correction one onto it before running a test to simulate a
 * previously-stored row), so a test can assert the computed-at stamp moved
 * and that the recap read the LATEST row, not a stale one.
 */
function correctionPowerRankingsWorld({ beforeHome, beforeAway, afterHome, afterAway }) {
  let matchupsJoinCalls = 0;
  const rankingsInserts = [];
  const fake = createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 1, week: 5, final: true, is_playoff: false, home_score: beforeHome, away_score: beforeAway }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 1, home_score: afterHome, away_score: afterAway }],
    })],
    [/^SELECT "matchups"\.\*/, () => {
      matchupsJoinCalls += 1;
      const corrected = matchupsJoinCalls > 1;
      return {
        rows: [{
          id: 1, final: true, home_team_id: 1, away_team_id: 2,
          home_team_name: 'Team A', away_team_name: 'Team B',
          home_score: corrected ? afterHome : beforeHome,
          away_score: corrected ? afterAway : beforeAway,
        }],
      };
    }],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [{ id: 7, scoring_rules: null }] })],
    [/^SELECT "data" FROM "league_analytics"/, () => {
      const latest = rankingsInserts[rankingsInserts.length - 1];
      return { rows: latest ? [{ data: latest }] : [] };
    }],
    [/^INSERT INTO "league_analytics"/, (text, params) => {
      if (text.includes(`'power_rankings'`)) rankingsInserts.push(JSON.parse(params[3]));
      return { rows: [] };
    }],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 101 }] })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
  fake.rankingsInserts = rankingsInserts;
  return fake;
}

test('#1410: a correction recomputes power rankings and the rebuilt recap reads the fresh row, not the pre-correction one', async (t) => {
  const fake = correctionPowerRankingsWorld({ beforeHome: 90, beforeAway: 80, afterHome: 115, afterAway: 80 });
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));

  // Seed: a power rankings row already on the books, same as production
  // before Tuesday's correction runs.
  fake.rankingsInserts.push({
    computedAt: '2026-10-05T00:00:00.000Z',
    rankings: [{ name: 'Team A', playoffOdds: 0.5, titleOdds: 0.2 }],
  });
  const mc = t.mock.method(montecarlo, 'computeLeagueOdds', async ({ leagueId }) => {
    const data = {
      computedAt: '2026-10-06T12:00:00.000Z',
      rankings: [{ name: 'Team A', playoffOdds: 0.9, titleOdds: 0.4 }],
    };
    await poolModule.query(
      `INSERT INTO "league_analytics" ("league_id", "season", "week", "type", "data")
       VALUES ($1, $2, $3, 'power_rankings', $4)`,
      [leagueId, 2026, 5, JSON.stringify(data)]
    );
    return data;
  });

  // Seed: a stored recap built from the pre-correction score and the
  // pre-correction power rankings row - exactly what production looks like
  // right before Tuesday's correction runs (mirrors #1409's own seed step).
  await recapSvc.generateWeeklyRecap({ leagueId: 7, season: 2026, week: 5 });

  const outcome = await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  assert.equal(outcome.changes.length, 1);
  assert.equal(mc.mock.calls.length, 1, 'power rankings are recomputed exactly once');

  assert.equal(fake.rankingsInserts.length, 2, 'the seed row, then the rewrite');
  assert.notEqual(
    fake.rankingsInserts[1].computedAt,
    fake.rankingsInserts[0].computedAt,
    'the stored power rankings row was rewritten - its computed-at stamp moved'
  );

  const recapInserts = fake
    .matching(/INSERT INTO "league_analytics"/)
    .filter((c) => c.text.includes(`'weekly_recap'`));
  assert.equal(recapInserts.length, 2, 'the seed store, then the rebuild');
  const rebuilt = JSON.parse(recapInserts[1].params[3]);
  assert.deepEqual(
    rebuilt.facts.playoffOdds,
    [{ name: 'Team A', playoffOdds: 0.9, titleOdds: 0.4 }],
    'the rebuilt recap reflects the freshly stored power rankings, not the pre-correction ones'
  );
});

test('#1410: power rankings recompute runs after the log/notify and before the recap rebuild reads them', async (t) => {
  const fake = correctionRecapWorld({ beforeHome: 90, beforeAway: 80, afterHome: 115, afterAway: 80 });
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  t.mock.method(montecarlo, 'computeLeagueOdds', async ({ leagueId }) => {
    await poolModule.query(
      `INSERT INTO "league_analytics" ("league_id", "season", "week", "type", "data")
       VALUES ($1, $2, $3, 'power_rankings', $4)`,
      [leagueId, 2026, 5, JSON.stringify({ computedAt: new Date().toISOString(), rankings: [] })]
    );
  });

  await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  const statCorrectionIdx = fake.calls.findIndex(
    (c) => /INSERT INTO "transactions"/.test(c.text) && c.params[2] === 'stat_correction'
  );
  const powerRankingsIdx = fake.calls.findIndex(
    (c) => /INSERT INTO "league_analytics"/.test(c.text) && c.text.includes(`'power_rankings'`)
  );
  const recapStoreIdx = fake.calls.findIndex(
    (c) => /INSERT INTO "league_analytics"/.test(c.text) && c.text.includes(`'weekly_recap'`)
  );
  assert.ok(statCorrectionIdx >= 0, 'the stat_correction feed entry was written');
  assert.ok(powerRankingsIdx >= 0, 'power rankings were recomputed and stored');
  assert.ok(recapStoreIdx >= 0, 'the recap was rebuilt');
  assert.ok(statCorrectionIdx < powerRankingsIdx, 'power rankings run after the log/notify transaction');
  assert.ok(powerRankingsIdx < recapStoreIdx, 'power rankings are stored before the recap rebuild reads them');
});

test('#1410: power rankings still recompute before the recap rebuild when the log/notify transaction itself throws', async (t) => {
  // Mirrors the #1409 catch-path test: the scores are committed either way,
  // so the catch-before-rethrow path must still order power rankings ahead
  // of the recap rebuild, exactly like the success path.
  const beforeHome = 90; const beforeAway = 80; const afterHome = 115; const afterAway = 80;
  const fake = createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 1, week: 5, final: true, is_playoff: false, home_score: beforeHome, away_score: beforeAway }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 1, home_score: afterHome, away_score: afterAway }],
    })],
    [/^SELECT "matchups"\.\*/, () => ({
      rows: [{
        id: 1, final: true, home_team_id: 1, away_team_id: 2,
        home_team_name: 'Team A', away_team_name: 'Team B',
        home_score: afterHome, away_score: afterAway,
      }],
    })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [{ id: 7, scoring_rules: null }] })],
    [/^INSERT INTO "league_analytics"/, () => ({ rows: [] })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => { throw new Error('owner lookup exploded'); }],
  ]);
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  // Same stub shape as the success-path ordering test: it inserts its own
  // power_rankings row rather than just resolving, so the call log can prove
  // WHERE that insert lands relative to the recap rebuild's weekly_recap
  // insert - not just that both happened once.
  const mc = t.mock.method(montecarlo, 'computeLeagueOdds', async ({ leagueId }) => {
    await poolModule.query(
      `INSERT INTO "league_analytics" ("league_id", "season", "week", "type", "data")
       VALUES ($1, $2, $3, 'power_rankings', $4)`,
      [leagueId, 2026, 5, JSON.stringify({ computedAt: new Date().toISOString(), rankings: [] })]
    );
  });
  t.mock.method(console, 'error', () => {});

  await assert.rejects(
    correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 }),
    /owner lookup exploded/
  );

  assert.equal(mc.mock.calls.length, 1, 'power rankings still recompute on the catch-before-rethrow path');
  const stored = fake.matching(/INSERT INTO "league_analytics"/);
  assert.equal(stored.length, 2, 'the power rankings row, then the recap rebuild - the recap is still rebuilt even though the log/notify transaction failed');
  const powerRankingsIdx = fake.calls.findIndex(
    (c) => /INSERT INTO "league_analytics"/.test(c.text) && c.text.includes(`'power_rankings'`)
  );
  const recapStoreIdx = fake.calls.findIndex(
    (c) => /INSERT INTO "league_analytics"/.test(c.text) && c.text.includes(`'weekly_recap'`)
  );
  assert.ok(powerRankingsIdx >= 0, 'power rankings were recomputed and stored');
  assert.ok(recapStoreIdx >= 0, 'the recap was rebuilt');
  assert.ok(
    powerRankingsIdx < recapStoreIdx,
    'on the catch-before-rethrow path too, power rankings are stored before the recap rebuild reads them'
  );
  fake.assertClean();
});

test('#1410: a power-rankings recompute failure is logged and never blocks the recap rebuild or the correction pass', async (t) => {
  const fake = correctionRecapWorld({ beforeHome: 90, beforeAway: 80, afterHome: 115, afterAway: 80 });
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  t.mock.method(montecarlo, 'computeLeagueOdds', async () => { throw new Error('power rankings boom'); });
  const logs = [];
  t.mock.method(console, 'error', (...args) => { logs.push(args); });

  const outcome = await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  assert.equal(outcome.changes.length, 1, 'the correction pass still completes');
  const stored = fake.matching(/INSERT INTO "league_analytics"/);
  assert.equal(stored.length, 1, 'the recap rebuild still ran despite the power-rankings failure');
  assert.equal(
    fake.matching(/INSERT INTO "transactions"/).filter((c) => c.params[2] === 'stat_correction').length,
    1,
    'and the log/notify step still completed'
  );
  const logged = logs.find((l) => String(l[0]).includes('power rankings failed'));
  assert.ok(logged, 'the power-rankings failure is logged');
});

test('#1410: a correction that changes no scores never recomputes power rankings', async (t) => {
  const fake = createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 1, week: 5, final: true, is_playoff: false, home_score: 90, away_score: 80 }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 1, home_score: 90, away_score: 80 }], // unchanged
    })],
  ]);
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  const mc = t.mock.method(montecarlo, 'computeLeagueOdds', async () => {
    throw new Error('must not be called for a no-op correction');
  });

  const outcome = await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  assert.deepEqual(outcome.changes, []);
  assert.equal(mc.mock.calls.length, 0, 'no score movement means no power-rankings recompute');
  fake.assertClean();
});

// ---- #1411: weekly high score trophy reconciles after a stat correction ----
//
// awardWeeklyTrophies' insert is ON CONFLICT DO NOTHING, keyed on (league,
// season, week, team, type) - safe to re-run when the leader is unchanged,
// but wrong once a correction moves the high score: the original recipient
// would keep a stale trophy and the new leader would get a second one, or
// (leader unchanged, points moved) the stored points would go stale forever.
// This reconcile runs after the recap rebuild, matching #1409/#1410's own
// placement and the advance-week order (odds, recap, trophies).
//
// A stateful "world" tracks the trophies table in JS (mirroring
// correctionPowerRankingsWorld's rankingsInserts) so a test can assert the
// FINAL shape of the table, including that a seeded season-level trophy
// never moves. recomputePowerRankings and rebuildStoredRecap are stubbed to
// no-ops: their own ordering and failure handling are #1409/#1410's coverage,
// not this one's.

function trophyReconcileWorld({
  beforeHome, beforeAway, afterHome, afterAway,
  homeTeamId = 10, awayTeamId = 20, seedTrophies = [],
}) {
  const trophyRows = seedTrophies.map((row) => ({ ...row }));
  let nextId = Math.max(0, ...trophyRows.map((row) => row.id)) + 1;
  const fake = createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 1, week: 5, final: true, is_playoff: false, home_score: beforeHome, away_score: beforeAway }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 1, home_score: afterHome, away_score: afterAway }],
    })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 101 }] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [] })],
    // The trophy reconcile's own week-final read: by the time it runs, the
    // corrected scores are already committed, so it always sees `after`.
    [/^SELECT \* FROM "matchups" WHERE "league_id" = \$1 AND "season" = \$2 AND "week" = \$3 AND "final" = true/, () => ({
      rows: [{
        id: 1, home_team_id: homeTeamId, away_team_id: awayTeamId,
        home_score: afterHome, away_score: afterAway,
      }],
    })],
    [/^SELECT "id", "team_id", "data" FROM "trophies"/, () => ({
      rows: trophyRows
        .filter((row) => row.type === 'top_scorer')
        .map((row) => ({ id: row.id, team_id: row.team_id, data: row.data })),
    })],
    [/^DELETE FROM "trophies" WHERE "id" = \$1/, (text, params) => {
      const idx = trophyRows.findIndex((row) => row.id === params[0]);
      if (idx >= 0) trophyRows.splice(idx, 1);
      return { rows: [] };
    }],
    [/^INSERT INTO "trophies"/, (text, params) => {
      const [, teamId, season, week, type, label, data] = params;
      const id = nextId++;
      trophyRows.push({ id, team_id: teamId, season, week, type, label, data: JSON.parse(data) });
      return { rows: [{ id }] };
    }],
    [/^UPDATE "trophies" SET "data" = "data" \|\| \$2::jsonb WHERE "id" = \$1/, (text, params) => {
      const row = trophyRows.find((r) => r.id === params[0]);
      if (row) row.data = { ...row.data, ...JSON.parse(params[1]) };
      return { rows: [] };
    }],
    [/^SELECT "owner_id" FROM "teams" WHERE "id" = \$1/, (text, params) => ({
      rows: [{ owner_id: 1000 + Number(params[0]) }],
    })],
  ]);
  fake.trophyRows = trophyRows;
  return fake;
}

test('#1411: a correction that moves the weekly high score removes the previous recipient\'s trophy and awards the new leader with the corrected points', async (t) => {
  // Team A (10) led at 100; the correction makes Team B (20) the leader at 115.
  const fake = trophyReconcileWorld({
    beforeHome: 100, beforeAway: 80, afterHome: 90, afterAway: 115,
    seedTrophies: [
      { id: 501, team_id: 10, season: 2026, week: 5, type: 'top_scorer', label: 'Top Scorer', data: { points: 100 } },
    ],
  });
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  t.mock.method(montecarlo, 'computeLeagueOdds', async () => ({}));
  t.mock.method(recapSvc, 'computeAndStoreWeeklyRecap', async () => ({}));

  await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  const topScorers = fake.trophyRows.filter((row) => row.type === 'top_scorer');
  assert.equal(topScorers.length, 1, 'exactly one team holds the weekly high score trophy');
  assert.equal(topScorers[0].team_id, 20, 'the new leader holds it');
  assert.equal(topScorers[0].data.points, 115, 'stored points match the corrected score');

  const ownerLookups = fake.matching(/^SELECT "owner_id" FROM "teams" WHERE "id" = \$1/);
  assert.deepEqual(ownerLookups.map((c) => c.params[0]), [20], 'only the new recipient is looked up for notification');
});

test('#1411: a correction that raises the leader\'s total without changing the leader updates the trophy in place, with no notification', async (t) => {
  // Team A (10) stays the leader; their total rises from 100 to 115.
  const fake = trophyReconcileWorld({
    beforeHome: 100, beforeAway: 80, afterHome: 115, afterAway: 80,
    seedTrophies: [
      { id: 501, team_id: 10, season: 2026, week: 5, type: 'top_scorer', label: 'Top Scorer', data: { points: 100 } },
    ],
  });
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  t.mock.method(montecarlo, 'computeLeagueOdds', async () => ({}));
  t.mock.method(recapSvc, 'computeAndStoreWeeklyRecap', async () => ({}));

  await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  const topScorers = fake.trophyRows.filter((row) => row.type === 'top_scorer');
  assert.equal(topScorers.length, 1, 'still exactly one trophy for the week');
  assert.equal(topScorers[0].id, 501, 'the SAME row was updated in place, not replaced');
  assert.equal(topScorers[0].team_id, 10);
  assert.equal(topScorers[0].data.points, 115, 'stored points match the corrected total');

  assert.equal(
    fake.matching(/^SELECT "owner_id" FROM "teams" WHERE "id" = \$1/).length,
    0,
    'an in-place points update is not a new award, so nobody is notified'
  );
});

test('#1411: an exact tie for the week high score never moves the trophy off its current (still-tied) holder, regardless of matchup scan order', async (t) => {
  // Risk review (#1411): a single-pass, unordered `>` scan picks whichever
  // tied side the query happens to return last - and matchups are UPDATEd in
  // place every correction pass, so their physical scan order is not stable
  // run to run. Team 10 already holds the trophy at 152; the correction
  // drops them to 150, which exactly ties team 20's 150. Team 10 still ties
  // for the lead, so they must keep the trophy - and the DELETE handler below
  // throws if the reconcile ever tries to remove team 10's still-correct
  // trophy. (See the next test for the mirror case: the incumbent at the
  // HIGHER team_id keeps it too - formal-001 f1.)
  const seedTrophies = [
    { id: 501, team_id: 10, season: 2026, week: 5, type: 'top_scorer', label: 'Top Scorer', data: { points: 152 } },
  ];
  const trophyRows = seedTrophies.map((row) => ({ ...row }));
  // Team 20's matchup listed FIRST, so a scan-order-dependent picker would
  // hand the tie to team 20 instead.
  const weekMatchups = [
    { id: 2, home_team_id: 20, away_team_id: 21, home_score: 150, away_score: 80 },
    { id: 1, home_team_id: 10, away_team_id: 11, home_score: 150, away_score: 90 },
  ];
  const fake = createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 1, week: 5, final: true, is_playoff: false, home_score: 152, away_score: 90 }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 1, home_score: 150, away_score: 90 }],
    })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 101 }] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [] })],
    [/^SELECT \* FROM "matchups" WHERE "league_id" = \$1 AND "season" = \$2 AND "week" = \$3 AND "final" = true/, () => ({
      rows: weekMatchups,
    })],
    [/^SELECT "id", "team_id", "data" FROM "trophies"/, () => ({
      rows: trophyRows
        .filter((row) => row.type === 'top_scorer')
        .map((row) => ({ id: row.id, team_id: row.team_id, data: row.data })),
    })],
    [/^DELETE FROM "trophies" WHERE "id" = \$1/, () => {
      throw new Error('the tied, already-correct leader must never be deleted');
    }],
    [/^UPDATE "trophies" SET "data" = "data" \|\| \$2::jsonb WHERE "id" = \$1/, (text, params) => {
      const row = trophyRows.find((r) => r.id === params[0]);
      if (row) row.data = { ...row.data, ...JSON.parse(params[1]) };
      return { rows: [] };
    }],
    [/^SELECT "owner_id" FROM "teams" WHERE "id" = \$1/, (text, params) => ({
      rows: [{ owner_id: 1000 + Number(params[0]) }],
    })],
  ]);
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  t.mock.method(montecarlo, 'computeLeagueOdds', async () => ({}));
  t.mock.method(recapSvc, 'computeAndStoreWeeklyRecap', async () => ({}));

  await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  const topScorers = trophyRows.filter((row) => row.type === 'top_scorer');
  assert.equal(topScorers.length, 1);
  assert.equal(topScorers[0].team_id, 10, 'team 10 keeps it - it still ties for the corrected week high');
  assert.equal(topScorers[0].data.points, 150, 'stored points reflect the corrected (tied) total');
});

test('#1411 (formal-001 f1): the mirror case - an incumbent at the HIGHER team_id also keeps the trophy on a tie, never demoted for a fresh tiebreak', async (t) => {
  // formal-001 f1: awardWeeklyTrophies' own first-award tiebreak is unstable
  // scan order, not team_id - so the incumbent a tie produced is not
  // reliably the lower team_id. Team 20 already holds the trophy at 152; the
  // correction drops them to 150, tying team 10's 150. A tiebreak that always
  // resolved ties by team_id ASC (regardless of who already holds it) would
  // wrongly hand this to team 10 and DELETE team 20's still-correct trophy;
  // the DELETE handler below throws if that happens.
  const seedTrophies = [
    { id: 501, team_id: 20, season: 2026, week: 5, type: 'top_scorer', label: 'Top Scorer', data: { points: 152 } },
  ];
  const trophyRows = seedTrophies.map((row) => ({ ...row }));
  const weekMatchups = [
    { id: 1, home_team_id: 10, away_team_id: 11, home_score: 150, away_score: 90 },
    { id: 2, home_team_id: 20, away_team_id: 21, home_score: 150, away_score: 80 },
  ];
  const fake = createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 2, week: 5, final: true, is_playoff: false, home_score: 152, away_score: 80 }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 2, home_score: 150, away_score: 80 }],
    })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 101 }] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [] })],
    [/^SELECT \* FROM "matchups" WHERE "league_id" = \$1 AND "season" = \$2 AND "week" = \$3 AND "final" = true/, () => ({
      rows: weekMatchups,
    })],
    [/^SELECT "id", "team_id", "data" FROM "trophies"/, () => ({
      rows: trophyRows
        .filter((row) => row.type === 'top_scorer')
        .map((row) => ({ id: row.id, team_id: row.team_id, data: row.data })),
    })],
    [/^DELETE FROM "trophies" WHERE "id" = \$1/, () => {
      throw new Error('the tied, already-correct leader must never be deleted');
    }],
    [/^UPDATE "trophies" SET "data" = "data" \|\| \$2::jsonb WHERE "id" = \$1/, (text, params) => {
      const row = trophyRows.find((r) => r.id === params[0]);
      if (row) row.data = { ...row.data, ...JSON.parse(params[1]) };
      return { rows: [] };
    }],
    [/^SELECT "owner_id" FROM "teams" WHERE "id" = \$1/, (text, params) => ({
      rows: [{ owner_id: 1000 + Number(params[0]) }],
    })],
  ]);
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  t.mock.method(montecarlo, 'computeLeagueOdds', async () => ({}));
  t.mock.method(recapSvc, 'computeAndStoreWeeklyRecap', async () => ({}));

  await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  const topScorers = trophyRows.filter((row) => row.type === 'top_scorer');
  assert.equal(topScorers.length, 1);
  assert.equal(topScorers[0].team_id, 20, 'team 20 (the higher team_id) keeps it - it still ties for the corrected week high');
  assert.equal(topScorers[0].data.points, 150, 'stored points reflect the corrected (tied) total');
});

test('#1411 (formal-001 f2): a team\'s week score is its highest single matchup appearance, never the sum across two appearances', async (t) => {
  // formal-001 f2: matchups' unique key is only per home_team_id, so a team
  // can legally appear in two final matchups the same week. awardWeeklyTrophies
  // takes each team's single highest side value, never a sum. Team 10 appears
  // twice at 110 each (sum 220, correct value 110); team 20 appears once at
  // 150 and already holds the trophy. A summing reconcile would treat team 10
  // as a fictitious 220 and DELETE team 20's still-correct trophy in team 10's
  // favor; the DELETE handler below throws if that happens.
  const seedTrophies = [
    { id: 501, team_id: 20, season: 2026, week: 5, type: 'top_scorer', label: 'Top Scorer', data: { points: 150 } },
  ];
  const trophyRows = seedTrophies.map((row) => ({ ...row }));
  const weekMatchups = [
    { id: 1, home_team_id: 10, away_team_id: 30, home_score: 110, away_score: 20 },
    { id: 2, home_team_id: 40, away_team_id: 10, home_score: 95, away_score: 110 },
    { id: 3, home_team_id: 20, away_team_id: 50, home_score: 150, away_score: 60 },
  ];
  const fake = createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      // An unrelated matchup in the same week is what the correction actually
      // changed - team 10 and team 20's own scores above are untouched by it.
      rows: [{ id: 4, week: 5, final: true, is_playoff: false, home_score: 90, away_score: 30 }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 4, home_score: 92, away_score: 30 }],
    })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 101 }] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [] })],
    [/^SELECT \* FROM "matchups" WHERE "league_id" = \$1 AND "season" = \$2 AND "week" = \$3 AND "final" = true/, () => ({
      rows: weekMatchups,
    })],
    [/^SELECT "id", "team_id", "data" FROM "trophies"/, () => ({
      rows: trophyRows
        .filter((row) => row.type === 'top_scorer')
        .map((row) => ({ id: row.id, team_id: row.team_id, data: row.data })),
    })],
    [/^DELETE FROM "trophies" WHERE "id" = \$1/, () => {
      throw new Error('team 20 still has the true (non-summed) week high and must never be deleted');
    }],
    [/^INSERT INTO "trophies"/, () => {
      throw new Error('no new award is due - team 20 already correctly holds it');
    }],
    [/^UPDATE "trophies" SET "data" = "data" \|\| \$2::jsonb WHERE "id" = \$1/, (text, params) => {
      const row = trophyRows.find((r) => r.id === params[0]);
      if (row) row.data = { ...row.data, ...JSON.parse(params[1]) };
      return { rows: [] };
    }],
    [/^SELECT "owner_id" FROM "teams" WHERE "id" = \$1/, (text, params) => ({
      rows: [{ owner_id: 1000 + Number(params[0]) }],
    })],
  ]);
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  t.mock.method(montecarlo, 'computeLeagueOdds', async () => ({}));
  t.mock.method(recapSvc, 'computeAndStoreWeeklyRecap', async () => ({}));

  await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  const topScorers = trophyRows.filter((row) => row.type === 'top_scorer');
  assert.equal(topScorers.length, 1);
  assert.equal(topScorers[0].team_id, 20, 'team 20 keeps it - team 10\'s true week score (110) never outranks it');
  assert.equal(topScorers[0].data.points, 150, 'stored points are team 20\'s real score, not team 10\'s summed 220');
});

test('#1411: a correction that changes no scores leaves the trophies table untouched', async (t) => {
  const fake = createFakePool([
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"/, () => ({
      rows: [{ id: 1, week: 5, final: true, is_playoff: false, home_score: 90, away_score: 80 }],
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, () => ({
      rows: [{ id: 1, home_score: 90, away_score: 80 }], // unchanged
    })],
  ]);
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  const reconcile = t.mock.method(trophySvc, 'reconcileWeeklyHighScoreTrophy', async () => {
    throw new Error('must not be called for a no-op correction');
  });

  const outcome = await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  assert.deepEqual(outcome.changes, []);
  assert.equal(reconcile.mock.calls.length, 0, 'no score movement means no trophy reconcile');
  assert.equal(fake.calls.some((c) => /"trophies"/.test(c.text)), false);
  fake.assertClean();
});

test('#1411: season-level trophies for the league are unchanged by a weekly high score reconcile', async (t) => {
  const seasonTrophy = { id: 900, team_id: 10, season: 2026, week: 0, type: 'champion', label: '2026 League Champion', data: {} };
  const fake = trophyReconcileWorld({
    beforeHome: 100, beforeAway: 80, afterHome: 90, afterAway: 115,
    seedTrophies: [
      { id: 501, team_id: 10, season: 2026, week: 5, type: 'top_scorer', label: 'Top Scorer', data: { points: 100 } },
      seasonTrophy,
    ],
  });
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  t.mock.method(montecarlo, 'computeLeagueOdds', async () => ({}));
  t.mock.method(recapSvc, 'computeAndStoreWeeklyRecap', async () => ({}));

  await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  const stillThere = fake.trophyRows.find((row) => row.id === 900);
  assert.ok(stillThere, 'the season-level trophy row was never deleted');
  assert.deepEqual(stillThere, seasonTrophy, 'and never mutated');
});

test('#1411: a weekly high score trophy reconcile failure is logged and never blocks the correction pass', async (t) => {
  const fake = correctionRecapWorld({ beforeHome: 90, beforeAway: 80, afterHome: 115, afterAway: 80 });
  fake.install(t);
  t.mock.method(scoringSvc, 'scoreMatchups', async () => ({}));
  t.mock.method(trophySvc, 'reconcileWeeklyHighScoreTrophy', async () => { throw new Error('trophy reconcile boom'); });
  const logs = [];
  t.mock.method(console, 'error', (...args) => { logs.push(args); });

  const outcome = await correctionSvc.correctLeagueWeek({ leagueId: 7, season: 2026, week: 5 });

  assert.equal(outcome.changes.length, 1, 'the correction pass still completes');
  assert.equal(
    fake.matching(/INSERT INTO "transactions"/).filter((c) => c.params[2] === 'stat_correction').length,
    1,
    'and the log/notify step still completed'
  );
  const logged = logs.find((l) => String(l[0]).includes('weekly high score trophy reconcile failed'));
  assert.ok(logged, 'the trophy reconcile failure is logged');
});
