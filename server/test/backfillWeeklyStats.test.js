const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, weekOutcome } = require('../../scripts/backfill-weekly-stats');

// --- parseArgs --------------------------------------------------------------

test('parseArgs defaults to seasons 2024+2025, all weeks, 250ms pacing, tank01 source', () => {
  assert.deepEqual(parseArgs([]), {
    seasons: [2024, 2025],
    weeks: [],
    pauseMs: 250,
    skipNflverse: false,
    source: 'tank01',
  });
});

test('parseArgs accepts repeated --week in both flag styles', () => {
  assert.deepEqual(parseArgs(['--week', '2', '--week=4', '--week', '5']).weeks, [2, 4, 5]);
});

test('parseArgs accepts --source nflverse in both flag styles and rejects unknown sources', () => {
  assert.equal(parseArgs(['--source', 'nflverse']).source, 'nflverse');
  assert.equal(parseArgs(['--source=nflverse']).source, 'nflverse');
  assert.throws(() => parseArgs(['--source', 'espn']), /--source must be tank01 or nflverse/);
});

test('parseArgs accepts repeated --season in both flag styles', () => {
  assert.deepEqual(parseArgs(['--season', '2024', '--season=2025']).seasons, [2024, 2025]);
  assert.deepEqual(parseArgs(['--season=2025']).seasons, [2025]);
});

test('parseArgs accepts --week, --pause-ms, and --skip-nflverse', () => {
  const args = parseArgs(['--season', '2025', '--week=5', '--pause-ms', '0', '--skip-nflverse']);
  assert.deepEqual(args.weeks, [5]);
  assert.equal(args.pauseMs, 0);
  assert.equal(args.skipNflverse, true);
});

test('parseArgs rejects out-of-range weeks and unknown flags', () => {
  assert.throws(() => parseArgs(['--week', '19']), /--week must be an integer 1-18/);
  assert.throws(() => parseArgs(['--week', '0']), /--week must be an integer 1-18/);
  assert.throws(() => parseArgs(['--season', 'abc']), /--season must be an integer/);
  assert.throws(() => parseArgs(['--pause-ms', '-1']), /--pause-ms/);
  assert.throws(() => parseArgs(['--force']), /Unknown argument/);
});

// --- weekOutcome ------------------------------------------------------------

test('weekOutcome is complete when the schedule count is met', () => {
  assert.equal(weekOutcome({ gamesProcessed: 16, expectedGames: 16, attempt: 1 }), 'complete');
});

test('weekOutcome accepts any result when the schedule is unknown', () => {
  assert.equal(weekOutcome({ gamesProcessed: 3, expectedGames: null, attempt: 1 }), 'complete');
});

test('weekOutcome retries a short week until attempts run out', () => {
  assert.equal(weekOutcome({ gamesProcessed: 12, expectedGames: 16, attempt: 1 }), 'retry');
  assert.equal(weekOutcome({ gamesProcessed: 12, expectedGames: 16, attempt: 2 }), 'retry');
  assert.equal(weekOutcome({ gamesProcessed: 12, expectedGames: 16, attempt: 3 }), 'incomplete');
});
