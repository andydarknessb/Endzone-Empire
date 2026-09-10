const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const scoring = require('../services/scoring.service');
const tank01BoxSource = require('../services/tank01BoxSource');
const golden = require('./fixtures/tank01-box-golden.json');

/**
 * The Box source seam (#1183, ADR 0035): applyGameBoxScore consumes one
 * source-neutral Live box, and the Tank01 adapter is the first thing behind it.
 * This golden pins the refactor to zero behaviour change: the adapter's output,
 * applied, must write byte-identical player_stats.stats and emit an identical
 * plays array to the pre-refactor path (captured from origin/integration
 * 705a7598 in fixtures/tank01-box-golden.json).
 *
 * Green for the wrong reason is the risk: the second test seeds a wrong key
 * and proves the comparison goes red before the first test's green is trusted.
 */

function mapsFromFixture() {
  const m = golden.maps;
  return {
    idByExternal: new Map(m.idByExternal),
    metaById: new Map(m.metaById),
    defByTeamCode: new Map(m.defByTeamCode),
    prevById: new Map(m.prevById),
    opponentByTeam: new Map(m.opponentByTeam),
  };
}

function stubUpserts(t) {
  const upserts = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    if (String(sql).includes('INTO "player_stats"')) {
      upserts.push([params[0], params[1], params[2], JSON.parse(params[3]), params[4]]);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  return upserts;
}

test('tank01BoxSource: the adapter output applied through applyGameBoxScore matches the pre-refactor golden byte for byte', async (t) => {
  const upserts = stubUpserts(t);
  const liveBox = tank01BoxSource.fromBox(golden.box);
  assert.equal(liveBox.source, 'tank01');
  assert.equal(liveBox.gameId, '20260913_JAC@WSH');
  assert.equal(liveBox.isFinal, false);

  const out = await scoring.applyGameBoxScore({ liveBox, season: 2026, week: 2, maps: mapsFromFixture() });

  assert.equal(out.updated, golden.expected.updated);
  // stats jsonb byte-identical: compare the serialised form, in write order.
  assert.deepEqual(
    upserts.map((u) => [u[0], u[1], u[2], JSON.stringify(u[3]), u[4]]),
    golden.expected.upserts.map((u) => [u[0], u[1], u[2], JSON.stringify(u[3]), u[4]])
  );
  assert.deepEqual(out.plays, golden.expected.plays);
});

test('tank01BoxSource golden: a drifted key is caught (the comparison can go red)', async (t) => {
  const upserts = stubUpserts(t);
  const liveBox = tank01BoxSource.fromBox(golden.box);
  // Seed the wrong input: one player's receptions off by one.
  const wr = liveBox.players.find((p) => p.externalId === '4430878');
  wr.stats.receptions += 1;
  await scoring.applyGameBoxScore({ liveBox, season: 2026, week: 2, maps: mapsFromFixture() });
  assert.notDeepEqual(
    upserts.map((u) => JSON.stringify(u[3])),
    golden.expected.upserts.map((u) => JSON.stringify(u[3])),
    'a one-key drift must not compare equal'
  );
});

test('tank01BoxSource: the neutral shape carries every key the live path scores or animates', () => {
  const liveBox = tank01BoxSource.fromBox(golden.box);
  const keys = new Set(liveBox.players.flatMap((p) => Object.keys(p.stats)));
  for (const key of [
    'passingYards', 'passingTDs', 'interceptions', 'rushingYards', 'rushingTDs', 'receivingYards',
    'receivingTDs', 'receptions', 'fumbles', 'fieldGoal', 'fieldGoalMissed', 'extraPoint',
    'extraPointMissed', 'returnTDs', 'puntReturns', 'puntReturnYards',
    'soloTackle', 'assistedTackle', 'idpSack', 'idpInterception', 'forcedFumble', 'idpFumbleRecovery',
    'passDeflection', 'qbHit', 'tacklesForLoss', 'idpDefensiveTD', 'twoPointReturn',
    'fieldGoalDistances', 'passingTDLengths', 'rushingTDLengths', 'receivingTDLengths',
  ]) {
    assert.ok(keys.has(key), `${key} must be produced by the Tank01 adapter`);
  }
  // Team defense is keyed by folded Team code (WAS, never WSH), one line per side.
  assert.deepEqual(Object.keys(liveBox.teamDefense).sort(), ['JAX', 'WAS']);
  assert.deepEqual(Object.keys(liveBox.teamDefense.WAS).sort(), [
    'blockedKick', 'defensiveTD', 'fumbleRecovery', 'interceptionReturn', 'pointsAllowed', 'sack', 'safety', 'yardsAllowed',
  ]);
  // Blocks are credited to the side whose OPPONENT had kicks blocked.
  assert.equal(liveBox.teamDefense.WAS.blockedKick, 2, 'JAC had an XP and a punt blocked: WAS gets 2');
  assert.equal(liveBox.teamDefense.JAX.blockedKick, 1, 'WSH had a FG blocked: JAX gets 1');
  // Players the pool does not know are still in the shape; the apply skips them.
  assert.ok(liveBox.players.some((p) => p.externalId === '999999'));
});

test('applyGameBoxScore: a raw Tank01 box is still accepted and routed through the adapter', async (t) => {
  // The existing scoring tests pass `box`; the seam accepts it and adapts it so
  // no assertion in them had to change (#1183 done-when).
  const upserts = stubUpserts(t);
  const out = await scoring.applyGameBoxScore({ box: golden.box, season: 2026, week: 2, maps: mapsFromFixture() });
  assert.deepEqual(out.plays, golden.expected.plays);
  assert.equal(upserts.length, golden.expected.upserts.length);
});
