const { test, after } = require('node:test');
const assert = require('node:assert/strict');
// The autodraft route refreshes the board through the one Draft room adapter
// (#745), which throws with no transport; register a recording broadcast.
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
registerRecordingBroadcast();
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, select, update } = require('./helpers/fakePool');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'draft-autodraft-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const LEAGUE_ID = 5;
const TEAM_ID = 30;
const MANAGER_ID = 7;
const COMMISSIONER_ID = 9;
const OTHER_MANAGER_ID = 11;

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

const auth = (id) => `Bearer ${signToken({ id, username: `user-${id}` })}`;
const toggle = (actorId, enabled) => request(app)
  .post(`/api/draft/league/${LEAGUE_ID}/teams/${TEAM_ID}/autodraft`)
  .set('Authorization', auth(actorId))
  .send({ enabled });

// The Draft act module's serializing lock on the League row (#967). It replaces
// this suite's private `/FROM "leagues"[\s\S]*FOR UPDATE/` matcher, which was,
// until this PR, the only thing here binding that the autodraft toggle locked
// the League row before it wrote a Team. That ordering is now structural -
// runDraftAct takes the lock as its first statement after BEGIN, and
// draftAct.service.test.js's "the FOR UPDATE lock precedes the first mutation"
// owns it - so the private matcher is deleted rather than restated. This
// matcher is still load-bearing in THIS suite: drop it and the module's lock
// read hits the fake pool's unregistered-query throw and every test reddens.
const ACT_LOCK = /^SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE$/;
// The act module loads Teams in rotation order and the body picks the target
// Team out of that list, so the route no longer issues its own
// `SELECT "id", "owner_id" FROM "teams" WHERE "id" = $1 AND "league_id" = $2`.
const ACT_TEAMS = /^SELECT "id", "owner_id", "autodraft", "draft_position" FROM "teams"/;
// lookupTeam, the act module's acting-Team read. The toggle never uses it (it
// appends no narration), but the module resolves it for every act.
const ACT_ACTING_TEAM = /^SELECT "id", "name" FROM "teams"/;

function autodraftPool({ isCommissioner, teamOwnerId = MANAGER_ID, league = true, teamInLeague = true }) {
  return createFakePool([
    // requireFantasyLeague middleware.
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    // isLeagueCommissioner includes owners and co-commissioners. Kept ahead of
    // the lock matcher: both read FROM "leagues".
    [/^SELECT 1 FROM "leagues" WHERE "id" = \$1 AND/, () => ({
      rows: isCommissioner ? [{ ok: 1 }] : [],
    })],
    [ACT_LOCK, () => ({
      rows: league ? [{
        id: LEAGUE_ID,
        owner_id: COMMISSIONER_ID,
        draft_status: 'active',
        current_pick: 0,
        draft_paused: false,
        autodraft_delay_seconds: 10,
        draft_rotation: 'snake',
        draft_order_overrides: null,
      }] : [],
    })],
    [ACT_TEAMS, () => ({
      rows: teamInLeague ? [{ id: TEAM_ID, owner_id: teamOwnerId, autodraft: false, draft_position: 1 }] : [],
    })],
    [ACT_ACTING_TEAM, () => ({ rows: [] })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
  ]);
}

/**
 * Enabling autodraft for the team ON the clock is the branch that arms a clock
 * through onAutodraftToggled, and the only route that reaches that event. #948
 * moved the offline-rule read off the router's SELECT and into the event, which
 * re-reads the policy from the locked row - so this world registers that policy
 * SELECT (carrying draft_type) alongside the act module's own lock read. It
 * records the arm-in-place UPDATE's bound seconds so the assertion is the arming
 * decision.
 */
function onClockPool({ draftType }) {
  const armed = [];
  const fake = createFakePool([
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    // isLeagueCommissioner's probe, kept ahead of the shape matcher below.
    [/^SELECT 1 FROM "leagues" WHERE "id" = \$1 AND/, () => ({ rows: [] })],
    // The act module's lock read and onAutodraftToggled's policy read are both
    // SELECT ... FROM "leagues"; one full row answers both (#948).
    [select('leagues'), () => ({
      rows: [{
        id: LEAGUE_ID,
        owner_id: COMMISSIONER_ID,
        draft_status: 'active',
        draft_type: draftType,
        current_pick: 0,
        draft_paused: false,
        pick_time_seconds: 90,
        autodraft_delay_seconds: 8,
        draft_rotation: 'snake',
        draft_order_overrides: null,
      }],
    })],
    // The act module's rotation-order Teams read, which is now also the on-clock
    // resolution list: TEAM_ID holds pick 0, so it is on the clock.
    [ACT_TEAMS, () => ({
      rows: [{ id: TEAM_ID, owner_id: MANAGER_ID, autodraft: false, draft_position: 1 }],
    })],
    [ACT_ACTING_TEAM, () => ({ rows: [] })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), (text, params) => {
      armed.push(params);
      return { rows: [{ pick_deadline_at: null }] };
    }],
  ]);
  return { fake, armed };
}

test('POST autodraft on the on-clock team of a timed draft arms the short delay', async (t) => {
  const { fake, armed } = onClockPool({ draftType: 'online' });
  fake.install(t);

  const response = await toggle(MANAGER_ID, true);

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.autodraft, true);
  assert.equal(armed.length, 1, 'the on-clock enable reaches the arm-in-place statement');
  assert.equal(armed[0][1], 8, 'a timed draft arms the short autodraft delay');
});

test('POST autodraft on the on-clock team of an OFFLINE draft arms no clock', async (t) => {
  // The defect #948 fixes: this route reaches onAutodraftToggled with an active
  // offline draft and no draft_type guard. The event re-reads draft_type from
  // the locked row, so the offline rule applies and no deadline is armed. Red
  // tell: drop draft_type from onClockPool's league row and this arms 8s instead
  // of null, exactly as a router SELECT that dropped the column used to.
  const { fake, armed } = onClockPool({ draftType: 'offline' });
  fake.install(t);

  const response = await toggle(MANAGER_ID, true);

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.autodraft, true);
  assert.equal(armed.length, 1, 'the arm-in-place statement still runs');
  assert.equal(armed[0][1], null, 'an offline draft arms a null deadline, never a clock');
});

test('POST autodraft lets a manager change their own Team', async (t) => {
  const fake = autodraftPool({ isCommissioner: false }).install(t);

  const response = await toggle(MANAGER_ID, false);

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body, {
    leagueId: LEAGUE_ID,
    teamId: TEAM_ID,
    autodraft: false,
  });
  const updates = fake.matching(update('teams'));
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].params, [false, TEAM_ID]);
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
});

test('POST autodraft refuses a manager changing another Team', async (t) => {
  const fake = autodraftPool({ isCommissioner: false, teamOwnerId: OTHER_MANAGER_ID }).install(t);

  const response = await toggle(MANAGER_ID, true);

  assert.equal(response.status, 403, JSON.stringify(response.body));
  assert.equal(response.body.error, 'only the team manager or a commissioner can change autodraft');
  assert.equal(fake.matching(update('teams')).length, 0);
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1);
});

test('POST autodraft lets a commissioner change any Team', async (t) => {
  const fake = autodraftPool({ isCommissioner: true, teamOwnerId: OTHER_MANAGER_ID }).install(t);

  const response = await toggle(COMMISSIONER_ID, false);

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body, {
    leagueId: LEAGUE_ID,
    teamId: TEAM_ID,
    autodraft: false,
  });
  const updates = fake.matching(update('teams'));
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].params, [false, TEAM_ID]);
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
});

/**
 * The two 404s the conversion moved out of the handler's own ROLLBACK-and-return
 * pairs and into DraftError refusals the act module rolls back (#967). Same
 * status, same body, and - the part worth pinning - still no write.
 */
test('POST autodraft: a missing league is a 404 that writes nothing', async (t) => {
  const fake = autodraftPool({ isCommissioner: false, league: false }).install(t);

  const response = await toggle(MANAGER_ID, true);

  assert.equal(response.status, 404, JSON.stringify(response.body));
  assert.equal(response.body.error, 'league not found');
  assert.equal(fake.matching(update('teams')).length, 0);
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1);
});

test('POST autodraft: a team outside this league is a 404 that writes nothing', async (t) => {
  const fake = autodraftPool({ isCommissioner: false, teamInLeague: false }).install(t);

  const response = await toggle(MANAGER_ID, true);

  assert.equal(response.status, 404, JSON.stringify(response.body));
  assert.equal(response.body.error, 'team not found in this league');
  assert.equal(fake.matching(update('teams')).length, 0);
  assert.equal(fake.matching(/^ROLLBACK$/).length, 1);
});
