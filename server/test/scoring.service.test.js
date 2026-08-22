const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, update } = require('./helpers/fakePool');
const {
  calculateFantasyPoints,
  tank01Body,
  normalizeTank01Stats,
  normalizeTank01IdpStats,
  extractPlayByPlayBonusStats,
  normalizeTank01DstStats,
  normalizeTeamAbbr,
  missingTeamDefenses,
  normalizeTank01Game,
  detectScoringEvents,
  scoreMatchups,
  SCORING_RULES,
} = require('../services/scoring.service');

test('scoreMatchups excludes IR occupants from the best-ball candidate pool', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [{
      id: 5,
      best_ball: true,
      roster_slots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }],
      scoring_rules: null,
    }] })],
    [select('matchups'), () => ({ rows: [{
      id: 90,
      home_team_id: 10,
      away_team_id: 20,
      final: true,
    }] })],
    [/^SELECT "lineup_entries"\."player_id"/, (text, params) => ({
      rows: params[0] === 10
        ? [
            { player_id: 1, position: 'QB', slot: 'IR', stats: { passingYards: 300, passingTDs: 2 } },
            { player_id: 2, position: 'QB', slot: 'BENCH', stats: { passingYards: 100 } },
          ]
        : [{ player_id: 3, position: 'QB', slot: 'BENCH', stats: { passingYards: 50 } }],
    })],
    [update('matchups'), () => ({ rows: [] })],
  ]).install(t);

  const result = await scoreMatchups({ leagueId: 5, season: 2026, week: 8 });

  assert.deepEqual(result.scored, [{
    matchupId: 90,
    homeTeamId: 10,
    awayTeamId: 20,
    homeScore: 4,
    awayScore: 2,
  }]);
  fake.assertClean();
});

test('SCORING_RULES is defined', () => {
  assert(SCORING_RULES);
  assert.equal(SCORING_RULES.passing.yards, 0.04);
  assert.equal(SCORING_RULES.passing.touchdowns, 4);
  assert.equal(SCORING_RULES.passing.interceptions, -2);
  assert.equal(SCORING_RULES.rushing.yards, 0.1);
  assert.equal(SCORING_RULES.rushing.touchdowns, 6);
  assert.equal(SCORING_RULES.receiving.reception, 0.5);
  assert.equal(SCORING_RULES.receiving.yards, 0.1);
  // Tiered stats are sorted, non-overlapping tier arrays. FG uses the five
  // NFL.com distance buckets, priced identically to the old three (0-39 = 3).
  assert.deepEqual(SCORING_RULES.kicking.fieldGoal.map((t) => [t.min, t.max, t.points]), [
    [0, 19, 3], [20, 29, 3], [30, 39, 3], [40, 49, 4], [50, null, 5],
  ]);
  assert.equal(SCORING_RULES.teamDefense.pointsAllowed.at(-1).max, null);
  assert.equal(SCORING_RULES.idp.sack, 2);
  // NFL.com-parity leaves: return TD scores like a touchdown by default;
  // yardage rates and kick-miss penalties default to 0 (opt-in).
  assert.equal(SCORING_RULES.misc.returnTDs, 6);
  assert.equal(SCORING_RULES.misc.puntReturnYards, 0);
  assert.equal(SCORING_RULES.misc.kickReturnYards, 0);
  assert.equal(SCORING_RULES.kicking.fieldGoalMissed, 0);
  assert.equal(SCORING_RULES.kicking.extraPointMissed, 0);
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

test('calculateFantasyPoints: a return TD scores 6 by default; return yards and kick misses are 0 until configured', () => {
  assert.equal(calculateFantasyPoints({ returnTDs: 1, puntReturnYards: 40, kickReturnYards: 55 }), 6);
  assert.equal(calculateFantasyPoints({ fieldGoalMissed: 2, extraPointMissed: 1 }), 0);
  const missPenaltyRules = JSON.parse(JSON.stringify(SCORING_RULES));
  missPenaltyRules.kicking.fieldGoalMissed = -1;
  missPenaltyRules.misc.puntReturnYards = 0.04; // 1 pt / 25 yds
  assert.equal(calculateFantasyPoints({ fieldGoalMissed: 2, puntReturnYards: 50 }, missPenaltyRules), 0);
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

test('normalizeTank01IdpStats: defTD is credited as fumble-return TD only after removing interceptionTDs', () => {
  const result = normalizeTank01IdpStats({ Defense: { defTD: '2', interceptionTDs: '1' } });
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

// --- Team-DEF backfill (missingTeamDefenses) ----------------------------------

test('missingTeamDefenses returns all 32 teams when none exist yet', () => {
  const missing = missingTeamDefenses([]);
  assert.equal(missing.length, 32);
  assert(missing.includes('Arizona Cardinals'));
  assert(missing.includes('San Francisco 49ers'));
});

test('missingTeamDefenses excludes teams already present, matched by abbreviation regardless of stored format', () => {
  const missing = missingTeamDefenses(['San Francisco 49ers', 'DAL']);
  assert.equal(missing.length, 30);
  assert(!missing.includes('San Francisco 49ers'));
  assert(!missing.includes('Dallas Cowboys'));
});

test('missingTeamDefenses ignores unresolvable/empty nfl_team values and null/undefined input', () => {
  assert.equal(missingTeamDefenses([null, '', 'Not A Real Team']).length, 32);
  assert.equal(missingTeamDefenses(undefined).length, 32);
});

// --- Team-defense (DST) aggregate handling ------------------------------------

test('normalizeTank01DstStats maps the box score DST side to scoring-rule stat names', () => {
  const result = normalizeTank01DstStats({
    teamAbv: 'BAL', sacks: '3', defensiveInterceptions: '1', fumblesRecovered: '1', defTD: '0',
    safeties: '0', ptsAllowed: '20', ydsAllowed: '340',
  });
  assert.deepEqual(result, {
    sack: 3, interceptionReturn: 1, fumbleRecovery: 1, defensiveTD: 0,
    safety: 0, blockedKick: 0, pointsAllowed: 20, yardsAllowed: 340,
  });
});

test('normalizeTank01DstStats treats a missing side as all-zero', () => {
  assert.deepEqual(normalizeTank01DstStats(null), {
    sack: 0, interceptionReturn: 0, fumbleRecovery: 0, defensiveTD: 0,
    safety: 0, blockedKick: 0, pointsAllowed: 0, yardsAllowed: 0,
  });
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
