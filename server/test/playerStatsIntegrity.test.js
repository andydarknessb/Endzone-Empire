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
 * upsert, the open-anomaly read and resolve, and the scan-log writes.
 */
function mockPool(t, { rows = [], openAnomalies = [] } = {}) {
  const writes = { anomalies: [], resolved: [], scans: [] };
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "player_stats"')) {
      const [seasons, afterId, limit] = params;
      const page = rows
        .filter((r) => seasons.includes(r.season) && r.id > afterId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
      return { rows: page };
    }
    if (text.includes('INSERT INTO "player_stats_anomalies"')) {
      writes.anomalies.push(params);
      return { rows: [] };
    }
    if (text.includes('FROM "player_stats_anomalies"') && text.includes('"resolved_at" IS NULL')) {
      return { rows: openAnomalies };
    }
    if (text.includes('UPDATE "player_stats_anomalies"')) {
      writes.resolved.push(params[0]);
      return { rows: [] };
    }
    if (text.includes('INSERT INTO "player_stats_integrity_scans"')) {
      writes.scans.push({ insert: params });
      return { rows: [{ id: 99 }] };
    }
    if (text.includes('UPDATE "player_stats_integrity_scans"')) {
      writes.scans.push({ finish: params });
      return { rows: [] };
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

test('a scan writes a log row with what it scanned and how many anomalies remain open', async (t) => {
  const writes = mockPool(t, { rows: [row(1, 1, 2026, 1, ALL_ZERO, 0)] });
  await integrity.scanPlayerStats({ seasons: [2026] });
  assert.equal(writes.scans.length, 2);
  assert.deepEqual(writes.scans[1].finish.slice(0, 2), [1, 0], 'scanned rows, then open anomalies');
});

test('a sub-cent rounding difference is not an anomaly', async (t) => {
  const writes = mockPool(t, { rows: [row(1, 1, 2026, 1, { passingYards: 233 }, 9.32)] });
  await integrity.scanPlayerStats({ seasons: [2026] });
  assert.equal(writes.anomalies.length, 0);
});
