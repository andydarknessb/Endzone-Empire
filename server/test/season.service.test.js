const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const {
  roundRobinPairings,
  computeStandings,
  pairBySeed,
  getStandings,
} = require('../services/season.service');

// --- roundRobinPairings ---

test('roundRobinPairings: 4 teams, every week pairs everyone exactly once', () => {
  const ids = [1, 2, 3, 4];
  for (let week = 1; week <= 3; week++) {
    const pairings = roundRobinPairings(ids, week);
    assert.equal(pairings.length, 2);
    const seen = pairings.flatMap((p) => [p.home, p.away]).sort();
    assert.deepEqual(seen, [1, 2, 3, 4]);
  }
});

test('roundRobinPairings: 4 teams meet every opponent across 3 weeks', () => {
  const met = new Set();
  for (let week = 1; week <= 3; week++) {
    for (const p of roundRobinPairings([1, 2, 3, 4], week)) {
      met.add([Math.min(p.home, p.away), Math.max(p.home, p.away)].join('-'));
    }
  }
  assert.equal(met.size, 6); // C(4,2)
});

test('roundRobinPairings: odd team count gives one team a bye each week', () => {
  const pairings = roundRobinPairings([1, 2, 3], 1);
  assert.equal(pairings.length, 1);
  const playing = pairings.flatMap((p) => [p.home, p.away]);
  assert.equal(new Set(playing).size, 2);
});

test('roundRobinPairings: schedule repeats with flipped venues on the second cycle', () => {
  const first = roundRobinPairings([1, 2, 3, 4], 1);
  const secondCycle = roundRobinPairings([1, 2, 3, 4], 4); // week 4 = round 1 again
  const key = (p) => [Math.min(p.home, p.away), Math.max(p.home, p.away)].join('-');
  assert.deepEqual(first.map(key).sort(), secondCycle.map(key).sort());
  // same pairings, opposite home teams
  const homes1 = new Set(first.map((p) => p.home));
  for (const p of secondCycle) assert.equal(homes1.has(p.away), true);
});

test('roundRobinPairings: fewer than 2 teams yields no games', () => {
  assert.deepEqual(roundRobinPairings([1], 1), []);
  assert.deepEqual(roundRobinPairings([], 1), []);
});

// --- computeStandings ---

const matchup = (week, home, away, hs, as, extra = {}) => ({
  week,
  home_team_id: home,
  away_team_id: away,
  home_score: hs,
  away_score: as,
  final: true,
  is_playoff: false,
  ...extra,
});

const teams = [
  { id: 1, name: 'A' },
  { id: 2, name: 'B' },
  { id: 3, name: 'C' },
  { id: 4, name: 'D' },
];

test('computeStandings: records, points for/against, and rank order', () => {
  const standings = computeStandings(teams, [
    matchup(1, 1, 2, 100, 90), // A beats B
    matchup(1, 3, 4, 80, 70),  // C beats D
    matchup(2, 1, 3, 110, 95), // A beats C
    matchup(2, 2, 4, 60, 65),  // D beats B
  ]);
  assert.equal(standings[0].teamId, 1);
  assert.deepEqual(
    standings.map((s) => [s.teamId, s.wins, s.losses]),
    [[1, 2, 0], [3, 1, 1], [4, 1, 1], [2, 0, 2]]
  );
  const a = standings.find((s) => s.teamId === 1);
  assert.equal(a.pf, 210);
  assert.equal(a.pa, 185);
  assert.equal(a.rank, 1);
});

test('computeStandings: head-to-head breaks a record tie before points-for', () => {
  // B and C both 1-1. C beat B head-to-head, but B has more total points.
  const standings = computeStandings(teams, [
    matchup(1, 3, 2, 50, 40),   // C beats B (h2h)
    matchup(2, 2, 4, 200, 10),  // B crushes D (big PF)
    matchup(2, 3, 1, 20, 100),  // C loses to A
  ]);
  const b = standings.find((s) => s.teamId === 2);
  const c = standings.find((s) => s.teamId === 3);
  assert.ok(c.rank < b.rank, `expected C (h2h winner) above B, got C=${c.rank} B=${b.rank}`);
});

test('computeStandings: points-for breaks the tie when head-to-head is even', () => {
  const standings = computeStandings(teams, [
    matchup(1, 1, 2, 100, 90), // A beats B
    matchup(2, 2, 1, 105, 90), // B beats A — 1-1 split, B has 195 PF vs A's 190
  ]);
  const one = standings.find((s) => s.teamId === 1);
  const two = standings.find((s) => s.teamId === 2);
  assert.ok(two.rank < one.rank, `expected B (more PF) above A, got B=${two.rank} A=${one.rank}`);
});

test('computeStandings: ties count as half a win and streaks report correctly', () => {
  const standings = computeStandings(teams, [
    matchup(1, 1, 2, 100, 100),
    matchup(2, 1, 3, 110, 90),
    matchup(3, 1, 4, 120, 95),
  ]);
  const a = standings.find((s) => s.teamId === 1);
  assert.equal(a.ties, 1);
  assert.equal(a.streak, 'W2');
  const b = standings.find((s) => s.teamId === 2);
  assert.equal(b.streak, 'T1');
});

test('computeStandings: unfinished and playoff games are excluded', () => {
  const standings = computeStandings(teams, [
    matchup(1, 1, 2, 100, 90, { final: false }),
    matchup(2, 1, 2, 100, 90, { is_playoff: true }),
  ]);
  const a = standings.find((s) => s.teamId === 1);
  assert.equal(a.wins + a.losses + a.ties, 0);
  assert.equal(a.streak, '—');
});

// --- getStandings ---

const serviceTeams = [
  { id: 1, name: 'A', owner: 'owner-a', avatar_url: null, avatar_static_url: null },
  { id: 2, name: 'B', owner: 'owner-b', avatar_url: null, avatar_static_url: null },
];

test('getStandings: single-season league preserves record, rank, points, and streak', async (t) => {
  t.mock.method(pool, 'query', async (sql, params) => {
    assert.deepEqual(params, [44]);
    if (sql.includes('FROM "teams"')) return { rows: serviceTeams };
    return { rows: [matchup(1, 1, 2, 100, 90, { season: 2026 })] };
  });

  const standings = await getStandings({ leagueId: 44 });

  assert.deepEqual(
    standings.map(({ teamId, wins, losses, ties, pf, pa, streak, rank }) => (
      { teamId, wins, losses, ties, pf, pa, streak, rank }
    )),
    [
      { teamId: 1, wins: 1, losses: 0, ties: 0, pf: 100, pa: 90, streak: 'W1', rank: 1 },
      { teamId: 2, wins: 0, losses: 1, ties: 0, pf: 90, pa: 100, streak: 'L1', rank: 2 },
    ]
  );
});

test('getStandings: rolled-over league excludes prior-season matchups', async (t) => {
  const allMatchups = [
    matchup(1, 1, 2, 150, 80, { season: 2025 }),
    matchup(1, 2, 1, 110, 100, { season: 2026 }),
  ];

  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('FROM "teams"')) return { rows: serviceTeams };
    assert.match(sql, /JOIN "leagues" ON "leagues"\."id" = "matchups"\."league_id"/);
    assert.match(sql, /"matchups"\."season" = "leagues"\."current_season"/);
    return { rows: allMatchups.filter((row) => row.season === 2026) };
  });

  const standings = await getStandings({ leagueId: 44 });

  assert.deepEqual(
    standings.map(({ teamId, wins, losses, pf, pa }) => ({ teamId, wins, losses, pf, pa })),
    [
      { teamId: 2, wins: 1, losses: 0, pf: 110, pa: 100 },
      { teamId: 1, wins: 0, losses: 1, pf: 100, pa: 110 },
    ]
  );
});

// --- pairBySeed ---

test('pairBySeed: 4 teams — 1v4 and 2v3, no byes', () => {
  const { games, byes } = pairBySeed([
    { teamId: 10, seed: 1 }, { teamId: 20, seed: 2 },
    { teamId: 30, seed: 3 }, { teamId: 40, seed: 4 },
  ]);
  assert.deepEqual(byes, []);
  assert.deepEqual(games, [{ home: 10, away: 40 }, { home: 20, away: 30 }]);
});

test('pairBySeed: 6 teams — top two seeds bye, 3v6 and 4v5', () => {
  const entrants = [1, 2, 3, 4, 5, 6].map((seed) => ({ teamId: seed * 10, seed }));
  const { games, byes } = pairBySeed(entrants);
  assert.deepEqual(byes, [10, 20]);
  assert.deepEqual(games, [{ home: 30, away: 60 }, { home: 40, away: 50 }]);
});

test('pairBySeed: 2 teams — straight final', () => {
  const { games, byes } = pairBySeed([{ teamId: 1, seed: 1 }, { teamId: 2, seed: 2 }]);
  assert.deepEqual(byes, []);
  assert.deepEqual(games, [{ home: 1, away: 2 }]);
});

test('pairBySeed: 3 teams — top seed bye, 2v3', () => {
  const { games, byes } = pairBySeed([
    { teamId: 1, seed: 1 }, { teamId: 2, seed: 2 }, { teamId: 3, seed: 3 },
  ]);
  assert.deepEqual(byes, [1]);
  assert.deepEqual(games, [{ home: 2, away: 3 }]);
});
