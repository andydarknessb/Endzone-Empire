const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const scoring = require('../services/boxScoreApply.service');
const tank01BoxSource = require('../services/tank01BoxSource');
const golden = require('./fixtures/tank01-box-golden.json');

/**
 * The Box source seam (#1183, ADR 0035): applyGameBoxScore consumes one
 * source-neutral Live box, and the Tank01 adapter is the first thing behind it.
 * This golden pins the adapter's applied output: player_stats.stats stays
 * byte-identical to the pre-refactor path captured from origin/integration
 * 705a7598, while the plays array reflects the per-play pointsDelta contract
 * introduced by #1545.
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

test('tank01BoxSource: the adapter output applied through applyGameBoxScore matches the golden contract', async (t) => {
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

  // #1545 self-check, independent of the golden file: a multi-play player's
  // pointsDelta values changed (each play now carries its own marginal share
  // instead of the whole change stamped on every play), but they must still
  // SUM to the exact single value the pre-refactor golden (705a7598) stamped
  // on every one of that player's plays. Hardcoded here rather than read back
  // off `golden.expected`, so a bad regen of the fixture (e.g. one that
  // silently drops points somewhere) cannot agree with its own wrong values.
  const PRE_REFACTOR_WHOLE_DELTA_BY_PLAYER = { 15: 6, 11: 13.78, 13: 5, 91: 20, 92: 6 };
  const sumByPlayer = new Map();
  for (const p of out.plays) {
    sumByPlayer.set(p.playerId, Math.round(((sumByPlayer.get(p.playerId) || 0) + p.pointsDelta) * 100) / 100);
  }
  for (const [playerId, whole] of Object.entries(PRE_REFACTOR_WHOLE_DELTA_BY_PLAYER)) {
    assert.equal(
      sumByPlayer.get(Number(playerId)), whole,
      `player ${playerId}'s plays must still sum to the pre-refactor whole delta ${whole}`
    );
  }
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

test('tank01BoxSource: pointsAllowed comes from the opponent\'s lineScore total, not Tank01\'s ptsAllowed (#1384)', () => {
  // DST.home.ptsAllowed says 27 (Tank01's own convention: the opponent's
  // score minus 6 per opposing non-offensive TD), but the away side actually
  // put 33 on the board per lineScore — a non-offensive TD masked the true
  // score under the old convention. pointsAllowed must read the scoreboard
  // total, not the drifted ptsAllowed field.
  const box = {
    gameID: '20260913_JAC@WSH',
    home: 'WSH',
    away: 'JAC',
    DST: {
      home: {
        teamAbv: 'WSH', sacks: '0', defensiveInterceptions: '0', fumblesRecovered: '0',
        defTD: '0', safeties: '0', ptsAllowed: '27', ydsAllowed: '0',
      },
      away: {
        teamAbv: 'JAC', sacks: '0', defensiveInterceptions: '0', fumblesRecovered: '0',
        defTD: '0', safeties: '0', ptsAllowed: '0', ydsAllowed: '0',
      },
    },
    teamStats: { home: { teamAbv: 'WSH' }, away: { teamAbv: 'JAC' } },
    lineScore: {
      away: { Q1: '7', Q2: '10', Q3: '10', Q4: '6' },
    },
  };
  const liveBox = tank01BoxSource.fromBox(box);
  assert.equal(liveBox.teamDefense.WAS.pointsAllowed, 33);
});

test('tank01BoxSource: pointsAllowed falls back to DST ptsAllowed when the box has no lineScore for that side (#1384 f1)', () => {
  // fromBox also serves the in-progress Live box fallback (liveBox.js
  // fetchTank01, ADR 0035), whose box may carry no lineScore yet. Reading
  // the missing side as an absent lineScore -> 0 pointsAllowed would score
  // a shutout that never happened; it must fall back to DST ptsAllowed.
  const box = {
    gameID: '20260913_JAC@WSH',
    home: 'WSH',
    away: 'JAC',
    DST: {
      home: {
        teamAbv: 'WSH', sacks: '0', defensiveInterceptions: '0', fumblesRecovered: '0',
        defTD: '0', safeties: '0', ptsAllowed: '17', ydsAllowed: '0',
      },
      away: {
        teamAbv: 'JAC', sacks: '0', defensiveInterceptions: '0', fumblesRecovered: '0',
        defTD: '0', safeties: '0', ptsAllowed: '0', ydsAllowed: '0',
      },
    },
    teamStats: { home: { teamAbv: 'WSH' }, away: { teamAbv: 'JAC' } },
    // No lineScore at all.
  };
  const liveBox = tank01BoxSource.fromBox(box);
  assert.equal(liveBox.teamDefense.WAS.pointsAllowed, 17);
});

test('tank01BoxSource: a real lineScore shutout (0) for the opponent still wins over DST ptsAllowed (#1384 f1)', () => {
  // A present lineScore always wins, even when it sums to 0 — a real
  // shutout must still read 0, not fall back to a non-zero ptsAllowed.
  const box = {
    gameID: '20260913_JAC@WSH',
    home: 'WSH',
    away: 'JAC',
    DST: {
      home: {
        teamAbv: 'WSH', sacks: '0', defensiveInterceptions: '0', fumblesRecovered: '0',
        defTD: '0', safeties: '0', ptsAllowed: '3', ydsAllowed: '0',
      },
      away: {
        teamAbv: 'JAC', sacks: '0', defensiveInterceptions: '0', fumblesRecovered: '0',
        defTD: '0', safeties: '0', ptsAllowed: '0', ydsAllowed: '0',
      },
    },
    teamStats: { home: { teamAbv: 'WSH' }, away: { teamAbv: 'JAC' } },
    lineScore: {
      away: { Q1: '0', Q2: '0', Q3: '0', Q4: '0' },
    },
  };
  const liveBox = tank01BoxSource.fromBox(box);
  assert.equal(liveBox.teamDefense.WAS.pointsAllowed, 0);
});

test('tank01BoxSource: an absent ydsAllowed on the DST side omits yardsAllowed from that side\'s teamDefense line (#1549)', () => {
  const box = JSON.parse(JSON.stringify(golden.box));
  delete box.DST.home.ydsAllowed;
  const liveBox = tank01BoxSource.fromBox(box);
  // golden.box.home is 'WSH', folded to 'WAS' as team-defense keys always are.
  assert.equal('yardsAllowed' in liveBox.teamDefense.WAS, false);
});

test('applyGameBoxScore: a raw Tank01 box is still accepted and routed through the adapter', async (t) => {
  // The existing scoring tests pass `box`; the seam accepts it and adapts it so
  // no assertion in them had to change (#1183 done-when).
  const upserts = stubUpserts(t);
  const out = await scoring.applyGameBoxScore({ box: golden.box, season: 2026, week: 2, maps: mapsFromFixture() });
  assert.deepEqual(out.plays, golden.expected.plays);
  assert.equal(upserts.length, golden.expected.upserts.length);
});
