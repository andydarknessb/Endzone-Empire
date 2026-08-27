const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildReconciliationReport } = require('../services/legacyFeedBackfill');

/**
 * Fast unit tests for the legacy-feed reconciliation verdict (#436, AC5). The
 * VERDICT logic is pure - it folds the four problem-row sets each reconciliation
 * query returns into an ok/failures report - so it is tested here without a
 * database. Whether the QUERIES actually detect an uncovered Pick, a cross-kind
 * duplicate, an unregistered row or a lagging counter is a claim about real SQL
 * and lives in legacyFeedBackfill.pg.test.js against a real Postgres.
 */

test('a feed with nothing wrong reconciles ok with no failures', () => {
  const report = buildReconciliationReport({
    uncoveredPicks: [],
    crossKindDuplicates: [],
    unregisteredRows: [],
    counterLag: [],
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
});

test('the default (no arguments) is a clean report', () => {
  const report = buildReconciliationReport();
  assert.equal(report.ok, true);
  assert.deepEqual(report.failures, []);
});

test('an uncovered Pick fails the source-coverage check', () => {
  const report = buildReconciliationReport({ uncoveredPicks: [{ league_id: 7, count: 2 }] });
  assert.equal(report.ok, false);
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0].check, 'source-coverage');
  assert.deepEqual(report.failures[0].detail, [{ league_id: 7, count: 2 }]);
});

test('a cross-kind duplicate fails the per-league-uniqueness check', () => {
  const report = buildReconciliationReport({ crossKindDuplicates: [{ league_id: 1, feed_seq: '3' }] });
  assert.equal(report.ok, false);
  assert.equal(report.failures[0].check, 'per-league-uniqueness');
});

test('an unregistered row fails the registry-coverage check', () => {
  const report = buildReconciliationReport({
    unregisteredRows: [{ record_kind: 'league_chat', league_id: 1, source_id: 9 }],
  });
  assert.equal(report.ok, false);
  assert.equal(report.failures[0].check, 'registry-coverage');
});

test('a counter behind its high-water fails the counter-high-water check', () => {
  const report = buildReconciliationReport({
    counterLag: [{ league_id: 1, last_seq: '4', high_water: '6' }],
  });
  assert.equal(report.ok, false);
  assert.equal(report.failures[0].check, 'counter-high-water');
});

test('every failing check is reported at once, in a stable order', () => {
  const report = buildReconciliationReport({
    uncoveredPicks: [{ league_id: 1, count: 1 }],
    crossKindDuplicates: [{ league_id: 1, feed_seq: '2' }],
    unregisteredRows: [{ record_kind: 'draft_activity', league_id: 1, source_id: 5 }],
    counterLag: [{ league_id: 1, last_seq: '1', high_water: '2' }],
  });
  assert.equal(report.ok, false);
  assert.deepEqual(
    report.failures.map((f) => f.check),
    ['source-coverage', 'per-league-uniqueness', 'registry-coverage', 'counter-high-water']
  );
});
