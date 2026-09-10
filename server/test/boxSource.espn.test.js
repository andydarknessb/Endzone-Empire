const test = require('node:test');
const assert = require('node:assert/strict');
const espnBoxSource = require('../services/espnBoxSource');
const summary = require('./fixtures/espn-summary-2026-w1-ne-sea-final.json');

/**
 * The ESPN adapter behind the Box source seam (#1184, ADR 0035), bound to the
 * real NE at SEA 2026 week 1 final summary. Every number asserted here is read
 * off the fixture by hand, not recomputed from it.
 */

const GAME_ID = '20260909_NE@SEA';

function liveBox() {
  return espnBoxSource.fromSummary(summary, { gameId: GAME_ID });
}

const player = (box, externalId) => box.players.find((p) => p.externalId === externalId);

test('espnBoxSource: shape and identity', () => {
  const box = liveBox();
  assert.equal(box.source, 'espn');
  assert.equal(box.gameId, GAME_ID);
  assert.equal(box.espnEventId, '401872656');
  assert.equal(box.isFinal, true);
  assert.ok(Array.isArray(box.players) && box.players.length > 40, 'both teams’ box rows are present');
  assert.deepEqual(Object.keys(box.teamDefense).sort(), ['NE', 'SEA']);
});

test('espnBoxSource: Jaxon Smith-Njigba reads 8 receptions, 122 yards, 1 TD and a 45-yard TD length from the summary line', () => {
  const jsn = player(liveBox(), '4430878');
  assert.ok(jsn, 'JSN is keyed by his ESPN athlete id, which is players.external_id');
  assert.equal(jsn.stats.receptions, 8);
  assert.equal(jsn.stats.receivingYards, 122);
  assert.equal(jsn.stats.receivingTDs, 1);
  assert.deepEqual(jsn.stats.receivingTDLengths, [45]);
  // Every offensive parity key is present (zeros where the box has nothing),
  // as the Tank01 path writes them.
  for (const key of ['passingYards', 'passingTDs', 'interceptions', 'rushingYards', 'rushingTDs', 'fumbles', 'fieldGoal', 'extraPoint', 'returnTDs', 'puntReturns', 'puntReturnYards']) {
    assert.ok(key in jsn.stats, `${key} present`);
  }
});

test('espnBoxSource: Drake Maye reads 23/33 for 178, 1 TD, 3 INT, and the matching 2-yard passing TD length', () => {
  const maye = player(liveBox(), '4431452');
  assert.equal(maye.stats.passingYards, 178);
  assert.equal(maye.stats.passingTDs, 1);
  assert.equal(maye.stats.interceptions, 3);
  assert.deepEqual(maye.stats.passingTDLengths, [2]);
  // He also ran 7 times for 47 with no score.
  assert.equal(maye.stats.rushingYards, 47);
  assert.equal(maye.stats.rushingTDs, 0);
});

test('espnBoxSource: Drew Lock gets the 45-yard passing TD length that pairs with JSN’s catch', () => {
  const lock = player(liveBox(), '3924327');
  assert.equal(lock.stats.passingTDs, 1);
  assert.deepEqual(lock.stats.passingTDLengths, [45]);
});

test('espnBoxSource: the two kicking lines produce FG distances from the summary lines and no missed XP', () => {
  const box = liveBox();
  const borregales = player(box, '4569923');
  assert.equal(borregales.stats.fieldGoal, 1);
  assert.equal(borregales.stats.fieldGoalMissed, 0);
  assert.equal(borregales.stats.extraPoint, 1);
  assert.equal(borregales.stats.extraPointMissed, 0);
  assert.deepEqual(borregales.stats.fieldGoalDistances, [50]);
  const myers = player(box, '2473037');
  assert.equal(myers.stats.fieldGoal, 2);
  assert.deepEqual(myers.stats.fieldGoalDistances, [30, 26]);
  assert.equal(myers.stats.extraPointMissed, 0);
});

test('espnBoxSource: the SEA team-defense line carries NE’s points and total yards, sacks and interceptions summed from the defensive box', () => {
  const sea = liveBox().teamDefense.SEA;
  assert.equal(sea.pointsAllowed, 10, 'NE scored 10');
  assert.equal(sea.yardsAllowed, 277, 'NE’s totalYards');
  assert.equal(sea.interceptionReturn, 3, 'three SEA interceptions in the box');
  assert.equal(sea.sack, 3, 'Maye was sacked 3 times');
  assert.equal(sea.defensiveTD, 0);
  assert.equal(sea.safety, 0);
  assert.equal(sea.fumbleRecovery, 0, 'no fumbles in this game');
  assert.equal(sea.blockedKick, 0);
  const ne = liveBox().teamDefense.NE;
  assert.equal(ne.pointsAllowed, 13);
  assert.equal(ne.yardsAllowed, 285);
  assert.equal(ne.sack, 2);
  assert.equal(ne.interceptionReturn, 0);
});

test('espnBoxSource: an IDP line maps tackles, TFL, PD and QB hits, assisted = total minus solo, INT yards pass through', () => {
  const box = liveBox();
  const thomas = player(box, '4428659'); // Drake Thomas: 9 TOT, 3 SOLO, 1 sack, 1 TFL, 0 PD, 1 QBH
  assert.equal(thomas.stats.soloTackle, 3);
  assert.equal(thomas.stats.assistedTackle, 6);
  assert.equal(thomas.stats.idpSack, 1);
  assert.equal(thomas.stats.tacklesForLoss, 1);
  assert.equal(thomas.stats.qbHit, 1);
  assert.equal(thomas.stats.idpDefensiveTD, 0);
  const pritchett = player(box, '4567222'); // 1 INT for 30 yards
  assert.equal(pritchett.stats.idpInterception, 1);
  assert.equal(pritchett.stats.idpInterceptionReturnYards, 30);
});

test('espnBoxSource: return lines pass kick-return yards through and count return TDs', () => {
  const shaheed = player(liveBox(), '4032473'); // 3 KR for 80, 1 PR for 9
  assert.equal(shaheed.stats.kickReturnYards, 80);
  assert.equal(shaheed.stats.puntReturns, 1);
  assert.equal(shaheed.stats.puntReturnYards, 9);
  assert.equal(shaheed.stats.returnTDs, 0);
});

test('espnBoxSource: Score summary lines are carried as lines, never as Scoring plays', () => {
  const box = liveBox();
  assert.equal(box.scoreSummaryLines.length, 5);
  const first = box.scoreSummaryLines[0];
  assert.deepEqual(
    { kind: first.kind, period: first.period, clock: first.clock, teamCode: first.teamCode, scorerExternalId: first.scorerExternalId, yards: first.yards },
    { kind: 'Passing Touchdown', period: 2, clock: '9:11', teamCode: 'NE', scorerExternalId: '4831959', yards: 2 }
  );
  assert.equal(first.text, 'Eli Raridon 2 Yd pass from Drake Maye (Andy Borregales Kick)');
});

test('espnBoxSource: a rushing touchdown Score summary line gives the rusher a rushingTDLengths entry', () => {
  // NE at SEA had no rushing score; the line shape is real ("Daniel Jones 1 Yd
  // Rush (Spencer Shrader Kick)", IND 2025 week 1) with a scorer on this roster.
  const withRush = {
    ...summary,
    scoringPlays: [
      ...summary.scoringPlays,
      {
        type: { text: 'Rushing Touchdown' },
        text: 'Rhamondre Stevenson 3 Yd Rush (Andy Borregales Kick)',
        period: { number: 4 },
        clock: { displayValue: '2:00' },
        team: { abbreviation: 'NE' },
      },
    ],
  };
  const box = espnBoxSource.fromSummary(withRush, { gameId: GAME_ID });
  assert.deepEqual(player(box, '4569173').stats.rushingTDLengths, [3]);
  assert.equal(box.scoreSummaryLines.at(-1).scorerExternalId, '4569173');
  assert.equal(box.scoreSummaryLines.at(-1).yards, 3);
});

test('espnBoxSource: a summary with no athletes for a game in progress yields an empty players list (the shape-failure signal)', () => {
  const hollow = {
    header: { id: '1', competitions: [{ id: '1', status: { type: { state: 'in' } }, competitors: summary.header.competitions[0].competitors }] },
    boxscore: { teams: [], players: [] },
    scoringPlays: [],
    drives: {},
  };
  const box = espnBoxSource.fromSummary(hollow, { gameId: GAME_ID });
  assert.equal(box.isFinal, false);
  assert.deepEqual(box.players, []);
});
