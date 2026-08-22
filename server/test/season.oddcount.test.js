const test = require('node:test');
const assert = require('node:assert/strict');
const { roundRobinPairings } = require('../services/season.service');

test('roundRobinPairings: even team count pairs everyone every week', () => {
  const teams = [1, 2, 3, 4];
  for (let week = 1; week <= 3; week++) {
    const pairings = roundRobinPairings(teams, week);
    assert.equal(pairings.length, 2, `week ${week} should have 2 games`);
    const seen = new Set();
    for (const { home, away } of pairings) {
      assert.notEqual(home, away);
      seen.add(home);
      seen.add(away);
    }
    assert.equal(seen.size, 4, `week ${week} should involve all 4 teams`);
  }
});

test('roundRobinPairings: odd team count gives exactly one bye per week', () => {
  const teams = [1, 2, 3, 4, 5];
  const cycleWeeks = teams.length; // n rounds when a ghost is added
  const appearances = new Map(teams.map((id) => [id, 0]));

  for (let week = 1; week <= cycleWeeks; week++) {
    const pairings = roundRobinPairings(teams, week);
    // 5 real teams -> 2 games + 1 bye each week.
    assert.equal(pairings.length, 2, `week ${week} should have 2 games`);
    const playing = new Set();
    for (const { home, away } of pairings) {
      assert.notEqual(home, away);
      assert.ok(teams.includes(home) && teams.includes(away));
      playing.add(home);
      playing.add(away);
      appearances.set(home, appearances.get(home) + 1);
      appearances.set(away, appearances.get(away) + 1);
    }
    assert.equal(playing.size, 4, `week ${week} should rest exactly one team`);
  }

  // Over a full cycle every team plays every other team once and byes once.
  for (const id of teams) {
    assert.equal(appearances.get(id), cycleWeeks - 1, `team ${id} should bye exactly once`);
  }
});

test('roundRobinPairings: fewer than two teams yields no games', () => {
  assert.deepEqual(roundRobinPairings([1], 1), []);
  assert.deepEqual(roundRobinPairings([], 1), []);
});
