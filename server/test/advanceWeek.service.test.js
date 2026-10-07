const { test } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const { createFakePool } = require('./helpers/fakePool');
const matchupScoring = require('../services/matchupScoring.service');
const season = require('../services/season.service');
const settleFollowUpSvc = require('../services/settleFollowUp.service');
const { SEASON_BEFORE_DRAFT_MESSAGE } = require('../services/leaguePhase');
const { advanceWeek } = require('../services/advanceWeek.service');

const league = (over = {}) => ({
  current_season: 2026, current_week: 5, pickem_only: false,
  draft_status: 'complete', season_status: 'regular', ...over,
});

// Scoring, season and the follow-up are stubbed at their module objects and
// append to one log, so the log IS the order advanceWeek ran them in.
function world(t, { row = league(), advance = { advancedTo: 6, seasonStatus: 'regular' }, followUp } = {}) {
  createFakePool([[/^SELECT .* FROM "leagues"/, () => ({ rows: [row] })]]).install(t);
  const order = [];
  t.mock.method(matchupScoring, 'scoreMatchups', async (arg) => { order.push({ step: 'score', arg }); return { scored: 3 }; });
  t.mock.method(season, 'finalizeWeekAndAdvance', async (arg) => { order.push({ step: 'finalize', arg }); return advance; });
  t.mock.method(settleFollowUpSvc, 'settleFollowUp', async (arg) => {
    order.push({ step: 'followUp', arg });
    if (followUp) return followUp();
  });
  return order;
}

test('advanceWeek: scores the week as settled, then finalizes, then starts the follow-up', async (t) => {
  const order = world(t);

  const result = await advanceWeek({ leagueId: 7 });
  await result.followUp;

  assert.deepEqual(order.map((o) => o.step), ['score', 'finalize', 'followUp']);
  assert.deepEqual(order[0].arg, { leagueId: 7, season: 2026, week: 5, settle: true });
  assert.deepEqual(order[1].arg, { leagueId: 7 });
  assert.deepEqual(order[2].arg, { leagueId: 7, season: 2026, week: 5, mode: 'advance' });
  assert.equal(result.scored, 3);
  assert.deepEqual(result.advance, { advancedTo: 6, seasonStatus: 'regular' });
});

test('advanceWeek: the follow-up is not awaited', async (t) => {
  world(t, { followUp: () => new Promise(() => {}) });
  const result = await advanceWeek({ leagueId: 7 });
  assert.ok(result.followUp instanceof Promise);
});

test('advanceWeek: a rejecting follow-up is logged with league and week and the advance still resolves', async (t) => {
  world(t, { followUp: () => { throw new Error('follow-up boom'); } });
  const logs = [];
  t.mock.method(console, 'error', (...args) => { logs.push(args); });

  const result = await advanceWeek({ leagueId: 7 });
  await result.followUp;

  assert.equal(result.scored, 3);
  assert.deepEqual(result.advance, { advancedTo: 6, seasonStatus: 'regular' });
  assert.equal(logs.length, 1);
  assert.match(util.format(...logs[0]), /settle follow-up failed for league 7 week 5: follow-up boom/);
});

test('advanceWeek: the Advance that completes the season tells the follow-up so', async (t) => {
  const order = world(t, { advance: { advancedTo: 18, seasonStatus: 'complete', championTeamId: 4 } });
  await (await advanceWeek({ leagueId: 7 })).followUp;
  assert.equal(order[2].arg.seasonComplete, true);
});

test('advanceWeek: a league before its draft is refused 409 before anything is scored', async (t) => {
  const order = world(t, { row: league({ draft_status: 'active' }) });
  await assert.rejects(advanceWeek({ leagueId: 7 }), (err) => {
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, SEASON_BEFORE_DRAFT_MESSAGE);
    return true;
  });
  assert.equal(order.length, 0);
});
