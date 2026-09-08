const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');
const draftRoomBroadcast = require('../modules/draftRoomBroadcast');
const pickClock = require('../services/pickClock.service');

/**
 * The one fan-out order, across the two PROCESSES that emit it (#967, part of
 * #938).
 *
 * The defect #938 names: "the same domain event, 'the draft is now paused, here
 * is its lifecycle entry', fans out in one order from the router and the
 * opposite order from the Pick clock, in two different processes, with nothing
 * owning which is right." ADR 0025's 2026-09-03 amendment assigns the order to
 * the Pick module, and the shipped order there puts the narration ahead of the
 * board facts. The Draft act module adopts it for every router act; the Pick
 * clock's nothing-draftable escalation (#602) emits the same pair from the
 * worker.
 *
 * This test drives BOTH emitters against the same recording broadcast and
 * asserts they produce the identical sequence, so the two-process divergence
 * cannot come back by an edit to either side alone. It is deliberately NOT an
 * assertion that each equals a hard-coded literal: the binding claim is that the
 * two agree, and a literal on each side would let a future PR flip both and stay
 * green. The literal is asserted once, separately, as the ADR's own order.
 *
 * RED-TELL: swap the two lines after `escalateNothingDraftable` in
 * pickClock.service.js (emit stateChanged before activityAppended, the order
 * that shipped before #602's alignment) and "the escalation path and a router
 * act emit the same event order" goes red. Swapping the act module's fan-out
 * (board facts before narration in runFanout) reddens it from the other side.
 */

const LEAGUE_ID = 5;
const COMMISSIONER = 9;
const ACTOR_TEAM = { id: 30, name: 'Commish FC' };
const SEASON = 2026;
const STUCK_TEAM = { id: 30, name: 'Commish FC', autodraft: false, draft_position: 1 };

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'draft-fanout-order-test-secret';
require('node:test').after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

/**
 * One recording broadcast, shared by both emitters, so the two sequences are
 * read off the same instrument rather than two lookalikes.
 */
function installRecorder(t) {
  const calls = [];
  const record = (method) => (leagueId) => {
    calls.push(method);
    return { delivered: true, transport: 'fanout-order-test' };
  };
  const prior = draftRoomBroadcast.peekDraftRoomBroadcast();
  draftRoomBroadcast.setDraftRoomBroadcast({
    activityAppended: record('activityAppended'),
    stateChanged: record('stateChanged'),
    rosterChanged: record('rosterChanged'),
    draftCompleted: record('draftCompleted'),
    pickLanded: record('pickLanded'),
    scoresUpdated: record('scoresUpdated'),
  });
  t.after(() => draftRoomBroadcast.setDraftRoomBroadcast(prior));
  return calls;
}

// --- the worker's emitter: the nothing-draftable escalation (#602) -----------

// Elapsed well in the past, so autoPick's expiry guard (#601) lets it through.
const ESCALATION_LEAGUE = {
  id: LEAGUE_ID,
  draft_status: 'active',
  draft_paused: false,
  draft_type: 'online',
  current_pick: 0,
  current_season: SEASON,
  draft_rotation: 'snake',
  draft_order_overrides: null,
  pick_deadline_at: new Date('2000-01-01T00:00:00.000Z'),
};

/**
 * A world where the on-clock team has NO draftable candidate, which is the only
 * way into escalateNothingDraftable: autoPick walks its candidate list, finds it
 * empty, and escalates instead of spinning on the same elapsed deadline.
 */
function escalationWorld() {
  return createFakePool([
    // escalateNothingDraftable's own locked read, ahead of autoPick's unlocked
    // one: both are SELECT * FROM "leagues" WHERE "id" = $1.
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE$/, () => ({ rows: [ESCALATION_LEAGUE] })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1$/, () => ({ rows: [ESCALATION_LEAGUE] })],
    [/EXTRACT\(MONTH FROM CURRENT_DATE\)/, () => ({ rows: [{ season: 2025 }] })],
    // The candidate query, answered EMPTY: nothing is draftable.
    [/FROM "players"/, () => ({ rows: [] })],
    [/FROM "team_players"/, () => ({ rows: [] })],
    [/FROM "draft_picks"/, () => ({ rows: [] })],
    // escalateNothingDraftable's named-team read and autoPick's rotation read.
    [/FROM "teams"/, () => ({ rows: [STUCK_TEAM] })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
    [insert('draft_activity'), () => ({ rows: [{ id: 9, feed_seq: '50', created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })],
  ]);
}

// --- the API's emitter: a router lifecycle act (POST reset) ------------------

/**
 * POST /league/:id/reset, the router act #967 converts. It was the shipped
 * board-fact-first site (stateChanged then activityAppended); running it through
 * the act module is what flips it onto the ADR 0025 order this test pins.
 */
function resetWorld() {
  return createFakePool([
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE$/, () => ({
      rows: [{ id: LEAGUE_ID, current_season: SEASON, draft_status: 'active' }],
    })],
    [/^SELECT "id", "owner_id", "autodraft", "draft_position" FROM "teams"/, () => ({
      rows: [{ id: ACTOR_TEAM.id, owner_id: COMMISSIONER, autodraft: false, draft_position: 1 }],
    })],
    [/^SELECT "id", "name" FROM "teams"/, () => ({ rows: [ACTOR_TEAM] })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [] })],
    [/^SELECT "id", "transactions_locked",.* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({
      rows: [{ id: LEAGUE_ID, transactions_locked: false }],
    })],
    [/^SELECT "id", "locked" FROM "teams" WHERE "id" = \$1 FOR UPDATE/, (text, params) => ({
      rows: [{ id: params[0], locked: false }],
    })],
    [remove('team_players'), () => ({ rows: [], rowCount: 0 })],
    [remove('lineup_entries'), () => ({ rows: [], rowCount: 0 })],
    [remove('draft_picks'), () => ({ rows: [], rowCount: 0 })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
    [insert('draft_activity'), () => ({ rows: [{ id: 8, feed_seq: '40', created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 })],
  ]);
}

async function escalationOrder(t) {
  const fake = escalationWorld().install(t);
  const calls = installRecorder(t);
  const outcome = await pickClock.autoPick({ leagueId: LEAGUE_ID });
  assert.equal(outcome, null, 'nothing was draftable, so autoPick committed no Pick');
  assert.ok(
    fake.matching(insert('draft_activity')).length === 1,
    'the escalation appended its STALLED entry, so this really is the escalation path'
  );
  fake.assertClean();
  return calls;
}

async function routerActOrder(t) {
  const fake = resetWorld().install(t);
  const calls = installRecorder(t);
  const res = await request(app)
    .post(`/api/draft/league/${LEAGUE_ID}/reset`)
    .set('Authorization', `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  fake.assertClean();
  return calls;
}

test('the escalation path and a router act emit the same event order', async (t) => {
  const escalation = await escalationOrder(t);
  const routerAct = await routerActOrder(t);

  assert.ok(escalation.length > 0, 'the escalation emitted something');
  assert.ok(routerAct.length > 0, 'the router act emitted something');
  // THE binding assertion (red-tell: swap either emitter's two lines).
  assert.deepEqual(
    escalation,
    routerAct,
    `the worker and the API must fan the same lifecycle pair out in one order; ` +
      `escalation=[${escalation.join(', ')}] routerAct=[${routerAct.join(', ')}]`
  );
});

test('and that shared order is the one ADR 0025 assigns: narration ahead of the board fact', async (t) => {
  // The literal, asserted ONCE, so the test above can stay a pure agreement
  // check. Flipping both emitters together would pass that one and fail this.
  const escalation = await escalationOrder(t);
  assert.deepEqual(escalation, ['activityAppended', 'stateChanged']);
});
