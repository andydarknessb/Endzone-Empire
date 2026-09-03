const { test } = require('node:test');
const assert = require('node:assert/strict');
// The correct-pick route refreshes the board and appends the correction through
// the one Draft room adapter (#745); register a recording broadcast per test.
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
registerRecordingBroadcast();
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');

/**
 * POST /api/draft/league/:id/correct-pick - Commissioner correction (#439).
 *
 * The correction is ONE safe, reasoned administrative act: a commissioner
 * records a 10-200 character reason, then the server pauses the Draft and
 * reverses ONLY its latest non-keeper Pick as a single transaction, appends an
 * append-only correction entry, and LEAVES THE DRAFT PAUSED (CONTEXT.md:
 * Commissioner correction). It cannot cross a keeper, cannot run after the Draft
 * completes, and cannot reverse a Pick other than the one the commissioner
 * confirmed - each refusal a stable SCREAMING_SNAKE code (ADR 0008).
 *
 * These pin the wire behaviour through the route; the pure target decision is
 * unit-tested in draftValidation.test.js (correctionTarget) and the activity
 * shape in draftActivity.service.test.js.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'draft-correction-route-test-secret';
require('node:test').after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const COMMISSIONER = 9;
const LEAGUE_ID = 5;
const SEASON = 2026;
const WEEK = 1;
const authed = () => `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`;

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

const REASON = 'entered against the wrong team; correcting this before we resume play';

const CORRECTED_TEAM = { id: 30, name: 'Gridiron Ghosts' };
const CORRECTED_PLAYER = { id: 500, name: 'Wrong Guy', position: 'RB', nfl_team: 'KC' };

/**
 * A world for the correction route. `status` sets the league's draft_status,
 * `isCommissioner` whether the acting user passes the commissioner predicate,
 * and `picks` the draft_picks rows. `currentPick` is the 0-based pick on the
 * clock (defaults to the highest live pick number so the latest reached pick is
 * the last live one).
 */
function correctionPool({
  status = 'active',
  isCommissioner = true,
  picks = [{ pick_number: 3, team_id: CORRECTED_TEAM.id, player_id: CORRECTED_PLAYER.id, is_keeper: false }],
  currentPick = 3,
} = {}) {
  return createFakePool([
    // requireFantasyLeague middleware: a pick'em-only league has no draft.
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    // The league, locked for update by id (no predicate, so the route can name
    // distinct refusals for not-commissioner vs not-active).
    [/FROM "leagues"[\s\S]*FOR UPDATE/, () => ({
      rows: [{
        id: LEAGUE_ID, draft_status: status, current_pick: currentPick, draft_paused: false,
        current_season: SEASON, current_week: WEEK, draft_rotation: 'snake', draft_order_overrides: null,
      }],
    })],
    // isLeagueCommissioner
    [/SELECT 1 FROM "leagues" WHERE "id" = \$1 AND/, () => ({ rows: isCommissioner ? [{ ok: 1 }] : [] })],
    [select('teams'), () => ({ rows: [{ ...CORRECTED_TEAM, owner_id: 77, draft_position: 1, autodraft: false }] })],
    [select('draft_picks'), () => ({ rows: picks })],
    [select('players'), () => ({ rows: [CORRECTED_PLAYER] })],
    // removeLineupEntries reads (no kickoff this week, not a final week).
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
    [select('matchups'), () => ({ rows: [] })],
    [remove('draft_picks'), () => ({ rows: [], rowCount: 1 })],
    [remove('team_players'), () => ({ rows: [], rowCount: 1 })],
    [remove('lineup_entries'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [{ id: LEAGUE_ID }], rowCount: 1 })],
    [insert('draft_activity'), () => ({ rows: [{ id: 30, feed_seq: '18', created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })],
  ]);
}

const correct = (body) => request(app)
  .post(`/api/draft/league/${LEAGUE_ID}/correct-pick`)
  .set('Authorization', authed())
  .send(body);

test('POST correct-pick: pauses, reverses the latest non-keeper Pick, appends a correction and stays paused', async (t) => {
  const fake = correctionPool().install(t);

  const res = await correct({ pickNumber: 3, reason: REASON });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.paused, true, 'the draft is left paused');
  assert.equal(res.body.pickNumber, 3);
  assert.equal(res.body.currentPick, 2, 'the clock rewinds to the corrected slot');

  // Exactly the corrected Pick was reversed.
  const pickDelete = fake.matching(remove('draft_picks'));
  assert.equal(pickDelete.length, 1);
  assert.deepEqual(pickDelete[0].params, [LEAGUE_ID, 3]);
  assert.equal(fake.matching(remove('team_players')).length, 1);
  assert.equal(fake.matching(remove('lineup_entries')).length, 1);

  // The league UPDATE pauses and rewinds in the same transaction.
  const leagueUpdate = fake.matching(update('leagues'));
  assert.equal(leagueUpdate.length, 1);
  assert.match(leagueUpdate[0].text, /"draft_paused" = true/);
  assert.match(leagueUpdate[0].text, /"pick_deadline_at" = NULL/);

  // The correction activity snapshots the reversed Pick and carries the reason.
  const appended = fake.matching(insert('draft_activity'));
  assert.equal(appended.length, 1, 'exactly one correction activity appended');
  assert.equal(appended[0].params[1], 'correction');
  assert.ok(appended[0].params.includes(REASON), 'the reason is stored');
  assert.equal(fake.matching(/^DELETE FROM "draft_activity"/).length, 0, 'append-only: no activity deleted');

  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  fake.assertClean();
});

test('POST correct-pick: locks the league FOR UPDATE before any mutation, serializing against a concurrent pick', async (t) => {
  // The concurrency defence (#439: cannot race a manager or autopick) is the
  // SAME row lock draftPlayer takes: both do SELECT ... FOR UPDATE on the league
  // before touching draft_picks, so a correction and a concurrent pick serialize
  // on it. This proves correctLatestPick ISSUES that lock, before any
  // DELETE/UPDATE. It does NOT prove Postgres actually serialises two real
  // transactions on it - a matcher fake has no lock manager. Its sibling,
  // draftCorrection.pg.test.js, proves that runtime half against a real Postgres;
  // neither is sufficient alone, and the honest residual gap (the pg test replays
  // correctLatestPick's statements, so a drift between them escapes both) is named
  // there.
  const fake = correctionPool().install(t);

  const res = await correct({ pickNumber: 3, reason: REASON });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const order = fake.calls.map((c) => c.text);
  const lockIdx = order.findIndex((t2) => /FROM "leagues"[\s\S]*FOR UPDATE/.test(t2));
  const firstMutationIdx = order.findIndex((t2) => /^DELETE|^UPDATE/.test(t2));
  assert.ok(lockIdx >= 0, 'the league is locked FOR UPDATE');
  assert.ok(firstMutationIdx > lockIdx, 'the lock is taken before any DELETE/UPDATE');
});

test('POST correct-pick: a reason shorter than 10 characters is rejected before any DB write', async (t) => {
  const fake = correctionPool().install(t);

  const res = await correct({ pickNumber: 3, reason: 'oops' });

  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'CORRECTION_REASON_INVALID');
  assert.equal(fake.matching(/^BEGIN$/).length, 0, 'no transaction opened');
  assert.equal(fake.matching(/^DELETE/).length, 0);
});

test('POST correct-pick: a reason longer than 200 characters is rejected', async (t) => {
  correctionPool().install(t);
  const res = await correct({ pickNumber: 3, reason: 'x'.repeat(201) });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.code, 'CORRECTION_REASON_INVALID');
});

test('POST correct-pick: a non-commissioner is refused with NOT_COMMISSIONER and no reversal', async (t) => {
  const fake = correctionPool({ isCommissioner: false }).install(t);

  const res = await correct({ pickNumber: 3, reason: REASON });

  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(res.body.code, 'NOT_COMMISSIONER');
  assert.equal(fake.matching(/^DELETE/).length, 0);
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1);
});

test('POST correct-pick: a completed Draft is refused with DRAFT_ALREADY_COMPLETE', async (t) => {
  const fake = correctionPool({ status: 'complete' }).install(t);

  const res = await correct({ pickNumber: 3, reason: REASON });

  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'DRAFT_ALREADY_COMPLETE');
  assert.equal(fake.matching(/^DELETE/).length, 0);
});

test('POST correct-pick: a keeper as the latest reached Pick is refused with KEEPER_UNCORRECTABLE', async (t) => {
  const fake = correctionPool({
    picks: [{ pick_number: 3, team_id: CORRECTED_TEAM.id, player_id: CORRECTED_PLAYER.id, is_keeper: true }],
  }).install(t);

  const res = await correct({ pickNumber: 3, reason: REASON });

  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'KEEPER_UNCORRECTABLE');
  assert.equal(fake.matching(/^DELETE/).length, 0);
});

test('POST correct-pick: a stale expected Pick number is refused with LATEST_PICK_CHANGED', async (t) => {
  // The commissioner confirmed pick 2, but pick 3 has since landed.
  const fake = correctionPool({
    picks: [
      { pick_number: 2, team_id: CORRECTED_TEAM.id, player_id: 400, is_keeper: false },
      { pick_number: 3, team_id: CORRECTED_TEAM.id, player_id: CORRECTED_PLAYER.id, is_keeper: false },
    ],
  }).install(t);

  const res = await correct({ pickNumber: 2, reason: REASON });

  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'LATEST_PICK_CHANGED');
  assert.equal(fake.matching(/^DELETE/).length, 0);
});
