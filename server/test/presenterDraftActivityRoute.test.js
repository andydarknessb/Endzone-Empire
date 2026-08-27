const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');

/**
 * GET /api/draft/board/:token/activity - the PUBLIC presenter-safe Draft
 * activity feed (#438).
 *
 * The member combined feed (/api/league/:id/draft-feed) carries League chat
 * alongside Draft activity and so refuses a non-member; #438 is the SEPARATE
 * anonymous surface that exposes the Draft-activity half alone. This suite is a
 * privacy CONTRACT: it pins that the route is reachable with no credentials,
 * resolves the league from the share token, reads draft_activity and NEVER
 * chat_messages, and returns Team-only Pick and lifecycle entries with no
 * account identity, chat, tombstone or correction reason anywhere in the body.
 */

const TOKEN = 'presenter-share-token';

const pickRow = (over = {}) => ({
  id: 3,
  feed_seq: '8',
  created_at: '2026-09-01T00:01:00.000Z',
  kind: 'pick',
  teamId: 11,
  teamName: 'Gridiron Ghosts',
  player_id: 500,
  player_name: 'Star Runningback',
  player_position: 'RB',
  player_nfl_team: 'KC',
  round: 1,
  pick_number: 1,
  is_autopick: false,
  is_legacy: false,
  ...over,
});

const pauseRow = (over = {}) => ({
  id: 4,
  feed_seq: '9',
  created_at: '2026-09-01T00:02:00.000Z',
  kind: 'pause',
  teamId: 11,
  teamName: 'Gridiron Ghosts',
  player_id: null,
  player_name: null,
  player_position: null,
  player_nfl_team: null,
  round: null,
  pick_number: null,
  is_autopick: null,
  is_legacy: false,
  ...over,
});

function activityPool({ league = [{ id: 3 }], rows } = {}) {
  const activity = rows || [pickRow(), pauseRow()];
  return createFakePool([
    [/FROM "leagues" WHERE "draft_share_token" = \$1/, () => ({ rows: league })],
    [/FROM "draft_activity"/, () => ({ rows: activity })],
  ]);
}

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

const getActivity = (token = TOKEN) =>
  request(app).get(`/api/draft/board/${token}/activity`);

test('returns Team-only Pick and lifecycle entries, oldest-first, with no auth', async (t) => {
  const fake = activityPool().install(t);

  const res = await getActivity();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 2);
  assert.deepEqual(res.body[0], {
    type: 'draft_activity',
    kind: 'pick',
    id: 3,
    seq: 8,
    teamId: 11,
    teamName: 'Gridiron Ghosts',
    player: { id: 500, name: 'Star Runningback', position: 'RB', nflTeam: 'KC' },
    round: 1,
    pickNumber: 1,
    isAutopick: false,
    isLegacy: false,
    created_at: '2026-09-01T00:01:00.000Z',
  });
  assert.deepEqual(res.body[1], {
    type: 'draft_activity',
    kind: 'pause',
    id: 4,
    seq: 9,
    teamId: 11,
    teamName: 'Gridiron Ghosts',
    isLegacy: false,
    created_at: '2026-09-01T00:02:00.000Z',
  });
  fake.assertClean();
});

test('never queries chat_messages, user_blocks or the unread marker', async (t) => {
  const fake = activityPool().install(t);

  await getActivity();

  for (const call of fake.calls) {
    assert.ok(!/"chat_messages"/.test(call.text), 'the presenter activity route never reads chat_messages');
    assert.ok(!/"user_blocks"/.test(call.text), 'never consults the block relation');
    assert.ok(!/"chat_reads"/.test(call.text), 'never consults the unread marker');
  }
  fake.assertClean();
});

test('no account identity, chat, tombstone or correction reason appears in the body', async (t) => {
  const fake = activityPool({
    rows: [pickRow({ kind: 'correction' })],
  }).install(t);

  const res = await getActivity();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  const body = JSON.stringify(res.body);
  for (const forbidden of [
    'user_id', 'owner_id', 'username', 'email', 'invite_code', 'draft_share_token',
    'message', 'hidden', 'reason', 'unread',
  ]) {
    assert.ok(!new RegExp(`"${forbidden}"`).test(body), `${forbidden} is not published`);
  }
  fake.assertClean();
});

test('an unknown share token is a 404 that reads no activity and publishes nothing', async (t) => {
  const fake = activityPool({ league: [] }).install(t);

  const res = await getActivity('nope');

  assert.equal(res.status, 404);
  assert.deepEqual(Object.keys(res.body), ['error']);
  assert.ok(
    !fake.calls.some((call) => /"draft_activity"/.test(call.text)),
    'an unknown token never reaches the activity read'
  );
  fake.assertClean();
});

test('?before=<seq> pages older, handed through as a bound integer', async (t) => {
  const fake = activityPool().install(t);
  await getActivity().query({ before: '8' });
  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  assert.match(query.text, /"draft_activity"\."feed_seq" < \$2/);
  assert.ok(query.params.includes(8));
  fake.assertClean();
});

test('?after=<seq> resumes newer, handed through as a bound integer', async (t) => {
  const fake = activityPool().install(t);
  await getActivity().query({ after: '8' });
  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  assert.match(query.text, /"draft_activity"\."feed_seq" > \$2/);
  assert.ok(query.params.includes(8));
  fake.assertClean();
});

test('a non-integer cursor is ignored rather than binding a bad value', async (t) => {
  const fake = activityPool().install(t);
  await getActivity().query({ before: 'abc' });
  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  // Only leagueId and the page-size cap, no cursor param.
  assert.equal(query.params.length, 2);
  fake.assertClean();
});
