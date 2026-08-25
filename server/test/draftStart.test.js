const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const { startDraft } = require('../services/draftStart.service');

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

const DEFAULT_TEAMS = [{ id: 11, owner_id: 7, draft_position: 1, autodraft: false, locked: false }];

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
  { id: 11, owner_id: 7, draft_position: 1, autodraft: false, locked: false },
  { id: 12, owner_id: 8, draft_position: 2, autodraft: false, locked: false },
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
function draftStartPool({ league = baseLeague, keepers = [], teams = DEFAULT_TEAMS } = {}) {
  const row = { ...league };
  return createFakePool([
    [select('leagues'), () => ({ rows: [{ ...row }] })],
    // isLeagueCommissioner's owner-or-co-commissioner probe.
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })],
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
  fake.assertClean();
});

// #194: season operations now refuse to schedule a season for a league still
// pre-draft or drafting, and this path enters them INSIDE the start
// transaction. It survives that gate only because the draft_status =
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
