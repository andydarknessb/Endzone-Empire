const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
const { startDraft } = require('../services/draftStart.service');
const { MARKET_FLOOR } = require('../services/adp.service');

// startDraft now broadcasts its state refresh and lifecycle entries through the
// one Draft room adapter (#745), which throws with no transport. Register a
// recording broadcast around every test here so the real io/emitter transport is
// not required; the "worker path emits" assertion is owned by
// draftSchedule.autostartArm.test.js (invoked through runStartAction).
registerRecordingBroadcast();

const baseLeague = {
  id: 1,
  owner_id: 7,
  draft_status: 'pending',
  draft_type: 'snake',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  keepers_enabled: false,
  keeper_count: 0,
  min_teams: 1,
  roster_limit: 2,
  pick_time_seconds: 60,
  autodraft_delay_seconds: 10,
};

const DEFAULT_TEAMS = [{ id: 11, name: 'Team Eleven', owner_id: 7, draft_position: 1, autodraft: false, locked: false }];

const KEEPER_FILLED_LEAGUE = {
  ...baseLeague,
  roster_limit: 1,
  ir_slots: 0,
  keepers_enabled: true,
  keeper_count: 1,
  current_season: 2026,
  waiver_period_hours: 24,
};

const TWO_TEAMS = [
  { id: 11, name: 'Team Eleven', owner_id: 7, draft_position: 1, autodraft: false, locked: false },
  { id: 12, name: 'Team Twelve', owner_id: 8, draft_position: 2, autodraft: false, locked: false },
];

const TWO_KEEPERS = [
  { team_id: 11, player_id: 101, draft_round: 1 },
  { team_id: 12, player_id: 201, draft_round: 1 },
];

/**
 * A stateful world (the pattern the helper documents): the league row this
 * transaction can see includes its OWN uncommitted writes, because a real
 * client reads back what it just wrote and the #194 phase gate inside
 * generateRegularSeason depends on exactly that. A static row would model a
 * database that forgets the UPDATE two statements earlier.
 */
function draftStartPool({ league = baseLeague, keepers = [], teams = DEFAULT_TEAMS, market = 500 } = {}) {
  const row = { ...league };
  return createFakePool([
    [select('leagues'), () => ({ rows: [{ ...row }] })],
    // isLeagueCommissioner's owner-or-co-commissioner probe.
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })],
    // The market gate's count of players carrying an ADP (#747). Default clears
    // MARKET_FLOOR so every unrelated start test is unaffected.
    [select('players'), () => ({ rows: [{ n: market }] })],
    [update('leagues'), (text) => {
      if (/'complete'/.test(text)) row.draft_status = 'complete';
      else if (/'active'/.test(text)) row.draft_status = 'active';
      return { rows: [], rowCount: 1 };
    }],
    [select('teams'), () => ({ rows: teams })],
    [select('keepers'), () => ({ rows: keepers })],
    // generateRegularSeason, run inline on this same client when the draft
    // completes immediately (every slot pre-filled by keepers).
    [select('matchups'), () => ({ rows: [] })],
    [insert('matchups'), () => ({ rows: [], rowCount: 1 })],
    [insert('draft_picks'), () => ({ rows: [], rowCount: 1 })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    // The lifecycle Draft activity (#437). Stateful feed_seq so a draft_start
    // and (on an all-keeper start) a following complete take distinct positions.
    [insert('draft_activity'), (() => { let seq = 100; return () => ({ rows: [{ id: seq, feed_seq: String(seq++), created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 }); })()],
  ]);
}

const texts = (fake) => fake.calls.map((c) => c.text);

test('startDraft skips keeper reads and inserts when keepers are disabled', async (t) => {
  const fake = draftStartPool().install(t);

  await startDraft({ leagueId: 1, userId: 7 });

  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  assert.equal(fake.matching(/^ROLLBACK$/).length, 0);
  assert.equal(fake.matching(/FROM "keepers"/).length, 0);
  assert.equal(fake.matching(insert('draft_picks')).length, 0);
  assert.equal(fake.matching(insert('team_players')).length, 0);
  fake.assertClean();
});

// ADR 0005: starting a draft must fix draft_rounds once, from Draft roster
// size at that instant, so active/completed reads never recompute it.
test('startDraft fixes draft_rounds (roster_limit - ir_slots) when the draft goes active', async (t) => {
  const fake = draftStartPool({ league: { ...baseLeague, roster_limit: 20, ir_slots: 1 } }).install(t);

  await startDraft({ leagueId: 1, userId: 7 });

  const updateCall = texts(fake).find((sql) => update('leagues').test(sql) && sql.includes("'active'"));
  assert.ok(updateCall, 'expected an UPDATE ... SET draft_status = active');
  assert.match(updateCall, /"draft_rounds"\s*=\s*\$/);
  fake.assertClean();
});

test('startDraft fixes draft_rounds even when every roster slot is pre-filled by keepers (the draft completes without a single live pick)', async (t) => {
  const fake = draftStartPool({
    league: { ...KEEPER_FILLED_LEAGUE, regular_season_weeks: 0 },
    keepers: TWO_KEEPERS,
    teams: TWO_TEAMS,
  }).install(t);

  await startDraft({ leagueId: 1, userId: 7 });

  const updateCall = texts(fake).find((sql) => update('leagues').test(sql) && sql.includes("'complete'"));
  assert.ok(updateCall, 'expected an UPDATE ... SET draft_status = complete');
  assert.match(updateCall, /"draft_rounds"\s*=\s*\$/);
  fake.assertClean();
});

test('startDraft rolls back without writes when keepers exceed the current per-team count', async (t) => {
  const fake = draftStartPool({
    league: { ...baseLeague, keepers_enabled: true, keeper_count: 1 },
    keepers: [
      { team_id: 11, player_id: 101, draft_round: 1 },
      { team_id: 11, player_id: 102, draft_round: 2 },
    ],
  }).install(t);

  await assert.rejects(
    startDraft({ leagueId: 1, userId: 7 }),
    (error) => error.statusCode === 409 && /allows 1/.test(error.message)
  );

  assert.equal(fake.matching(/^ROLLBACK$/).length, 1);
  assert.equal(fake.matching(/^COMMIT$/).length, 0);
  assert.equal(fake.matching(update('leagues')).length, 0);
  assert.equal(fake.matching(insert('draft_picks')).length, 0);
  assert.equal(fake.matching(insert('team_players')).length, 0);
  // #274: the service's fourth write site, UPDATE "teams" SET "autodraft", is
  // deliberately NOT counted here. It is gated on plan.autodraftAll, which is
  // draft_type === 'autopick', and this fixture is a snake draft - so the
  // statement is unreachable and a count of zero would pass in a correct build
  // and in a mutated one alike. An assertion that cannot fail is the thing
  // this ticket removes, not the thing it adds. Covering that write wants an
  // autopick fixture, which is a different test.
  fake.assertClean();
});

// #194: season operations now refuse to schedule a season for a league still
// pre-draft or drafting, and this path calls generateRegularSeason INSIDE the
// start transaction. It survives that gate only because the draft_status =
// 'complete' UPDATE runs first, so the phase read on this same client sees
// 'complete'. Nothing in draftStart.service states that order, so pin it:
// reordering those two statements would break every keeper-filled draft start.
test('startDraft marks the draft complete BEFORE it generates the season schedule (#194)', async (t) => {
  const fake = draftStartPool({
    league: { ...KEEPER_FILLED_LEAGUE, regular_season_weeks: 1 },
    keepers: TWO_KEEPERS,
    teams: TWO_TEAMS,
  }).install(t);

  await startDraft({ leagueId: 1, userId: 7 });

  const sql = texts(fake);
  const completedAt = sql.findIndex((s) => update('leagues').test(s) && s.includes("'complete'"));
  const scheduledAt = sql.findIndex((s) => /"matchups"/.test(s));
  assert.notEqual(completedAt, -1, 'the draft was marked complete');
  assert.notEqual(scheduledAt, -1, 'season operations ran on this transaction');
  assert.ok(
    completedAt < scheduledAt,
    'draft_status must be set to complete before generateRegularSeason is called'
  );
  // And it actually scheduled: 2 teams over 1 regular-season week is one game.
  assert.equal(fake.matching(insert('matchups')).length, 1);
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  assert.equal(fake.matching(/^ROLLBACK$/).length, 0);
  fake.assertClean();
});

/**
 * Lifecycle activity on start (#437). Starting the draft appends a draft_start
 * Draft-activity entry from the SAME transaction as the status change (#437
 * AC1), attributed to the acting commissioner's Team. When every slot is
 * pre-filled by keepers the draft completes in the same transaction, so a
 * completion entry follows the start.
 */
test('startDraft appends a draft_start activity with the acting commissioner Team (#437 AC1)', async (t) => {
  const fake = draftStartPool().install(t);

  await startDraft({ leagueId: 1, userId: 7 });

  const appended = fake.matching(insert('draft_activity'));
  assert.equal(appended.length, 1, 'exactly one lifecycle entry on a live-picking start');
  // INSERT ("league_id","kind","team_id","team_name") VALUES ($1,$2,$3,$4)
  assert.deepEqual(appended[0].params, [1, 'draft_start', 11, 'Team Eleven']);
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  fake.assertClean();
});

test('startDraft by the scheduler (no acting user) records draft_start with a null actor, not a fabricated one (#437 AC5)', async (t) => {
  const fake = draftStartPool().install(t);

  await startDraft({ leagueId: 1, userId: null });

  const appended = fake.matching(insert('draft_activity'));
  assert.equal(appended.length, 1);
  assert.equal(appended[0].params[1], 'draft_start');
  assert.equal(appended[0].params[2], null, 'no actor team id');
  assert.equal(appended[0].params[3], null, 'no actor team name');
  fake.assertClean();
});

// ---- the market gate on draft start (#747) ---------------------------------

test('startDraft refuses when the player market has not loaded, with the 409 copy naming cause and fix', async (t) => {
  // A market below MARKET_FLOOR would leave autopicks falling back to last
  // season's points, so start is refused where a human can still act. Raising
  // this fixture to MARKET_FLOOR (100) clears the gate and turns the test red.
  const fake = draftStartPool({ market: MARKET_FLOOR - 1 }).install(t);

  await assert.rejects(
    startDraft({ leagueId: 1, userId: 7 }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(
        error.message,
        `The player market has not loaded (${MARKET_FLOOR - 1} of ${MARKET_FLOOR} players carry an ADP), `
          + "so autopicks would fall back to last season's points. "
          + 'Ask your admin to run the ADP sync, then start the draft.'
      );
      return true;
    }
  );

  // Refused under the lock: rolled back, and nothing was written or started.
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1);
  assert.equal(fake.matching(/^COMMIT$/).length, 0);
  assert.equal(fake.matching(update('leagues')).length, 0);
  assert.equal(fake.matching(insert('draft_activity')).length, 0);
  fake.assertClean();
});

test('startDraft proceeds when exactly MARKET_FLOOR players carry an ADP', async (t) => {
  const fake = draftStartPool({ market: MARKET_FLOOR }).install(t);

  await startDraft({ leagueId: 1, userId: 7 });

  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  assert.equal(fake.matching(/^ROLLBACK$/).length, 0);
  fake.assertClean();
});

test('startDraft that completes on keeper pre-fill appends draft_start then complete (#437 AC1, AC4)', async (t) => {
  const fake = draftStartPool({
    league: { ...KEEPER_FILLED_LEAGUE, regular_season_weeks: 0 },
    keepers: TWO_KEEPERS,
    teams: TWO_TEAMS,
  }).install(t);

  await startDraft({ leagueId: 1, userId: 7 });

  const appended = fake.matching(insert('draft_activity'));
  assert.equal(appended.length, 2, 'a start and a completion');
  assert.equal(appended[0].params[1], 'draft_start');
  assert.deepEqual([appended[0].params[2], appended[0].params[3]], [11, 'Team Eleven']);
  // The completion is an actor-less state transition (#437 AC5).
  assert.equal(appended[1].params[1], 'complete');
  assert.equal(appended[1].params[2], null);
  assert.equal(appended[1].params[3], null);
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  fake.assertClean();
});
