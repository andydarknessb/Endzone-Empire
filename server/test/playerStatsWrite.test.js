const test = require('node:test');
const assert = require('node:assert/strict');

const { upsertPlayerStats } = require('../services/playerStatsWrite.service');

// A stat line that scores 12.0 under the default (half-PPR) rules: four
// receptions (2.0) + 40 yards (4.0) + one touchdown (6.0). The 2026-09-15 audit
// found 23 production rows carrying exactly this line stored with 0.00 points.
const FOUR_FORTY_ONE = { receptions: 4, receivingYards: 40, receivingTDs: 1 };

function captureDb() {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => { calls.push({ sql: String(sql), params }); return { rows: [] }; },
  };
}

test('upsertPlayerStats stores fantasy_points computed from the stats it writes', async () => {
  const db = captureDb();
  const result = await upsertPlayerStats(db, { playerId: 7, season: 2025, week: 1, stats: FOUR_FORTY_ONE });

  assert.equal(db.calls.length, 1);
  const { sql, params } = db.calls[0];
  assert.match(sql, /INSERT INTO "player_stats"/);
  assert.match(sql, /ON CONFLICT \("player_id", "season", "week"\)/);
  assert.deepEqual(params.slice(0, 3), [7, 2025, 1]);
  assert.deepEqual(JSON.parse(params[3]), FOUR_FORTY_ONE);
  assert.equal(params[4], 12, 'the stored points describe the stored stats');
  assert.equal(result.fantasyPoints, 12);
});

test('upsertPlayerStats ignores a caller-supplied fantasy_points', async () => {
  const db = captureDb();
  await upsertPlayerStats(db, { playerId: 7, season: 2025, week: 1, stats: FOUR_FORTY_ONE, fantasyPoints: 0 });
  assert.equal(db.calls[0].params[4], 12, 'a points value the stats do not support is never written');
});

test('upsertPlayerStats writes 0 for an all-zero stat line', async () => {
  const db = captureDb();
  const result = await upsertPlayerStats(db, { playerId: 7, season: 2025, week: 3, stats: { receptions: 0, rushingYards: 0 } });
  assert.equal(result.fantasyPoints, 0);
  assert.equal(db.calls[0].params[4], 0);
});
