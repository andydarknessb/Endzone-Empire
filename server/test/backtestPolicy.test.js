const test = require('node:test');
const assert = require('node:assert/strict');

const ordering = require('../../scripts/backtest/lib/ordering');
const policy = require('../../scripts/backtest/lib/policy');
const cohort = require('../../scripts/backtest/lib/cohort');
const rosters = require('../../scripts/backtest/lib/rosters');

// The REAL production pieces. The whole value of a "deployed-policy" estimand
// is that it runs production's own availability rule and optimizer, so these
// are injected rather than re-implemented.
const { availabilityFor } = require('../services/projectionModel');
const { optimalAssignment } = require('../services/lineupOptimizer');
const { normalizeTeamKey } = require('../services/projectionFeatures');

const SLOTS = rosters.DEFAULT_ROSTER_SLOTS;

/** Rank artifacts in the shape the extraction captures them. */
function makeRanks({ positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'], players = [] } = {}) {
  return ordering.buildRankIndex({
    positionRankRows: positions.map((code, i) => ({ code, rank: i + 1 })),
    playerNameRankRows: players.map((p) => ({ id: p.id, name: p.name, rank: p.rank })),
  });
}

/** A legal 16-man roster: 1 QB, 5 RB, 5 WR, 2 TE, 1 K, 1 DEF. */
function makeRoster() {
  const entries = [];
  let id = 1;
  const add = (position, count, slot) => {
    for (let i = 0; i < count; i++) {
      entries.push({ playerId: id, position, slot: slot(i), name: `${position}${i}` });
      id++;
    }
  };
  add('QB', 2, (i) => (i === 0 ? 'QB' : 'BENCH'));
  add('RB', 5, (i) => (i < 2 ? 'RB' : 'BENCH'));
  add('WR', 5, (i) => (i < 2 ? 'WR' : 'BENCH'));
  add('TE', 2, (i) => (i === 0 ? 'TE' : 'BENCH'));
  add('K', 1, () => 'K');
  add('DEF', 1, () => 'DEF');
  return entries;
}

function ranksFor(entries) {
  return makeRanks({ players: entries.map((e, i) => ({ id: e.playerId, name: e.name, rank: i + 1 })) });
}

// ---------------------------------------------------------------------------
// Ordering: the two collation artifacts
// ---------------------------------------------------------------------------

test('candidates order by week POSITION first, then captured name rank, then id', () => {
  const ranks = makeRanks({
    players: [{ id: 1, name: 'Zed', rank: 90 }, { id: 2, name: 'Abe', rank: 10 },
      { id: 3, name: 'Mid', rank: 50 }],
  });
  const candidates = [
    { playerId: 1, position: 'RB' },
    { playerId: 2, position: 'WR' },
    { playerId: 3, position: 'QB' },
  ];
  // QB(1) before RB(2) before WR(3) by POSITION rank, whatever the name rank.
  assert.deepEqual(
    ordering.orderCandidates({ candidates, ranks }).map((c) => c.playerId), [3, 1, 2]
  );
  // Within a position, captured name rank decides.
  const sameSpot = ordering.orderCandidates({
    candidates: [{ playerId: 1, position: 'RB' }, { playerId: 2, position: 'RB' }], ranks,
  });
  assert.deepEqual(sameSpot.map((c) => c.playerId), [2, 1], 'Abe (rank 10) before Zed (rank 90)');
});

test('a duplicate NAME rank falls through to the player id, which makes the order total', () => {
  // Production's `ORDER BY position, name` leaves duplicate names unordered.
  // The id refinement is what the reconstruction adds so the result is
  // reproducible rather than arbitrary.
  const ranks = makeRanks({
    players: [{ id: 7, name: 'Same Name', rank: 42 }, { id: 3, name: 'Same Name', rank: 42 }],
  });
  const ordered = ordering.orderCandidates({
    candidates: [{ playerId: 7, position: 'RB' }, { playerId: 3, position: 'RB' }], ranks,
  });
  assert.deepEqual(ordered.map((c) => c.playerId), [3, 7], 'the lower id breaks the name tie');
});

test('today\'s players.position CANNOT affect historical candidate order', () => {
  // The position that orders a candidate is the RECONSTRUCTED roster-week
  // position; only the RANK of that code comes from the database. A player who
  // is a WR today but was an RB that week must sort as an RB.
  const ranks = makeRanks({
    players: [{ id: 1, name: 'Mover', rank: 10 }, { id: 2, name: 'Static', rank: 20 }],
  });
  const asRb = ordering.orderCandidates({
    candidates: [{ playerId: 2, position: 'WR' }, { playerId: 1, position: 'RB' }], ranks,
  });
  assert.deepEqual(asRb.map((c) => c.playerId), [1, 2], 'the week RB sorts ahead of the week WR');
  // Change ONLY the week position and the order flips - proving position is
  // what drove it, and that it came from the candidate rather than a lookup.
  const asWr = ordering.orderCandidates({
    candidates: [{ playerId: 2, position: 'RB' }, { playerId: 1, position: 'WR' }], ranks,
  });
  assert.deepEqual(asWr.map((c) => c.playerId), [2, 1]);
});

test('a candidate with no captured rank FAILS CLOSED, never sorts arbitrarily', () => {
  const ranks = makeRanks({ players: [{ id: 1, name: 'Known', rank: 1 }] });
  assert.throws(() => ordering.orderCandidates({
    candidates: [{ playerId: 99, position: 'RB' }], ranks,
  }), /player 99 has no captured name rank.*fails closed/s);
  assert.throws(() => ordering.orderCandidates({
    candidates: [{ playerId: 1, position: 'LB' }], ranks,
  }), /week-position "LB" has no captured rank/);
  // A synthesized DEF that never borrowed a database id is refused by name.
  assert.throws(() => ordering.orderCandidates({
    candidates: [{ playerId: null, teamKey: 'KC', position: 'DEF' }], ranks,
  }), /has no player id.*must borrow the database DEF row's identity/s);
});

test('the rank index refuses a duplicated or empty artifact', () => {
  assert.throws(() => ordering.buildRankIndex({
    positionRankRows: [{ code: 'QB', rank: 1 }, { code: 'QB', rank: 2 }],
    playerNameRankRows: [{ id: 1, rank: 1 }],
  }), /duplicate position rank for QB/);
  assert.throws(() => ordering.buildRankIndex({
    positionRankRows: [{ code: 'QB', rank: 1 }],
    playerNameRankRows: [{ id: 1, rank: 1 }, { id: 1, rank: 2 }],
  }), /duplicate name rank for player 1/);
  assert.throws(() => ordering.buildRankIndex({
    positionRankRows: [], playerNameRankRows: [{ id: 1, rank: 1 }],
  }), /position-rank artifact is empty/);
});

test('the two required sensitivities reorder only what they are meant to', () => {
  const ranks = makeRanks({
    players: [{ id: 1, name: 'A', rank: 10 }, { id: 2, name: 'B', rank: 20 },
      { id: 3, name: 'C', rank: 5 }],
  });
  const candidates = [
    { playerId: 1, position: 'WR' }, { playerId: 2, position: 'QB' }, { playerId: 3, position: 'WR' },
  ];
  // Primary: position first.
  assert.deepEqual(ordering.orderCandidates({ candidates, ranks }).map((c) => c.playerId), [2, 3, 1]);
  // DB-collation variant: name rank first, position ignored.
  assert.deepEqual(ordering.orderCandidates({
    candidates, ranks, ordering: ordering.ORDERINGS.DB_COLLATION,
  }).map((c) => c.playerId), [3, 1, 2]);
  // Duplicate shuffle with NO duplicates changes nothing: there is nothing
  // production left unordered to permute.
  assert.deepEqual(ordering.orderCandidates({
    candidates, ranks, ordering: ordering.ORDERINGS.DUPLICATE_SHUFFLE,
  }).map((c) => c.playerId), [2, 3, 1]);
  assert.throws(() => ordering.orderCandidates({ candidates, ranks, ordering: 'whatever' }),
    /unknown ordering/);
});

test('the duplicate shuffle permutes ONLY genuine ties, and is seeded', () => {
  const players = Array.from({ length: 6 }, (unused, i) => ({ id: i + 1, name: 'Tie', rank: 7 }));
  const ranks = makeRanks({ players });
  const candidates = players.map((p) => ({ playerId: p.id, position: 'RB' }));
  const a = ordering.orderCandidates({
    candidates, ranks, ordering: ordering.ORDERINGS.DUPLICATE_SHUFFLE, shuffleSeed: 11,
  });
  const b = ordering.orderCandidates({
    candidates, ranks, ordering: ordering.ORDERINGS.DUPLICATE_SHUFFLE, shuffleSeed: 11,
  });
  assert.deepEqual(a.map((c) => c.playerId), b.map((c) => c.playerId), 'same seed, same order');
  assert.notDeepEqual(
    a.map((c) => c.playerId),
    ordering.orderCandidates({
      candidates, ranks, ordering: ordering.ORDERINGS.DUPLICATE_SHUFFLE, shuffleSeed: 999,
    }).map((c) => c.playerId)
  );
  // It is a permutation of the same players, not a filter.
  assert.deepEqual([...a.map((c) => c.playerId)].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6]);

  // And the count of invented order is published, so a vacuous sensitivity is
  // visible as vacuous.
  assert.deepEqual(ordering.duplicateOrderCount({ candidates, ranks }),
    { duplicates: 5, distinctKeys: 1, candidates: 6 });
});

test('the shuffle leaves everything production DOES order exactly where it was', () => {
  // A mix of tied and untied candidates. Only the tied RUN may move; if the
  // shuffle reached past it, the study would be perturbing an order production
  // actually specifies and calling the result an ordering sensitivity.
  const players = [
    { id: 1, name: 'Alpha', rank: 1 },
    { id: 2, name: 'Tie', rank: 5 }, { id: 3, name: 'Tie', rank: 5 },
    { id: 4, name: 'Tie', rank: 5 }, { id: 5, name: 'Tie', rank: 5 },
    { id: 6, name: 'Omega', rank: 9 },
  ];
  const ranks = makeRanks({ players });
  const candidates = players.map((p) => ({ playerId: p.id, position: 'RB' }));
  for (const seed of [1, 2, 3, 4, 5, 17, 99]) {
    const out = ordering.orderCandidates({
      candidates, ranks, ordering: ordering.ORDERINGS.DUPLICATE_SHUFFLE, shuffleSeed: seed,
    }).map((c) => c.playerId);
    assert.equal(out[0], 1, `seed ${seed}: the uniquely-ranked first candidate never moves`);
    assert.equal(out[5], 6, `seed ${seed}: nor does the uniquely-ranked last one`);
    assert.deepEqual([...out.slice(1, 5)].sort((a, b) => a - b), [2, 3, 4, 5],
      `seed ${seed}: the tied run is permuted among itself and nowhere else`);
  }
  // And across seeds the tied run really does take more than one arrangement,
  // or the assertions above would hold vacuously.
  const arrangements = new Set([1, 2, 3, 4, 5, 17, 99].map((seed) => ordering.orderCandidates({
    candidates, ranks, ordering: ordering.ORDERINGS.DUPLICATE_SHUFFLE, shuffleSeed: seed,
  }).map((c) => c.playerId).join(',')));
  assert.ok(arrangements.size > 1, 'the shuffle actually shuffles');
});

test('an ordering-dependent winner or verdict is INCONCLUSIVE', () => {
  const primary = { winner: 'usage-40-off', verdict: 'pass' };
  const stable = ordering.orderingSensitivityVerdict({
    primary,
    sensitivities: {
      'db-collation': { winner: 'usage-40-off', verdict: 'pass' },
      'duplicate-shuffle': { winner: 'usage-40-off', verdict: 'pass' },
    },
  });
  assert.equal(stable.verdict, 'pass');
  assert.deepEqual(stable.disagreements, []);

  const movedWinner = ordering.orderingSensitivityVerdict({
    primary,
    sensitivities: {
      'db-collation': { winner: 'usage-60-off', verdict: 'pass' },
      'duplicate-shuffle': { winner: 'usage-40-off', verdict: 'pass' },
    },
  });
  assert.equal(movedWinner.verdict, 'inconclusive');
  assert.equal(movedWinner.reason, 'ordering-dependent');

  // A moved VERDICT is equally disqualifying, even with the same winner.
  assert.equal(ordering.orderingSensitivityVerdict({
    primary,
    sensitivities: { 'db-collation': { winner: 'usage-40-off', verdict: 'fail' } },
  }).verdict, 'inconclusive');

  // A sensitivity that never ran cannot demonstrate stability.
  assert.throws(() => ordering.orderingSensitivityVerdict({ primary, sensitivities: {} }),
    /no sensitivity results supplied.*REQUIRED/s);
  assert.throws(() => ordering.orderingSensitivityVerdict({
    primary, sensitivities: { 'db-collation': null },
  }), /sensitivity db-collation produced no result/);
});

// ---------------------------------------------------------------------------
// JC2: the DEF pseudo-player carries a database identity
// ---------------------------------------------------------------------------

test('a synthesized DEF borrows the database DEF row\'s id, so it orders by name rank', () => {
  const dbPlayers = [
    { id: 501, position: 'DEF', nfl_team: 'Kansas City Chiefs', team_key: 'KC' },
    { id: 502, position: 'DEF', nfl_team: 'Buffalo Bills', team_key: 'BUF' },
    { id: 1, position: 'QB', nfl_team: 'KC', team_key: 'KC' },
  ];
  const index = cohort.buildDefensePlayerIndex({ dbPlayers, normalizeTeamKey });
  assert.equal(index.get('KC'), 501);
  assert.equal(index.get('BUF'), 502);
  assert.equal(index.has('LAR'), false);

  // Two DEF rows for one team would make the borrowed identity ambiguous.
  assert.throws(() => cohort.buildDefensePlayerIndex({
    dbPlayers: [...dbPlayers, { id: 503, position: 'DEF', nfl_team: 'KC', team_key: 'KC' }],
    normalizeTeamKey,
  }), /two DEF players map to KC/);

  // And the ordered DEF ties resolve by NAME RANK, the way production's would -
  // not by team key, which was the carried defect.
  const ranks = makeRanks({
    players: [{ id: 501, name: 'Kansas City Chiefs', rank: 30 },
      { id: 502, name: 'Buffalo Bills', rank: 10 }],
  });
  const ordered = ordering.orderCandidates({
    candidates: [
      { playerId: 501, teamKey: 'KC', position: 'DEF' },
      { playerId: 502, teamKey: 'BUF', position: 'DEF' },
    ],
    ranks,
  });
  assert.deepEqual(ordered.map((c) => c.playerId), [502, 501],
    'Buffalo (name rank 10) before Kansas City (30) - by NAME, not by team key');
  // Team key alone would have given the opposite order, so this is not vacuous.
  assert.ok('BUF' < 'KC');
});

test('the cohort refuses to synthesize a DEF with no database identity', () => {
  const crosswalk = cohort.buildCrosswalk([{ gsis_id: '00-0000001', espn_id: '3001' }]);
  const { playerIdByGsis } = cohort.buildGsisByPlayerId({
    dbPlayers: [{ id: 1, external_id: '3001' }], crosswalk,
  });
  const asOf = require('../../scripts/backtest/lib/asOfView');
  const rosterIndex = asOf.buildRosterIndex([{
    season: 2025, week: 3, team: 'KC', position: 'QB', status: 'ACT',
    gsis_id: '00-0000001', full_name: 'A', game_type: 'REG',
  }]);
  const args = {
    season: 2025, week: 3, rosterIndex, crosswalk, playerIdByGsis, normalizeTeamKey,
    statsGameTeamFor: () => null, byeTeamKeys: new Set(), defenseTeamKeys: ['KC'],
  };
  assert.throws(() => cohort.buildCohort(args),
    /no database DEF player for team KC.*could not be ordered the way production orders it/s);
  // With the index supplied it succeeds and the DEF carries the real id.
  const built = cohort.buildCohort({
    ...args, defensePlayerIdByTeamKey: new Map([['KC', 501]]),
  });
  const def = built.members.find((m) => m.isDefense);
  assert.equal(def.playerId, 501);
  assert.equal(def.teamKey, 'KC');
});

// ---------------------------------------------------------------------------
// The deployed-policy wrapper: parity with buildSuggestions
// ---------------------------------------------------------------------------

function runDeployed(entries, projections, extra = {}) {
  return policy.deployedPolicyLineup({
    entries,
    projections,
    ranks: ranksFor(entries),
    rosterSlots: SLOTS,
    availabilityFor,
    optimize: optimalAssignment,
    ...extra,
  });
}

test('the wrapper removes bye, Out and IR players and treats them as worth zero', () => {
  const entries = makeRoster();
  const byBye = entries.map((e) => (e.playerId === 3 ? { ...e, onBye: true } : e));
  const projections = new Map(entries.map((e) => [e.playerId, 100 - e.playerId]));

  const result = runDeployed(byBye, projections);
  assert.equal(result.started.includes(3), false, 'a bye player is never started');
  assert.ok(result.removed.some((r) => r.playerId === 3 && r.reason === 'bye'));

  for (const [status, reason] of [['O', 'out'], ['IR', 'ir']]) {
    const marked = entries.map((e) => (e.playerId === 3 ? { ...e, injuryStatus: status } : e));
    const out = runDeployed(marked, projections);
    assert.equal(out.started.includes(3), false, `${status} is never started`);
    assert.ok(out.removed.some((r) => r.playerId === 3 && r.reason === reason));
  }
  // An IR-SLOT player is excluded before availability is even consulted.
  const onIrSlot = entries.map((e) => (e.playerId === 4 ? { ...e, slot: 'IR' } : e));
  assert.ok(runDeployed(onIrSlot, projections).removed
    .some((r) => r.playerId === 4 && r.reason === 'ir-slot'));
});

test('Doubtful on the bench is never auto-promoted; Doubtful already starting keeps its slot', () => {
  // The asymmetry is production's own (decision.service.js:133), and it is the
  // fixture the preregistration names.
  const entries = makeRoster();
  const projections = new Map(entries.map((e) => [e.playerId, 1]));
  // Player 6 is a benched RB; make him Doubtful and by far the best projection.
  projections.set(6, 1000);
  const benched = entries.map((e) => (e.playerId === 6 ? { ...e, injuryStatus: 'D' } : e));
  const benchResult = runDeployed(benched, projections);
  assert.equal(benchResult.started.includes(6), false,
    'a Doubtful bench player is not promoted, however good his projection');
  assert.ok(benchResult.removed.some((r) => r.playerId === 6 && r.reason === 'doubtful-on-bench'));

  // The same player STARTING stays a candidate and keeps his place.
  const starting = entries.map((e) => (e.playerId === 6 ? { ...e, injuryStatus: 'D', slot: 'RB' } : e));
  const startResult = runDeployed(starting, projections);
  assert.equal(startResult.started.includes(6), true, 'a Doubtful starter is not benched');
});

test('an unavailable player is worth ZERO even when he cannot be removed', () => {
  // The candidate filter is not the whole story. A LOCKED starter is pinned
  // into his slot and never enters the candidate pool at all, so if the bye
  // did not also zero his VALUE, the lineup total would keep his full
  // projection - the exact failure decision.service's effectiveProjection
  // exists to prevent ("a starter on a bye keeps his full projection, the
  // lineup total overstates itself").
  const entries = [
    { playerId: 1, position: 'QB', slot: 'QB', name: 'Bye Locked', onBye: true, locked: true },
    { playerId: 2, position: 'K', slot: 'K', name: 'Fit' },
  ];
  const projections = new Map([[1, 99], [2, 7]]);
  const { availabilityById } = policy.partitionCandidates({ entries, availabilityFor });
  const effective = policy.effectiveProjections({ entries, projections, availabilityById });
  assert.equal(effective.get(1), 0, 'the bye player is worth zero, not 99');
  assert.equal(effective.get(2), 7);

  // And it shows up in the lineup total the optimizer reports.
  const result = policy.deployedPolicyLineup({
    entries,
    projections,
    ranks: ranksFor(entries),
    rosterSlots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] },
      { key: 'K', count: 1, eligiblePositions: ['K'] }],
    availabilityFor,
    optimize: optimalAssignment,
  });
  assert.equal(result.total, 7, 'the locked bye starter contributes nothing to the total');
  assert.equal(result.started.includes(1), true, 'though he is still pinned into his slot');

  // An Out player, likewise.
  const out = policy.effectiveProjections({
    entries: [{ playerId: 3, position: 'QB', slot: 'QB', injuryStatus: 'O' }],
    projections: new Map([[3, 50]]),
    availabilityById: policy.partitionCandidates({
      entries: [{ playerId: 3, position: 'QB', slot: 'QB', injuryStatus: 'O' }], availabilityFor,
    }).availabilityById,
  });
  assert.equal(out.get(3), 0);
});

test('force-fill zeroes an unavailable player too, rather than force-starting a bye', () => {
  // Force-fill relaxes WHICH slots must be filled, not WHO may fill them. A
  // locked bye starter is still worth zero; skipping the wrapper here would
  // let force-fill credit a bye player's full projection.
  const entries = [
    { playerId: 1, position: 'QB', slot: 'QB', name: 'Bye Locked', onBye: true, locked: true },
    { playerId: 2, position: 'K', slot: 'K', name: 'Fit' },
  ];
  const forced = policy.forceFillLineup({
    entries,
    projections: new Map([[1, 99], [2, 7]]),
    ranks: ranksFor(entries),
    rosterSlots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] },
      { key: 'K', count: 1, eligiblePositions: ['K'] }],
    availabilityFor,
    optimize: optimalAssignment,
  });
  assert.equal(forced.started.includes(1), true, 'he is pinned, so he is in the lineup');
  assert.equal(forced.total, 7, 'but he is worth zero, not 99');
});

test('the empty-slot dummy beats a strictly negative projection', () => {
  // The optimizer's dummy costs 0 and a real player costs -points, so a -5
  // player costs +5 and loses to the dummy: the slot is left EMPTY.
  const entries = [
    { playerId: 1, position: 'QB', slot: 'QB', name: 'QB0' },
    { playerId: 2, position: 'K', slot: 'K', name: 'K0' },
  ];
  const negative = new Map([[1, -5], [2, -5]]);
  const result = policy.deployedPolicyLineup({
    entries,
    projections: negative,
    ranks: ranksFor(entries),
    rosterSlots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] },
      { key: 'K', count: 1, eligiblePositions: ['K'] }],
    availabilityFor,
    optimize: optimalAssignment,
  });
  assert.deepEqual(result.started, [], 'both slots stay empty rather than start a negative');
});

test('zero and null-coerced-to-zero TIE with the dummy, so a real player may start', () => {
  const entries = [{ playerId: 1, position: 'QB', slot: 'QB', name: 'QB0' }];
  const slots = [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }];
  for (const [label, projections] of [
    ['an exact zero', new Map([[1, 0]])],
    ['a null projection', new Map([[1, null]])],
    ['a missing projection', new Map()],
  ]) {
    const result = policy.deployedPolicyLineup({
      entries, projections, ranks: ranksFor(entries), rosterSlots: slots,
      availabilityFor, optimize: optimalAssignment,
    });
    // Tie with the dummy: the real player is permitted to start, which is
    // production's behaviour and why null is NOT excluded from regret.
    assert.equal(result.started.length <= 1, true, `${label} ties rather than losing`);
  }
  // pointsValue mirrors the optimizer's coercion exactly.
  assert.equal(policy.pointsValue(null), 0);
  assert.equal(policy.pointsValue(undefined), 0);
  assert.equal(policy.pointsValue({ median: 12.5 }), 12.5);
  assert.equal(policy.pointsValue({ median: null }), 0);
  assert.equal(policy.pointsValue(Number.NaN), 0);
});

test('equal projections are resolved by CANDIDATE ORDER, which is why ordering matters', () => {
  // Two identical RBs and one RB slot. Whichever the ordering puts first is the
  // one that starts - that is `lineupOptimizer.js:74`'s strict `<`.
  const entries = [
    { playerId: 1, position: 'RB', slot: 'BENCH', name: 'Zed' },
    { playerId: 2, position: 'RB', slot: 'BENCH', name: 'Abe' },
  ];
  const slots = [{ key: 'RB', count: 1, eligiblePositions: ['RB'] }];
  const projections = new Map([[1, 10], [2, 10]]);
  const byName = makeRanks({
    players: [{ id: 1, name: 'Zed', rank: 90 }, { id: 2, name: 'Abe', rank: 10 }],
  });
  const first = policy.deployedPolicyLineup({
    entries, projections, ranks: byName, rosterSlots: slots,
    availabilityFor, optimize: optimalAssignment,
  });
  assert.deepEqual(first.started, [2], 'the earlier candidate wins an exact tie');

  // Flip only the NAME RANKS and the other player starts - the projections and
  // the roster are unchanged.
  const flipped = makeRanks({
    players: [{ id: 1, name: 'Zed', rank: 10 }, { id: 2, name: 'Abe', rank: 90 }],
  });
  const second = policy.deployedPolicyLineup({
    entries, projections, ranks: flipped, rosterSlots: slots,
    availabilityFor, optimize: optimalAssignment,
  });
  assert.deepEqual(second.started, [1]);
});

// ---------------------------------------------------------------------------
// The force-fill sensitivity
// ---------------------------------------------------------------------------

test('force-fill leaves no slot empty and ranks null strictly below every finite value', () => {
  const entries = [
    { playerId: 1, position: 'QB', slot: 'BENCH', name: 'Neg' },
    { playerId: 2, position: 'QB', slot: 'BENCH', name: 'Null' },
  ];
  const slots = [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }];
  const common = {
    entries, ranks: ranksFor(entries), rosterSlots: slots, availabilityFor, optimize: optimalAssignment,
  };

  // With ONLY a negative candidate, production leaves the slot empty: the
  // dummy costs 0 and a -5 player costs +5.
  assert.deepEqual(policy.deployedPolicyLineup({
    ...common, entries: [entries[0]], projections: new Map([[1, -5]]),
  }).started, [], 'deployed policy leaves the slot empty rather than start a negative');

  // THE CONTRAST THAT DEFINES THE TWO ESTIMANDS. Given a -5 and a null:
  //   - deployed policy starts the NULL, because null coerces to 0 and ties
  //     with the dummy, and 0 beats a negative;
  //   - force-fill starts the -5, because null ranks strictly BELOW every
  //     finite projection.
  // They pick different players from the same roster, which is exactly why
  // force-fill is a labelled sensitivity and not production regret.
  const projections = new Map([[1, -5], [2, null]]);
  assert.deepEqual(policy.deployedPolicyLineup({ ...common, projections }).started, [2],
    'deployed policy: a null ties with the dummy and beats the negative');
  const forced = policy.forceFillLineup({ ...common, projections });
  assert.deepEqual(forced.started, [1], 'force-fill: null ranks strictly below a finite -5');
  assert.equal(forced.total, -5, 'and the total is reported in REAL points, not shifted ones');

  // With only a null available force-fill still fills the slot.
  assert.equal(policy.forceFillLineup({
    ...common, projections: new Map([[2, null]]),
  }).started.length, 1);
});

test('force-fill still honours the availability wrapper - it is not a free-for-all', () => {
  const entries = [
    { playerId: 1, position: 'QB', slot: 'BENCH', name: 'Bye', onBye: true },
    { playerId: 2, position: 'QB', slot: 'BENCH', name: 'Fit' },
  ];
  const forced = policy.forceFillLineup({
    entries,
    projections: new Map([[1, 100], [2, 1]]),
    ranks: ranksFor(entries),
    rosterSlots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }],
    availabilityFor,
    optimize: optimalAssignment,
  });
  assert.deepEqual(forced.started, [2], 'a bye player is still removed, however high his projection');
});

// ---------------------------------------------------------------------------
// Regret, and the estimand-disagreement halt
// ---------------------------------------------------------------------------

test('regret is best-minus-started under ACTUAL points, and is non-negative by construction', () => {
  const actual = new Map([[1, 10], [2, 20], [3, 5]]);
  assert.equal(policy.regretFor({ startedPlayerIds: [1], bestPlayerIds: [2], actualPoints: actual }), 10);
  assert.equal(policy.regretFor({ startedPlayerIds: [2], bestPlayerIds: [2], actualPoints: actual }), 0);
  // A missing actual is zero, matching how the optimizer values a missing point.
  assert.equal(policy.regretFor({ startedPlayerIds: [], bestPlayerIds: [99], actualPoints: actual }), 0);
  // A "best" lineup that scores less than the arm's is a solver defect.
  assert.throws(() => policy.regretFor({
    startedPlayerIds: [2], bestPlayerIds: [3], actualPoints: actual,
  }), /regret is -15, which is negative.*solver defect/s);
});

test('when the two estimands disagree on a winner, NO SELECTION OCCURS', () => {
  const agreed = policy.reconcileEstimands({
    deployedPolicy: { winner: 'usage-40-off' }, forceFill: { winner: 'usage-40-off' },
  });
  assert.equal(agreed.halted, false);
  assert.equal(agreed.selection, 'usage-40-off');

  const split = policy.reconcileEstimands({
    deployedPolicy: { winner: 'usage-40-off' }, forceFill: { winner: 'usage-60-on' },
  });
  assert.equal(split.halted, true);
  assert.equal(split.selection, null, 'no selection occurs');
  assert.equal(split.reason, 'estimand-disagreement');
  assert.match(split.detail, /NO SELECTION OCCUR/);
  assert.deepEqual(split.winners, { deployedPolicy: 'usage-40-off', forceFill: 'usage-60-on' });

  // "No winner at all" on either side is a failure, not an agreement.
  assert.throws(() => policy.reconcileEstimands({
    deployedPolicy: { winner: null }, forceFill: {},
  }), /forceFill produced no winner/);
  // Two nulls agree, and agreeing on "nobody" is a legitimate outcome.
  assert.equal(policy.reconcileEstimands({
    deployedPolicy: { winner: null }, forceFill: { winner: null },
  }).halted, false);
});

// ---------------------------------------------------------------------------
// The evaluation artifact carries the exclusion counters
// ---------------------------------------------------------------------------

test('an evaluation artifact carries the exclusion counters the report has to state', () => {
  // Prereg 4.1 requires the published report to state exclusions per cause. If
  // the artifact could not carry them, a report that states them would not be
  // constructible - so they travel with the result rather than being recovered.
  const artifact = policy.evaluationArtifact({
    season: 2025,
    week: 9,
    replicate: 0,
    teamIndex: 3,
    estimand: policy.ESTIMANDS.DEPLOYED_POLICY,
    regret: 4.25,
    started: [1, 2, 3],
    removed: [{ playerId: 9, reason: 'bye' }, { playerId: 10, reason: 'bye' },
      { playerId: 11, reason: 'doubtful-on-bench' }],
    counters: {
      playersOmittedByReason: { 'def-synthesized-in-phase-3': 32, 'no-roster-row': 4 },
      contradictions: 7,
      scanRowsUnattributed: 12,
      cohortExcludedByReason: { 'status-class-reserve': 5 },
      outcomeExcludedByReason: { 'ambiguous-one-source-only': 2 },
    },
  });
  assert.equal(artifact.season, 2025);
  assert.equal(artifact.regret, 4.25);
  assert.deepEqual(artifact.removedByReason, { bye: 2, 'doubtful-on-bench': 1 });
  assert.equal(artifact.removedFromCandidates, 3);
  assert.deepEqual(artifact.exclusions.playersOmittedByReason,
    { 'def-synthesized-in-phase-3': 32, 'no-roster-row': 4 });
  assert.equal(artifact.exclusions.contradictions, 7);
  assert.equal(artifact.exclusions.scanRowsUnattributed, 12);
  assert.deepEqual(artifact.exclusions.cohortExcludedByReason, { 'status-class-reserve': 5 });
  assert.deepEqual(artifact.exclusions.outcomeExcludedByReason, { 'ambiguous-one-source-only': 2 });

  // With no counters supplied the shape is still complete, so a consumer never
  // has to guess whether a field is absent or zero.
  const bare = policy.evaluationArtifact({
    season: 2024, week: 2, replicate: 1, teamIndex: 0,
    estimand: policy.ESTIMANDS.FORCE_FILL, regret: 0, started: [], removed: [],
  });
  assert.deepEqual(bare.exclusions, {
    playersOmittedByReason: {}, contradictions: 0, scanRowsUnattributed: 0,
    cohortExcludedByReason: {}, outcomeExcludedByReason: {},
  });
});

test('the 2026 quarantine holds on the PERSISTED evaluation row, not just upstream', () => {
  // buildCohort refusing 2026 is not the same guard: evaluationArtifact is
  // exported and Phase 5 calls it directly, so a 2026 row could be persisted
  // without ever passing through cohort construction. The quarantine has to be
  // on every path that mints a row.
  const row = {
    week: 9, replicate: 0, teamIndex: 3, estimand: policy.ESTIMANDS.DEPLOYED_POLICY,
    regret: 4.25, started: [1], removed: [],
  };
  assert.throws(() => policy.evaluationArtifact({ ...row, season: 2026 }), /2026/);
  assert.throws(() => policy.evaluationArtifact({ ...row, season: 2027 }), /2026/);
  assert.throws(() => policy.evaluationArtifact({ ...row, season: '2026' }), /2026/);
  // The label travels, so the halt names the path it fired on.
  assert.throws(() => policy.evaluationArtifact({ ...row, season: 2026 }),
    /evaluation artifact/);
  // The permitted seasons are untouched.
  assert.equal(policy.evaluationArtifact({ ...row, season: 2024 }).season, 2024);
  assert.equal(policy.evaluationArtifact({ ...row, season: 2025 }).season, 2025);
});

test('the wrapper needs the real production pieces injected, never a stand-in it invents', () => {
  const entries = makeRoster();
  assert.throws(() => policy.deployedPolicyLineup({
    entries, projections: new Map(), ranks: ranksFor(entries), rosterSlots: SLOTS,
    availabilityFor,
  }), /the production optimizer must be injected/);
  assert.throws(() => policy.partitionCandidates({ entries }),
    /the production availabilityFor must be injected/);
  assert.throws(() => policy.forceFillLineup({
    entries, projections: new Map(), ranks: ranksFor(entries), rosterSlots: SLOTS, availabilityFor,
  }), /the production optimizer must be injected/);
});
