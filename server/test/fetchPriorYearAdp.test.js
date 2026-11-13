const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildFixture } = require('../../scripts/fetch-prior-year-adp');

// The committed fixtures must be exactly what the script builds from the saved raw responses (#1442).
const RAW_DIR = path.join(__dirname, '..', '..', 'backtest-artifacts', 'v3.2-successor-gate', 'ffc-adp');
const DATA_DIR = path.join(__dirname, '..', 'data');

for (const year of [2025, 2026]) {
  for (const format of ['standard', 'half-ppr', 'ppr']) {
    test(`adp-${year}-${format}.json is rebuilt exactly from its saved raw FFC response (#1442)`, () => {
      const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, `adp-${year}-${format}.json`), 'utf8'));
      const committed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `adp-${year}-${format}.json`), 'utf8'));
      assert.deepEqual(buildFixture(raw), committed);
    });
  }
}

test('buildFixture refuses a response it cannot turn into a fixture, with a plain message (#1442)', () => {
  const ok = {
    status: 'Success',
    meta: { start_date: '2026-09-08', end_date: '2026-09-15', total_drafts: 1 },
    players: [{ name: 'Josh Allen', position: 'QB', team: 'BUF', adp: 3 }],
  };
  assert.doesNotThrow(() => buildFixture(ok));
  assert.throws(() => buildFixture({ ...ok, status: 'Error' }), /not Success/);
  assert.throws(() => buildFixture({ ...ok, meta: undefined }), /meta is missing/);
  assert.throws(() => buildFixture({ ...ok, meta: { ...ok.meta, start_date: '09/08/2026' } }), /YYYY-MM-DD/);
  assert.throws(() => buildFixture({ ...ok, meta: { ...ok.meta, end_date: undefined } }), /YYYY-MM-DD/);
  assert.throws(() => buildFixture({ ...ok, players: [] }), /players is missing or empty/);
  assert.throws(() => buildFixture({ ...ok, players: undefined }), /players is missing or empty/);
});
