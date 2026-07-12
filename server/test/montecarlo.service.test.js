const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mulberry32,
  normalSample,
  meanAndStddev,
  buildTeamModel,
  runSimulation,
  simulateBracketFrom,
  powerRankings,
} = require('../services/montecarlo.service');
const { optimalLineup, DEFAULT_LINEUP_SLOTS } = require('../services/lineup.service');

test('mulberry32 is deterministic for a given seed and in [0, 1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const va = a();
    assert.equal(va, b());
    assert.ok(va >= 0 && va < 1);
  }
});

test('normalSample clusters around the mean and never goes negative', () => {
  const rng = mulberry32(7);
  const samples = Array.from({ length: 2000 }, () => normalSample(rng, 100, 20));
  const { mean } = meanAndStddev(samples);
  assert.ok(Math.abs(mean - 100) < 3, `sample mean ${mean} too far from 100`);
  assert.ok(samples.every((s) => s >= 0));
  const low = normalSample(mulberry32(1), 1, 50);
  assert.ok(low >= 0); // clamped
});

test('meanAndStddev handles empty, single, and known inputs', () => {
  assert.deepEqual(meanAndStddev([]), { mean: 0, stddev: 0 });
  assert.deepEqual(meanAndStddev([10]), { mean: 10, stddev: 0 });
  const { mean, stddev } = meanAndStddev([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(mean, 5);
  assert.equal(stddev, 2);
});

test('buildTeamModel blends history and projection once 3+ weeks exist', () => {
  const model = buildTeamModel([100, 110, 120], 90);
  assert.ok(Math.abs(model.mean - (0.6 * 110 + 0.4 * 90)) < 1e-9);
  assert.ok(model.sigma >= 8);
});

test('buildTeamModel leans on projection with thin history and prior with none', () => {
  assert.equal(buildTeamModel([100], 90).mean, 90);
  assert.equal(buildTeamModel([], null).mean, 100); // league prior
  assert.equal(buildTeamModel([105], null).mean, 105);
});

const team = (id) => ({ id, name: `Team ${id}` });
const finalMatchup = (id, home, away, hs, as, week) => ({
  id, week, final: true, is_playoff: false,
  home_team_id: home, away_team_id: away, home_score: hs, away_score: as,
});

test('runSimulation: a dominant team gets near-certain playoff odds, a hopeless one near zero', () => {
  const teams = [team(1), team(2), team(3), team(4)];
  // Team 1 has crushed everyone; team 4 has lost everything, huge gaps
  const played = [
    finalMatchup(1, 1, 2, 150, 80, 1), finalMatchup(2, 3, 4, 100, 60, 1),
    finalMatchup(3, 1, 3, 150, 85, 2), finalMatchup(4, 2, 4, 100, 60, 2),
    finalMatchup(5, 1, 4, 150, 60, 3), finalMatchup(6, 2, 3, 95, 100, 3),
  ];
  const remaining = [
    { home_team_id: 1, away_team_id: 2, week: 4 },
    { home_team_id: 3, away_team_id: 4, week: 4 },
  ];
  const models = new Map([
    [1, { mean: 150, sigma: 10 }],
    [2, { mean: 95, sigma: 10 }],
    [3, { mean: 95, sigma: 10 }],
    [4, { mean: 60, sigma: 10 }],
  ]);
  const odds = runSimulation({
    teams, playedMatchups: played, remainingMatchups: remaining,
    models, playoffTeams: 2, runs: 500, seed: 3,
  });
  assert.ok(odds.get(1).playoffOdds > 0.95, `team 1 odds ${odds.get(1).playoffOdds}`);
  assert.ok(odds.get(4).playoffOdds < 0.05, `team 4 odds ${odds.get(4).playoffOdds}`);
  assert.ok(odds.get(1).titleOdds > odds.get(4).titleOdds);
});

test('runSimulation: title odds sum to ~1 and playoff slots are always filled', () => {
  const teams = [team(1), team(2), team(3), team(4)];
  const remaining = [
    { home_team_id: 1, away_team_id: 2, week: 1 },
    { home_team_id: 3, away_team_id: 4, week: 1 },
  ];
  const models = new Map(teams.map((t) => [t.id, { mean: 100, sigma: 15 }]));
  const odds = runSimulation({
    teams, playedMatchups: [], remainingMatchups: remaining,
    models, playoffTeams: 2, runs: 400, seed: 11,
  });
  let titleSum = 0;
  let playoffSum = 0;
  for (const t of teams) {
    titleSum += odds.get(t.id).titleOdds;
    playoffSum += odds.get(t.id).playoffOdds;
  }
  assert.ok(Math.abs(titleSum - 1) < 0.01, `title odds sum ${titleSum}`);
  assert.ok(Math.abs(playoffSum - 2) < 0.01, `playoff odds sum ${playoffSum}`);
});

test('runSimulation is reproducible for the same seed', () => {
  const teams = [team(1), team(2)];
  const remaining = [{ home_team_id: 1, away_team_id: 2, week: 1 }];
  const models = new Map(teams.map((t) => [t.id, { mean: 100, sigma: 20 }]));
  const args = {
    teams, playedMatchups: [], remainingMatchups: remaining,
    models, playoffTeams: 2, runs: 100, seed: 99,
  };
  assert.deepEqual(runSimulation(args), runSimulation(args));
});

test('simulateBracketFrom anchors round 1 to the real pending pairings', () => {
  // 3 alive: seed 1 has the bye, the pending real game is 2v3
  const aliveEntrants = [
    { teamId: 1, seed: 1 },
    { teamId: 2, seed: 2 },
    { teamId: 3, seed: 3 },
  ];
  const fixedGames = [{ home: 2, away: 3 }];
  // Team 3 always wins its games; team 1 always beats 2 but loses to 3
  const models = new Map([
    [1, { mean: 100, sigma: 0.001 }],
    [2, { mean: 50, sigma: 0.001 }],
    [3, { mean: 200, sigma: 0.001 }],
  ]);
  const champion = simulateBracketFrom({
    aliveEntrants,
    fixedGames,
    models,
    rng: mulberry32(5),
  });
  assert.equal(champion, 3); // wins 2v3, then beats the seed-1 bye team
});

test('simulateBracketFrom: an eliminated team can never be champion', () => {
  // Only alive entrants are passed in — an eliminated team simply isn't there
  const aliveEntrants = [
    { teamId: 1, seed: 1 },
    { teamId: 2, seed: 2 },
  ];
  const models = new Map([
    [1, { mean: 100, sigma: 20 }],
    [2, { mean: 100, sigma: 20 }],
  ]);
  const rng = mulberry32(9);
  for (let i = 0; i < 50; i++) {
    const champ = simulateBracketFrom({ aliveEntrants, fixedGames: [], models, rng });
    assert.ok(champ === 1 || champ === 2);
  }
});

test('simulateBracketFrom handles a lone survivor and empty entrants', () => {
  assert.equal(
    simulateBracketFrom({
      aliveEntrants: [{ teamId: 7, seed: 1 }],
      fixedGames: [],
      models: new Map(),
      rng: mulberry32(1),
    }),
    7
  );
  assert.equal(
    simulateBracketFrom({ aliveEntrants: [], fixedGames: [], models: new Map(), rng: mulberry32(1) }),
    null
  );
});

test('powerRankings orders by blended score and assigns dense ranks', () => {
  const standings = [
    { teamId: 1, name: 'A', winPct: 1.0 },
    { teamId: 2, name: 'B', winPct: 0.5 },
    { teamId: 3, name: 'C', winPct: 0.0 },
  ];
  const models = new Map([
    [1, { mean: 130 }], [2, { mean: 110 }], [3, { mean: 80 }],
  ]);
  const odds = new Map([
    [1, { playoffOdds: 0.99, titleOdds: 0.6 }],
    [2, { playoffOdds: 0.5, titleOdds: 0.25 }],
    [3, { playoffOdds: 0.01, titleOdds: 0.0 }],
  ]);
  const ranked = powerRankings(standings, models, odds);
  assert.deepEqual(ranked.map((r) => r.teamId), [1, 2, 3]);
  assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
  assert.ok(ranked[0].score > ranked[1].score);
});

test('optimalLineup fills dedicated slots then FLEX with the best leftover', () => {
  const players = [
    { playerId: 1, position: 'QB' },
    { playerId: 2, position: 'RB' }, { playerId: 3, position: 'RB' },
    { playerId: 4, position: 'RB' }, // best flex candidate
    { playerId: 5, position: 'WR' }, { playerId: 6, position: 'WR' },
    { playerId: 7, position: 'WR' },
    { playerId: 8, position: 'TE' },
    { playerId: 9, position: 'K' }, { playerId: 10, position: 'DEF' },
  ];
  const points = new Map([
    [1, 20], [2, 15], [3, 12], [4, 11], [5, 14], [6, 13], [7, 9], [8, 8], [9, 7], [10, 6],
  ]);
  const { starters, total } = optimalLineup(players, DEFAULT_LINEUP_SLOTS, points);
  const flex = starters.find((s) => s.slot === 'FLEX');
  assert.equal(flex.playerId, 4); // RB3 (11) beats WR3 (9) and TE bench (none left)
  assert.equal(starters.length, 9); // 1QB 2RB 2WR 1TE 1FLEX 1K 1DEF
  assert.equal(total, 20 + 15 + 12 + 14 + 13 + 8 + 11 + 7 + 6);
});

test('optimalLineup tolerates unfillable slots and empty rosters', () => {
  const { starters, total } = optimalLineup([], DEFAULT_LINEUP_SLOTS, new Map());
  assert.deepEqual(starters, []);
  assert.equal(total, 0);
  const qbOnly = optimalLineup(
    [{ playerId: 1, position: 'QB' }],
    DEFAULT_LINEUP_SLOTS,
    new Map([[1, 22]])
  );
  assert.equal(qbOnly.starters.length, 1);
  assert.equal(qbOnly.total, 22);
});

test('optimalLineup never starts a player in an ineligible slot', () => {
  const players = [
    { playerId: 1, position: 'QB' }, { playerId: 2, position: 'QB' },
  ];
  const points = new Map([[1, 30], [2, 28]]);
  const { starters } = optimalLineup(players, DEFAULT_LINEUP_SLOTS, points);
  // Second QB has nowhere legal to go (FLEX excludes QB)
  assert.equal(starters.length, 1);
  assert.equal(starters[0].slot, 'QB');
});
