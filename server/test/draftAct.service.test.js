const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const draftRoomBroadcast = require('../modules/draftRoomBroadcast');
const { runDraftAct, setAutodraft, reset, correctLatestPick } = require('../services/draftAct.service');
const rosterMove = require('../services/rosterMove.service');
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
    [/^UPDATE "leagues" SET "board_version" = "board_version" \+ 1 WHERE "id" = \$1 RETURNING \*/, () => ({ rows: [{ id: LEAGUE_ID, draft_status: 'active' }] })],
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

  const lockIdx = firstIndex(fake, /"board_version" = "board_version" \+ 1/);
  const firstMutationIdx = firstIndex(fake, /^(UPDATE|INSERT|DELETE)(?! "leagues" SET "board_version")/);
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

test('a reserved adapter method (pickLanded) is rejected even though the adapter defines it', async (t) => {
  // The recording broadcast HAS pickLanded, so validating against the live adapter
  // would accept it. The allowlist is by LEGITIMACY, not by adapter existence:
  // ADR 0025 reserves pickLanded to the Pick module, so a Draft act may not emit
  // it. This is the exclusion the BOARD_FACTS comment documents.
  const fake = baseWorld(t);
  const rec = installActBroadcast(t, fake);

  await assert.rejects(
    runDraftAct({ leagueId: LEAGUE_ID, userId: USER_ID }, async ({ client }) => {
      await client.query(
        `UPDATE "leagues" SET "draft_paused" = $1 WHERE "id" = $2 RETURNING "id"`,
        [true, LEAGUE_ID]
      );
      return { response: {}, activity: [], broadcasts: ['pickLanded'] };
    }),
    /is not a board-fact broadcast/
  );

  assert.equal(fake.matching(/^COMMIT$/).length, 0, 'a reserved name never commits');
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'it rolls back');
  assert.equal(rec.calls.length, 0, 'and emits nothing');
  fake.assertClean();
});

test('a Draft act may name only stateChanged: rosterChanged is retired (ADR 0025, 2026-11-06)', async (t) => {
  const fake = baseWorld(t);
  const rec = installActBroadcast(t, fake);

  await assert.rejects(
    runDraftAct({ leagueId: LEAGUE_ID, userId: USER_ID }, async ({ client }) => {
      await client.query(
        `UPDATE "leagues" SET "draft_paused" = $1 WHERE "id" = $2 RETURNING "id"`,
        [true, LEAGUE_ID]
      );
      return { response: {}, activity: [], broadcasts: ['rosterChanged'] };
    }),
    /is not a board-fact broadcast/
  );

  assert.equal(fake.matching(/^COMMIT$/).length, 0, 'a retired name never commits');
  assert.equal(rec.calls.length, 0, 'and emits nothing');
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

// --- #2764: the Autodraft rules of the Draft act operations ---

// A world for one named act: the locked League row, the Teams, the acting-Team
// lookup and the commissioner check. `extra` adds the act's own statements.
function actWorld(t, { league, teams, commissioner = false, extra = [] }) {
  return createFakePool([
    [/^UPDATE "leagues" SET "board_version" = "board_version" \+ 1 WHERE "id" = \$1 RETURNING \*/, () => ({ rows: [league] })],
    [/^SELECT "id", "owner_id", "autodraft", "draft_position" FROM "teams"/, () => ({ rows: teams })],
    [/^SELECT "id", "name" FROM "teams"/, () => ({ rows: teams.filter((tm) => tm.owner_id === USER_ID).map((tm) => ({ id: tm.id, name: 'Acting FC' })) })],
    [/^SELECT 1 FROM "leagues" WHERE "id" = \$1 AND/, () => ({ rows: commissioner ? [{ '?column?': 1 }] : [] })],
    [/^UPDATE "teams" SET "autodraft" = \$1/, () => ({ rows: [] })],
    ...extra,
  ]).install(t);
}

test('an autopick draft refuses turning Autodraft off, and writes nothing (#2764)', async (t) => {
  const fake = actWorld(t, {
    league: { id: LEAGUE_ID, draft_status: 'active', draft_type: 'autopick', draft_paused: false, current_pick: 0 },
    teams: [{ id: 11, owner_id: USER_ID, autodraft: true, draft_position: 1 }],
  });

  await assert.rejects(
    setAutodraft({ leagueId: LEAGUE_ID, userId: USER_ID, teamId: 11, enabled: false }),
    (err) => err instanceof DraftError && err.statusCode === 409
  );

  assert.equal(fake.matching(/^UPDATE "teams" SET "autodraft"/).length, 0, 'the switch is never written');
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1, 'the refusal rolls back');
  fake.assertClean();
});

test('an autopick draft still lets Autodraft be switched on (#2764)', async (t) => {
  const fake = actWorld(t, {
    league: { id: LEAGUE_ID, draft_status: 'pending', draft_type: 'autopick', draft_paused: false, current_pick: 0 },
    teams: [{ id: 11, owner_id: USER_ID, autodraft: false, draft_position: 1 }],
  });
  installActBroadcast(t, fake);

  const response = await setAutodraft({ leagueId: LEAGUE_ID, userId: USER_ID, teamId: 11, enabled: true });

  assert.deepEqual(response, { leagueId: LEAGUE_ID, teamId: 11, autodraft: true });
  fake.assertClean();
});

test('reset switches Autodraft off for managed Teams only; a CPU-managed Team keeps it (#2764)', async (t) => {
  const fake = actWorld(t, {
    league: { id: LEAGUE_ID, draft_status: 'active', draft_paused: false, current_pick: 4, current_season: 2026 },
    teams: [],
    commissioner: true,
    extra: [
      [/^SELECT 1 FROM "matchups"/, () => ({ rows: [] })],
      [/^DELETE FROM "/, () => ({ rows: [] })],
      [/^UPDATE "teams" SET "autodraft" = CASE WHEN "owner_id" IS NULL THEN "autodraft" ELSE false END/, () => ({ rows: [] })],
      [/^UPDATE "leagues" SET "draft_status" = 'pending'/, () => ({ rows: [] })],
      [/^UPDATE "leagues" SET "pick_deadline_at" = NULL/, () => ({ rows: [] })],
      [/^INSERT INTO "draft_activity"/, () => ({ rows: [{ id: 1, feed_seq: 1, created_at: new Date() }] })],
    ],
  });
  installActBroadcast(t, fake);

  await reset({ leagueId: LEAGUE_ID, userId: USER_ID });

  assert.equal(
    fake.matching(/SET "autodraft" = CASE WHEN "owner_id" IS NULL THEN "autodraft" ELSE false END/).length,
    1,
    'the Autodraft reset spares CPU-managed Teams'
  );
  fake.assertClean();
});

// A correction world: one Pick (pick 1, Team 11, player 900) is the latest, made by
// autopick or by hand, and its Team has `streak` consecutive timeouts on Autodraft or not.
function correctionWorld(t, { autopick, autodraft = true, streak = 2, ownerId = 99 }) {
  // The roster drop is its own module's concern: stub it, the correction's own writes are what is under test.
  t.mock.method(rosterMove, 'drop', async () => {});
  return actWorld(t, {
    league: { id: LEAGUE_ID, draft_status: 'active', draft_paused: false, current_pick: 1, current_season: 2026 },
    teams: [],
    commissioner: true,
    extra: [
      [/^SELECT "id", "name", "owner_id", "draft_position", "autodraft", "consecutive_timeouts" FROM "teams"/, () => ({
        rows: [{ id: 11, name: 'Acting FC', owner_id: ownerId, draft_position: 1, autodraft, consecutive_timeouts: streak }],
      })],
      [/^SELECT "pick_number", "team_id", "player_id", "is_keeper" FROM "draft_picks"/, () => ({
        rows: [{ pick_number: 1, team_id: 11, player_id: 900, is_keeper: false }],
      })],
      [/^SELECT 1 FROM "draft_activity" "da"/, () => ({ rows: autopick ? [{ '?column?': 1 }] : [] })],
      [/^SELECT "id", "name", "position", "nfl_team" FROM "players"/, () => ({
        rows: [{ id: 900, name: 'Tripping WR', position: 'WR', nfl_team: 'KC' }],
      })],
      [/^DELETE FROM "/, () => ({ rows: [] })],
      [/^UPDATE "leagues" SET "draft_paused" = true, "current_pick"/, () => ({ rows: [] })],
      [/^UPDATE "teams" SET "autodraft" = false, "consecutive_timeouts" = 0/, () => ({ rows: [] })],
      [/^INSERT INTO "draft_activity"/, () => ({ rows: [{ id: 9, feed_seq: 1, created_at: new Date() }] })],
    ],
  });
}

test('correcting the Autopick that tripped its Team clears that Team\'s Autodraft and streak (#2764)', async (t) => {
  const fake = correctionWorld(t, { autopick: true, autodraft: true, streak: 2 });
  installActBroadcast(t, fake);

  await correctLatestPick({ leagueId: LEAGUE_ID, userId: USER_ID, reason: 'the clock tripped on a glitch' });

  assert.equal(
    fake.matching(/^UPDATE "teams" SET "autodraft" = false, "consecutive_timeouts" = 0/).length,
    1,
    'the tripping Team leaves Autodraft and its streak resets'
  );
  fake.assertClean();
});

test('correcting an Autopick of a CPU-managed Team leaves it on Autodraft (#2764)', async (t) => {
  const fake = correctionWorld(t, { autopick: true, autodraft: true, streak: 2, ownerId: null });
  installActBroadcast(t, fake);

  await correctLatestPick({ leagueId: LEAGUE_ID, userId: USER_ID, reason: 'the CPU pick was entered twice' });

  assert.equal(
    fake.matching(/^UPDATE "teams" SET "autodraft" = false, "consecutive_timeouts" = 0/).length,
    0,
    'a CPU-managed Team has no manager to turn Autodraft back on'
  );
  fake.assertClean();
});

test('correcting an Autopick by an Autodraft Team below the threshold leaves it on Autodraft (#2764)', async (t) => {
  const fake = correctionWorld(t, { autopick: true, autodraft: true, streak: 1 });
  installActBroadcast(t, fake);

  await correctLatestPick({ leagueId: LEAGUE_ID, userId: USER_ID, reason: 'an autopick below the threshold' });

  assert.equal(
    fake.matching(/^UPDATE "teams" SET "autodraft" = false, "consecutive_timeouts" = 0/).length,
    0,
    'one timeout is not a trip: the Team keeps Autodraft and its streak'
  );
  fake.assertClean();
});

test('correcting a hand-made Pick leaves its Team on Autodraft and streak alone (#2764)', async (t) => {
  const fake = correctionWorld(t, { autopick: false, autodraft: true, streak: 2 });
  installActBroadcast(t, fake);

  await correctLatestPick({ leagueId: LEAGUE_ID, userId: USER_ID, reason: 'a hand pick was entered twice' });

  assert.equal(
    fake.matching(/^UPDATE "teams" SET "autodraft" = false, "consecutive_timeouts" = 0/).length,
    0,
    'only an Autopick that tripped the threshold clears the Team'
  );
  fake.assertClean();
});
