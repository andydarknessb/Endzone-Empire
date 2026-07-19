const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateFantasyPoints,
  tank01Body,
  normalizeTank01Stats,
  normalizeTank01DstStats,
  normalizeTeamAbbr,
  normalizeTank01Game,
  detectScoringEvents,
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
    Punting: { puntReturns: '2', puntReturnYds: '18', puntReturnTD: '0' },
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
    returnTDs: 0,
    puntReturns: 2,
    puntReturnYards: 18,
  });
});

test('normalizeTank01Stats: missing categories mean zeros; top-level fumblesLost accepted', () => {
  const result = normalizeTank01Stats({ fumblesLost: '2' });
  assert.equal(result.fumbles, 2);
  assert.equal(result.passingYards, 0);
  assert.equal(result.receptions, 0);
  assert.equal(result.returnTDs, 0);
  assert.deepEqual(normalizeTank01Stats(null).passingYards, 0);
});

test('normalizeTank01Stats strips comma separators', () => {
  const result = normalizeTank01Stats({ Passing: { passYds: '1,250' } });
  assert.equal(result.passingYards, 1250);
});

test('normalizeTank01Stats maps a punt-return touchdown', () => {
  const result = normalizeTank01Stats({ Punting: { puntReturns: '1', puntReturnYds: '82', puntReturnTD: '1' } });
  assert.equal(result.returnTDs, 1);
  assert.equal(result.puntReturns, 1);
  assert.equal(result.puntReturnYards, 82);
});

// --- Team-defense (DST) aggregate handling ------------------------------------

test('normalizeTank01DstStats maps the box score DST side to scoring-rule stat names', () => {
  const result = normalizeTank01DstStats({
    teamAbv: 'BAL', sacks: '3', defensiveInterceptions: '1', fumblesRecovered: '1', defTD: '0',
  });
  assert.deepEqual(result, { sack: 3, interceptionReturn: 1, fumbleRecovery: 1, defensiveTD: 0 });
});

test('normalizeTank01DstStats treats a missing side as all-zero', () => {
  assert.deepEqual(normalizeTank01DstStats(null), {
    sack: 0, interceptionReturn: 0, fumbleRecovery: 0, defensiveTD: 0,
  });
});

test('normalizeTeamAbbr passes through an already-abbreviated nfl_team', () => {
  assert.equal(normalizeTeamAbbr('BAL'), 'BAL');
  assert.equal(normalizeTeamAbbr('SF'), 'SF');
});

test('normalizeTeamAbbr resolves a full team name to its Tank01 abbreviation', () => {
  assert.equal(normalizeTeamAbbr('San Francisco 49ers'), 'SF');
  assert.equal(normalizeTeamAbbr('Dallas Cowboys'), 'DAL');
});

test('normalizeTeamAbbr returns null for unknown/empty input', () => {
  assert.equal(normalizeTeamAbbr(''), null);
  assert.equal(normalizeTeamAbbr(null), null);
  assert.equal(normalizeTeamAbbr('Not A Real Team'), null);
});

// --- Scoring-event detection (touchdowns and non-TD "moment" plays) ----------

test('detectScoringEvents fires a touchdown-caliber event for a new passing TD', () => {
  const events = detectScoringEvents({ passingTDs: 1 }, { passingTDs: 2 });
  assert.deepEqual(events, [{ type: 'passing', statKey: 'passingTDs', tdDelta: 1, isTouchdown: true }]);
});

test('detectScoringEvents fires a non-touchdown event for a new sack/field goal/fumble recovery', () => {
  const events = detectScoringEvents(
    { sack: 0, fieldGoal: 0, fumbleRecovery: 0 },
    { sack: 1, fieldGoal: 1, fumbleRecovery: 1 }
  );
  const types = events.map((e) => e.type).sort();
  assert.deepEqual(types, ['fieldGoal', 'fumble', 'sack']);
  assert(events.every((e) => e.isTouchdown === false));
});

test('detectScoringEvents produces nothing for yardage-only changes or unchanged stats', () => {
  assert.deepEqual(detectScoringEvents({ passingYards: 100 }, { passingYards: 300 }), []);
  assert.deepEqual(detectScoringEvents({ sack: 2 }, { sack: 2 }), []);
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
