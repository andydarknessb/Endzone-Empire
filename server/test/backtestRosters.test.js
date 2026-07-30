const test = require('node:test');
const assert = require('node:assert/strict');

const rosters = require('../../scripts/backtest/lib/rosters');
const naive = require('../../scripts/backtest/lib/naive');

/**
 * A full 160-candidate pool at the preregistered quotas, scored so that ranks
 * are unambiguous. Model-independent by construction: the score is a fixed
 * function of the index, not of any arm.
 */
function makePool() {
  const candidates = [];
  let id = 1;
  for (const [position, quota] of Object.entries(rosters.CANDIDATE_QUOTAS)) {
    // Build MORE than the quota so pool selection has something to cut.
    for (let i = 0; i < quota + 3; i++) {
      candidates.push({
        playerId: id,
        teamKey: `T${id % 32}`,
        position,
        isDefense: position === 'DEF',
        score: 1000 - id,
      });
      id++;
    }
  }
  return candidates;
}

function ranks(candidates) {
  const positionRank = new Map(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p, i) => [p, i + 1]));
  const nameRankById = new Map(candidates.map((c) => [c.playerId, c.playerId]));
  return { positionRank, nameRankById };
}

function buildWeek(season = 2025, week = 3) {
  const candidates = makePool();
  const { positionRank, nameRankById } = ranks(candidates);
  return rosters.buildRosterWeek({ season, week, candidates, positionRank, nameRankById });
}

// ---------------------------------------------------------------------------
// THE SLOT-COUNT GUARD
// ---------------------------------------------------------------------------

test('the starting-slot count is the SUM of slot.count (9), never the slot kinds (7)', () => {
  // The legacy harness this study replaces graded nine-slot lineups as though
  // they had seven, and that is one of the four defects that invalidated
  // free_baseline_v3.1's constants. RB and WR each carry count: 2.
  assert.equal(rosters.startingSlotCount(), 9);
  assert.equal(rosters.DEFAULT_ROSTER_SLOTS.length, 7, 'there really are only 7 slot KINDS');
  assert.notEqual(rosters.startingSlotCount(), rosters.DEFAULT_ROSTER_SLOTS.length);
  assert.equal(rosters.rosterSize(), 16, '9 starters + 7 bench');
  assert.equal(rosters.rosterSize(), rosters.TEAM_COUNT * rosters.ROUNDS / rosters.TEAM_COUNT);

  // The sum is what the arithmetic of the whole design rests on.
  assert.equal(rosters.TEAM_COUNT * rosters.rosterSize(),
    Object.values(rosters.CANDIDATE_QUOTAS).reduce((a, b) => a + b, 0),
    'ten 16-man rosters exactly exhaust the 160-candidate pool');
  assert.equal(Object.values(rosters.PER_TEAM_CAPS).reduce((a, b) => a + b, 0), 16);

  // And it is computed, not hardcoded: a shape with different counts moves it.
  assert.equal(rosters.startingSlotCount([
    { key: 'QB', count: 1, eligiblePositions: ['QB'] },
    { key: 'RB', count: 3, eligiblePositions: ['RB'] },
  ]), 4, 'two slot kinds, four starting slots');
});

test('the initial fill order has one entry per STARTING SLOT, not per slot kind', () => {
  assert.equal(rosters.INITIAL_FILL_ORDER.length, rosters.startingSlotCount());
  assert.deepEqual([...rosters.INITIAL_FILL_ORDER],
    ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']);
  // RB and WR appear twice precisely because their count is 2. A .length-based
  // fill order would list each once and leave two starters unfilled.
  assert.equal(rosters.INITIAL_FILL_ORDER.filter((s) => s === 'RB').length, 2);
  assert.equal(rosters.INITIAL_FILL_ORDER.filter((s) => s === 'WR').length, 2);
});

test('a roster shape whose fill order disagrees with the slot sum is refused', () => {
  // This is the guard the 9-slot mutant trips: swap the sum for .length and the
  // fill order no longer matches, so lineups cannot be built at all.
  const sevenSlotShape = rosters.DEFAULT_ROSTER_SLOTS.map((s) => ({ ...s, count: 1 }));
  assert.equal(rosters.startingSlotCount(sevenSlotShape), 7);
  const week = buildWeek();
  const roster = week.rosters[0];
  assert.throws(() => rosters.initialLineup({
    roster: roster.players.map((p, i) => ({ ...p, score: 100 - i, positionRank: 1, nameRank: i })),
    rosterSlots: sevenSlotShape,
  }), /the fill order has 9 entries but the roster has 7 starting slots/);
});

// ---------------------------------------------------------------------------
// The preregistered constants
// ---------------------------------------------------------------------------

test('every roster constant matches the sealed preregistration', () => {
  assert.equal(rosters.ROSTER_SEED, 1357931762);
  assert.deepEqual(rosters.CANDIDATE_QUOTAS, { QB: 20, RB: 50, WR: 50, TE: 20, K: 10, DEF: 10 });
  assert.deepEqual(rosters.PER_TEAM_CAPS, { QB: 2, RB: 5, WR: 5, TE: 2, K: 1, DEF: 1 });
  assert.equal(rosters.TEAM_COUNT, 10);
  assert.equal(rosters.ROUNDS, 16);
  assert.equal(rosters.REPLICATES, 5);
  assert.equal(rosters.BENCH_SLOTS, 7);
  assert.equal(rosters.IR_SLOTS, 0);
  assert.equal(rosters.RECENCY_HALF_LIFE_WEEKS, 8);
});

// ---------------------------------------------------------------------------
// The model-independent ranking
// ---------------------------------------------------------------------------

test('the ranking is a recency-weighted mean with the preregistered weight', () => {
  const priorGames = [
    { season: 2025, week: 2, points: 20 }, // 1 week ago  -> 0.5^(1/8)
    { season: 2025, week: 1, points: 10 }, // 2 weeks ago -> 0.5^(2/8)
  ];
  const result = rosters.recencyWeightedScore({ priorGames, season: 2025, week: 3 });
  const w1 = Math.pow(0.5, 1 / 8);
  const w2 = Math.pow(0.5, 2 / 8);
  assert.equal(result.games, 2);
  assert.ok(Math.abs(result.score - ((20 * w1 + 10 * w2) / (w1 + w2))) < 1e-12);
  // More recent games weigh more, so the score sits above the plain mean of 15.
  assert.ok(result.score > 15);
});

test('the ranking honours the two-season window, the cutoff, and the one-game gate', () => {
  const score = (priorGames) => rosters.recencyWeightedScore({ priorGames, season: 2025, week: 3 });
  // Three seasons back is outside the window.
  assert.equal(score([{ season: 2022, week: 1, points: 99 }]), null);
  // Exactly two seasons back is INSIDE it.
  assert.ok(score([{ season: 2023, week: 1, points: 99 }]).games === 1);
  // The target week itself, and anything after it, is never prior.
  assert.equal(score([{ season: 2025, week: 3, points: 99 }]), null);
  assert.equal(score([{ season: 2025, week: 9, points: 99 }]), null);
  // No prior game at all: not rankable, and null rather than a zero that would
  // still sort him onto the board.
  assert.equal(score([]), null);
  assert.equal(score([{ season: 2025, week: 1, points: 'nope' }]), null);
});

test('ties break by position rank, then name rank, then id - never arbitrarily', () => {
  const candidates = [
    { playerId: 3, position: 'RB', score: 10 },
    { playerId: 1, position: 'QB', score: 10 },
    { playerId: 2, position: 'QB', score: 10 },
    { playerId: 4, position: 'QB', score: 11 },
  ];
  const positionRank = new Map([['QB', 1], ['RB', 2]]);
  const nameRankById = new Map([[1, 50], [2, 40], [3, 10], [4, 5]]);
  const ranked = rosters.rankCandidates({ candidates, positionRank, nameRankById });
  assert.deepEqual(ranked.map((c) => c.playerId), [4, 2, 1, 3]);
  //  4 first on score; then the QBs by NAME rank (2 before 1); RB last by
  //  position rank despite the same score.
});

test('an unranked position or player fails closed, because order would be arbitrary', () => {
  const positionRank = new Map([['QB', 1]]);
  assert.throws(() => rosters.rankCandidates({
    candidates: [{ playerId: 1, position: 'RB', score: 1 }],
    positionRank,
    nameRankById: new Map([[1, 1]]),
  }), /position "RB" has no captured rank/);
  assert.throws(() => rosters.rankCandidates({
    candidates: [{ playerId: 1, position: 'QB', score: 1 }],
    positionRank,
    nameRankById: new Map(),
  }), /player 1 has no captured name rank/);
  // A DEF pseudo-player legitimately has no name rank and must NOT fail.
  assert.doesNotThrow(() => rosters.rankCandidates({
    candidates: [{ teamKey: 'KC', position: 'DEF', isDefense: true, score: 1 }],
    positionRank: new Map([['DEF', 6]]),
    nameRankById: new Map(),
  }));
});

test('the candidate pool takes exactly the quota per position and fails closed when short', () => {
  const candidates = makePool();
  const { positionRank, nameRankById } = ranks(candidates);
  const ranked = rosters.rankCandidates({ candidates, positionRank, nameRankById });
  const pool = rosters.selectCandidatePool({ ranked });
  assert.equal(pool.length, 160);
  for (const [position, quota] of Object.entries(rosters.CANDIDATE_QUOTAS)) {
    assert.equal(pool.filter((c) => c.position === position).length, quota, `${position} quota`);
  }
  // A short position would produce illegal rosters at the end of the draft
  // rather than an error, so it is an error.
  const short = ranked.filter((c) => c.position !== 'K').concat(
    ranked.filter((c) => c.position === 'K').slice(0, 3)
  );
  assert.throws(() => rosters.selectCandidatePool({ ranked: short }),
    /short at K \(3 of 10\).*exhaust a full pool/s);
});

test('the pool comes back in GLOBAL rank order, not grouped by position', () => {
  // The quotas are applied per position, so the pool is necessarily BUILT
  // position by position - but the draft's rule is "the highest-ranked
  // remaining player the caps allow", and snakeDraft reads that as this
  // array's order. Grouped order would quietly mean "the best player in the
  // first position group with room", which is a different board entirely.
  //
  // The fixture interleaves positions through the ranking so grouped and
  // global order genuinely differ (the earlier fixture gave QBs the top
  // scores, which hid this).
  const candidates = [];
  let id = 1;
  for (const [position, quota] of Object.entries(rosters.CANDIDATE_QUOTAS)) {
    for (let i = 0; i < quota; i++) {
      candidates.push({
        playerId: id,
        teamKey: `T${id}`,
        position,
        isDefense: position === 'DEF',
        // Interleave: score depends on the within-position index, so every
        // position has entries near the top and near the bottom.
        score: 1000 - (i * 10) - Object.keys(rosters.CANDIDATE_QUOTAS).indexOf(position),
      });
      id++;
    }
  }
  const { positionRank, nameRankById } = ranks(candidates);
  const ranked = rosters.rankCandidates({ candidates, positionRank, nameRankById });
  const pool = rosters.selectCandidatePool({ ranked });

  assert.equal(pool.length, 160);
  for (let i = 1; i < pool.length; i++) {
    assert.ok(pool[i - 1].score >= pool[i].score,
      `pool position ${i} (${pool[i].score}) outranks its predecessor (${pool[i - 1].score})`);
  }
  // And the fixture really does interleave, or the assertion above is vacuous.
  const firstTwelve = pool.slice(0, 12).map((c) => c.position);
  assert.ok(new Set(firstTwelve).size > 1,
    'the top of the pool must mix positions for this test to mean anything');
});

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

test('the draft produces 50 legal 16-man rosters per season-week', () => {
  const week = buildWeek();
  assert.equal(week.rosters.length, 50, '10 teams x 5 replicates');
  assert.equal(week.poolSize, 160);
  for (const roster of week.rosters) {
    assert.equal(roster.players.length, 16);
    for (const [position, cap] of Object.entries(rosters.PER_TEAM_CAPS)) {
      assert.equal(roster.players.filter((p) => p.position === position).length, cap,
        `every roster holds exactly ${cap} ${position}`);
    }
  }
  // Within one replicate every candidate is drafted exactly once.
  const replicateZero = week.rosters.filter((r) => r.replicate === 0);
  const drafted = replicateZero.flatMap((r) => r.players.map((p) => p.playerId ?? p.teamKey));
  assert.equal(drafted.length, 160);
  assert.equal(new Set(drafted).size, 160, 'no candidate is drafted twice');
});

test('the draft is deterministic and seeded, and differs across replicates', () => {
  const a = buildWeek(2025, 3);
  const b = buildWeek(2025, 3);
  assert.equal(rosters.freezeHash(a), rosters.freezeHash(b), 'same inputs, same artifact');

  // Different replicates get a different seeded draft order, so the rosters
  // differ - that is what makes five replicates worth running.
  const r0 = a.rosters.filter((r) => r.replicate === 0).map((r) => r.players.map((p) => p.playerId));
  const r1 = a.rosters.filter((r) => r.replicate === 1).map((r) => r.players.map((p) => p.playerId));
  assert.notDeepEqual(r0, r1);

  // A different week is a different artifact.
  assert.notEqual(rosters.freezeHash(a), rosters.freezeHash(buildWeek(2025, 4)));
  assert.notEqual(rosters.freezeHash(a), rosters.freezeHash(buildWeek(2024, 3)));
});

test('the freeze hash moves when a single pick changes, and not otherwise', () => {
  const week = buildWeek();
  const hash = rosters.freezeHash(week);
  assert.match(hash, /^[0-9a-f]{64}$/);
  // Key order and formatting cannot move it (canonical serialization).
  const reordered = {
    week: week.week,
    season: week.season,
    rosters: week.rosters.map((r) => ({ bench: r.bench, players: r.players, starters: r.starters, teamIndex: r.teamIndex, draftSlot: r.draftSlot, replicate: r.replicate })),
  };
  assert.equal(rosters.freezeHash(reordered), hash);
  // One swapped player does move it.
  const tampered = JSON.parse(JSON.stringify(week));
  tampered.rosters[0].players[0].playerId += 1000;
  assert.notEqual(rosters.freezeHash(tampered), hash);
});

test('the per-team caps bind during the draft and are re-checked after it', () => {
  // With the caps ignored while picking, a globally rank-ordered pool lets the
  // early slots hoard whatever is best regardless of position, and the
  // post-draft check is what turns that into an error instead of an illegal
  // roster. Both halves are exercised here.
  const candidates = [];
  let id = 1;
  for (const [position, quota] of Object.entries(rosters.CANDIDATE_QUOTAS)) {
    for (let i = 0; i < quota; i++) {
      candidates.push({
        playerId: id,
        teamKey: `T${id}`,
        position,
        isDefense: position === 'DEF',
        score: 1000 - (i * 10) - Object.keys(rosters.CANDIDATE_QUOTAS).indexOf(position),
      });
      id++;
    }
  }
  const { positionRank, nameRankById } = ranks(candidates);
  const pool = rosters.selectCandidatePool({
    ranked: rosters.rankCandidates({ candidates, positionRank, nameRankById }),
  });
  const teams = rosters.snakeDraft({ pool, season: 2025, week: 3, replicate: 0 });
  for (const team of teams) {
    for (const [position, cap] of Object.entries(rosters.PER_TEAM_CAPS)) {
      assert.equal(team.picks.filter((p) => p.position === position).length, cap,
        `team ${team.teamIndex} holds exactly ${cap} ${position}`);
    }
  }
  // A cap that cannot be met is an error, not a best-effort roster. Two
  // distinct failures, and both must be caught:
  //
  // (a) caps too TIGHT to fill 16 rounds - a pick has nowhere legal to go.
  assert.throws(() => rosters.snakeDraft({
    pool, season: 2025, week: 3, replicate: 0, caps: { ...rosters.PER_TEAM_CAPS, QB: 1 },
  }), /no legal pick in round/);

  // (b) caps too LOOSE - they sum above 16, so the draft completes but some
  //     team ends below a cap. Only the POST-DRAFT check can see this: every
  //     individual pick was legal. This is what "the caps exactly exhaust the
  //     pool" means, and why it is verified rather than assumed.
  assert.throws(() => rosters.snakeDraft({
    pool, season: 2025, week: 3, replicate: 0, caps: { ...rosters.PER_TEAM_CAPS, RB: 6 },
  }), /holds \d+ RB, the cap is 6.*exactly exhaust the pool/s);
});

test('the draft refuses a pool that is not in rank order', () => {
  // The draft reads array order as rank. A pool still grouped by position, or
  // one a caller shuffled, would silently mean "the best player in the first
  // position group with room" - a different board. Asserted rather than
  // re-sorted, so the tie-break comparator lives in exactly one place.
  const candidates = makePool();
  const { positionRank, nameRankById } = ranks(candidates);
  const pool = rosters.selectCandidatePool({
    ranked: rosters.rankCandidates({ candidates, positionRank, nameRankById }),
  });
  assert.doesNotThrow(() => rosters.snakeDraft({ pool, season: 2025, week: 3, replicate: 0 }));

  const shuffled = [...pool];
  [shuffled[0], shuffled[80]] = [shuffled[80], shuffled[0]];
  assert.throws(() => rosters.snakeDraft({ pool: shuffled, season: 2025, week: 3, replicate: 0 }),
    /the candidate pool is not in rank order at index \d+.*a different board/s);

  // The realistic fault: grouped by position rather than globally ranked.
  const grouped = [...pool].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  assert.throws(() => rosters.snakeDraft({ pool: grouped, season: 2025, week: 3, replicate: 0 }),
    /not in rank order/);
});

test('a roster of the wrong size is refused rather than benched short', () => {
  // Rosters are legal by construction, so a bench that is not exactly seven
  // means the caps and the roster shape have drifted apart.
  const fifteen = [
    { playerId: 1, position: 'QB', score: 100, positionRank: 1, nameRank: 1 },
    ...Array.from({ length: 5 }, (unused, i) => ({ playerId: 10 + i, position: 'RB', score: 90 - i, positionRank: 2, nameRank: i })),
    ...Array.from({ length: 5 }, (unused, i) => ({ playerId: 20 + i, position: 'WR', score: 80 - i, positionRank: 3, nameRank: i })),
    ...Array.from({ length: 2 }, (unused, i) => ({ playerId: 30 + i, position: 'TE', score: 70 - i, positionRank: 4, nameRank: i })),
    { playerId: 40, position: 'K', score: 60, positionRank: 5, nameRank: 40 },
    { playerId: 41, position: 'DEF', score: 50, positionRank: 6, nameRank: null, isDefense: true },
  ];
  assert.equal(fifteen.length, 15);
  assert.throws(() => rosters.initialLineup({ roster: fifteen }),
    /6 players on the bench, expected 7/);

  // Seventeen is equally wrong, in the other direction.
  assert.throws(() => rosters.initialLineup({
    roster: [...fifteen,
      { playerId: 42, position: 'RB', score: 40, positionRank: 2, nameRank: 42 },
      { playerId: 43, position: 'WR', score: 30, positionRank: 3, nameRank: 43 }],
  }), /8 players on the bench, expected 7/);
});

test('the snake really snakes: round two runs in reverse draft order', () => {
  const candidates = makePool();
  const { positionRank, nameRankById } = ranks(candidates);
  const pool = rosters.selectCandidatePool({
    ranked: rosters.rankCandidates({ candidates, positionRank, nameRankById }),
  });
  const teams = rosters.snakeDraft({ pool, season: 2025, week: 3, replicate: 0 });
  const bySlot = [...teams].sort((a, b) => a.draftSlot - b.draftSlot);
  // The team picking first in round 1 picks LAST in round 2, so its second
  // pick is worse than the last team's second pick.
  const firstTeam = bySlot[0];
  const lastTeam = bySlot[bySlot.length - 1];
  assert.ok(firstTeam.picks[0].score > lastTeam.picks[0].score, 'round 1 favours the first slot');
  assert.ok(lastTeam.picks[1].score > firstTeam.picks[1].score, 'round 2 reverses it');
});

// ---------------------------------------------------------------------------
// The initial lineup
// ---------------------------------------------------------------------------

test('the initial lineup fills nine starters in the fixed order and benches seven', () => {
  const week = buildWeek();
  for (const roster of week.rosters) {
    assert.equal(roster.starters.length, 9, 'nine starting slots, not seven');
    assert.equal(roster.bench.length, 7);
    assert.deepEqual(roster.starters.map((s) => s.slot), [...rosters.INITIAL_FILL_ORDER]);
    // Every starter is eligible for the slot it fills.
    for (const starter of roster.starters) {
      const slot = rosters.DEFAULT_ROSTER_SLOTS.find((s) => s.key === starter.slot);
      assert.ok(slot.eligiblePositions.includes(starter.position),
        `${starter.position} is eligible for ${starter.slot}`);
    }
    // Starters and bench partition the roster exactly.
    const all = [...roster.starters, ...roster.bench].map((p) => p.playerId ?? p.teamKey);
    assert.equal(new Set(all).size, 16);
  }
});

test('the initial lineup is model-independent and deterministic', () => {
  const a = buildWeek();
  const b = buildWeek();
  assert.deepEqual(
    a.rosters.map((r) => r.starters.map((s) => `${s.slot}:${s.playerId ?? s.teamKey}`)),
    b.rosters.map((r) => r.starters.map((s) => `${s.slot}:${s.playerId ?? s.teamKey}`))
  );
  // FLEX takes the best remaining RB/WR/TE, which is the highest-ranked player
  // left after the dedicated slots - a fact about the RANKING, not any model.
  const roster = a.rosters[0];
  const flex = roster.starters.find((s) => s.slot === 'FLEX');
  assert.ok(['RB', 'WR', 'TE'].includes(flex.position));
});

test('an impossible lineup is an error rather than a partially filled one', () => {
  // A roster with no kicker cannot fill the K slot. Rosters are legal by
  // construction, so reaching this means the caps and shape have drifted.
  const roster = Array.from({ length: 16 }, (unused, i) => ({
    playerId: i + 1, position: 'RB', score: 100 - i, positionRank: 2, nameRank: i,
  }));
  // The fill order starts at QB, so that is where an all-RB roster stops.
  assert.throws(() => rosters.initialLineup({ roster }),
    /no eligible unassigned player for slot QB.*legal by construction/s);

  // And one that gets further: enough for QB/RB/WR/TE/FLEX but no kicker.
  const noKicker = [
    { playerId: 1, position: 'QB', score: 100, positionRank: 1, nameRank: 1 },
    ...Array.from({ length: 5 }, (unused, i) => ({ playerId: 10 + i, position: 'RB', score: 90 - i, positionRank: 2, nameRank: i })),
    ...Array.from({ length: 5 }, (unused, i) => ({ playerId: 20 + i, position: 'WR', score: 80 - i, positionRank: 3, nameRank: i })),
    ...Array.from({ length: 2 }, (unused, i) => ({ playerId: 30 + i, position: 'TE', score: 70 - i, positionRank: 4, nameRank: i })),
    { playerId: 40, position: 'DEF', score: 60, positionRank: 6, nameRank: null, isDefense: true },
  ];
  assert.throws(() => rosters.initialLineup({ roster: noKicker }),
    /no eligible unassigned player for slot K/);
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

test('seeding is derived from the roster seed and never touches a global RNG', () => {
  assert.equal(rosters.seedFor('draft-order', 2025, 3, 0), rosters.seedFor('draft-order', 2025, 3, 0));
  assert.notEqual(rosters.seedFor('draft-order', 2025, 3, 0), rosters.seedFor('draft-order', 2025, 3, 1));
  assert.notEqual(rosters.seedFor('draft-order', 2025, 3, 0), rosters.seedFor('draft-order', 2025, 4, 0));

  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const p1 = rosters.seededPermutation(items, 12345);
  const p2 = rosters.seededPermutation(items, 12345);
  assert.deepEqual(p1, p2, 'the same seed gives the same permutation');
  assert.deepEqual([...p1].sort((a, b) => a - b), items, 'it is a permutation, not a sample');
  assert.notDeepEqual(p1, rosters.seededPermutation(items, 999));
  assert.deepEqual(items, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'the input is never mutated');

  // No Math.random anywhere in the module: the artifacts are committed and must
  // regenerate byte-identically on another machine.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', 'rosters.js'), 'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/Math\.random/.test(src));
  assert.ok(!/Date\.now|new Date\(/.test(src), 'and no clock either');
});

// ---------------------------------------------------------------------------
// The benchmarks
// ---------------------------------------------------------------------------

test('naive-recency is the recency-weighted mean, with exact preregistered weights', () => {
  const priorGames = [
    { season: 2025, week: 2, points: 20 },
    { season: 2025, week: 1, points: 10 },
  ];
  const projection = naive.naiveRecency({ playerId: 7, priorGames, season: 2025, week: 3 });
  const w1 = Math.pow(0.5, 1 / 8);
  const w2 = Math.pow(0.5, 2 / 8);
  assert.ok(Math.abs(projection.median - ((20 * w1 + 10 * w2) / (w1 + w2))) < 1e-12);
  assert.equal(projection.median, projection.mean, 'a point estimator has one number');
  assert.equal(projection.benchmark, 'naive-recency');
  assert.equal(projection.sampleSize, 2);
});

test('the benchmarks emit NO intervals, which is what makes coverage and WIS skip them', () => {
  const projection = naive.naiveRecency({
    playerId: 1, priorGames: [{ season: 2025, week: 1, points: 5 }], season: 2025, week: 3,
  });
  for (const key of ['p10', 'p25', 'p75', 'p90']) {
    assert.equal(projection[key], null, `${key} must be null - there is no distribution`);
  }
  assert.equal(projection.activeProbability, null);
  assert.equal(projection.factors, null);
});

test('the at-least-one-prior-game gate yields null, never a confident zero', () => {
  const none = naive.naiveRecency({ playerId: 1, priorGames: [], season: 2025, week: 3 });
  assert.equal(none.median, null);
  assert.equal(none.sampleSize, 0);
  assert.equal(none.confidence, 'none');
  // Out-of-window history does not satisfy the gate either.
  assert.equal(naive.naiveRecency({
    playerId: 1, priorGames: [{ season: 2022, week: 1, points: 50 }], season: 2025, week: 3,
  }).median, null);
});

test('the window boundaries are the same as the ranking\'s, to the week', () => {
  const at = (season, week) => naive.naiveRecency({
    playerId: 1, priorGames: [{ season, week, points: 12 }], season: 2025, week: 3,
  }).median;
  assert.equal(at(2023, 18), 12, 'two seasons back is inside the window');
  assert.equal(at(2022, 18), null, 'three is outside it');
  assert.equal(at(2025, 2), 12, 'the week before the target counts');
  assert.equal(at(2025, 3), null, 'the target week itself never counts');
  assert.equal(at(2025, 4), null, 'nor does anything after it');
});

test('usage-signal uses only usage-bearing games, and a stored zero IS usage', () => {
  const priorGames = [
    { season: 2025, week: 1, points: 30, usage: { carries: 20, passAttempts: null, targets: null } },
    { season: 2025, week: 2, points: 10, usage: { carries: null, passAttempts: null, targets: null } },
  ];
  // naive-recency sees both games; usage-signal sees only the first.
  assert.equal(naive.naiveRecency({ playerId: 1, priorGames, season: 2025, week: 3 }).sampleSize, 2);
  const usage = naive.usageSignal({ playerId: 1, priorGames, season: 2025, week: 3 });
  assert.equal(usage.sampleSize, 1);
  assert.equal(usage.median, 30, 'only the usage-bearing game contributes');
  assert.equal(usage.benchmark, 'usage-signal');

  // A stored 0 is a measurement (he dressed and touched the ball zero times),
  // so it counts as usage-bearing; an absent key does not.
  assert.equal(naive.isUsageBearing({ usage: { carries: 0 } }), true);
  assert.equal(naive.isUsageBearing({ usage: { carries: null, passAttempts: null, targets: null } }), false);
  assert.equal(naive.isUsageBearing({ usage: {} }), false);
  assert.equal(naive.isUsageBearing({}), false);
  assert.equal(naive.isUsageBearing({ usage: { targets: 3 } }), true);

  // With no usage-bearing game at all, the gate yields null.
  assert.equal(naive.usageSignal({
    playerId: 1, priorGames: [priorGames[1]], season: 2025, week: 3,
  }).median, null);
});

test('neither benchmark lets a caller substitute its own filter', () => {
  // `naive-recency` is DEFINED over every prior game in the window. A caller
  // who could pass a filter could publish a filtered estimator under the
  // benchmark's name, and the report would call it naive-recency.
  const priorGames = [{ season: 2025, week: 1, points: 8, usage: { targets: 4 } }];
  assert.throws(() => naive.naiveRecency({
    playerId: 1, priorGames, season: 2025, week: 3, filter: () => false,
  }), /does not accept a filter.*usageSignal.*is the preregistered one/s);
  // usage-signal's filter is fixed too: it is the definition, not a parameter.
  assert.throws(() => naive.usageSignal({
    playerId: 1, priorGames, season: 2025, week: 3, filter: () => true,
  }), /filter is fixed to usage-bearing games and cannot be overridden/);
  // Without one, both still work.
  assert.equal(naive.naiveRecency({ playerId: 1, priorGames, season: 2025, week: 3 }).median, 8);
  assert.equal(naive.usageSignal({ playerId: 1, priorGames, season: 2025, week: 3 }).median, 8);
});

test('both benchmarks come back together, in the fixed report order', () => {
  const both = naive.benchmarksFor({
    playerId: 1,
    priorGames: [{ season: 2025, week: 1, points: 8, usage: { targets: 4 } }],
    season: 2025,
    week: 3,
  });
  assert.deepEqual(Object.keys(both), ['naive-recency', 'usage-signal']);
  assert.equal(both['naive-recency'].median, 8);
  assert.equal(both['usage-signal'].median, 8);
});
