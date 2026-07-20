const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CORRECTION_WINDOW_ERROR,
  CorrectionWindowError,
  assertManualCorrectionWindow,
  diffMatchupScores,
  isCorrectionDay,
} = require('../services/correction.service');

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

test('isCorrectionDay uses exact UTC Tuesday/Wednesday boundaries', () => {
  assert.equal(isCorrectionDay('2026-07-06T23:59:59.999Z'), false);
  assert.equal(isCorrectionDay('2026-07-07T00:00:00.000Z'), true);
  assert.equal(isCorrectionDay('2026-07-08T23:59:59.999Z'), true);
  assert.equal(isCorrectionDay('2026-07-09T00:00:00.000Z'), false);
});

test('manual correction allows only the immediate past week during the UTC window', () => {
  const result = assertManualCorrectionWindow({
    requestedSeason: 2026,
    requestedWeek: 8,
    activeSeason: 2026,
    activeWeek: 9,
    timestamp: '2026-10-06T00:00:00.000Z',
  });

  assert.equal(result.correctionWeek, 8);
  assert.equal(result.checkedAt.toISOString(), '2026-10-06T00:00:00.000Z');
});

test('manual correction blocks a week older than the immediate past week', () => {
  assert.throws(
    () => assertManualCorrectionWindow({
      requestedSeason: 2026,
      requestedWeek: 7,
      activeSeason: 2026,
      activeWeek: 9,
      timestamp: '2026-10-06T12:00:00.000Z',
    }),
    (error) =>
      error instanceof CorrectionWindowError &&
      error.statusCode === 403 &&
      error.code === CORRECTION_WINDOW_ERROR.code &&
      error.message === CORRECTION_WINDOW_ERROR.message
  );
});

test('manual correction blocks the immediate past week outside Tuesday/Wednesday UTC', () => {
  for (const timestamp of ['2026-10-05T23:59:59.999Z', '2026-10-08T00:00:00.000Z']) {
    assert.throws(
      () => assertManualCorrectionWindow({
        requestedSeason: 2026,
        requestedWeek: 8,
        activeSeason: 2026,
        activeWeek: 9,
        timestamp,
      }),
      CorrectionWindowError
    );
  }
});

test('manual correction fails closed for cross-season, week-one, and ambiguous timestamps', () => {
  const attempts = [
    { requestedSeason: 2025, requestedWeek: 18, activeSeason: 2026, activeWeek: 1, timestamp: '2026-09-08T12:00:00Z' },
    { requestedSeason: 2026, requestedWeek: 8, activeSeason: 2026, activeWeek: 9, timestamp: '2026-10-06T12:00:00' },
    { requestedSeason: 2026, requestedWeek: 8, activeSeason: 2026, activeWeek: 9, timestamp: 'not-a-date' },
  ];
  for (const attempt of attempts) {
    assert.throws(() => assertManualCorrectionWindow(attempt), CorrectionWindowError);
  }
});
