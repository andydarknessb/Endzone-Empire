const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');

/**
 * GET /api/draft/board/:token - the PUBLIC presenter board (#173).
 *
 * This suite is a payload CONTRACT, not a rendering test. The route is
 * reachable with no credentials by anyone holding a league's share link, and
 * `getDraftState` feeds it `SELECT * FROM "leagues"`, so the route's own
 * projection is the only thing standing between an anonymous viewer and every
 * column of that table. The assertions below pin the EXACT key set of the
 * public `league`, of a `teams[]` entry, of `onTheClock` and of a `picks[]`
 * entry, so a column added to `leagues` (or a field added to the snapshot)
 * fails here loudly instead of shipping to anonymous viewers silently.
 *
 * The fake deliberately answers with rows that are WIDER than the contract,
 * including account identity and a stand-in for "some column added next
 * quarter". A denylist implementation passes the named-field assertions and
 * fails the exact-key-set ones, which is the whole point of the shape.
 */

const TOKEN = 'presenter-share-token';

// Everything `SELECT * FROM "leagues"` can hand the route today, plus a
// stand-in for tomorrow's column.
const wideLeagueRow = (over = {}) => ({
  id: 3,
  name: 'The Gridiron Society',
  owner_id: 7,
  invite_code: 'JOIN-ME-42',
  draft_share_token: TOKEN,
  draft_status: 'active',
  draft_paused: false,
  pick_deadline_at: '2026-09-01T00:00:00.000Z',
  draft_rounds: 15,
  roster_limit: 16,
  ir_slots: 1,
  current_pick: 1,
  draft_rotation: 'snake',
  draft_order_overrides: null,
  scoring_preset: 'half_ppr',
  pickem_only: false,
  some_column_added_next_quarter: 'leaks by default under a denylist',
  ...over,
});

// The teams query joins users and aliases "users"."username" AS "owner".
const wideTeamRow = (id, draftPosition, over = {}) => ({
  id,
  name: `Team ${id}`,
  teamId: id,
  teamName: `Team ${id}`,
  draft_position: draftPosition,
  autodraft: false,
  draft_ready: true,
  owner_id: 100 + id,
  owner: `manager${id}`,
  ...over,
});

const widePickRow = (over = {}) => ({
  pick_number: 1,
  team_id: 11,
  is_keeper: false,
  teamId: 11,
  teamName: 'Team 11',
  player_id: 501,
  name: 'Star Runningback',
  position: 'RB',
  nfl_team: 'KC',
  ...over,
});

function presenterPool({ league = {}, teams, picks } = {}) {
  const teamRows = teams || [wideTeamRow(11, 1), wideTeamRow(12, 2)];
  const pickRows = picks || [widePickRow()];
  return createFakePool([
    // The token lookup and the snapshot's league read are both
    // `... FROM "leagues"`, so they are separated by their predicates rather
    // than by the shared select() shape matcher.
    [/FROM "leagues" WHERE "draft_share_token" = \$1/, () => ({ rows: [{ id: 3 }] })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [wideLeagueRow(league)] })],
    [/FROM "teams" JOIN "users"/, () => ({ rows: teamRows })],
    [/FROM "draft_picks" JOIN "players"/, () => ({ rows: pickRows })],
  ]);
}

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

const getBoard = () => request(app).get(`/api/draft/board/${TOKEN}`);

test('the snapshot the presenter route projects from is an unrestricted SELECT *', async (t) => {
  // This is why the route needs an allowlist rather than a denylist: the row
  // it starts from is every column of "leagues", present and future. If this
  // ever stops being true the projection can be reconsidered, but until then
  // the exact-key-set assertions below are the only backstop.
  const fake = presenterPool().install(t);

  await getBoard();

  assert.ok(
    fake.calls.some((call) => /^SELECT \* FROM "leagues" WHERE "id" = \$1/.test(call.text)),
    'getDraftState still reads the league with SELECT *'
  );
  fake.assertClean();
});

test('the public league object carries exactly the presenter board fields', async (t) => {
  const fake = presenterPool().install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(
    Object.keys(res.body.league).sort(),
    [
      'draft_paused',
      'draft_rounds',
      'draft_status',
      'ir_slots',
      'name',
      'pick_deadline_at',
      'roster_limit',
    ],
    'the public league is an allowlist: add a key here only to publish it anonymously'
  );
  fake.assertClean();
});

test('a public teams[] entry carries exactly Team identity and draft position', async (t) => {
  const fake = presenterPool().install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.teams.length, 2);
  for (const team of res.body.teams) {
    assert.deepEqual(Object.keys(team).sort(), ['draft_position', 'teamId', 'teamName']);
  }
  fake.assertClean();
});

test('the public onTheClock carries exactly the same fields as a teams[] entry', async (t) => {
  const fake = presenterPool().install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(res.body.onTheClock, 'an active draft is on the clock');
  assert.deepEqual(
    Object.keys(res.body.onTheClock).sort(),
    ['draft_position', 'teamId', 'teamName']
  );
  fake.assertClean();
});

test('a public picks[] entry carries exactly the pick and its Team identity', async (t) => {
  const fake = presenterPool().install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(
    Object.keys(res.body.picks[0]).sort(),
    ['is_keeper', 'name', 'nfl_team', 'pick_number', 'player_id', 'position', 'teamId', 'teamName']
  );
  fake.assertClean();
});

test('the key set is the allowlist, not the row: a sparse snapshot still answers every field', async (t) => {
  // A consumer reads these fields unconditionally, the rule teamIdentityOf()
  // states for Team identity. A row missing one answers null; it never drops
  // the key, so the contract cannot quietly narrow when a query changes.
  const fake = presenterPool({
    league: { pick_deadline_at: undefined, draft_rounds: undefined },
    teams: [{ id: 11, teamId: 11, teamName: 'Team 11' }],
    picks: [{ pick_number: 1, teamId: 11, name: 'Star Runningback' }],
  }).install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(
    Object.keys(res.body.league).sort(),
    ['draft_paused', 'draft_rounds', 'draft_status', 'ir_slots', 'name', 'pick_deadline_at', 'roster_limit']
  );
  assert.equal(res.body.league.pick_deadline_at, null);
  assert.deepEqual(Object.keys(res.body.teams[0]).sort(), ['draft_position', 'teamId', 'teamName']);
  assert.equal(res.body.teams[0].draft_position, null);
  assert.deepEqual(
    Object.keys(res.body.picks[0]).sort(),
    ['is_keeper', 'name', 'nfl_team', 'pick_number', 'player_id', 'position', 'teamId', 'teamName']
  );
  assert.equal(res.body.picks[0].nfl_team, null);
  fake.assertClean();
});

test('the response body is exactly league, teams, picks and onTheClock', async (t) => {
  const fake = presenterPool().install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body).sort(), ['league', 'onTheClock', 'picks', 'teams']);
  fake.assertClean();
});

test('no account identity or secret appears anywhere in the response', async (t) => {
  const fake = presenterPool().install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const body = JSON.stringify(res.body);
  for (const forbidden of ['owner', 'owner_id', 'username', 'email', 'invite_code', 'draft_share_token']) {
    assert.ok(!new RegExp(`"${forbidden}"`).test(body), `${forbidden} is not published`);
  }
  // The VALUES, not only the keys: a rename must not smuggle them back.
  for (const secret of ['manager11', 'manager12', 'JOIN-ME-42', TOKEN, 'leaks by default under a denylist']) {
    assert.ok(!body.includes(secret), `${secret} is not published`);
  }
  fake.assertClean();
});

test('the presenter board still renders: teams are named, picks and the clock resolve by teamId', async (t) => {
  const fake = presenterPool().install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.league.name, 'The Gridiron Society');
  assert.equal(res.body.league.draft_status, 'active');
  assert.deepEqual(res.body.teams.map((team) => team.teamName), ['Team 11', 'Team 12']);
  assert.deepEqual(res.body.teams.map((team) => team.draft_position), [1, 2]);
  // current_pick is 0-based: one pick is in, so the second slot is up.
  assert.equal(res.body.onTheClock.teamId, 12);
  assert.equal(res.body.onTheClock.teamName, 'Team 12');
  assert.equal(res.body.picks[0].teamId, 11);
  assert.equal(res.body.picks[0].name, 'Star Runningback');
  fake.assertClean();
});

test('a pending draft has no onTheClock and still projects the league', async (t) => {
  const fake = presenterPool({ league: { draft_status: 'pending' } }).install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.onTheClock, null);
  assert.equal(res.body.league.draft_status, 'pending');
  fake.assertClean();
});

test('an unknown share token is a 404 that publishes nothing', async (t) => {
  const fake = createFakePool([
    [/FROM "leagues" WHERE "draft_share_token" = \$1/, () => ({ rows: [] })],
  ]).install(t);

  const res = await getBoard();

  assert.equal(res.status, 404);
  assert.deepEqual(Object.keys(res.body), ['error']);
  fake.assertClean();
});
