const test = require('node:test');
const assert = require('node:assert/strict');
const {
  tank01Body,
  normalizeTank01Stats,
  normalizeTank01IdpStats,
  extractPlayByPlayBonusStats,
  normalizeTank01DstStats,
  normalizeTeamAbbr,
  normalizeTank01Game,
} = require('../services/tank01Feed');
const { calculateFantasyPoints } = require('../services/scoringRules');

// The following moved from scoring.service.test.js (#1506, spec #1492): all
// exercise tank01Feed.js, the Tank01 feed adapter.

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
    Kicking: { fgMade: '2', fgAttempts: '3', xpMade: '3', xpAttempts: '3' },
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
    fieldGoalMissed: 1, // 3 attempts - 2 made
    extraPoint: 3,
    extraPointMissed: 0,
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

// --- Individual defender (IDP) handling ---------------------------------------

test('normalizeTank01IdpStats maps a defender\'s Defense category to IDP scoring keys', () => {
  const result = normalizeTank01IdpStats({
    Defense: {
      totalTackles: '5', soloTackles: '3', sacks: '1', defensiveInterceptions: '0',
      forcedFumbles: '1', fumblesRecovered: '0', passDeflections: '2', qbHits: '1',
      tfl: '1', defTD: '0',
    },
  });
  assert.deepEqual(result, {
    soloTackle: 3,
    assistedTackle: 2, // totalTackles - soloTackles
    idpSack: 1,
    idpInterception: 0,
    forcedFumble: 1,
    idpFumbleRecovery: 0,
    passDeflection: 2,
    qbHit: 1,
    tacklesForLoss: 1,
    idpDefensiveTD: 0,
    twoPointReturn: 0,
  });
});

test('normalizeTank01IdpStats: an interception-return TD counts fully as idpDefensiveTD (issue #1386)', () => {
  const result = normalizeTank01IdpStats({ Defense: { defTD: '1', interceptionTDs: '1' } });
  assert.equal(result.idpDefensiveTD, 1);
});

test('normalizeTank01IdpStats: missing/empty Defense category is all-zero', () => {
  assert.deepEqual(normalizeTank01IdpStats({}), {
    soloTackle: 0, assistedTackle: 0, idpSack: 0, idpInterception: 0, forcedFumble: 0,
    idpFumbleRecovery: 0, passDeflection: 0, qbHit: 0, tacklesForLoss: 0, idpDefensiveTD: 0,
    twoPointReturn: 0,
  });
  assert.equal(normalizeTank01IdpStats(null).soloTackle, 0);
});

// --- Play-by-play bonus-stat extraction (FG distance / TD length) ------------

test('extractPlayByPlayBonusStats collects a made FG\'s distance for the kicker', () => {
  const plays = [
    { playerStats: { '123': { Kicking: { fgMade: '1', fgAttempts: '1', fgYds: '41' } } } },
    { playerStats: { '123': { Kicking: { fgAttempts: '1', fgYds: '37' } } } }, // missed — no fgMade
  ];
  const result = extractPlayByPlayBonusStats(plays);
  assert.deepEqual(result.get('123').fieldGoalDistances, [41]);
});

test('extractPlayByPlayBonusStats collects passing/rushing/receiving TD lengths from the same-play yardage', () => {
  const plays = [
    { playerStats: { p1: { Passing: { passTD: '1', passYds: '5' } }, p2: { Receiving: { recTD: '1', recYds: '5' } } } },
    { playerStats: { p3: { Rushing: { rushTD: '1', rushYds: '45' } } } },
    { playerStats: { p3: { Rushing: { rushYds: '3' } } } }, // non-TD run — ignored
  ];
  const result = extractPlayByPlayBonusStats(plays);
  assert.deepEqual(result.get('p1').passingTDLengths, [5]);
  assert.deepEqual(result.get('p2').receivingTDLengths, [5]);
  assert.deepEqual(result.get('p3').rushingTDLengths, [45]);
});

test('extractPlayByPlayBonusStats tolerates a missing/empty play list', () => {
  assert.equal(extractPlayByPlayBonusStats(null).size, 0);
  assert.equal(extractPlayByPlayBonusStats([]).size, 0);
  assert.equal(extractPlayByPlayBonusStats([{ play: 'no playerStats here' }]).size, 0);
});

// --- Team-defense (DST) aggregate handling ------------------------------------

test('normalizeTank01DstStats maps the box score DST side to scoring-rule stat names, pointsAllowed from the opponentScore param (#1384)', () => {
  // ptsAllowed: '99' on the DST side itself must be ignored — pointsAllowed
  // comes from the third param (the opponent's lineScore total), not from
  // Tank01's own ptsAllowed field.
  const result = normalizeTank01DstStats(
    {
      teamAbv: 'BAL', sacks: '3', defensiveInterceptions: '1', fumblesRecovered: '1', defTD: '0',
      safeties: '0', ptsAllowed: '99', ydsAllowed: '340',
    },
    null,
    20
  );
  assert.deepEqual(result, {
    sack: 3, interceptionReturn: 1, fumbleRecovery: 1, defensiveTD: 0,
    safety: 0, blockedKick: 0, pointsAllowed: 20, yardsAllowed: 340,
  });
});

test('normalizeTank01DstStats treats a missing side as all-zero counting stats, with pointsAllowed and yardsAllowed omitted (#1549)', () => {
  assert.deepEqual(normalizeTank01DstStats(null), {
    sack: 0, interceptionReturn: 0, fumbleRecovery: 0, defensiveTD: 0,
    safety: 0, blockedKick: 0,
  });
});

test('normalizeTank01DstStats omits yardsAllowed and pointsAllowed when their figures are absent, rather than scoring the best tier (#1549)', () => {
  const result = normalizeTank01DstStats({ teamAbv: 'BAL', sacks: '1' }, null, 14);
  assert.equal('yardsAllowed' in result, false);
  assert.equal(
    calculateFantasyPoints(result),
    calculateFantasyPoints({ ...result, yardsAllowed: 375 }),
    'an absent yardsAllowed must score the same as the explicit 0-point tier, not the best tier'
  );
});

test('normalizeTank01DstStats keeps a real 0 figure for yardsAllowed and pointsAllowed (#1549)', () => {
  const result = normalizeTank01DstStats({ teamAbv: 'BAL', ydsAllowed: '0' }, null, 0);
  assert.equal(result.yardsAllowed, 0);
  assert.equal(result.pointsAllowed, 0);
});

test('normalizeTank01DstStats omits yardsAllowed and pointsAllowed for a whitespace-only figure, and keeps a real 0 (#1555)', () => {
  const result = normalizeTank01DstStats({ teamAbv: 'BAL', sacks: '1', ydsAllowed: ' ', ptsAllowed: '\t' }, null, 14);
  assert.equal('yardsAllowed' in result, false);
  assert.equal('pointsAllowed' in result, true, 'opponentScore param (14) wins over the blank ptsAllowed field');
  assert.equal(result.pointsAllowed, 14);

  const zeroResult = normalizeTank01DstStats({ teamAbv: 'BAL', ydsAllowed: '0' }, null, 0);
  assert.equal(zeroResult.yardsAllowed, 0);
});

test('normalizeTank01DstStats attributes a blocked kick to the OPPONENT\'s teamStats line', () => {
  // The blocked side's own kick got blocked (their teamStats), so the block
  // credit belongs to the other side's defense — this call is for that side.
  const result = normalizeTank01DstStats(
    { sacks: '0', defensiveInterceptions: '0', fumblesRecovered: '0', defTD: '0' },
    { blockedFG: '1', blockedXP: '0', blockedPunt: '1' }
  );
  assert.equal(result.blockedKick, 2);
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
