const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, select } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const projectionService = require('../services/projection.service');
const lineupService = require('../services/lineup.service');
const decisionService = require('../services/decision.service');
const clock = require('../modules/clock');

/**
 * GET /api/league/:id/matchups/:matchupId reports each side's expected
 * final and players remaining (`home.expectedFinal`, `home.playersRemaining`)
 * from the shared producer, and its per-player `projected` figures read the
 * same weekly run: a starter's carries the availability rule (bye/Out/IR
 * count zero), a bench player's is the run's raw number. The old
 * `projectedTotal` is gone.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'matchup-detail-expected-final-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const LEAGUE_ID = 1;
const SEASON = 2026;
const WEEK = 8;
const HOME = 11;
const AWAY = 12;
const authed = (userId) => `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

const MATCHUP_ROW = {
  id: 7,
  league_id: LEAGUE_ID,
  season: SEASON,
  week: WEEK,
  home_team_id: HOME,
  away_team_id: AWAY,
  home_score: '0',
  away_score: '0',
  final: false,
  home_team_name: 'Gridiron Ghosts',
  away_team_name: 'Sunday Scaries',
  home_owner_id: 42,
  away_owner_id: 43,
  home_team_avatar_url: null,
  away_team_avatar_url: null,
  home_team_avatar_static_url: null,
  away_team_avatar_static_url: null,
};

// Home starters: a QB whose game is final at 22.5 (562.5 passing yards at
// 0.04), a WR ruled Out (projection 11.3 counts 0) not yet kicked off. Home
// bench: an RB with a raw projection of 7.7. Away: one starter, a bye.
const player = (id, name, position, nfl_team, injury_status, slot, stats) => ({
  id, name, position, nfl_team, injury_status, slot, stats,
});
const HOME_STARTERS = [
  player(101, 'Some Passer', 'QB', 'KC', null, 'QB', { passingYards: 562.5 }),
  player(102, 'Some Wideout', 'WR', 'PHI', 'O', 'WR', null),
];
const HOME_BENCH = [player(103, 'Some Runner', 'RB', 'DAL', null, 'BENCH', null)];
const AWAY_STARTERS = [player(201, 'Resting Back', 'RB', 'Ghosts', null, 'RB', null)];

const PROJECTIONS = new Map([
  [101, { points: 19 }],
  [102, { points: 11.3 }],
  [103, { points: 7.7 }],
  [201, { points: 9 }],
]);
const LIVE = [{ home_team: 'KC', away_team: 'LV', game_status: 'final' }];
const SCHEDULE = [
  { nfl_team: 'KC', opponent: 'LV', kickoff_at: '2099-10-25T17:00:00.000Z' },
  { nfl_team: 'PHI', opponent: 'NYG', kickoff_at: '2099-10-25T20:25:00.000Z' },
  { nfl_team: 'DAL', opponent: 'SF', kickoff_at: '2099-10-25T20:25:00.000Z' },
];
const BYE_ROWS = [];
for (let w = 1; w <= 18; w++) {
  for (const team of ['KC', 'PHI', 'DAL']) BYE_ROWS.push({ nfl_team: team, week: w });
  if (w !== WEEK) BYE_ROWS.push({ nfl_team: 'Ghosts', week: w });
}

async function getDetail(t) {
  const runCalls = [];
  t.mock.method(projectionService, 'getWeeklyProjections', async (args) => {
    runCalls.push([...args.playerIds].sort());
    return { modelVersion: 'test', projections: PROJECTIONS };
  });
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(decisionService, 'liveWhatIf', async () => null);
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...MATCHUP_ROW }] })],
    [select('leagues'), () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: false }] })],
    // The route's opponent map and the producer's kickoff map both read nfl_games for the week.
    [/FROM "nfl_games" "ng"/, () => ({ rows: BYE_ROWS })],
    [/FROM "nfl_games"/, () => ({ rows: SCHEDULE })],
    [/FROM "live_game_states"/, () => ({ rows: LIVE })],
    // The route's own per-team reads (bench by slot, starters by NOT IN).
    [/"lineup_entries"\."slot" = \$4/, (text, params) => ({
      rows: params[0] === HOME ? HOME_BENCH : [],
    })],
    [/"players"\."id", "players"\."name"[\s\S]*"lineup_entries"\."slot" NOT IN/, (text, params) => ({
      rows: params[0] === HOME ? HOME_STARTERS : AWAY_STARTERS,
    })],
    // The producer's one read across both teams.
    [/"lineup_entries"\."team_id", "lineup_entries"\."player_id"/, () => ({
      rows: [
        ...HOME_STARTERS.map((p) => ({ team_id: HOME, player_id: p.id, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
        ...AWAY_STARTERS.map((p) => ({ team_id: AWAY, player_id: p.id, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
      ],
    })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/matchups/7`)
    .set('Authorization', authed(42));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { body: res.body, runCalls };
}

test('each side carries its expected final and players remaining, and projectedTotal is gone', async (t) => {
  const { body } = await getDetail(t);
  // Home: 22.5 (final) + 0 (Out, not started) = 22.5; one starter still to play.
  assert.equal(body.home.expectedFinal, 22.5);
  assert.equal(body.home.playersRemaining, 1);
  // Away: a bye counts 0 and is final.
  assert.equal(body.away.expectedFinal, 0);
  assert.equal(body.away.playersRemaining, 0);
  assert.equal('projectedTotal' in body.home, false);
  assert.equal('projectedTotal' in body.away, false);
});

test('starters project under the availability rule and bench players from the same run raw', async (t) => {
  const { body, runCalls } = await getDetail(t);
  const byId = new Map([...body.home.starters, ...body.home.bench, ...body.away.starters].map((p) => [p.id, p]));
  assert.equal(byId.get(101).projected, 19);
  assert.equal(byId.get(102).projected, 0, 'a starter ruled Out projects zero');
  assert.equal(byId.get(201).projected, 0, 'a starter on bye projects zero');
  assert.equal(byId.get(103).projected, 7.7, 'a bench player shows the run\'s raw number');
  assert.equal(byId.get(101).points, 22.5);
  // Two reads of the weekly run: the producer's (every starter) and the bench's.
  assert.deepEqual(runCalls, [[101, 102, 201], [103]]);
});

// ---------------------------------------------------------------------------
// matchup.status on the detail body, at a fixed instant.
// ---------------------------------------------------------------------------

const NOW = '2026-10-25T18:00:00.000Z'; // Sunday afternoon, after the 17:00Z kickoffs

// One home starter (KC) and one away starter (DAL); the live rows and the
// schedule set their game states, so a fixture can name any status.
async function detailStatus(t, { live, schedule }) {
  t.mock.method(clock, 'now', () => new Date(NOW));
  t.mock.method(projectionService, 'getWeeklyProjections', async () => ({ modelVersion: 'test', projections: new Map([[301, { points: 10 }], [401, { points: 10 }]]) }));
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(decisionService, 'liveWhatIf', async () => null);
  const homeStarters = [player(301, 'Home QB', 'QB', 'KC', null, 'QB', null)];
  const awayStarters = [player(401, 'Away RB', 'RB', 'DAL', null, 'RB', null)];
  const byes = [];
  for (let w = 1; w <= 18; w++) for (const team of ['KC', 'DAL']) byes.push({ nfl_team: team, week: w });
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...MATCHUP_ROW }] })],
    [select('leagues'), () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: false }] })],
    [/FROM "nfl_games" "ng"/, () => ({ rows: byes })],
    [/FROM "nfl_games"/, () => ({ rows: schedule })],
    [/FROM "live_game_states"/, () => ({ rows: live })],
    [/"lineup_entries"\."slot" = \$4/, () => ({ rows: [] })],
    [/"players"\."id", "players"\."name"[\s\S]*"lineup_entries"\."slot" NOT IN/, (text, params) => ({
      rows: params[0] === HOME ? homeStarters : awayStarters,
    })],
    [/"lineup_entries"\."team_id", "lineup_entries"\."player_id"/, () => ({
      rows: [
        ...homeStarters.map((p) => ({ team_id: HOME, player_id: p.id, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
        ...awayStarters.map((p) => ({ team_id: AWAY, player_id: p.id, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
      ],
    })],
  ]).install(t);
  const res = await request(app).get(`/api/league/${LEAGUE_ID}/matchups/7`).set('Authorization', authed(42));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

test('the detail body reports matchup.status live when a starter\'s game is in progress', async (t) => {
  const body = await detailStatus(t, {
    live: [{ home_team: 'KC', away_team: 'LV', game_status: 'in_progress' }],
    schedule: [
      { nfl_team: 'KC', opponent: 'LV', kickoff_at: '2026-10-25T17:00:00.000Z' },
      { nfl_team: 'DAL', opponent: 'NYG', kickoff_at: '2026-10-27T00:20:00.000Z' },
    ],
  });
  assert.equal(body.matchup.status, 'live');
});

test('the detail body reports matchup.status played when every starter\'s game is over', async (t) => {
  const body = await detailStatus(t, {
    live: [
      { home_team: 'KC', away_team: 'LV', game_status: 'final' },
      { home_team: 'DAL', away_team: 'NYG', game_status: 'final' },
    ],
    schedule: [
      { nfl_team: 'KC', opponent: 'LV', kickoff_at: '2026-10-25T17:00:00.000Z' },
      { nfl_team: 'DAL', opponent: 'NYG', kickoff_at: '2026-10-25T17:00:00.000Z' },
    ],
  });
  assert.equal(body.matchup.status, 'played');
});
