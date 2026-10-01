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

test('declareCalledShot refuses a malformed pair before touching the database', async () => {
  for (const pair of [{}, { starterId: 1 }, { starterId: 1, benchedId: 1 }, { starterId: '1', benchedId: 2 }]) {
    await assert.rejects(
      declareCalledShot({ leagueId: 3, userId: 7, ...pair, loadAdvice: async () => assert.fail('no advice') }),
      (error) => error.statusCode === 400
    );
  }
});
