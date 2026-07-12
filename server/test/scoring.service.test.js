const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateFantasyPoints,
  tank01Body,
  normalizeTank01Stats,
  normalizeTank01Game,
  SCORING_RULES,
} = require('../services/scoring.service');

test('SCORING_RULES is defined', () => {
  assert(SCORING_RULES);
  assert.equal(SCORING_RULES.passingYards, 0.04);
  assert.equal(SCORING_RULES.passingTDs, 4);
  assert.equal(SCORING_RULES.interceptions, -2);
  assert.equal(SCORING_RULES.rushingYards, 0.1);
  assert.equal(SCORING_RULES.rushingTDs, 6);
  assert.equal(SCORING_RULES.receptions, 0.5);
  assert.equal(SCORING_RULES.receivingYards, 0.1);
});

test('calculateFantasyPoints returns 0 for empty object', () => {
  assert.equal(calculateFantasyPoints({}), 0);
});

test('calculateFantasyPoints returns 0 for null', () => {
  assert.equal(calculateFantasyPoints(null), 0);
});

test('calculateFantasyPoints returns 0 for undefined', () => {
  assert.equal(calculateFantasyPoints(undefined), 0);
});

test('calculateFantasyPoints: QB line {passingYards: 300, passingTDs: 2, interceptions: 1} = 18', () => {
  const stats = { passingYards: 300, passingTDs: 2, interceptions: 1 };
  const result = calculateFantasyPoints(stats);
  assert.equal(result, 18);
});

test('calculateFantasyPoints: RB line {rushingYards: 100, rushingTDs: 1, receptions: 4, receivingYards: 25} = 20.5', () => {
  const stats = {
    rushingYards: 100,
    rushingTDs: 1,
    receptions: 4,
    receivingYards: 25,
  };
  const result = calculateFantasyPoints(stats);
  assert.equal(result, 20.5);
});

test('calculateFantasyPoints ignores unknown stat keys', () => {
  const stats = { bogusStat: 999 };
  assert.equal(calculateFantasyPoints(stats), 0);
});

test('calculateFantasyPoints ignores non-numeric values', () => {
  const stats = { passingYards: 'abc' };
  assert.equal(calculateFantasyPoints(stats), 0);
});

test('calculateFantasyPoints rounds result to 2 decimals', () => {
  const stats = { passingYards: 333 };
  // 333 * 0.04 = 13.32, should round correctly
  const result = calculateFantasyPoints(stats);
  assert.equal(result, 13.32);
});

test('calculateFantasyPoints: mixed valid and invalid values', () => {
  const stats = { passingYards: 100, passingTDs: 'invalid', rushingYards: 50 };
  // 100 * 0.04 + 50 * 0.1 = 4 + 5 = 9
  assert.equal(calculateFantasyPoints(stats), 9);
});

// --- Tank01 response handling ------------------------------------------------

test('tank01Body unwraps the { statusCode, body } envelope', () => {
  assert.deepEqual(tank01Body({ statusCode: 200, body: [1, 2] }), [1, 2]);
});

test('tank01Body passes through raw payloads and null', () => {
  assert.deepEqual(tank01Body([{ a: 1 }]), [{ a: 1 }]);
  assert.equal(tank01Body(null), null);
});

test('normalizeTank01Stats maps a full box-score entry', () => {
  const entry = {
    playerID: '3915511',
    Passing: { passYds: '312', passTD: '2', int: '1' },
    Rushing: { carries: '4', rushYds: '22', rushTD: '1' },
    Receiving: { targets: '1', receptions: '1', recYds: '8', recTD: '0' },
    Kicking: { fgMade: '2', xpMade: '3' },
    Defense: { fumblesLost: '1' },
  };
  assert.deepEqual(normalizeTank01Stats(entry), {
    passingYards: 312,
    passingTDs: 2,
    interceptions: 1,
    rushingYards: 22,
    rushingTDs: 1,
    receivingYards: 8,
    receivingTDs: 0,
    receptions: 1,
    fumbles: 1,
    fieldGoal: 2,
    extraPoint: 3,
  });
});

test('normalizeTank01Stats: missing categories mean zeros; top-level fumblesLost accepted', () => {
  const result = normalizeTank01Stats({ fumblesLost: '2' });
  assert.equal(result.fumbles, 2);
  assert.equal(result.passingYards, 0);
  assert.equal(result.receptions, 0);
  assert.deepEqual(normalizeTank01Stats(null).passingYards, 0);
});

test('normalizeTank01Stats strips comma separators', () => {
  const result = normalizeTank01Stats({ Passing: { passYds: '1,250' } });
  assert.equal(result.passingYards, 1250);
});

test('normalizeTank01Game builds kickoff from epoch and requires both teams', () => {
  const game = normalizeTank01Game({
    gameID: '20250907_BUF@NYJ',
    away: 'BUF',
    home: 'NYJ',
    gameTime_epoch: '1757266200.0',
  });
  assert.equal(game.home, 'NYJ');
  assert.equal(game.away, 'BUF');
  assert.equal(game.kickoffAt.getTime(), 1757266200000);
  assert.equal(normalizeTank01Game({ home: 'NYJ', gameTime_epoch: '1' }), null);
  assert.equal(normalizeTank01Game({ home: 'NYJ', away: 'BUF' }), null);
  assert.equal(normalizeTank01Game(null), null);
});
