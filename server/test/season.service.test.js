const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const {
  roundRobinPairings,
  computeStandings,
  pairBySeed,
  getStandings,
  getPlayoffSeeds,
  finalizeWeekAndAdvance,
  playoffRounds,
  lastPlayoffWeek,
} = require('../services/season.service');
const lineupService = require('../services/lineup.service');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');

// --- playoffRounds / lastPlayoffWeek (#1305) ---

test('playoffRounds: fewer than two playoff teams play no bracket at all', () => {
  assert.equal(playoffRounds(0), 0);
  assert.equal(playoffRounds(1), 0);
  assert.equal(playoffRounds(null), 0);
  assert.equal(playoffRounds(undefined), 0);
});

test('playoffRounds: each round halves the field to one champion', () => {
  assert.equal(playoffRounds(2), 1);
  assert.equal(playoffRounds(4), 2);
  assert.equal(playoffRounds(6), 3, 'byes in round one still cost a full round');
  assert.equal(playoffRounds(8), 3);
});

test('lastPlayoffWeek: two leagues with different playoff lengths end on different weeks', () => {
  assert.equal(
    lastPlayoffWeek({ regular_season_weeks: 14, playoff_teams: 4 }),
    16,
    '14 regular weeks + 2 rounds'
  );
  assert.equal(
    lastPlayoffWeek({ regular_season_weeks: 14, playoff_teams: 8 }),
    17,
    '14 regular weeks + 3 rounds: the SAME regular season, a longer bracket'
  );
  assert.equal(
    lastPlayoffWeek({ regular_season_weeks: 13, playoff_teams: 2 }),
    14,
    '13 regular weeks + 1 round: a shorter regular season AND a shorter bracket'
  );
});

test('lastPlayoffWeek: no playoff bracket ends the season at the last regular week', () => {
  assert.equal(lastPlayoffWeek({ regular_season_weeks: 14, playoff_teams: 0 }), 14);
});

test('lastPlayoffWeek: a missing or malformed league fails closed to 0, never NaN', () => {
  assert.equal(lastPlayoffWeek(null), 0);
  assert.equal(lastPlayoffWeek({}), 0);
});

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
  assert.equal(a.streak, '-');
});

// --- getStandings ---

const serviceTeams = [
  { id: 1, name: 'A', avatar_url: null, avatar_static_url: null },
  { id: 2, name: 'B', avatar_url: null, avatar_static_url: null },
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

// --- Playoff seeds lock when the bracket is created (#2547) ---

// Six Teams, four Playoff teams, a three-week regular season. Before the
// last-week flip: T1 3-0, T3 and T2 2-1, T5 and T4 1-2 (T5 ahead on points),
// T6 0-3, so the bracket seeds T1, T3, T2, T5 and T4 misses by one place.
const SEED_TEAMS = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `T${id}`, owner_id: id }));
const seedMatchup = (id, week, home, away, hs, as) => ({
  id, league_id: 1, season: 2026, week, home_team_id: home, away_team_id: away,
  home_score: hs, away_score: as, final: week < 3 || id < 0, is_playoff: false,
});

function seedWorld() {
  const world = {
    league: {
      id: 1, draft_status: 'complete', season_status: 'regular', current_season: 2026,
      current_week: 3, regular_season_weeks: 3, playoff_teams: 4, playoff_consolation: false,
      best_ball: false,
    },
    matchups: [
      seedMatchup(11, 1, 1, 2, 100, 60), seedMatchup(12, 1, 3, 4, 90, 70), seedMatchup(13, 1, 5, 6, 81, 75),
      seedMatchup(21, 2, 1, 3, 100, 70), seedMatchup(22, 2, 2, 5, 95, 65), seedMatchup(23, 2, 4, 6, 85, 60),
      seedMatchup(31, 3, 1, 4, 110, 60), seedMatchup(32, 3, 3, 5, 88, 70), seedMatchup(33, 3, 2, 6, 92, 55),
    ].map((m) => ({ ...m, final: m.week < 3 })),
    seeds: [],
  };
  world.pool = createFakePool([
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [] })],
    [/^INSERT INTO "(transactions|notifications)"/, () => ({ rows: [] })],
    [select('leagues'), () => ({ rows: [{ ...world.league }] })],
    [select('teams'), () => ({ rows: SEED_TEAMS })],
    [select('matchups'), (text, params) => {
      const rows = world.matchups.filter((m) => params.length < 3 || m.week === Number(params[2]));
      return { rows: rows.map((m) => ({ ...m })) };
    }],
    [select('playoff_seeds'), () => ({
      rows: [...world.seeds].sort((a, b) => a.seed - b.seed).map((s) => ({ team_id: s.teamId, seed: s.seed })),
    })],
    [insert('playoff_seeds'), (text, params) => {
      params[2].forEach((teamId, i) => world.seeds.push({ teamId, seed: params[3][i] }));
      return { rows: [] };
    }],
    [/^UPDATE "matchups" SET "final"/, (text, params) => {
      world.matchups.filter((m) => m.week === Number(params[2])).forEach((m) => { m.final = true; });
      return { rows: [] };
    }],
    [insert('matchups'), (text, params) => {
      world.matchups.push({
        id: 100 + world.matchups.length, league_id: 1, season: 2026, week: params[2],
        home_team_id: params[3], away_team_id: params[4], home_score: 0, away_score: 0,
        final: false, is_playoff: true, playoff_round: params[5] ?? 1,
      });
      return { rows: [] };
    }],
    [update('teams'), () => ({ rows: [] })],
    [update('leagues'), (text, params) => {
      world.league.current_week = params[0];
      if (text.includes("'playoffs'")) world.league.season_status = 'playoffs';
      return { rows: [] };
    }],
  ]);
  return world;
}

test('bracket creation stores one seed per playoff Team, byes included', async (t) => {
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  const world = seedWorld();
  world.league.playoff_teams = 6;
  world.pool.install(t);

  await finalizeWeekAndAdvance({ leagueId: 1 });

  assert.deepEqual(
    [...world.seeds].sort((a, b) => a.seed - b.seed),
    [{ teamId: 1, seed: 1 }, { teamId: 3, seed: 2 }, { teamId: 2, seed: 3 }, { teamId: 5, seed: 4 }, { teamId: 4, seed: 5 }, { teamId: 6, seed: 6 }],
    'seeds 1 and 2 have a first-round bye and still hold a row'
  );
  world.pool.assertClean();
});

test('a regular-season correction after seeding never changes who advances', async (t) => {
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  const world = seedWorld();
  world.pool.install(t);

  await finalizeWeekAndAdvance({ leagueId: 1 });
  assert.equal(world.league.season_status, 'playoffs');
  const round1 = world.matchups.filter((m) => m.is_playoff && m.week === 4);
  assert.deepEqual(round1.map((m) => [m.home_team_id, m.away_team_id]), [[1, 5], [3, 2]]);

  // The correction: T4 beat T1 in the last week. T4, who missed the bracket,
  // now sits in the top four of the live standings.
  const lastWeek = world.matchups.find((m) => m.id === 31);
  [lastWeek.home_score, lastWeek.away_score] = [60, 110];
  const live = computeStandings(SEED_TEAMS, world.matchups).slice(0, 4).map((s) => s.teamId);
  assert.ok(live.includes(4) && !live.includes(5), `precondition: live top four ${live}`);

  // The higher seeds win round 1.
  round1.forEach((m) => { m.home_score = 100; m.away_score = 50; });
  const outcome = await finalizeWeekAndAdvance({ leagueId: 1 });

  const round2 = world.matchups.filter((m) => m.is_playoff && m.week === 5);
  assert.deepEqual(
    round2.map((m) => [m.home_team_id, m.away_team_id]),
    [[1, 3]],
    'the two round-1 winners meet; the correction adds no third advancer'
  );
  assert.equal(outcome.playoffRound, 2);
  world.pool.assertClean();
});

test('stored byes advance without playing: a 6-Team bracket re-pairs the winners with seeds 1 and 2', async (t) => {
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  const world = seedWorld();
  world.league.playoff_teams = 6;
  world.pool.install(t);

  await finalizeWeekAndAdvance({ leagueId: 1 });
  const round1 = world.matchups.filter((m) => m.is_playoff && m.week === 4);
  assert.deepEqual(round1.map((m) => [m.home_team_id, m.away_team_id]), [[2, 6], [5, 4]], 'seeds 1 and 2 are on the bye');
  round1.forEach((m) => { m.home_score = 100; m.away_score = 50; });
  await finalizeWeekAndAdvance({ leagueId: 1 });

  const round2 = world.matchups.filter((m) => m.is_playoff && m.week === 5);
  assert.deepEqual(round2.map((m) => [m.home_team_id, m.away_team_id]), [[1, 5], [3, 2]]);
  world.pool.assertClean();
});

test('getPlayoffSeeds reads the stored seeds of the current season', async (t) => {
  createFakePool([
    [select('playoff_seeds'), (text, params) => {
      assert.match(text, /JOIN "leagues" ON "leagues"\."id" = "playoff_seeds"\."league_id"/);
      assert.match(text, /"playoff_seeds"\."season" = "leagues"\."current_season"/);
      assert.deepEqual(params, [44]);
      return { rows: [{ team_id: 7, seed: 1 }, { team_id: 9, seed: 2 }] };
    }],
  ]).install(t);

  assert.deepEqual(await getPlayoffSeeds({ leagueId: 44 }), new Map([[7, 1], [9, 2]]));
});
