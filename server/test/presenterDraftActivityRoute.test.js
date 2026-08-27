const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { keys, withheld, NEXT_QUARTER } = require('./helpers/payloadShape');

/**
 * The payload contract of GET /api/draft/board/:token/activity - the PUBLIC
 * presenter-safe Draft activity feed (#438), sibling to draftPresenterBoard.
 *
 * These acceptance criteria are mostly ABSENCES (no chat, no unread, no
 * composer, no tombstone, no account identity), and an absence is trivially
 * satisfied by a fixture that never carried the thing. This repository has been
 * bitten by exactly that: a forbidden-key loop passed against vulnerable code
 * because some of its names were in no fixture. So this suite follows the
 * established convention (server/test/helpers/payloadShape.js, as
 * publicPayloadShape.test.js does): it asserts the EXACT key set of every entry
 * and of the nested player object, and it makes every fixture row WIDER than the
 * contract - carrying chat, moderation, account-identity and next-quarter decoys
 * built by `withheld` from ONE object, so a decoy can never be asserted-against
 * without also being supplied. A serializer that spread its row instead of
 * naming its fields passes a denylist and fails the exact-set assertions here.
 */

const TOKEN = 'presenter-share-token';

// Every fixture row is WIDER than the contract: alongside the real
// draft_activity columns it carries the decoys below. activityEntryOf builds a
// fresh, named-key object, so none of them may survive into a presenter entry.
const { decoys: DECOYS, assertWithheld } = withheld({
  // account identity a future join might re-introduce (AC4)
  user_id: 9,
  owner_id: 42,
  username: 'account-holder',
  email: 'manager@example.com',
  // presenter's own credential and league scoping
  draft_share_token: TOKEN,
  league_id: 3,
  // chat and moderation surface that must never reach a presenter (AC2)
  message: 'secret-league-chat-content',
  hidden_at: '2026-09-01T00:00:00.000Z',
  // the commissioner correction free-text, by VALUE, so the reason-strip is
  // proven and not merely asserted about
  reason: 'commissioner-only-correction-note',
  // "a column someone adds next quarter"
  a_column_added_next_quarter: NEXT_QUARTER,
});

const PICK_KEYS = [
  'type', 'kind', 'id', 'seq', 'teamId', 'teamName',
  'player', 'round', 'pickNumber', 'isAutopick', 'isLegacy', 'created_at',
].sort();
const PLAYER_KEYS = ['id', 'name', 'position', 'nflTeam'].sort();
const LIFECYCLE_KEYS = [
  'type', 'kind', 'id', 'seq', 'teamId', 'teamName', 'isLegacy', 'created_at',
].sort();
// A correction is Pick-shaped (it snapshots the reversed Pick) but carries
// neither isAutopick (only a Pick can) nor reason (stripped for a presenter).
const CORRECTION_KEYS = [
  'type', 'kind', 'id', 'seq', 'teamId', 'teamName',
  'player', 'round', 'pickNumber', 'isLegacy', 'created_at',
].sort();

const pickRow = (over = {}) => ({
  ...DECOYS,
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
  ...DECOYS,
  id: 4,
  feed_seq: '9',
  created_at: '2026-09-01T00:02:00.000Z',
  kind: 'pause',
  teamId: 11,
  teamName: 'Gridiron Ghosts',
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

test('a Pick entry carries EXACTLY the allowed keys, and the player object exactly its own', async (t) => {
  const fake = activityPool({ rows: [pickRow()] }).install(t);

  const res = await getActivity();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body[0]), PICK_KEYS, 'a Pick entry is an exact allowlist');
  assert.deepEqual(keys(res.body[0].player), PLAYER_KEYS, 'the nested player is an exact allowlist');
  assertWithheld(res.body);
  fake.assertClean();
});

test('a lifecycle entry carries EXACTLY the base keys and NO Pick fields', async (t) => {
  const fake = activityPool({ rows: [pauseRow()] }).install(t);

  const res = await getActivity();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body[0]), LIFECYCLE_KEYS, 'a lifecycle entry is an exact allowlist');
  assertWithheld(res.body);
  fake.assertClean();
});

test('a correction entry is Pick-shaped but carries NO reason and NO isAutopick', async (t) => {
  const fake = activityPool({
    rows: [pickRow({ id: 7, feed_seq: '10', kind: 'correction' })],
  }).install(t);

  const res = await getActivity();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body[0]), CORRECTION_KEYS, 'a correction entry is an exact allowlist');
  // The correction free-text is proven absent by VALUE, not just by the missing
  // key: the reason decoy value must appear nowhere in the body.
  assertWithheld(res.body);
  fake.assertClean();
});

test('the exact-set holds for a mixed page: every entry is one of the three shapes', async (t) => {
  const fake = activityPool({
    rows: [
      pickRow(),
      pauseRow(),
      pickRow({ id: 7, feed_seq: '10', kind: 'correction' }),
    ],
  }).install(t);

  const res = await getActivity();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(keys(res.body[0]), PICK_KEYS);
  assert.deepEqual(keys(res.body[1]), LIFECYCLE_KEYS);
  assert.deepEqual(keys(res.body[2]), CORRECTION_KEYS);
  assertWithheld(res.body);
  fake.assertClean();
});

test('returns entries oldest-first with no auth, resolving the league from the share token', async (t) => {
  const fake = activityPool().install(t);

  const res = await getActivity();

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.length, 2);
  assert.equal(res.body[0].kind, 'pick');
  assert.equal(res.body[0].teamName, 'Gridiron Ghosts');
  assert.equal(res.body[1].kind, 'pause');
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

test('an unknown share token is a 404 that reads no activity and publishes nothing', async (t) => {
  const fake = activityPool({ league: [] }).install(t);

  const res = await getActivity('nope');

  assert.equal(res.status, 404);
  assert.deepEqual(keys(res.body), ['error']);
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
  assert.match(query.text, /"draft_activity"\."feed_seq" < \$3/);
  assert.ok(query.params.includes(8));
  fake.assertClean();
});

test('?after=<seq> resumes newer, handed through as a bound integer', async (t) => {
  const fake = activityPool().install(t);
  await getActivity().query({ after: '8' });
  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  assert.match(query.text, /"draft_activity"\."feed_seq" > \$3/);
  assert.ok(query.params.includes(8));
  fake.assertClean();
});

test('a non-integer cursor is ignored rather than binding a bad value', async (t) => {
  const fake = activityPool().install(t);
  await getActivity().query({ before: 'abc' });
  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  // leagueId, the kind allowlist and the page-size cap - no cursor param.
  assert.equal(query.params.length, 3);
  fake.assertClean();
});
