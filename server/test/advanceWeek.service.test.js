const { test } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const { createFakePool, select, update } = require('./helpers/fakePool');
const matchupScoring = require('../services/matchupScoring.service');
const season = require('../services/season.service');
const lineupService = require('../services/lineup.service');
const settleFollowUpSvc = require('../services/settleFollowUp.service');
const { SEASON_BEFORE_DRAFT_MESSAGE } = require('../services/leaguePhase');
const { advanceWeek } = require('../services/advanceWeek.service');

const league = (over = {}) => ({
  current_season: 2026, current_week: 5, pickem_only: false,
  draft_status: 'complete', season_status: 'regular', ...over,
});

// Season (which settles and finalizes in one transaction) and the follow-up are
// stubbed at their module objects and append to one log, so the log IS the
// order advanceWeek ran them in.
function world(t, { row = league(), advance = { advancedTo: 6, seasonStatus: 'regular' }, followUp } = {}) {
  createFakePool([[/^SELECT .* FROM "leagues"/, () => ({ rows: [row] })]]).install(t);
  const order = [];
  t.mock.method(season, 'finalizeWeekAndAdvance', async (arg) => { order.push({ step: 'finalize', arg }); return { ...advance, scored: 3 }; });
  t.mock.method(settleFollowUpSvc, 'settleFollowUp', async (arg) => {
    order.push({ step: 'followUp', arg });
    if (followUp) return followUp();
  });
  return order;
}

test('advanceWeek: finalizes with the settle pass, then starts the follow-up', async (t) => {
  const order = world(t);

  const result = await advanceWeek({ leagueId: 7 });
  await result.followUp;

  assert.deepEqual(order.map((o) => o.step), ['finalize', 'followUp']);
  assert.deepEqual(order[0].arg, { leagueId: 7, week: 5, settle: true }); // the week it read, so a replay is refused
  assert.deepEqual(order[1].arg, { leagueId: 7, season: 2026, week: 5, mode: 'advance' });
  assert.equal(result.scored, 3);
  assert.deepEqual(result.advance, { advancedTo: 6, seasonStatus: 'regular' }, 'scored is not part of the advance');
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
  assert.equal(order[1].arg.seasonComplete, true);
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

test('advanceWeek: a week the commissioner saw that is no longer current is refused 409 before anything is scored', async (t) => {
  const order = world(t); // the league is on week 5; the confirm was for week 4
  await assert.rejects(advanceWeek({ leagueId: 7, expectedWeek: 4 }), (err) => {
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, 'week 4 was already advanced');
    return true;
  });
  assert.equal(order.length, 0, 'nothing scored, finalized or followed up');
});

test('advanceWeek: a matching expectedWeek runs as before and pins finalize to that week', async (t) => {
  const order = world(t);
  await (await advanceWeek({ leagueId: 7, expectedWeek: '5' })).followUp;
  assert.deepEqual(order.map((o) => o.step), ['finalize', 'followUp']);
  assert.deepEqual(order[0].arg, { leagueId: 7, week: '5', settle: true });
});

/* ------------------------------------------------------------------ *
 * Settle and finalize in ONE transaction (spec #2602)                  *
 * ------------------------------------------------------------------ */

// The real advanceWeek and finalizeWeekAndAdvance over a fake pool. The settle
// pass is stubbed at its module object to write its Matchup score UPDATEs
// through the transaction's client, and every post-commit step stamps the call
// log's length, so the log orders them against BEGIN and COMMIT.
const LEAGUE_ROW = {
  id: 7, draft_status: 'complete', season_status: 'regular', pickem_only: false,
  current_season: 2026, current_week: 5, regular_season_weeks: 14,
  playoff_teams: 4, playoff_consolation: false,
};
const TEAMS = [{ id: 11, name: 'A', owner_id: 1 }, { id: 12, name: 'B', owner_id: 2 }];
const WEEK_5 = [{
  id: 51, league_id: 7, season: 2026, week: 5, home_team_id: 11, away_team_id: 12,
  home_score: '0', away_score: '0', final: false, is_playoff: false,
}];

function realWorld(t, { lockedLeague = LEAGUE_ROW } = {}) {
  const fake = createFakePool([
    // The League row lock reads the locked row; the advance's first read is the plain SELECT.
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [{ ...lockedLeague }] })],
    [select('leagues'), () => ({ rows: [{ ...LEAGUE_ROW }] })],
    [select('teams'), () => ({ rows: TEAMS })],
    [select('matchups'), () => ({ rows: WEEK_5 })],
    [update('matchups'), () => ({ rows: [], rowCount: 1 })],
    [update('teams'), () => ({ rows: [], rowCount: TEAMS.length })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);
  const stamps = [];
  const stamp = (step) => stamps.push({ step, at: fake.calls.length });
  const settleCalls = [];
  t.mock.method(matchupScoring, 'scoreMatchupsInTransaction', async (client, args) => {
    settleCalls.push(args);
    await client.query(`UPDATE "matchups" SET "home_score" = $1, "away_score" = $2 WHERE "id" = $3`, [90, 80, 51]);
    return { league: LEAGUE_ROW, scored: [{ matchupId: 51 }], openMatchups: [] };
  });
  t.mock.method(matchupScoring, 'announceScored', async () => { stamp('announce'); });
  t.mock.method(lineupService, 'materializeLineup', async () => { stamp('seed'); });
  t.mock.method(settleFollowUpSvc, 'settleFollowUp', async () => { stamp('followUp'); });
  return { fake, stamps, settleCalls };
}

const indexOf = (calls, re, from = 0) => calls.findIndex((c, i) => i >= from && re.test(c.text));

test('advanceWeek: the settle pass and the final flag fall inside one transaction, after the League row lock', async (t) => {
  const { fake, settleCalls } = realWorld(t);

  const result = await advanceWeek({ leagueId: 7, expectedWeek: 5 });
  await result.followUp;

  const { calls } = fake;
  const begin = indexOf(calls, /^BEGIN$/);
  const lock = indexOf(calls, /FROM "leagues" WHERE "id" = \$1 FOR UPDATE/);
  const scoreUpdate = indexOf(calls, /^UPDATE "matchups" SET "home_score"/);
  const finalUpdate = indexOf(calls, /^UPDATE "matchups" SET "final" = true/);
  const commit = indexOf(calls, /^COMMIT$/);
  assert.ok(begin >= 0 && begin < lock, 'BEGIN, then the League row lock');
  assert.ok(lock < scoreUpdate, 'the lock comes before any score is written');
  assert.ok(scoreUpdate < finalUpdate, 'scores are written before they are marked final');
  assert.ok(finalUpdate < commit, 'and both commit together');
  assert.equal(indexOf(calls, /^COMMIT$/, scoreUpdate), commit, 'no COMMIT splits the settle pass from the final flag');
  assert.deepEqual(settleCalls, [{ leagueId: 7, season: 2026, week: 5, settle: true }]);
  assert.equal(result.scored.length, 1);
  assert.equal(result.advance.advancedTo, 6);
  fake.assertClean();
});

test('advanceWeek: the announcement, the lineup seed and the follow-up start after the COMMIT, in that order', async (t) => {
  const { fake, stamps } = realWorld(t);

  await (await advanceWeek({ leagueId: 7, expectedWeek: 5 })).followUp;

  const commit = indexOf(fake.calls, /^COMMIT$/);
  assert.deepEqual([...new Set(stamps.map((s) => s.step))], ['announce', 'seed', 'followUp']); // seed runs once per team
  for (const s of stamps) assert.ok(s.at > commit, `${s.step} starts after the COMMIT`);
});

test('advanceWeek: a week already advanced under the lock is refused 409 and no Matchup score is written', async (t) => {
  // The advance read week 5 and the confirm said 5, but by the time the lock is
  // held another advance has moved the League to week 6.
  const { fake, settleCalls, stamps } = realWorld(t, { lockedLeague: { ...LEAGUE_ROW, current_week: 6 } });

  await assert.rejects(advanceWeek({ leagueId: 7, expectedWeek: 5 }), (err) => {
    assert.equal(err.statusCode, 409);
    assert.equal(err.message, 'week 5 was already advanced');
    return true;
  });

  assert.equal(settleCalls.length, 0, 'the settle pass never ran');
  assert.equal(fake.matching(/^UPDATE "matchups"/).length, 0, 'no Matchup score UPDATE was issued');
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1);
  assert.equal(stamps.length, 0);
  fake.assertClean();
});
