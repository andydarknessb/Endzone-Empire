const { test } = require('node:test');
const assert = require('node:assert/strict');
const projection = require('../services/projection.service');
const claude = require('../services/claude');
const { generateForWeek, templateExplanation, CUTOFFS } = require('../services/projectionExplanation.service');

const NOW = new Date('2026-10-15T12:00:00Z');
const F = (pointsContribution, extra = {}) => ({ available: true, pointsContribution, ...extra });

test('templateExplanation names the largest available factors in words, with no digits', () => {
  const text = templateExplanation({
    recentProduction: F(14.2),
    opponent: F(-1.4),
    homeAway: F(-0.3, { isHome: false }),
    weather: F(0.1),
    versusOpponent: { available: false, pointsContribution: null },
    availability: { status: 'Q' },
  }, { position: 'WR' });
  assert.match(text, /^Built on recent production\. Carries a questionable tag\./);
  assert.match(text, /leans against/);
  assert.match(text, /on the road/);
  assert.match(text, /Weather is a mild help/);
  assert.doesNotMatch(text, /History against/, 'unavailable factors are not named');
  assert.doesNotMatch(text, /\d|\u2014/);
});

test('templateExplanation does not rank recentProduction and reads a position baseline as such', () => {
  const text = templateExplanation({
    recentProduction: F(14.2, { usedPositionBaseline: true }),
    opponent: F(-0.2),
    homeAway: F(0.1, { isHome: true }),
    weather: F(-0.9),
    gameEnvironment: F(0.5),
  }, { position: 'RB' });
  assert.match(text, /^With no track record yet, the projection starts from the position baseline\./);
  assert.doesNotMatch(text, /Built on recent production|at home/, 'recentProduction is the base, only the top three others follow');
  assert.match(text, /Weather is a mild drag.*game environment is favorable.*matchup leans against/);
  assert.doesNotMatch(text, /\d/);
});

test('templateExplanation has a plain fallback when no factor applies', () => {
  assert.equal(templateExplanation({ role: F(null) }, { position: 'K' }), 'No single factor stands out this week.');
});

// A pool that stores the explanation rows it is asked to write.
function world({ existing = [], failOn = null, positions = {}, noInsert = [] } = {}) {
  const rows = new Map(existing.map((id) => [id, { narrative: 'old', source: 'template' }]));
  return {
    rows,
    async query(sql, params) {
      if (/FROM "players"/.test(sql)) {
        return { rows: Object.entries(positions).map(([id, position]) => ({ id: Number(id), position })) };
      }
      if (/SELECT "player_id" FROM "projection_explanations"/.test(sql)) {
        return { rows: [...rows.keys()].map((player_id) => ({ player_id })) };
      }
      if (/^\s*INSERT INTO "projection_explanations"/.test(sql)) {
        if (params[0] === failOn) throw new Error('boom');
        if (noInsert.includes(params[0])) return { rowCount: 0 };
        rows.set(params[0], { narrative: params[3], source: 'template', modelVersion: params[4] });
        return { rowCount: 1 };
      }
      if (/UPDATE "projection_explanations"/.test(sql)) {
        Object.assign(rows.get(params[1]), { narrative: params[0], source: 'llm' });
        return { rowCount: 1 };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

// Cached projection entries carry no `position`; it comes from the players rows.
// rows: [playerId, position, mean]. Returns the positions map for `world`.
function stubRun(t, rows) {
  const projections = new Map(rows.map(([id, , mean]) => [id, {
    mean, modelVersion: 'm1', factors: { recentProduction: F(mean), opponent: F(1), availability: { status: null } },
  }]));
  t.mock.method(projection, 'getWeeklyProjections', async () => ({ modelVersion: 'm1', projections }));
  return Object.fromEntries(rows.map(([id, position]) => [id, position]));
}
const QBS = [[1, 'QB', 20], [2, 'QB', 19]];

test('cutoffs apply per position, taking the highest means, with positions from the players rows', async (t) => {
  const qbs = Array.from({ length: CUTOFFS.QB + 3 }, (_, i) => [i + 1, 'QB', 100 - i]);
  const positions = stubRun(t, [...qbs, [900, 'K', 5], [901, 'LB', 50]]);
  t.mock.method(claude, 'narrative', async () => null);
  const pool = world({ positions });
  const counts = await generateForWeek({ season: 2026, week: 6 }, { pool, now: NOW });
  assert.deepEqual(counts, { considered: CUTOFFS.QB + 1, written: CUTOFFS.QB + 1, enhanced: 0 });
  assert.ok(pool.rows.has(1) && pool.rows.has(CUTOFFS.QB));
  assert.ok(!pool.rows.has(CUTOFFS.QB + 1), 'below the QB cutoff');
  assert.ok(!pool.rows.has(901), 'a position with no cutoff is skipped');
  assert.equal(pool.rows.get(1).modelVersion, 'm1');
});

test('an existing row is never rewritten and never reaches the model', async (t) => {
  const positions = stubRun(t, QBS);
  const narrative = t.mock.method(claude, 'narrative', async () => null);
  const pool = world({ existing: [1], positions });
  const counts = await generateForWeek({ season: 2026, week: 6 }, { pool, now: NOW });
  assert.deepEqual(counts, { considered: 2, written: 1, enhanced: 0 });
  assert.equal(pool.rows.get(1).narrative, 'old');
  assert.equal(narrative.mock.callCount(), 1);
});

test('a lost insert race (rowCount 0) never reaches the model', async (t) => {
  const positions = stubRun(t, QBS);
  const narrative = t.mock.method(claude, 'narrative', async () => null);
  const pool = world({ positions, noInsert: [1] });
  const counts = await generateForWeek({ season: 2026, week: 6 }, { pool, now: NOW });
  assert.deepEqual(counts, { considered: 2, written: 1, enhanced: 0 });
  assert.equal(narrative.mock.callCount(), 1);
});

test('the existing-rows read comes before the projection run, so a missing table costs no generation', async (t) => {
  stubRun(t, QBS);
  const pool = { query: async () => { throw new Error('relation "projection_explanations" does not exist'); } };
  await assert.rejects(generateForWeek({ season: 2026, week: 6 }, { pool, now: NOW }), /does not exist/);
  assert.equal(projection.getWeeklyProjections.mock.callCount(), 0);
});

test('null from Claude keeps the template; text replaces it as llm, and no number reaches the prompt', async (t) => {
  const positions = stubRun(t, QBS);
  let n = 0;
  const narrative = t.mock.method(claude, 'narrative', async () => (++n === 2 ? 'Rewritten.' : null));
  const pool = world({ positions });
  const counts = await generateForWeek({ season: 2026, week: 6 }, { pool, now: NOW });
  assert.deepEqual(counts, { considered: 2, written: 2, enhanced: 1 });
  assert.equal(pool.rows.get(1).source, 'template');
  assert.deepEqual([pool.rows.get(2).narrative, pool.rows.get(2).source], ['Rewritten.', 'llm']);
  const { feature, user } = narrative.mock.calls[0].arguments[0];
  assert.equal(feature, 'projection_explanation');
  assert.doesNotMatch(user, /\d/);
  assert.match(user, /"direction":"up"/);
});

for (const [label, text] of [
  ['a digit', 'Recent production is up about 3 points.'],
  ['a verdict word', 'The matchup is good, so he is a clear start.'],
]) {
  test(`Claude output containing ${label} is discarded and the template stays`, async (t) => {
    const positions = stubRun(t, [QBS[0]]);
    t.mock.method(claude, 'narrative', async () => text);
    const pool = world({ positions });
    const counts = await generateForWeek({ season: 2026, week: 6 }, { pool, now: NOW });
    assert.deepEqual(counts, { considered: 1, written: 1, enhanced: 0 });
    assert.equal(pool.rows.get(1).source, 'template');
  });
}

test('one player failing does not stop the loop', async (t) => {
  const positions = stubRun(t, QBS);
  t.mock.method(claude, 'narrative', async () => null);
  t.mock.method(console, 'error', () => {});
  const pool = world({ failOn: 1, positions });
  const counts = await generateForWeek({ season: 2026, week: 6 }, { pool, now: NOW });
  assert.deepEqual(counts, { considered: 2, written: 1, enhanced: 0 });
  assert.ok(pool.rows.has(2));
});
