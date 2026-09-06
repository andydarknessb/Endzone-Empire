const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const draftRoomBroadcast = require('../modules/draftRoomBroadcast');
const { runDraftAct } = require('../services/draftAct.service');
const { DraftError } = require('../services/draft.service');

/**
 * The Draft act module (#947, part of #938) at its interface. runDraftAct owns
 * the transaction, the serializing lock on the League row, and the post-commit
 * fan-out order for every lifecycle act. These tests drive it against a fakePool
 * (the observation harness's call log is the record of statement order) and a
 * recording broadcast that stamps each emit with whether the transaction had
 * COMMITted yet, so all four of criterion 1's properties are read from evidence
 * rather than asserted about.
 *
 * Each property is isolated in its own test so that criterion 2's four
 * mutations - moving the lock after the first mutation, swallowing the rollback,
 * moving the fan-out before commit, rethrowing a broadcast failure - each turn
 * EXACTLY ONE named assertion red. The naming is in the PR body.
 */
const LEAGUE_ID = 1;
const USER_ID = 7;

// A minimal act body: one mutation on the locked client, one activity entry, one
// board fact. Enough to observe lock-before-mutation and the fan-out order.
function pauseLikeBody() {
  return async ({ client, actingTeam }) => {
    const upd = await client.query(
      `UPDATE "leagues" SET "draft_paused" = $1, "updated_at" = now()
       WHERE "id" = $2 RETURNING "id", "draft_paused"`,
      [true, LEAGUE_ID]
    );
    return {
      response: { ...upd.rows[0], actor: actingTeam ? actingTeam.id : null },
      activity: [{ id: 'entry-1', kind: 'pause' }],
      broadcasts: ['stateChanged'],
    };
  };
}

function baseWorld(t, extraHandlers = []) {
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [{ id: LEAGUE_ID, draft_status: 'active' }] })],
    [/^SELECT "id", "owner_id", "autodraft", "draft_position" FROM "teams"/, () => ({ rows: [{ id: 11, owner_id: USER_ID, autodraft: false, draft_position: 1 }] })],
    [/^SELECT "id", "name" FROM "teams"/, () => ({ rows: [{ id: 11, name: 'Acting FC' }] })],
    [/^UPDATE "leagues" SET "draft_paused"/, () => ({ rows: [{ id: LEAGUE_ID, draft_paused: true }] })],
    ...extraHandlers,
  ]).install(t);
  return fake;
}

// A broadcast that records each adapter call AND, at the moment of the call,
// whether the fakePool has seen a COMMIT yet. `failOn` makes one method throw so
// the fan-out-containment property can be exercised.
function installActBroadcast(t, fake, { failOn } = {}) {
  const calls = [];
  const committedNow = () => fake.calls.some((c) => /^COMMIT$/.test(c.text));
  const record = (method) => (leagueId, payload) => {
    calls.push({ method, leagueId, payload, committedAtEmit: committedNow() });
    if (failOn === method) throw new Error(`boom in ${method}`);
    return { delivered: true, transport: 'act-test' };
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
  return { calls };
}

const firstIndex = (fake, re) => fake.calls.findIndex((c) => re.test(c.text));

test('property 1: the lock precedes any mutation', async (t) => {
  const fake = baseWorld(t);
  installActBroadcast(t, fake);

  await runDraftAct({ leagueId: LEAGUE_ID, userId: USER_ID }, pauseLikeBody());

  const lockIdx = firstIndex(fake, /FOR UPDATE/);
  const firstMutationIdx = firstIndex(fake, /^(UPDATE|INSERT|DELETE)/);
  assert.ok(lockIdx >= 0, 'the League row is locked');
  assert.ok(firstMutationIdx >= 0, 'a mutation ran');
  // NAMED (red-tell 1: moving the lock after the first mutation reddens this).
  assert.ok(lockIdx < firstMutationIdx, 'the FOR UPDATE lock precedes the first mutation');
  fake.assertClean();
});

test('property 2: a thrown refusal rolls back and emits nothing', async (t) => {
  const fake = baseWorld(t);
  const rec = installActBroadcast(t, fake);

  await assert.rejects(
    runDraftAct({ leagueId: LEAGUE_ID, userId: USER_ID }, async () => {
      throw new DraftError(403, 'league not found, not commissioner, or draft not active');
    }),
    (err) => err instanceof DraftError && err.statusCode === 403
  );

  // NAMED (red-tell 2: swallowing the rollback reddens this). assertClean is not
  // called here on purpose, so the swallow mutation reddens ONLY this line rather
  // than also tripping the left-open-transaction guard.
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'the refusal rolled the transaction back');
  assert.equal(fake.matching(/^COMMIT$/).length, 0, 'a refusal never commits');
  assert.equal(rec.calls.length, 0, 'a refusal emits nothing to the room');
});

test('property 3: the fan-out runs only after commit, narration ahead of the board fact', async (t) => {
  const fake = baseWorld(t);
  const rec = installActBroadcast(t, fake);

  await runDraftAct({ leagueId: LEAGUE_ID, userId: USER_ID }, pauseLikeBody());

  assert.equal(rec.calls.length, 2, 'one activity entry and one board fact were emitted');
  // NAMED (red-tell 3: moving the fan-out before commit reddens this).
  assert.ok(rec.calls.every((c) => c.committedAtEmit === true), 'every fan-out emit ran after COMMIT');
  // The one order: narration first, then the board fact. Primary evidence is
  // pickClock.service.js's autoPick escalation branch (the emit right after
  // escalateNothingDraftable), which emits this exact pair (activityAppended then
  // stateChanged); pick.service.js's landPick completion group corroborates
  // (activityAppended ahead of the board facts, though its pickLanded precedes
  // the narration). The router was the lone outlier this flip removes.
  assert.deepEqual(
    rec.calls.map((c) => c.method),
    ['activityAppended', 'stateChanged'],
    'narration (activityAppended) is emitted before the board fact (stateChanged)'
  );
  fake.assertClean();
});

test('property 4: a fan-out failure does not turn a committed act into a 500', async (t) => {
  const fake = baseWorld(t);
  const rec = installActBroadcast(t, fake, { failOn: 'stateChanged' });

  // NAMED (red-tell 4: rethrowing a broadcast failure reddens this - runDraftAct
  // would reject instead of resolving).
  const response = await runDraftAct({ leagueId: LEAGUE_ID, userId: USER_ID }, pauseLikeBody());

  assert.deepEqual(response, { id: LEAGUE_ID, draft_paused: true, actor: 11 }, 'the committed response is returned despite the fan-out failure');
  assert.equal(fake.matching(/^COMMIT$/).length, 1, 'the act committed');
  assert.ok(rec.calls.some((c) => c.method === 'stateChanged'), 'the failing board fact was attempted');
  fake.assertClean();
});

test('a typo in a requested board-fact name throws before commit, rolls back, and emits nothing', async (t) => {
  const fake = baseWorld(t);
  const rec = installActBroadcast(t, fake);

  await assert.rejects(
    runDraftAct({ leagueId: LEAGUE_ID, userId: USER_ID }, async ({ client }) => {
      await client.query(
        `UPDATE "leagues" SET "draft_paused" = $1 WHERE "id" = $2 RETURNING "id"`,
        [true, LEAGUE_ID]
      );
      // 'stateChangd' is a typo. Without pre-commit validation it would be a
      // silent no-op swallowed by runFanout; here it must fail loudly.
      return { response: {}, activity: [{ id: 'e1' }], broadcasts: ['stateChangd'] };
    }),
    /is not a board-fact broadcast/
  );

  assert.equal(fake.matching(/^COMMIT$/).length, 0, 'a bad broadcast name never commits');
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'it rolls back');
  assert.equal(rec.calls.length, 0, 'and emits nothing to the room');
  fake.assertClean();
});

test('the act body receives the locked client, the League row, the Teams and the acting Team', async (t) => {
  const fake = baseWorld(t);
  installActBroadcast(t, fake);
  let seen = null;

  await runDraftAct({ leagueId: LEAGUE_ID, userId: USER_ID }, async (ctx) => {
    seen = ctx;
    return { response: {}, activity: [], broadcasts: [] };
  });

  assert.ok(seen, 'the body ran');
  assert.equal(typeof seen.client.query, 'function', 'the locked client is passed');
  assert.deepEqual(seen.league, { id: LEAGUE_ID, draft_status: 'active' }, 'the locked League row is passed');
  assert.equal(seen.teams.length, 1, 'the Teams in rotation order are passed');
  assert.deepEqual(seen.actingTeam, { id: 11, name: 'Acting FC' }, 'the acting Team is resolved');
  fake.assertClean();
});
