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
const scoringService = require('../services/scoring.service');
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
    [/^SELECT "nfl_team", "opponent", "kickoff_at", "game_key" FROM "nfl_games"/, () => ({
      rows: [{ nfl_team: 'MIN', opponent: 'GB', kickoff_at: '2026-11-01T18:00:00Z', game_key: 'MIN-GB' }],
    })],
    [/^SELECT "home_team", "away_team", "game_status" FROM "live_game_states"/, () => ({ rows: [] })], // #1235
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

/**
 * #1235 (ADR 0037): every Edge line kind, reached by seeding the state that
 * produces it, on one lineup so the roster-wide `bench-above-starter`
 * comparison and the "one projection read" ruling are exercised together.
 *
 * `Bench Stud` outprojects `Weak Flex` (the FLEX starter) but not `Injury RB`
 * (the RB starter, projected higher): the scenario the pre-launch ruling
 * calls out by name, a bench player who could start at FLEX specifically,
 * not merely at his own position.
 */
test('GET /api/team/lineup reaches every Edge line kind (#1235)', async (t) => {
  const entries = [
    { id: 1, name: 'Factor QB', position: 'QB', nfl_team: 'KC', injury_status: null, injury_detail: null, slot: 'QB', ir_attested: false },
    { id: 2, name: 'Injury RB', position: 'RB', nfl_team: 'DAL', injury_status: 'Q', injury_detail: 'ankle', slot: 'RB', ir_attested: false },
    { id: 3, name: 'Weak Flex', position: 'WR', nfl_team: 'MIA', injury_status: null, injury_detail: null, slot: 'FLEX', ir_attested: false },
    { id: 4, name: 'Bench Stud', position: 'RB', nfl_team: 'SF', injury_status: null, injury_detail: null, slot: 'BENCH', ir_attested: false },
    // No weekly projection at all (#1235, pre-launch ruling 2): projection,
    // floor and ceiling must all come back null together.
    { id: 5, name: 'No Data', position: 'TE', nfl_team: 'NYJ', injury_status: null, injury_detail: null, slot: 'BENCH', ir_attested: false },
    { id: 6, name: 'Pace Guy', position: 'WR', nfl_team: 'BUF', injury_status: null, injury_detail: null, slot: 'WR', ir_attested: false, week_stats: { actual: 6 } },
    { id: 7, name: 'Result Guy', position: 'TE', nfl_team: 'GB', injury_status: null, injury_detail: null, slot: 'TE', ir_attested: false, week_stats: { actual: 20 } },
    // Out carries both an injury designation (Edge line priority 1 wins over
    // every live-game kind) AND an Unavailable reason (a separate wire field).
    { id: 8, name: 'Out Guy', position: 'K', nfl_team: 'CHI', injury_status: 'O', injury_detail: null, slot: 'BENCH', ir_attested: false },
  ];
  const weekly = new Map([
    [1, { points: 18, projection: { mean: 18, p10: 12, p90: 24, factors: {
      opponent: { available: true, pointsContribution: 3.5, games: 5 },
    } } }],
    [2, { points: 16, projection: { mean: 16, p10: 11, p90: 21, factors: {} } }],
    [3, { points: 5, projection: { mean: 5, p10: 2, p90: 8, factors: {} } }],
    [4, { points: 12, projection: { mean: 12, p10: 8, p90: 16, factors: {} } }],
    // id 5 deliberately absent: no estimate at all.
    [6, { points: 9, projection: { mean: 9, p10: 5, p90: 13, factors: {} } }],
    [7, { points: 14, projection: { mean: 14, p10: 9, p90: 19, factors: {} } }],
  ]);
  const projectionCalls = [];
  t.mock.method(projectionService, 'getWeekProjections', async (options) => {
    projectionCalls.push(options);
    return weekly;
  });
  t.mock.method(scoringService, 'calculateFantasyPoints', (stats) => stats.actual);

  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: 5, current_season: 2026, current_week: 8, best_ball: false }] })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10 }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map(({ id, position }) => ({ player_id: id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: entries.map(({ id }) => ({ player_id: id })),
    })],
    [/^SELECT "players"\."id"/, () => ({ rows: entries })],
    [/^SELECT "players"\."position"/, () => ({ rows: [] })], // spentStartingSlots: nobody departed
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })], // kickedOffTeams: nobody locked
    [/FROM "nfl_games" "ng"/, () => ({ rows: [] })], // computeByeWeeks: nobody on bye here (#1235's bye/opponent-null case is covered in lineup.service.test.js)
    [/^SELECT "nfl_team", "opponent", "kickoff_at", "game_key" FROM "nfl_games"/, () => ({
      rows: [
        { nfl_team: 'KC', opponent: 'DEN', kickoff_at: '2026-11-01T18:00:00Z', game_key: 'KC-DEN' },
        { nfl_team: 'DAL', opponent: 'PHI', kickoff_at: '2026-11-01T18:00:00Z', game_key: 'DAL-PHI' },
        { nfl_team: 'MIA', opponent: 'NE', kickoff_at: '2026-11-01T18:00:00Z', game_key: 'MIA-NE' },
        { nfl_team: 'SF', opponent: 'SEA', kickoff_at: '2026-11-01T18:00:00Z', game_key: 'SF-SEA' },
        { nfl_team: 'NYJ', opponent: 'NO', kickoff_at: '2026-11-01T18:00:00Z', game_key: 'NYJ-NO' },
        { nfl_team: 'BUF', opponent: 'NYG', kickoff_at: '2026-11-01T13:00:00Z', game_key: 'BUF-NYG' },
        { nfl_team: 'GB', opponent: 'MIN', kickoff_at: '2026-11-01T13:00:00Z', game_key: 'GB-MIN' },
      ],
    })],
    [/^SELECT "home_team", "away_team", "game_status" FROM "live_game_states"/, () => ({
      rows: [
        { home_team: 'BUF', away_team: 'NYG', game_status: 'in_progress' },
        { home_team: 'GB', away_team: 'MIN', game_status: 'final' },
      ],
    })],
  ]).install(t);

  const token = signToken({ id: 7, username: 'member' });
  const response = await request(app)
    .get('/api/team/lineup?leagueId=5')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(projectionCalls.length, 1, 'exactly one weekly projection read for the whole lineup');
  assert.deepEqual(projectionCalls[0].playerIds, [1, 2, 3, 4, 5, 6, 7, 8]);
  const byId = new Map(response.body.entries.map((entry) => [entry.id, entry]));

  assert.deepEqual(byId.get(1).edge, { kind: 'factor', text: 'Matchup +3.5' });
  assert.deepEqual(byId.get(2).edge, { kind: 'injury', text: 'questionable, ankle' });
  // The bench player outprojects the FLEX starter (Weak Flex, 5) but not the
  // RB starter (Injury RB, 16): the FLEX-specific case the ruling names.
  assert.deepEqual(byId.get(4).edge, { kind: 'bench-above-starter', text: 'Outprojects Weak Flex at FLEX' });
  assert.deepEqual(byId.get(5).edge, { kind: 'none', text: null });
  assert.equal(byId.get(5).projection, null, 'no estimate: projection null');
  assert.equal(byId.get(5).floor, null, 'no estimate: floor null together with projection');
  assert.equal(byId.get(5).ceiling, null, 'no estimate: ceiling null together with projection');
  assert.deepEqual(byId.get(6).edge, { kind: 'pace', text: '67% of projection so far (6 of 9 pts)' });
  assert.deepEqual(byId.get(7).edge, { kind: 'result', text: 'Beat projection by 6 pts (20 of 14)' });
  // Priority 1 (injury) wins over every live-game kind, and the Unavailable
  // reason is its own field, independent of the Edge line.
  assert.deepEqual(byId.get(8).edge, { kind: 'injury', text: 'out' });
  assert.equal(byId.get(8).unavailable, 'out');
  assert.equal(byId.get(2).unavailable, null, 'Questionable is not Unavailable');

  assert.equal(byId.get(1).projection, 18);
  assert.equal(byId.get(1).floor, 12);
  assert.equal(byId.get(1).ceiling, 24);
  assert.equal(byId.get(1).game_key, 'KC-DEN');

  fake.assertClean();
});
