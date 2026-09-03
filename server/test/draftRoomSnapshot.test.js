const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select } = require('./helpers/fakePool');
const {
  MEMBER_LEAGUE_FIELDS,
  PRESENTER_LEAGUE_FIELDS,
  PRESENTER_TEAM_FIELDS,
  PRESENTER_PICK_FIELDS,
} = require('./helpers/draftStatePins');
const { memberSnapshot, presenterSnapshot } = require('../services/draftRoomSnapshot');

/**
 * The Draft room snapshot contract (#788). memberSnapshot builds `draft:state`
 * for authenticated league members; presenterSnapshot builds the anonymous
 * share-link board. Both are league-shared, so what they carry is a contract,
 * not an implementation detail.
 *
 * WHY THE FIXTURES ARE WIDER THAN THE CONTRACT. fakePool answers rows verbatim,
 * so a snapshot that returned its rows raw would carry every field the fixture
 * holds - including `owner_id` (an account identifier #115 forbids on a
 * league-shared payload), `draft_share_token` (the presenter credential only a
 * commissioner may mint) and `invite_code`. The snapshot names its output
 * fields, so none of the three survive; the exact-key-set assertions below are
 * what prove it, and they are pinned against the INDEPENDENT copies in
 * draftStatePins.js (never imported from the module under test), so a widened
 * read fails here instead of passing a tautology.
 *
 * The negative-control the issue names (AC1): add `owner_id` to
 * MEMBER_LEAGUE_COLUMNS in draftRoomSnapshot.js - the single list that drives
 * both the member SELECT and its projection - and the first two tests below go
 * red (the key set gains a 20th field the pinned copy lacks, and `owner_id` is
 * no longer stripped). Verified by experiment, reported in the PR body.
 */

const LEAGUE_ID = 1;

// A leagues row wider than either audience: the 19 member columns, the three
// forbidden fields, the columns the presenter's on-the-clock derivation needs,
// and a stand-in for a column added next quarter.
const wideLeagueRow = (over = {}) => ({
  id: LEAGUE_ID,
  name: 'The Gridiron Society',
  draft_status: 'active',
  draft_paused: false,
  draft_type: 'snake',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  current_pick: 1,
  pick_deadline_at: '2026-09-01T00:00:00.000Z',
  pick_time_seconds: 60,
  autodraft_delay_seconds: 10,
  draft_rounds: 15,
  roster_limit: 16,
  roster_slots: {},
  bench_slots: 6,
  ir_slots: 1,
  min_teams: 2,
  draft_date: '2026-09-01',
  draft_timezone: 'America/New_York',
  // Never on either snapshot:
  owner_id: 7,
  draft_share_token: 'presenter-secret-token',
  invite_code: 'JOIN-ME-42',
  // Publication is not the default: a new column does not ship because it exists.
  some_column_added_next_quarter: 'leaks by default under SELECT *',
  ...over,
});

// A teams row WIDER than the shared read projects (it carries owner_id), so the
// presenter narrowing is proven to strip a field a future teams query might
// re-add straight through.
const teamRow = (id, draftPosition) => ({
  id,
  name: `Team ${id}`,
  draft_position: draftPosition,
  autodraft: false,
  draft_ready: true,
  teamId: id,
  teamName: `Team ${id}`,
  owner_id: 100 + id,
});

const pickRow = () => ({
  pick_number: 1,
  team_id: 11,
  is_keeper: false,
  teamId: 11,
  teamName: 'Team 11',
  player_id: 501,
  name: 'Star Runningback',
  position: 'RB',
  nfl_team: 'KC',
});

function snapshotPool(leagueOver = {}) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [wideLeagueRow(leagueOver)] })],
    [/FROM "teams"/, () => ({ rows: [teamRow(11, 1), teamRow(12, 2)] })],
    [/FROM "draft_picks"/, () => ({ rows: [pickRow()] })],
  ]);
}

test('memberSnapshot: the league key set equals MEMBER_LEAGUE_FIELDS exactly, no extra and no missing', async (t) => {
  const fake = snapshotPool().install(t);

  const snapshot = await memberSnapshot(LEAGUE_ID);

  assert.deepEqual(Object.keys(snapshot.league).sort(), [...MEMBER_LEAGUE_FIELDS].sort());
  fake.assertClean();
});

test('memberSnapshot: a league row carrying owner_id, draft_share_token and invite_code yields a league with none of the three', async (t) => {
  const fake = snapshotPool().install(t);

  const snapshot = await memberSnapshot(LEAGUE_ID);

  for (const forbidden of ['owner_id', 'draft_share_token', 'invite_code']) {
    assert.equal(forbidden in snapshot.league, false, `${forbidden} must never ride draft:state`);
  }
  // The VALUES, not only the keys: a future rename must not smuggle them back.
  const body = JSON.stringify(snapshot.league);
  for (const secret of ['presenter-secret-token', 'JOIN-ME-42', 'leaks by default under SELECT *']) {
    assert.ok(!body.includes(secret), `${secret} is not on the member snapshot`);
  }
  fake.assertClean();
});

test('presenterSnapshot: league, teams[0], picks[0] and onTheClock key sets equal the PRESENTER_* lists', async (t) => {
  const fake = snapshotPool().install(t);

  const snapshot = await presenterSnapshot(LEAGUE_ID);

  assert.deepEqual(Object.keys(snapshot.league).sort(), [...PRESENTER_LEAGUE_FIELDS].sort());
  assert.equal(snapshot.teams.length, 2);
  assert.deepEqual(Object.keys(snapshot.teams[0]).sort(), [...PRESENTER_TEAM_FIELDS].sort());
  assert.deepEqual(Object.keys(snapshot.picks[0]).sort(), [...PRESENTER_PICK_FIELDS].sort());
  assert.ok(snapshot.onTheClock, 'an active draft is on the clock');
  assert.deepEqual(Object.keys(snapshot.onTheClock).sort(), [...PRESENTER_TEAM_FIELDS].sort());
  fake.assertClean();
});

test('presenterSnapshot: the on-the-clock derivation still runs, honouring the draft order', async (t) => {
  // The presenter reads a narrow league (no team `id` published), but the shared
  // teams read carries `id`, so teamForPick still resolves - and honours
  // overrides. current_pick 1, snake, two teams -> the second slot is up.
  const fake = snapshotPool().install(t);

  const snapshot = await presenterSnapshot(LEAGUE_ID);

  assert.equal(snapshot.onTheClock.teamId, 12);
  assert.equal(snapshot.onTheClock.teamName, 'Team 12');
  fake.assertClean();
});

test('presenterSnapshot: no account id or presenter credential appears anywhere in the payload', async (t) => {
  const fake = snapshotPool().install(t);

  const snapshot = await presenterSnapshot(LEAGUE_ID);

  const body = JSON.stringify(snapshot);
  for (const forbidden of ['owner_id', 'draft_share_token', 'invite_code']) {
    assert.ok(!new RegExp(`"${forbidden}"`).test(body), `${forbidden} is not published`);
  }
  for (const secret of ['presenter-secret-token', 'JOIN-ME-42', 'leaks by default under SELECT *']) {
    assert.ok(!body.includes(secret), `${secret} is not published`);
  }
  fake.assertClean();
});

test('both snapshots return null for an unknown league', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [] })],
  ]).install(t);

  assert.equal(await memberSnapshot(404), null);
  assert.equal(await presenterSnapshot(404), null);
  fake.assertClean();
});
