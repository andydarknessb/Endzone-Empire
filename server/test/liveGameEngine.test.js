const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLiveGameEntry,
  mapTank01Status,
} = require('../modules/liveGameEngine');

// --- mapTank01Status ---------------------------------------------------------

test('mapTank01Status: gameStatusCode 0 -> scheduled', () => {
  assert.equal(mapTank01Status({ gameStatusCode: '0', gameStatus: 'Not Started Yet' }), 'scheduled');
});

test('mapTank01Status: gameStatusCode 2 -> final', () => {
  assert.equal(mapTank01Status({ gameStatusCode: '2', gameStatus: 'Completed' }), 'final');
});

test('mapTank01Status: any other code -> in_progress', () => {
  assert.equal(mapTank01Status({ gameStatusCode: '1', gameStatus: 'In Progress' }), 'in_progress');
  assert.equal(mapTank01Status({ gameStatusCode: '3', gameStatus: 'Halftime' }), 'in_progress');
});

test('mapTank01Status: falls back to gameStatus text when code is missing/unfamiliar', () => {
  assert.equal(mapTank01Status({ gameStatus: 'Final' }), 'final');
  assert.equal(mapTank01Status({ gameStatus: 'Scheduled' }), 'scheduled');
  assert.equal(mapTank01Status({ gameStatus: 'Live' }), 'in_progress');
});

test('mapTank01Status: handles a missing/empty entry', () => {
  assert.equal(mapTank01Status(null), 'in_progress');
  assert.equal(mapTank01Status({}), 'in_progress');
});

// --- normalizeLiveGameEntry --------------------------------------------------

const SAMPLE_FINAL_ENTRY = {
  away: 'DAL',
  home: 'PHI',
  gameTime_epoch: '1757031600.0',
  gameID: '20250904_DAL@PHI',
  awayPts: '20',
  homePts: '24',
  gameClock: '',
  lineScore: { period: 'Final', gameClock: '' },
  gameStatus: 'Completed',
  gameStatusCode: '2',
};

test('normalizeLiveGameEntry: well-formed final entry maps correctly', () => {
  const result = normalizeLiveGameEntry(SAMPLE_FINAL_ENTRY, { season: 2025, week: 1 });
  assert.deepEqual(result, {
    tank01GameId: '20250904_DAL@PHI',
    season: 2025,
    week: 1,
    homeTeam: 'PHI',
    awayTeam: 'DAL',
    gameStatus: 'final',
    startTime: new Date(1757031600 * 1000),
    currentScoreHome: 24,
    currentScoreAway: 20,
    quarter: 'Final',
    timeRemaining: null,
  });
});

test('normalizeLiveGameEntry: not-started entry has null scores/clock/quarter treated as 0/null', () => {
  const result = normalizeLiveGameEntry(
    {
      away: 'DEN',
      home: 'KC',
      gameTime_epoch: '1789431300.0',
      gameID: '20260914_DEN@KC',
      awayPts: '',
      homePts: '',
      gameClock: '',
      gameStatus: 'Not Started Yet',
      gameStatusCode: '0',
    },
    { season: 2026, week: 1 }
  );
  assert.equal(result.gameStatus, 'scheduled');
  assert.equal(result.currentScoreHome, 0);
  assert.equal(result.currentScoreAway, 0);
  assert.equal(result.quarter, null);
  assert.equal(result.timeRemaining, null);
});

test('normalizeLiveGameEntry: live entry carries quarter + clock as raw strings', () => {
  const result = normalizeLiveGameEntry(
    {
      away: 'BUF',
      home: 'NYJ',
      gameID: '20260101_BUF@NYJ',
      awayPts: '14',
      homePts: '10',
      gameClock: '8:42',
      lineScore: { period: 'Q3', gameClock: '8:42' },
      gameStatus: 'In Progress',
      gameStatusCode: '1',
    },
    { season: 2026, week: 17 }
  );
  assert.equal(result.gameStatus, 'in_progress');
  assert.equal(result.quarter, 'Q3');
  assert.equal(result.timeRemaining, '8:42');
  assert.equal(result.currentScoreHome, 10);
  assert.equal(result.currentScoreAway, 14);
});

test('normalizeLiveGameEntry: missing gameID -> null', () => {
  assert.equal(normalizeLiveGameEntry({ home: 'KC', away: 'DEN' }, { season: 2026, week: 1 }), null);
});

test('normalizeLiveGameEntry: missing home/away -> null', () => {
  assert.equal(normalizeLiveGameEntry({ gameID: 'x' }, { season: 2026, week: 1 }), null);
});

test('normalizeLiveGameEntry: null/undefined entry -> null', () => {
  assert.equal(normalizeLiveGameEntry(null, { season: 2026, week: 1 }), null);
  assert.equal(normalizeLiveGameEntry(undefined, { season: 2026, week: 1 }), null);
});
