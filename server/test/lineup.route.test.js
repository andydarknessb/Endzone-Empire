/**
 * #1132: GET /api/team/lineup is a straight passthrough of `getLineup`'s
 * return value (team.router.js just does `res.json(lineup)`), so this is the
 * one place that pins the WIRE shape rather than the service return value
 * lineup.service.test.js already covers.
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const projectionService = require('../services/projection.service');
const { createFakePool } = require('./helpers/fakePool');
const teamRouter = require('../routes/team.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'lineup-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/team', teamRouter);

test("GET /api/team/lineup carries each entry's week opponent on the wire (#1132)", async (t) => {
  const entries = [
    { id: 1, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', injury_status: null, slot: 'WR', ir_attested: false },
    // BUF has no row in the schedule mocked below: a bye, or an unsynced
    // slate, and the wire must say null, never an absent field or ''.
    { id: 2, name: 'Stefon Diggs', position: 'WR', nfl_team: 'BUF', injury_status: null, slot: 'BENCH', ir_attested: false },
  ];
  t.mock.method(projectionService, 'getWeekProjections', async () => new Map());
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: 5, current_season: 2026, current_week: 8 }] })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10 }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map(({ id, position }) => ({ player_id: id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: entries.map(({ id }) => ({ player_id: id })),
    })],
    [/^SELECT "players"\."id"/, () => ({ rows: entries })],
    [/^SELECT "players"\."position"/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
    [/FROM "nfl_games" "ng"/, () => ({ rows: [] })],
    [/^SELECT "nfl_team", "opponent" FROM "nfl_games"/, () => ({
      rows: [{ nfl_team: 'MIN', opponent: 'GB' }],
    })],
  ]).install(t);

  const token = signToken({ id: 7, username: 'member' });
  const response = await request(app)
    .get('/api/team/lineup?leagueId=5')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  const byId = new Map(response.body.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.get(1).opponent, 'GB');
  assert.equal(byId.get(2).opponent, null);
  // Existing fields are preserved (response shape is otherwise unchanged).
  assert.equal(byId.get(1).name, 'Justin Jefferson');
  fake.assertClean();
});
