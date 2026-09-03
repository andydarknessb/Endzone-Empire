const { test, after } = require('node:test');
const assert = require('node:assert/strict');
// The autodraft route refreshes the board through the one Draft room adapter
// (#745), which throws with no transport; register a recording broadcast.
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
registerRecordingBroadcast();
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool, update } = require('./helpers/fakePool');

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

function autodraftPool({ isCommissioner, teamOwnerId = MANAGER_ID }) {
  return createFakePool([
    // requireFantasyLeague middleware.
    [/SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [/FROM "leagues"[\s\S]*FOR UPDATE/, () => ({
      rows: [{
        owner_id: COMMISSIONER_ID,
        draft_status: 'active',
        current_pick: 0,
        draft_paused: false,
        autodraft_delay_seconds: 10,
        draft_rotation: 'snake',
        draft_order_overrides: null,
      }],
    })],
    [/SELECT "id", "owner_id" FROM "teams" WHERE "id" = \$1 AND "league_id" = \$2/, () => ({
      rows: [{ id: TEAM_ID, owner_id: teamOwnerId }],
    })],
    // isLeagueCommissioner includes owners and co-commissioners.
    [/SELECT 1 FROM "leagues" WHERE "id" = \$1 AND/, () => ({
      rows: isCommissioner ? [{ ok: 1 }] : [],
    })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
  ]);
}

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
