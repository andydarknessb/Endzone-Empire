const test = require('node:test');
const assert = require('node:assert/strict');
const { diffMatchupScores, isCorrectionDay } = require('../services/correction.service');

const matchup = (id, home, away, overrides = {}) => ({
  id,
  week: 3,
  final: true,
  is_playoff: false,
  home_score: home,
  away_score: away,
  ...overrides,
});

test('identical scores before and after produce no changes', () => {
  const rows = [matchup(1, 100.5, 90.25), matchup(2, 80, 80)];
  assert.deepEqual(diffMatchupScores(rows, rows), []);
});

test('a moved score is reported with before/after values', () => {
  const before = [matchup(1, 100, 90)];
  const after = [matchup(1, 97.5, 90)];
  const changes = diffMatchupScores(before, after);
  assert.equal(changes.length, 1);
  assert.deepEqual(changes[0].before, { home: 100, away: 90 });
  assert.deepEqual(changes[0].after, { home: 97.5, away: 90 });
  assert.equal(changes[0].winnerFlipped, false);
});

test('a correction that changes the winner sets winnerFlipped', () => {
  const changes = diffMatchupScores([matchup(1, 100, 99)], [matchup(1, 98, 99)]);
  assert.equal(changes[0].winnerFlipped, true);
});

test('win becoming a tie counts as a flipped result', () => {
  const changes = diffMatchupScores([matchup(1, 100, 99)], [matchup(1, 99, 99)]);
  assert.equal(changes[0].winnerFlipped, true);
});

test('both scores moving without changing the winner is not a flip', () => {
  const changes = diffMatchupScores([matchup(1, 100, 90)], [matchup(1, 102, 95)]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].winnerFlipped, false);
});

test('finality and playoff flags pass through from the before rows', () => {
  const before = [matchup(1, 50, 60, { final: true, is_playoff: true })];
  const after = [matchup(1, 65, 60)];
  const changes = diffMatchupScores(before, after);
  assert.equal(changes[0].final, true);
  assert.equal(changes[0].isPlayoff, true);
  assert.equal(changes[0].winnerFlipped, true);
});

test('matchups missing from the after set are skipped, not crashed on', () => {
  const changes = diffMatchupScores([matchup(1, 10, 5)], []);
  assert.deepEqual(changes, []);
});

test('multiple matchups: only the changed ones are reported', () => {
  const before = [matchup(1, 100, 90), matchup(2, 70, 75), matchup(3, 60, 50)];
  const after = [matchup(1, 100, 90), matchup(2, 77, 75), matchup(3, 60, 50)];
  const changes = diffMatchupScores(before, after);
  assert.deepEqual(changes.map((c) => c.matchupId), [2]);
  assert.equal(changes[0].winnerFlipped, true); // 70-75 loss became 77-75 win
});

test('isCorrectionDay is true only on Tuesday and Wednesday', () => {
  // 2026-07-06 is a Monday; walk the whole week
  const expected = [false, true, true, false, false, false, false]; // Mon..Sun
  for (let i = 0; i < 7; i++) {
    const date = new Date(2026, 6, 6 + i, 12, 0, 0); // local noon avoids TZ edges
    assert.equal(isCorrectionDay(date), expected[i], date.toDateString());
  }
});
