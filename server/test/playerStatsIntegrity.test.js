const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const integrity = require('../services/playerStatsIntegrity.service');
const { calculateFantasyPoints } = require('../services/scoringRules');
const { createFakePool } = require('./helpers/fakePool');

// 4 rec / 40 yds / 1 TD = 12.0 under default rules. Stored with 0.00, this is the
// exact production row shape the 2026-09-15 audit found (player_stats ids 438-471).
const FIXTURE = { receptions: 4, receivingYards: 40, receivingTDs: 1 };
const ALL_ZERO = { receptions: 0, rushingYards: 0, receivingYards: 0 };

const row = (id, playerId, season, week, stats, fantasyPoints) => ({
  id, player_id: playerId, season, week, stats, fantasy_points: String(fantasyPoints),
});
/** A row whose stored score is right, so the only anomaly it can raise is the one under test. */
const scored = (id, playerId, season, week, stats) => row(id, playerId, season, week, stats, calculateFantasyPoints(stats));

/**
 * Dispatch pool.query by SQL fragment: the scan's page reads, the anomaly
 * upsert, the open-anomaly read and resolve, the settled-week frontier and
 * lastRun's data_sync_runs read.
 */
function mockPool(t, {
  rows = [], openAnomalies = [], openCount = 0, unlabelledCount = 0, lastOkRun = null, correction = null,
} = {}) {
  const writes = { anomalies: [], resolved: [], pages: [] };
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "player_stats"')) {
      const [seasons, afterId, limit] = params;
      writes.pages.push(seasons);
      const page = rows
        .filter((r) => (seasons == null || seasons.includes(r.season)) && r.id > afterId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
      return { rows: page };
    }
    if (text.includes('INSERT INTO "player_stats_anomalies"')) {
      writes.anomalies.push(params);
      return { rows: [] };
    }
    if (text.includes('count(*)') && text.includes('FROM "player_stats_anomalies"')) {
      return { rows: [{ open: openCount, unlabelled: unlabelledCount }] };
    }
    if (text.includes('FROM "player_stats_anomalies"') && text.includes('"resolved_at" IS NULL')) {
      const [seasons] = params;
      return { rows: openAnomalies.filter((a) => seasons == null || seasons.includes(a.season)) };
    }
    if (text.includes('UPDATE "player_stats_anomalies"')) {
      writes.resolved.push(params[0]);
      return { rows: [] };
    }
    // The settled-week frontier: the latest ok nflverse-correction run whose
    // detail names a season and week with games in the file.
    if (text.includes('FROM "data_sync_runs"') && text.includes('gamesInFile')) {
      return { rows: correction ? [{ detail: correction }] : [] };
    }
    if (text.includes('FROM "data_sync_runs"')) {
      return { rows: [{ latest: lastOkRun, latestOk: lastOkRun }] };
    }
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  });
  return writes;
}

/** The kinds recorded by the scan, in write order. */
const kindsOf = (writes) => writes.anomalies.map(([, , , kind]) => kind);

test('a stored score that disagrees with its stats is recorded as a points-mismatch anomaly', async (t) => {
  const writes = mockPool(t, {
    rows: [
      row(438, 30, 2025, 1, FIXTURE, 0),
      row(440, 34, 2025, 1, { receptions: 3, rushingYards: 20, receivingYards: 4 }, 3.9),
      row(632, 50, 2025, 1, ALL_ZERO, 0),
    ],
  });

  const result = await integrity.scanPlayerStats({ seasons: [2025, 2026], pageSize: 2 });

  assert.equal(result.scanned, 3);
  assert.equal(writes.anomalies.length, 1);
  const [playerId, season, week, kind, detail] = writes.anomalies[0];
  assert.deepEqual([playerId, season, week, kind], [30, 2025, 1, 'points-mismatch']);
  assert.deepEqual(JSON.parse(detail), { stored: 0, computed: 12 });
  assert.equal(result.open, 1);
});

test('by default every season is scanned, so a past-season anomaly is re-examined', async (t) => {
  const writes = mockPool(t, {
    rows: [row(5, 9, 2024, 3, FIXTURE, 12), row(900, 9, 2026, 1, ALL_ZERO, 0)],
    openAnomalies: [{ id: 7, player_id: 9, season: 2024, week: 3, kind: 'points-mismatch' }],
  });

  const result = await integrity.scanPlayerStats();

  assert.deepEqual(writes.pages[0], null, 'no season filter');
  assert.equal(result.scanned, 2);
  assert.deepEqual(writes.resolved, [[7]], 'the 2024 anomaly resolves once its row scores correctly');
});

test('an open anomaly whose row now scores correctly is resolved; one still wrong stays open', async (t) => {
  const writes = mockPool(t, {
    rows: [
      row(438, 30, 2025, 1, FIXTURE, 12),
      row(439, 33, 2025, 1, FIXTURE, 0),
    ],
    openAnomalies: [
      { id: 1, player_id: 30, season: 2025, week: 1, kind: 'points-mismatch' },
      { id: 2, player_id: 33, season: 2025, week: 1, kind: 'points-mismatch' },
    ],
  });

  const result = await integrity.scanPlayerStats({ seasons: [2025] });

  assert.deepEqual(writes.resolved, [[1]], 'only the now-correct row is resolved');
  assert.equal(result.resolved, 1);
  assert.equal(result.open, 1);
});

test('a narrowed scan leaves anomalies outside its scope untouched', async (t) => {
  const writes = mockPool(t, {
    rows: [row(1, 1, 2026, 1, ALL_ZERO, 0)],
    openAnomalies: [{ id: 3, player_id: 30, season: 2025, week: 1, kind: 'points-mismatch' }],
  });
  await integrity.scanPlayerStats({ seasons: [2026] });
  assert.deepEqual(writes.resolved, [], 'a 2025 anomaly is not resolved by a scan that never looked at 2025');
});

test('a sub-cent rounding difference is not an anomaly', async (t) => {
  const writes = mockPool(t, { rows: [row(1, 1, 2026, 1, { passingYards: 233 }, 9.32)] });
  await integrity.scanPlayerStats({ seasons: [2026] });
  assert.equal(writes.anomalies.length, 0);
});

// ---------------------------------------------------------------------------
// unlabelled-appearance (#2629): a row on a settled week with no stats.gameTeam
// that is an Appearance by madeAppearance. Report-only: it never reaches `ok`.
// ---------------------------------------------------------------------------

// The latest (season, week) an ok nflverse-correction run names, games in file.
const SETTLED = { season: 2026, week: 7, gamesInFile: 2, games: ['2026_07_KC_BUF'] };
const UNLABELLED = { soloTackle: 1 };

test('(a) an unlabelled non-zero row on a settled week is recorded as unlabelled-appearance', async (t) => {
  const writes = mockPool(t, { rows: [scored(900, 70, 2026, 7, UNLABELLED)], correction: SETTLED });

  await integrity.scanPlayerStats({ seasons: [2026] });

  assert.deepEqual(kindsOf(writes), ['unlabelled-appearance']);
  const [playerId, season, week, kind, detail] = writes.anomalies[0];
  assert.deepEqual([playerId, season, week, kind], [70, 2026, 7, 'unlabelled-appearance']);
  assert.deepEqual(JSON.parse(detail), { playerStatsId: 900 });
});

test('(b) the same row carrying a gameTeam is not an unlabelled-appearance', async (t) => {
  const writes = mockPool(t, {
    rows: [scored(900, 70, 2026, 7, { gameTeam: 'KC', soloTackle: 1 })],
    correction: SETTLED,
  });

  await integrity.scanPlayerStats({ seasons: [2026] });

  assert.deepEqual(kindsOf(writes), []);
});

test('(c) an all-zero unlabelled row is a rostered player who never took the field, not an anomaly', async (t) => {
  const writes = mockPool(t, { rows: [row(900, 70, 2026, 7, ALL_ZERO, 0)], correction: SETTLED });

  await integrity.scanPlayerStats({ seasons: [2026] });

  assert.deepEqual(kindsOf(writes), []);
});

test('(d) a week after the frontier is not settled; every week of an earlier season is', async (t) => {
  const writes = mockPool(t, {
    rows: [scored(900, 70, 2026, 8, UNLABELLED), scored(901, 71, 2025, 9, UNLABELLED)],
    correction: SETTLED,
  });

  await integrity.scanPlayerStats({ seasons: [2025, 2026] });

  assert.deepEqual(writes.anomalies.map(([playerId]) => playerId), [71], 'only the 2025 row is flagged');
});

test('(e) with no nflverse-correction run at all nothing is settled, so nothing is flagged', async (t) => {
  const writes = mockPool(t, { rows: [scored(900, 70, 2026, 7, UNLABELLED)] });

  await integrity.scanPlayerStats({ seasons: [2026] });

  assert.deepEqual(kindsOf(writes), []);
});

test('(f) an open unlabelled-appearance anomaly resolves once the row carries a gameTeam', async (t) => {
  const writes = mockPool(t, {
    rows: [scored(900, 70, 2026, 7, { gameTeam: 'KC', soloTackle: 1 })],
    openAnomalies: [{ id: 9, player_id: 70, season: 2026, week: 7, kind: 'unlabelled-appearance' }],
    correction: SETTLED,
  });

  const result = await integrity.scanPlayerStats({ seasons: [2026] });

  assert.deepEqual(writes.resolved, [[9]]);
  assert.equal(result.resolved, 1);
});

test('getIntegrityStatus counts unlabelled-appearance apart from the anomalies that page', async (t) => {
  const now = new Date('2026-09-17T12:00:00Z');
  const fresh = { id: 1, finished_at: '2026-09-17T09:05:00Z', ok: true, detail: {} };
  mockPool(t, { openCount: 0, unlabelledCount: 1, lastOkRun: fresh });

  assert.deepEqual(await integrity.getIntegrityStatus({ now }), {
    ok: true, open: 0, unlabelled: 1, lastScanAt: new Date(fresh.finished_at), stale: false,
  });
});

test('getIntegrityStatus is ok only with nothing open and a fresh successful scan', async (t) => {
  const now = new Date('2026-09-17T12:00:00Z');
  const fresh = { id: 1, finished_at: '2026-09-17T09:05:00Z', ok: true, detail: { scanned: 220000, open: 0 } };
  mockPool(t, { openCount: 0, lastOkRun: fresh });
  assert.deepEqual(await integrity.getIntegrityStatus({ now }), {
    ok: true, open: 0, unlabelled: 0, lastScanAt: new Date(fresh.finished_at), stale: false,
  });
});

test('getIntegrityStatus is not ok when the last successful scan is older than 36 hours, or never happened', async (t) => {
  const now = new Date('2026-09-19T12:00:00Z');
  mockPool(t, { openCount: 0, lastOkRun: { id: 1, finished_at: '2026-09-17T09:05:00Z', ok: true, detail: {} } });
  const old = await integrity.getIntegrityStatus({ now });
  assert.equal(old.ok, false);
  assert.equal(old.stale, true);

  mockPool(t, { openCount: 0, lastOkRun: null });
  const never = await integrity.getIntegrityStatus({ now });
  assert.deepEqual(never, { ok: false, open: 0, unlabelled: 0, lastScanAt: null, stale: true });
});

test('getIntegrityStatus is not ok while any anomaly is open, however fresh the scan', async (t) => {
  const now = new Date('2026-09-17T12:00:00Z');
  mockPool(t, { openCount: 23, lastOkRun: { id: 1, finished_at: '2026-09-17T09:05:00Z', ok: true, detail: {} } });
  const status = await integrity.getIntegrityStatus({ now });
  assert.equal(status.ok, false);
  assert.equal(status.open, 23);
  assert.equal(status.stale, false);
});

// runIntegrityScan is the Sync run body the scheduler gates (scheduler.statsIntegrity.test.js
// covers the gate). Driven here against the fake pool: the recorded
// data_sync_runs row carries the outcome and detail.reason.
function recordedRuns(t) {
  const runs = [];
  createFakePool([
    [/^INSERT INTO "data_sync_runs"/, (text, params) => {
      runs.push({ job: params[0], ok: params[2], detail: JSON.parse(params[3]) });
      return { rows: [] };
    }],
  ]).install(t);
  return runs;
}

test('runIntegrityScan records an ok row with the UTC day and the scan result', async (t) => {
  t.mock.method(integrity, 'scanPlayerStats', async () => ({ scanned: 5, open: 1, resolved: 0 }));
  const runs = recordedRuns(t);

  const result = await integrity.runIntegrityScan({ now: new Date('2026-09-21T09:10:00Z') });

  assert.deepEqual(result, { scanned: 5, open: 1, resolved: 0 });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].job, integrity.JOB);
  assert.equal(runs[0].ok, true);
  assert.deepEqual(runs[0].detail, { day: '2026-09-21', scanned: 5, open: 1, resolved: 0 });
});

test('runIntegrityScan records write_failed when the scan throws, and rethrows', async (t) => {
  t.mock.method(integrity, 'scanPlayerStats', async () => { throw new Error('relation does not exist'); });
  const runs = recordedRuns(t);

  await assert.rejects(integrity.runIntegrityScan({ now: new Date('2026-09-21T09:10:00Z') }), /relation does not exist/);

  assert.equal(runs.length, 1);
  assert.equal(runs[0].ok, false);
  assert.equal(runs[0].detail.reason, 'write_failed');
});
