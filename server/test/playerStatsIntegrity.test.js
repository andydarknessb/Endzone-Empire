const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const integrity = require('../services/playerStatsIntegrity.service');

// 4 rec / 40 yds / 1 TD = 12.0 under default rules. Stored with 0.00, this is the
// exact production row shape the 2026-09-15 audit found (player_stats ids 438-471).
const FIXTURE = { receptions: 4, receivingYards: 40, receivingTDs: 1 };
const ALL_ZERO = { receptions: 0, rushingYards: 0, receivingYards: 0 };

const row = (id, playerId, season, week, stats, fantasyPoints) => ({
  id, player_id: playerId, season, week, stats, fantasy_points: String(fantasyPoints),
});

/**
 * Dispatch pool.query by SQL fragment: the scan's page reads, the anomaly
 * upsert, the open-anomaly read and resolve, and lastRun's data_sync_runs read.
 */
function mockPool(t, { rows = [], openAnomalies = [], openCount = 0, lastOkRun = null } = {}) {
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
      return { rows: [{ open: openCount }] };
    }
    if (text.includes('FROM "player_stats_anomalies"') && text.includes('"resolved_at" IS NULL')) {
      const [seasons] = params;
      return { rows: openAnomalies.filter((a) => seasons == null || seasons.includes(a.season)) };
    }
    if (text.includes('UPDATE "player_stats_anomalies"')) {
      writes.resolved.push(params[0]);
      return { rows: [] };
    }
    if (text.includes('FROM "data_sync_runs"')) {
      return { rows: [{ latest: lastOkRun, latestOk: lastOkRun }] };
    }
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  });
  return writes;
}

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

test('getIntegrityStatus is ok only with nothing open and a fresh successful scan', async (t) => {
  const now = new Date('2026-09-17T12:00:00Z');
  const fresh = { id: 1, finished_at: '2026-09-17T09:05:00Z', ok: true, detail: { scanned: 220000, open: 0 } };
  mockPool(t, { openCount: 0, lastOkRun: fresh });
  assert.deepEqual(await integrity.getIntegrityStatus({ now }), {
    ok: true, open: 0, lastScanAt: new Date(fresh.finished_at), stale: false,
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
  assert.deepEqual(never, { ok: false, open: 0, lastScanAt: null, stale: true });
});

test('getIntegrityStatus is not ok while any anomaly is open, however fresh the scan', async (t) => {
  const now = new Date('2026-09-17T12:00:00Z');
  mockPool(t, { openCount: 23, lastOkRun: { id: 1, finished_at: '2026-09-17T09:05:00Z', ok: true, detail: {} } });
  const status = await integrity.getIntegrityStatus({ now });
  assert.equal(status.ok, false);
  assert.equal(status.open, 23);
  assert.equal(status.stale, false);
});
