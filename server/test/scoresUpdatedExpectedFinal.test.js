const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, update } = require('./helpers/fakePool');
const { setIo } = require('../modules/io');
const { scoreMatchups } = require('../services/scoring.service');
const expectedFinalService = require('../services/expectedFinal.service');

/**
 * The live score pass emits `scores:updated` with each matchup's fresh
 * scores. Each side's expected final and players remaining ride the same
 * event, computed after the pass commits (from the stats it just wrote),
 * only for matchups still open, and best-effort: a producer miss leaves the
 * four fields null and the scores still go out.
 */

const LEAGUE_ID = 5;
const SEASON = 2026;
const WEEK = 8;
const LEAGUE = { id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: false, roster_positions: null };

const OPEN = { id: 70, league_id: LEAGUE_ID, season: SEASON, week: WEEK, home_team_id: 10, away_team_id: 20, final: false };
const DONE = { id: 71, league_id: LEAGUE_ID, season: SEASON, week: WEEK, home_team_id: 30, away_team_id: 40, final: true };

function scoringPool({ matchups }) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [{ ...LEAGUE }] })],
    [select('matchups'), () => ({ rows: matchups.map((m) => ({ ...m })) })],
    // Every team scores 0 this pass: no starter rows with stats.
    [/FROM "lineup_entries"/, () => ({ rows: [] })],
    [/FROM "roster_tenures"/, () => ({ rows: [] })],
    [update('matchups'), () => ({ rows: [], rowCount: 1 })],
  ]);
}

function captureEmits(t) {
  const emitted = [];
  const io = { to: () => ({ emit: (event, payload) => emitted.push({ event, payload }) }) };
  setIo(io);
  t.after(() => setIo(null));
  return emitted;
}

test('scores:updated carries each open side\'s expected final and players remaining; a final matchup carries null', async (t) => {
  const producerCalls = [];
  const fake = scoringPool({ matchups: [OPEN, DONE] }).install(t);
  t.mock.method(expectedFinalService, 'expectedFinalsForWeek', async (args) => {
    // The producer reads on the pool. By the time it runs, the pass has
    // committed and handed its own connection back, so a pass never holds
    // two connections at once.
    fake.assertClean();
    producerCalls.push(args);
    return new Map([
      [10, { expectedFinal: 112.6, playersRemaining: 3 }],
      [20, { expectedFinal: 88.05, playersRemaining: 1 }],
    ]);
  });
  const emitted = captureEmits(t);

  const { scored } = await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK });

  const open = scored.find((s) => s.matchupId === 70);
  assert.equal(open.homeExpectedFinal, 112.6);
  assert.equal(open.awayExpectedFinal, 88.05);
  assert.equal(open.homePlayersRemaining, 3);
  assert.equal(open.awayPlayersRemaining, 1);
  const done = scored.find((s) => s.matchupId === 71);
  assert.equal(done.homeExpectedFinal, null);
  assert.equal(done.awayExpectedFinal, null);
  assert.equal(done.homePlayersRemaining, null);
  assert.equal(done.awayPlayersRemaining, null);
  // The producer was asked once, for the open matchup's teams only, under the league row.
  assert.equal(producerCalls.length, 1);
  assert.deepEqual(producerCalls[0].teamIds, [10, 20]);
  assert.equal(producerCalls[0].league.id, LEAGUE_ID);
  assert.equal(producerCalls[0].week, WEEK);
  // The same entries went out on the socket.
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, 'scores:updated');
  assert.deepEqual(emitted[0].payload.scored, scored);
});

test('a producer failure leaves the four fields null and the scores still go out', async (t) => {
  t.mock.method(expectedFinalService, 'expectedFinalsForWeek', async () => {
    throw new Error('run store down');
  });
  scoringPool({ matchups: [OPEN] }).install(t);
  const emitted = captureEmits(t);

  const { scored } = await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK });

  assert.equal(scored[0].homeScore, 0);
  assert.equal(scored[0].homeExpectedFinal, null);
  assert.equal(scored[0].awayPlayersRemaining, null);
  assert.equal(emitted.length, 1);
});

test('a settle pass never asks for expected finals: the week as played is its score', async (t) => {
  const producerCalls = [];
  t.mock.method(expectedFinalService, 'expectedFinalsForWeek', async (args) => {
    producerCalls.push(args);
    return new Map();
  });
  scoringPool({ matchups: [OPEN] }).install(t);
  captureEmits(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK, settle: true });

  assert.deepEqual(producerCalls, []);
});
