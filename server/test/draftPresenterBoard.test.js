const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const {
  PRESENTER_LEAGUE_FIELDS,
  PRESENTER_TEAM_FIELDS,
  PRESENTER_PICK_FIELDS,
} = require('./helpers/draftStatePins');

/**
 * GET /api/draft/board/:token - the PUBLIC presenter board (#173, #788).
 *
 * This suite is a payload CONTRACT, not a rendering test. The route is
 * reachable with no credentials by anyone holding a league's share link, and it
 * serves `presenterSnapshot` (server/services/draftRoomSnapshot.js), a NARROW
 * query that selects only the published league, team and pick fields - never
 * `SELECT *`, never `owner_id` / `draft_share_token`. The assertions below pin
 * the EXACT key set of the public `league`, of a `teams[]` entry, of
 * `onTheClock` and of a `picks[]` entry against the INDEPENDENT PRESENTER_*
 * copies in draftStatePins.js, so a column added to the snapshot's published
 * list fails here loudly instead of shipping to anonymous viewers silently.
 *
 * The fake deliberately answers with rows that are WIDER than the contract,
 * including account identity and a stand-in for "some column added next
 * quarter". Because the snapshot names its output fields, none of the extra
 * columns survive - the exact-key-set assertions are what prove it.
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

// The teams query no longer joins users or projects an owner (#344); this
// fixture still carries owner/owner_id/username/email as WIDER-than-contract
// rows, so the presenter allowlist is proven to strip a field a future query
// might re-add straight through (see the forbidden-key loop below).
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
  // Not on the teams query today: the alias is `owner`. They are here because
  // the forbidden-key loop below can only prove what the fixture supplies, and
  // a loop that lists a key no fixture carries asserts nothing while reading
  // as a guarantee. A query later written to select "users"."username" or
  // "users"."email" straight through is exactly the case that assertion is
  // named for, so the fixture has to contain it.
  username: `account${id}`,
  email: `manager${id}@example.com`,
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
    // than by the shared select() shape matcher. The snapshot's read now names
    // its columns (#788), so it is matched by its `WHERE "id"` predicate, not by
    // a `SELECT *` prefix.
    [/FROM "leagues" WHERE "draft_share_token" = \$1/, () => ({ rows: [{ id: 3 }] })],
    [/FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [wideLeagueRow(league)] })],
    [/FROM "teams"\s+WHERE/, () => ({ rows: teamRows })],
    [/FROM "draft_picks" JOIN "players"/, () => ({ rows: pickRows })],
  ]);
}

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

const getBoard = () => request(app).get(`/api/draft/board/${TOKEN}`);

test('the public league object carries exactly the presenter board fields', async (t) => {
  const fake = presenterPool().install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(
    Object.keys(res.body.league).sort(),
    [...PRESENTER_LEAGUE_FIELDS].sort(),
    'the public league is the published list: add a key to draftRoomSnapshot.js only to publish it anonymously'
  );
  fake.assertClean();
});

test('a public teams[] entry carries exactly Team identity and draft position', async (t) => {
  const fake = presenterPool().install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.teams.length, 2);
  for (const team of res.body.teams) {
    assert.deepEqual(Object.keys(team).sort(), [...PRESENTER_TEAM_FIELDS].sort());
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
    [...PRESENTER_TEAM_FIELDS].sort()
  );
  fake.assertClean();
});

test('a public picks[] entry carries exactly the pick and its Team identity', async (t) => {
  const fake = presenterPool().install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(
    Object.keys(res.body.picks[0]).sort(),
    [...PRESENTER_PICK_FIELDS].sort()
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
    [...PRESENTER_LEAGUE_FIELDS].sort()
  );
  assert.equal(res.body.league.pick_deadline_at, null);
  assert.deepEqual(Object.keys(res.body.teams[0]).sort(), [...PRESENTER_TEAM_FIELDS].sort());
  assert.equal(res.body.teams[0].draft_position, null);
  assert.deepEqual(
    Object.keys(res.body.picks[0]).sort(),
    [...PRESENTER_PICK_FIELDS].sort()
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
  for (const secret of [
    'manager11', 'manager12', 'account11', 'account12',
    'manager11@example.com', 'manager12@example.com',
    'JOIN-ME-42', TOKEN, 'leaks by default under a denylist',
  ]) {
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

test('a pending draft has no onTheClock and still allowlists the league', async (t) => {
  const fake = presenterPool({ league: { draft_status: 'pending' } }).install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.onTheClock, null);
  assert.equal(res.body.league.draft_status, 'pending');
  fake.assertClean();
});

test('the presenter board never carries League chat, a hidden message or its tombstone (#441 AC5)', async (t) => {
  // League chat, moderated or not, is never exposed through a presenter link
  // (ADR 0012). The presenter route reads league/teams/picks only, so a hidden
  // message and its "Message hidden by commissioner" tombstone cannot reach an
  // anonymous viewer: the route never touches chat_messages at all, and the
  // body is the fixed {league, teams, picks, onTheClock} allowlist.
  const fake = presenterPool().install(t);

  const res = await getBoard();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  // The presenter route reads no chat, so no tombstone or moderation state can
  // ride along.
  assert.ok(
    !fake.calls.some((call) => /"chat_messages"/.test(call.text)),
    'the presenter route never queries chat_messages'
  );
  const body = JSON.stringify(res.body);
  for (const forbidden of ['chat', 'message', 'hidden', 'Message hidden by commissioner', 'hidden_reason']) {
    assert.ok(!body.includes(forbidden), `presenter body carries no ${forbidden}`);
  }
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
