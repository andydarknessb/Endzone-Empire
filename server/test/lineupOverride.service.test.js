/**
 * #1856: the called-shot service's own rules, read through the shared fake
 * pool (the routes' wiring is pinned in calledShot.route.test.js).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { loadCalledShot, voidShotContradictedBySave, declareCalledShot } = require('../services/lineupOverride.service');

const row = (over = {}) => ({
  id: 41, team_id: 10, season: 2026, week: 6, slot: 'RB',
  starter_player_id: 1, benched_player_id: 3,
  starter_point_estimate: '6.00', benched_point_estimate: '18.00', probability: '0.9200', verdict: 'start',
  declared_at: '2026-10-08T12:00:00.000Z', outcome: 'pending',
  starter_points_actual: null, benched_points_actual: null, resolved_at: null,
  starter_name: 'p1', starter_nfl_team: 'BUF', benched_name: 'p3', benched_nfl_team: 'BUF',
  ...over,
});

const slotsFake = (slots, calledRow = row()) => {
  const fake = createFakePool([
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: calledRow ? [calledRow] : [] })],
    [/^SELECT "player_id", "slot" FROM "lineup_entries"/, () => ({
      rows: Object.entries(slots).map(([player_id, slot]) => ({ player_id: Number(player_id), slot })),
    })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
    [/^UPDATE "lineup_overrides"/, () => ({ rows: [] })],
  ]);
  return fake;
};

test('voidShotContradictedBySave leaves a shot alone while the lineup still matches it', async () => {
  const fake = slotsFake({ 1: 'RB', 3: 'BENCH' });
  assert.equal(await voidShotContradictedBySave(fake, { teamId: 10, season: 2026, week: 6 }), false);
  assert.equal(fake.matching(/^UPDATE "lineup_overrides"/).length, 0);
});

test('voidShotContradictedBySave voids a shot whose starter was benched', async () => {
  const fake = slotsFake({ 1: 'BENCH', 3: 'BENCH' });
  assert.equal(await voidShotContradictedBySave(fake, { teamId: 10, season: 2026, week: 6 }), true);
  assert.equal(fake.matching(/^UPDATE "lineup_overrides" SET "outcome" = 'void'/).length, 1);
});

test('voidShotContradictedBySave voids a shot whose benched player was started', async () => {
  const fake = slotsFake({ 1: 'RB', 3: 'FLEX' });
  assert.equal(await voidShotContradictedBySave(fake, { teamId: 10, season: 2026, week: 6 }), true);
});

test('voidShotContradictedBySave does nothing without an open shot', async () => {
  assert.equal(await voidShotContradictedBySave(slotsFake({}, null), { teamId: 10, season: 2026, week: 6 }), false);
  const settled = slotsFake({ 1: 'BENCH', 3: 'BENCH' }, row({ outcome: 'hit' }));
  assert.equal(await voidShotContradictedBySave(settled, { teamId: 10, season: 2026, week: 6 }), false);
  assert.equal(settled.matching(/^UPDATE/).length, 0);
});

test('loadCalledShot carries the numbers as called and is null without a shot', async () => {
  const league = { id: 3 };
  const withShot = createFakePool([
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [row()] })],
    [/FROM "matchups"/, () => ({ rows: [{ n: 1, all_final: false }] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
  ]);
  const shot = await loadCalledShot(withShot, { league, teamId: 10, season: 2026, week: 6 });
  assert.equal(shot.status, 'pending');
  assert.deepEqual(
    [shot.starter.projection, shot.benched.projection, shot.probability, shot.verdict],
    [6, 18, 0.92, 'start']
  );
  const none = createFakePool([[/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [] })]]);
  assert.equal(await loadCalledShot(none, { league, teamId: 10, season: 2026, week: 6 }), null);
});

test('loadCalledShot never writes an outcome: a pending row stays pending in a week whose matchups are all final (#1860, ruling on #1879)', async () => {
  const fake = createFakePool([
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [row()] })],
    [/FROM "matchups"/, () => ({ rows: [{ n: 1, all_final: true }] })],
    [/FROM "player_stats"/, () => ({ rows: [
      { player_id: 1, stats: { rushingYards: 100 } },
      { player_id: 3, stats: { rushingYards: 20 } },
    ] })],
    [/^UPDATE "lineup_overrides"/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
  ]);
  const shot = await loadCalledShot(fake, { league: { id: 3 }, teamId: 10, season: 2026, week: 6 });
  assert.equal(fake.matching(/^UPDATE "lineup_overrides"/).length, 0);
  assert.equal(shot.status, 'pending');
  assert.equal(shot.outcome, null);
  assert.equal(shot.resolvedAt, null);
});

test('loadCalledShot reads a stored outcome as resolved with both players\' points', async () => {
  const fake = createFakePool([
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [row({
      outcome: 'miss', starter_points_actual: '4.50', benched_points_actual: '12.00',
      resolved_at: '2026-10-13T15:00:00.000Z',
    })] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
  ]);
  const shot = await loadCalledShot(fake, { league: { id: 3 }, teamId: 10, season: 2026, week: 6 });
  assert.equal(shot.status, 'resolved');
  assert.equal(shot.outcome, 'miss');
  assert.deepEqual([shot.starter.points, shot.benched.points], [4.5, 12]);
  assert.equal(shot.canWithdraw, false);
});

test('declareCalledShot refuses a malformed pair before touching the database', async () => {
  for (const pair of [{}, { starterId: 1 }, { starterId: 1, benchedId: 1 }, { starterId: '1', benchedId: 2 }]) {
    await assert.rejects(
      declareCalledShot({ leagueId: 3, userId: 7, ...pair, loadAdvice: async () => assert.fail('no advice') }),
      (error) => error.statusCode === 400
    );
  }
});

// #1857: a called shot is the league's to see once both players have locked.
const { loadPublicCalledShot } = require('../services/lineupOverride.service');

const KICKOFF = '2026-10-11T17:00:00.000Z';
const AFTER = new Date('2026-10-11T18:00:00.000Z');
const BEFORE = new Date('2026-10-11T12:00:00.000Z');
const publicFake = ({ calledRow = row(), games = [{ nfl_team: 'BUF', kickoff_at: KICKOFF }] } = {}) => createFakePool([
  [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: calledRow ? [calledRow] : [] })],
  [/^SELECT "nfl_team" FROM "nfl_games"/, (text, params) => ({
    rows: games.filter((g) => new Date(g.kickoff_at) <= params[2]),
  })],
  [/FROM "player_stats"/, () => ({ rows: [
    { player_id: 1, stats: { rushingYards: 114 } },
    { player_id: 3, stats: { rushingYards: 62 } },
  ] })],
]);
const publicArgs = { league: { id: 3 }, teamId: 10, season: 2026, week: 6 };

test('loadPublicCalledShot carries nothing before both players have locked', async () => {
  assert.equal(await loadPublicCalledShot(publicFake({ games: [] }), { ...publicArgs, now: AFTER }), null);
  assert.equal(await loadPublicCalledShot(publicFake(), { ...publicArgs, now: BEFORE }), null);
  const oneLocked = publicFake({
    calledRow: row({ benched_nfl_team: 'KC' }),
    games: [{ nfl_team: 'BUF', kickoff_at: KICKOFF }, { nfl_team: 'KC', kickoff_at: '2026-10-11T20:00:00.000Z' }],
  });
  assert.equal(await loadPublicCalledShot(oneLocked, { ...publicArgs, now: AFTER }), null);
});

test('loadPublicCalledShot carries nothing for a team with no called shot', async () => {
  assert.equal(await loadPublicCalledShot(publicFake({ calledRow: null }), { ...publicArgs, now: AFTER }), null);
});

test('loadPublicCalledShot reads only called rows, so a captured Override never shows', async () => {
  const fake = publicFake();
  await loadPublicCalledShot(fake, { ...publicArgs, now: AFTER });
  const sql = fake.matching(/^SELECT .*FROM "lineup_overrides"/)[0].text;
  assert.match(sql, /"lineup_overrides"\."called"/);
});

test('loadPublicCalledShot carries the pair and both players\' current points once both locked', async () => {
  const shot = await loadPublicCalledShot(publicFake(), { ...publicArgs, now: AFTER });
  assert.deepEqual(shot, {
    starter: { playerId: 1, name: 'p1', points: 11.4 },
    benched: { playerId: 3, name: 'p3', points: 6.2 },
    outcome: null,
  });
});

test('loadPublicCalledShot carries the judged points and outcome when final, and never what was not judged', async () => {
  const hit = row({ outcome: 'hit', starter_points_actual: '11.40', benched_points_actual: '6.20' });
  const shot = await loadPublicCalledShot(publicFake({ calledRow: hit }), { ...publicArgs, now: AFTER });
  assert.deepEqual([shot.outcome, shot.starter.points, shot.benched.points], ['hit', 11.4, 6.2]);
  const voided = row({ outcome: 'void', starter_points_actual: null, benched_points_actual: null });
  assert.equal((await loadPublicCalledShot(publicFake({ calledRow: voided }), { ...publicArgs, now: AFTER })).outcome, 'void');
});

test('loadCalledShot gives the calling manager live points once both players have locked (#1857)', async () => {
  const shot = await loadCalledShot(publicFake(), { ...publicArgs, now: AFTER });
  assert.equal(shot.bothLocked, true);
  assert.deepEqual([shot.starter.points, shot.benched.points], [11.4, 6.2]);
  const early = await loadCalledShot(publicFake(), { ...publicArgs, now: BEFORE });
  assert.equal(early.bothLocked, false);
  assert.equal(early.starter.points, null);
});
