/**
 * #194: season operations refuse to create or finalize season state for a
 * fantasy league whose draft has not finished.
 *
 * These tests assert the ABSENCES as well as the status. A gate placed after
 * the work produces the same 409 with the damage already done, so every
 * refusal case counts the statements the fake pool logged and proves the
 * inserts/updates never happened.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const {
  generateRegularSeason,
  finalizeWeekAndAdvance,
  SeasonError,
} = require('../services/season.service');
const { SEASON_BEFORE_DRAFT_MESSAGE } = require('../services/leaguePhase');

const league = (over = {}) => ({
  id: 1,
  pickem_only: false,
  draft_status: 'complete',
  season_status: 'regular',
  current_season: 2026,
  current_week: 1,
  regular_season_weeks: 2,
  ...over,
});

const TEAMS = [{ id: 11 }, { id: 12 }];

function seasonPool(leagueRow, extra = []) {
  return createFakePool([
    ...extra,
    [select('leagues'), () => ({ rows: leagueRow ? [leagueRow] : [] })],
    [select('teams'), () => ({ rows: TEAMS })],
    [select('matchups'), () => ({ rows: [] })],
    [insert('matchups'), () => ({ rows: [], rowCount: 1 })],
    [update('matchups'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
  ]);
}

/* ------------------------------------------------------------------ *
 * generateRegularSeason                                               *
 * ------------------------------------------------------------------ */

for (const draft_status of ['pending', 'active']) {
  test(`generateRegularSeason: refuses a fantasy league whose draft is ${draft_status}, inserting no matchups`, async (t) => {
    const fake = seasonPool(league({ draft_status })).install(t);

    await assert.rejects(
      () => generateRegularSeason({ leagueId: 1 }),
      (error) => {
        assert.ok(error instanceof SeasonError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.message, SEASON_BEFORE_DRAFT_MESSAGE);
        return true;
      }
    );

    assert.equal(fake.matching(insert('matchups')).length, 0, 'no matchup was inserted');
    assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'its own transaction rolled back');
    assert.equal(fake.matching(/^COMMIT$/).length, 0);
    fake.assertClean();
  });
}

test('generateRegularSeason: a complete draft schedules the season exactly as before', async (t) => {
  const fake = seasonPool(league()).install(t);

  const result = await generateRegularSeason({ leagueId: 1 });

  assert.deepEqual(result, { created: 2, weeks: 2 }); // 2 teams, 2 weeks, 1 game each
  assert.equal(fake.matching(insert('matchups')).length, 2);
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  fake.assertClean();
});

test("generateRegularSeason: a pick'em-only row is never refused by the phase gate", async (t) => {
  // Its draft_status carries no meaning, so the gate must not read it as
  // pre-draft. The routers refuse pick'em-only upstream in
  // requireFantasyLeague; that is where the league type is enforced, not here.
  const fake = seasonPool(league({ pickem_only: true, draft_status: 'pending' })).install(t);

  const result = await generateRegularSeason({ leagueId: 1 });

  assert.equal(result.created, 2);
  assert.equal(fake.matching(insert('matchups')).length, 2);
  fake.assertClean();
});

test('generateRegularSeason: the gate reads the league row through the CALLER\'S client', async (t) => {
  // The load-bearing case for draft completion. Both completion paths set
  // draft_status = 'complete' on their own transaction and then call this
  // with that same client; a gate reading through `pool` instead would see
  // the pre-transaction row and refuse every finished draft.
  const committed = league({ draft_status: 'active' }); // what `pool` would see
  const inTransaction = league({ draft_status: 'complete' }); // what the caller wrote

  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [committed] }), 'pool'],
    [select('leagues'), () => ({ rows: [inTransaction] }), 'client'],
    [select('teams'), () => ({ rows: TEAMS })],
    [select('matchups'), () => ({ rows: [] })],
    [insert('matchups'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);

  const client = await fake.connect();
  await client.query('BEGIN');
  const result = await generateRegularSeason({ leagueId: 1 }, client);
  await client.query('COMMIT');
  client.release();

  assert.equal(result.created, 2);
  assert.equal(fake.matching(select('leagues')).every((c) => c.via === 'client'), true);
  fake.assertClean();
});

test('generateRegularSeason: a missing league is still a 404, not a phase refusal', async (t) => {
  const fake = seasonPool(null).install(t);

  await assert.rejects(
    () => generateRegularSeason({ leagueId: 1 }),
    (error) => error.statusCode === 404 && /not found/.test(error.message)
  );
  assert.equal(fake.matching(insert('matchups')).length, 0);
  fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * finalizeWeekAndAdvance                                              *
 * ------------------------------------------------------------------ */

for (const draft_status of ['pending', 'active']) {
  test(`finalizeWeekAndAdvance: refuses a fantasy league whose draft is ${draft_status}, changing nothing`, async (t) => {
    const fake = seasonPool(league({ draft_status })).install(t);

    await assert.rejects(
      () => finalizeWeekAndAdvance({ leagueId: 1 }),
      (error) => {
        assert.ok(error instanceof SeasonError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.message, SEASON_BEFORE_DRAFT_MESSAGE);
        return true;
      }
    );

    // Nothing marked final, and current_week / season_status untouched.
    assert.equal(fake.matching(update('matchups')).length, 0, 'no matchup marked final');
    assert.equal(fake.matching(update('leagues')).length, 0, 'current_week / season_status unchanged');
    assert.equal(fake.matching(/^COMMIT$/).length, 0);
    assert.equal(fake.matching(/^ROLLBACK$/).length, 1);
    fake.assertClean();
  });
}

test('finalizeWeekAndAdvance: a complete season is still refused with its own message', async (t) => {
  // Phase COMPLETE passes the new gate; what a finished season refuses is
  // season operations' own rule and must be unchanged.
  //
  // #274: the matchups row is load-bearing, not scenery. The shared fixture
  // answers select('matchups') with no rows, and with none the guard-below
  // variant would trip the EARLIER "no matchups exist for week N" refusal and
  // fail on the message regex instead of on the write count. That would be an
  // accident of the fixture standing in for an assertion. With a row present
  // the only thing standing between this call and the two UPDATEs is the
  // season_status guard, so the counts below are what catch it moving.
  const fake = seasonPool(league({ season_status: 'complete' }), [
    [select('matchups'), () => ({ rows: [{ id: 1, week: 1, final: false }] })],
  ]).install(t);

  await assert.rejects(
    () => finalizeWeekAndAdvance({ leagueId: 1 }),
    (error) => error.statusCode === 409 && /season is complete/.test(error.message)
  );
  assert.equal(fake.matching(update('matchups')).length, 0, 'no matchup marked final');
  assert.equal(fake.matching(update('leagues')).length, 0, 'current_week / season_status unchanged');
  fake.assertClean();
});
