const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const { createFakePool } = require('./helpers/fakePool');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-create-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const CREATOR = 5;
const authed = () => `Bearer ${signToken({ id: CREATOR, username: 'commish' })}`;

/**
 * The transaction client behind the create route (shared fakePool harness).
 * The leagues INSERT echoes its params back as the returned row, so
 * assertions on the response body pin what the route actually sent to the
 * database; the same row answers the membership module's FOR UPDATE re-read
 * with the column defaults a fresh league has (pre-draft, season regular).
 */
function mockClient(t, overrides = []) {
  let created = null;
  const defaults = [
    [/INSERT INTO "leagues"/, (text, params) => {
      created = {
        id: 77,
        name: params[0],
        owner_id: params[1],
        max_teams: params[3],
        min_teams: params[4],
        best_ball: params[7],
        draft_date: params[10],
        draft_timezone: params[11],
        pickem_only: params[12],
        draft_status: 'pending',
        season_status: 'regular',
        current_season: 2026,
        current_week: 1,
      };
      return { rows: [created] };
    }],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE$/, (text, params) => ({
      rows: created && created.id === params[0] ? [created] : [],
    })],
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "teams"/, () => ({ rows: [{ n: 0 }] })],
    [/INSERT INTO "teams"/, (text, params) => ({
      rows: [{ id: 501, league_id: params[0], owner_id: params[1], name: params[2], draft_position: params[3] }],
    })],
    [/INSERT INTO "pickem_settings"/, () => ({ rows: [] })],
    [/SELECT MAX\("season"\)/, () => ({ rows: [{ season: 2026 }] })],
    [/SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({ rows: scheduleAroundNow() })],
    [/^UPDATE "leagues" SET "current_season"/, (text, params) => ({
      rows: [{ id: params[2], pickem_only: true, current_season: params[0], current_week: params[1] }],
    })],
  ];
  return createFakePool([...overrides, ...defaults]).install(t).calls;
}

const statementsMatching = (calls, pattern) => calls.filter((c) => pattern.test(c.text));

/**
 * A schedule relative to the clock the route reads: weeks 1..6 have closed
 * (last kickoff two days ago or earlier) and week 7's Monday-night game is
 * three days out, so the shared derivation lands on week 7. One week-4 game
 * sits far in the future: a reschedule out of its week, which must not pin
 * the seed at 4.
 */
function scheduleAroundNow() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const rows = [];
  for (let week = 1; week <= 6; week += 1) {
    rows.push({ week, kickoff_at: new Date(now - (9 - week) * 7 * day).toISOString() });
    rows.push({ week, kickoff_at: new Date(now - (9 - week) * 7 * day + 3 * day).toISOString() });
  }
  rows.push({ week: 4, kickoff_at: new Date(now + 40 * day).toISOString() });
  rows.push({ week: 7, kickoff_at: new Date(now - 1 * day).toISOString() });
  rows.push({ week: 7, kickoff_at: new Date(now + 3 * day).toISOString() });
  rows.push({ week: 8, kickoff_at: new Date(now + 10 * day).toISOString() });
  return rows;
}

test('fantasy create: pickem_only false, no pickem_settings row, no season seed', async (t) => {
  const calls = mockClient(t);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Gridiron', teamName: "Commish's Crew", maxTeams: 10 });
  assert.equal(res.status, 201);
  assert.equal(res.body.pickem_only, false);
  const leagueInsert = statementsMatching(calls, /INSERT INTO "leagues"/)[0];
  assert.match(leagueInsert.text, /"pickem_only"/);
  assert.equal(leagueInsert.params[12], false);
  assert.equal(leagueInsert.params[10], null, 'draft_date defaults to null');
  assert.equal(leagueInsert.params[11], null, 'draft_timezone defaults to null');
  assert.equal(statementsMatching(calls, /INSERT INTO "pickem_settings"/).length, 0);
  assert.equal(statementsMatching(calls, /FROM "nfl_games"/).length, 0);
  assert.equal(statementsMatching(calls, /^COMMIT$/).length, 1);
  // The creator's Team goes through the membership write like every other
  // join path: the required name it sent, and draft_position 1 on an empty
  // league.
  const teamInserts = statementsMatching(calls, /INSERT INTO "teams"/);
  assert.equal(teamInserts.length, 1);
  assert.deepEqual(teamInserts[0].params, [77, CREATOR, "Commish's Crew", 1]);
});

test('fantasy create: a missing Team name is refused 400 and nothing commits', async (t) => {
  const calls = mockClient(t);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Gridiron', maxTeams: 10 });
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.equal(res.body.error, 'Team name is required');
  assert.equal(statementsMatching(calls, /INSERT INTO "teams"/).length, 0);
  assert.equal(statementsMatching(calls, /^COMMIT$/).length, 0);
  assert.equal(statementsMatching(calls, /^ROLLBACK$/).length, 1);
});

test("'both' create: pickem_settings written in the transaction with the chosen mode, no seed", async (t) => {
  const calls = mockClient(t);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Double Duty', teamName: 'Two-Way Titans', leagueType: 'both', pickemMode: 'confidence' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.pickem_only, false);
  const settingsInserts = statementsMatching(calls, /INSERT INTO "pickem_settings"/);
  assert.equal(settingsInserts.length, 1);
  assert.match(settingsInserts[0].text, /"enabled".*VALUES \(\$1, true, \$2\)/);
  assert.deepEqual(settingsInserts[0].params, [77, 'confidence']);
  assert.equal(statementsMatching(calls, /FROM "nfl_games"/).length, 0);
});

test('pick\'em create: pickem_only true, settings row, and season/week seeded from the schedule', async (t) => {
  const calls = mockClient(t);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Office Pool', teamName: 'Pool Shark', leagueType: 'pickem', maxTeams: 50 });
  assert.equal(res.status, 201);
  const leagueInsert = statementsMatching(calls, /INSERT INTO "leagues"/)[0];
  assert.equal(leagueInsert.params[12], true);
  assert.equal(statementsMatching(calls, /INSERT INTO "pickem_settings"/).length, 1);
  // Seeded through the SAME derivation the lifecycle job uses
  // (getSeasonWeekBounds + deriveNflWeek), so the two cannot disagree: newest
  // season on file, smallest week still open, and a game rescheduled out of
  // week 4 does not pin the seed there.
  const seedUpdate = statementsMatching(calls, /^UPDATE "leagues" SET "current_season"/)[0];
  assert.deepEqual(seedUpdate.params, [2026, 7, 77]);
  const bounds = statementsMatching(calls, /SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/);
  assert.equal(bounds.length, 1);
  assert.deepEqual(bounds[0].params, [2026, 18]);
  // The response carries the seeded pointer, not the column defaults.
  assert.equal(res.body.current_season, 2026);
  assert.equal(res.body.current_week, 7);
});

test('pick\'em create with an empty schedule table: no seed UPDATE, column defaults stand', async (t) => {
  const calls = mockClient(t, [
    [/SELECT MAX\("season"\)/, () => ({ rows: [{ season: null }] })],
  ]);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Preseason Pool', teamName: 'Early Bird', leagueType: 'pickem' });
  assert.equal(res.status, 201);
  assert.equal(statementsMatching(calls, /^UPDATE "leagues" SET "current_season"/).length, 0);
  assert.equal(res.body.current_week, 1);
});

test('pick\'em create honors the 50 cap at the route; fantasy still rejects 50 naming 20', async (t) => {
  mockClient(t);
  const pickem = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Big Pool', teamName: 'Pool Champ', leagueType: 'pickem', maxTeams: 50 });
  assert.equal(pickem.status, 201);
  const fantasy = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Big League', teamName: 'Big Ballers', maxTeams: 50 });
  assert.equal(fantasy.status, 400);
  assert.match(fantasy.body.error, /between 2 and 20/);
});

test('a failure inside the transaction rolls the whole create back', async (t) => {
  const calls = mockClient(t, [
    [/INSERT INTO "pickem_settings"/, () => { throw new Error('boom'); }],
  ]);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Doomed Pool', teamName: 'Doomed FC', leagueType: 'pickem' });
  assert.equal(res.status, 500);
  assert.equal(statementsMatching(calls, /^ROLLBACK$/).length, 1);
  assert.equal(statementsMatching(calls, /^COMMIT$/).length, 0);
});

test('rejected fantasy-only fields never reach the database', async (t) => {
  const calls = mockClient(t);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Sneaky', leagueType: 'pickem', bestBall: true });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /bestBall/);
  assert.equal(calls.length, 0);
});

// --- draft timezone (#116) ---------------------------------------------

test('create with a draftDate and a validated draftTimezone stores both', async (t) => {
  const calls = mockClient(t);
  const draftDate = new Date(Date.now() + 86400000).toISOString();
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Zoned', teamName: 'Zoned FC', maxTeams: 10, draftDate, draftTimezone: 'America/New_York' });
  assert.equal(res.status, 201);
  assert.equal(res.body.draft_timezone, 'America/New_York');
  const leagueInsert = statementsMatching(calls, /INSERT INTO "leagues"/)[0];
  assert.match(leagueInsert.text, /"draft_timezone"/);
  assert.equal(leagueInsert.params[11], 'America/New_York');
});

test('create rejects a draftTimezone without a draftDate before touching the database', async (t) => {
  const calls = mockClient(t);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Zoneless', draftTimezone: 'America/New_York' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'draftTimezone requires a scheduled draftDate');
  assert.equal(calls.length, 0);
});

test('create rejects an invalid IANA draftTimezone before touching the database', async (t) => {
  const calls = mockClient(t);
  const draftDate = new Date(Date.now() + 86400000).toISOString();
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Zoneless', draftDate, draftTimezone: 'Not/AZone' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /draftTimezone must be a valid IANA time zone name/);
  assert.equal(calls.length, 0);
});

test("create rejects a draftTimezone for a pick'em league before touching the database", async (t) => {
  const calls = mockClient(t);
  const res = await request(app)
    .post('/api/league')
    .set('Authorization', authed())
    .send({ name: 'Pool', leagueType: 'pickem', draftTimezone: 'America/New_York' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /draftTimezone is not allowed when leagueType is pickem/);
  assert.equal(calls.length, 0);
});
