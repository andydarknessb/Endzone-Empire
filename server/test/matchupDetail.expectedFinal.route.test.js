const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool, select } = require('./helpers/fakePool');
const { tenureHandlers, tenure } = require('./helpers/tenureFakes');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const projectionService = require('../services/projection.service');
const lineupService = require('../services/lineup.service');
const decisionService = require('../services/decision.service');
const clock = require('../modules/clock');

/**
 * GET /api/league/:id/matchups/:matchupId reports each side's expected
 * final and players remaining (`home.expectedFinal`, `home.playersRemaining`)
 * from the shared producer, and every player row, starter or bench, is priced
 * by that producer's one read under the availability rule (bye/Out/IR count
 * zero) and carries `availability: { available, reason }` (#883). The old
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
// bench: an available RB with a weekly projection of 7.7, and a TE ruled Out
// (projection 5.5 counts 0). Away: one starter, a bye.
// player_id rides beside players.id because the settled reads select it (#976)
// and rowsHeldAsPlayed is the one consumer that reads it; every other consumer
// keys on id, so carrying both is what the real row shape does.
const player = (id, name, position, nfl_team, injury_status, slot, stats) => ({
  id, player_id: id, name, position, nfl_team, injury_status, slot, stats,
});
const HOME_STARTERS = [
  player(101, 'Some Passer', 'QB', 'KC', null, 'QB', { passingYards: 562.5 }),
  player(102, 'Some Wideout', 'WR', 'PHI', 'O', 'WR', null),
];
const HOME_BENCH = [
  { ...player(103, 'Some Runner', 'RB', 'DAL', null, 'BENCH', null), photo_url: 'https://a.espncdn.com/i/headshots/nfl/players/full/103.png' },
  player(104, 'Hurt Tight End', 'TE', 'DAL', 'O', 'BENCH', null),
];
const AWAY_STARTERS = [player(201, 'Resting Back', 'RB', 'Ghosts', null, 'RB', null)];

const PROJECTIONS = new Map([
  [101, { points: 19 }],
  [102, { points: 11.3 }],
  [103, { points: 7.7 }],
  [104, { points: 5.5 }],
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

async function getDetail(t, { gameRows = [], throwGames = false } = {}) {
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
    // The NFL games either roster plays in this week (one row per rostered
    // player and game, so a game repeats once per player from that team).
    [/FROM "view_matchup_nfl_games"/, () => { if (throwGames) throw new Error('view unavailable'); return { rows: gameRows }; }],
    // The route's own per-team reads (bench by slot, starters by NOT IN).
    [/"lineup_entries"\."slot" = \$4/, (text, params) => ({
      rows: params[0] === HOME ? HOME_BENCH : [],
    })],
    [/"players"\."id", "players"\."name"[\s\S]*"lineup_entries"\."slot" NOT IN/, (text, params) => ({
      rows: params[0] === HOME ? HOME_STARTERS : AWAY_STARTERS,
    })],
    // The producer's one read across both teams: every non-IR lineup row,
    // bench included, each carrying its slot.
    // Answers the read's slot predicate the way the table would (a statement
    // that still excludes BENCH rows gets none), so the #883 WHERE clause
    // change is bound: restoring NOT IN ('BENCH', 'IR') turns the bench cases red.
    [/"lineup_entries"\."team_id", "lineup_entries"\."player_id"/, (text) => {
      const rows = [
        ...[...HOME_STARTERS, ...HOME_BENCH].map((p) => ({ team_id: HOME, player_id: p.id, slot: p.slot, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
        ...AWAY_STARTERS.map((p) => ({ team_id: AWAY, player_id: p.id, slot: p.slot, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
      ];
      return { rows: /NOT IN \('BENCH'/.test(text) ? rows.filter((r) => r.slot !== 'BENCH') : rows };
    }],
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

// #883: every row, starter or bench, is priced by the one rule, and an
// unavailable row says why. Red-tell: removing the availability zeroing for
// bench rows in the decorator turns the Out-bench case red and no other.
test('an Out bench player projects zero with the reason, an available bench player carries the weekly figure', async (t) => {
  const { body } = await getDetail(t);
  const byId = new Map(body.home.bench.map((p) => [p.id, p]));
  assert.equal(byId.get(104).projected, 0, 'an Out bench player projects zero');
  assert.deepEqual(byId.get(104).availability, { available: false, reason: 'out' });
  assert.equal(byId.get(103).projected, 7.7, 'an available bench player carries the weekly figure');
  assert.deepEqual(byId.get(103).availability, { available: true, reason: null });
});

test('a starter on bye projects zero with the reason and is excluded from the expected final', async (t) => {
  const { body } = await getDetail(t);
  const [resting] = body.away.starters;
  assert.equal(resting.id, 201);
  assert.equal(resting.projected, 0);
  assert.deepEqual(resting.availability, { available: false, reason: 'bye' });
  assert.equal(body.away.expectedFinal, 0, 'the bye contributes nothing to the team');
  // A starter ruled Out reads the same way; an available starter carries no reason.
  const home = new Map(body.home.starters.map((p) => [p.id, p]));
  assert.deepEqual(home.get(102).availability, { available: false, reason: 'out' });
  assert.deepEqual(home.get(101).availability, { available: true, reason: null });
  assert.equal(home.get(101).projected, 19);
});

test('the detail route makes one projection read per matchup, bench rows included', async (t) => {
  const { runCalls } = await getDetail(t);
  assert.deepEqual(runCalls, [[101, 102, 103, 104, 201]]);
});

// ---------------------------------------------------------------------------
// nflGameIds on the detail body (#884): the NFL games either roster plays in
// this week, read from view_matchup_nfl_games inside the same request that
// materializes both lineups, replacing the separate games route it used to need.
// ---------------------------------------------------------------------------

test('nflGameIds lists each NFL game once, sorted, however many rostered players share it (#884)', async (t) => {
  const { body } = await getDetail(t, {
    gameRows: [
      { tank01_game_id: '20260913_SF@LAR' },
      { tank01_game_id: '20260910_BUF@KC' },
      { tank01_game_id: '20260910_BUF@KC' }, // two Chiefs on one roster: one game
    ],
  });
  assert.deepEqual(body.nflGameIds, ['20260910_BUF@KC', '20260913_SF@LAR']);
});

test('nflGameIds is an empty array, not an error, for a week with no live game rows yet (#884)', async (t) => {
  const { body } = await getDetail(t, { gameRows: [] });
  assert.deepEqual(body.nflGameIds, []);
});

test('a failed games read leaves nflGameIds empty and the detail body still answers (#884)', async (t) => {
  const { body } = await getDetail(t, { throwGames: true });
  assert.deepEqual(body.nflGameIds, []);
  assert.equal(body.home.expectedFinal, 22.5, 'the rest of the body is unaffected');
});

// ---------------------------------------------------------------------------
// matchup.status on the detail body, at a fixed instant.
// ---------------------------------------------------------------------------

const NOW = '2026-10-25T18:00:00.000Z'; // Sunday afternoon, after the 17:00Z kickoffs

// One home starter (KC) and one away starter (DAL); the live rows and the
// schedule set their game states, so a fixture can name any status.
async function detailStatus(t, { live, schedule, throwLive = false }) {
  t.mock.method(clock, 'now', () => new Date(NOW));
  t.mock.method(projectionService, 'getWeeklyProjections', async () => ({ modelVersion: 'test', projections: new Map([[301, { points: 10 }], [401, { points: 10 }]]) }));
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(decisionService, 'liveWhatIf', async () => null);
  const homeStarters = [player(301, 'Home QB', 'QB', 'KC', null, 'QB', null)];
  // The away RB is ruled Out, so the no-priced-row fallback (F1) has a
  // designation to speak from.
  const awayStarters = [player(401, 'Away RB', 'RB', 'DAL', 'O', 'RB', null)];
  const byes = [];
  for (let w = 1; w <= 18; w++) for (const team of ['KC', 'DAL']) byes.push({ nfl_team: team, week: w });
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...MATCHUP_ROW }] })],
    [select('leagues'), () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: false }] })],
    [/FROM "nfl_games" "ng"/, () => ({ rows: byes })],
    [/FROM "nfl_games"/, () => ({ rows: schedule })],
    [/FROM "live_game_states"/, () => { if (throwLive) throw new Error('live table unavailable'); return { rows: live }; }],
    [/FROM "view_matchup_nfl_games"/, () => ({ rows: [] })],
    [/"lineup_entries"\."slot" = \$4/, () => ({ rows: [] })],
    [/"players"\."id", "players"\."name"[\s\S]*"lineup_entries"\."slot" NOT IN/, (text, params) => ({
      rows: params[0] === HOME ? homeStarters : awayStarters,
    })],
    [/"lineup_entries"\."team_id", "lineup_entries"\."player_id"/, () => ({
      rows: [
        ...homeStarters.map((p) => ({ team_id: HOME, player_id: p.id, slot: p.slot, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
        ...awayStarters.map((p) => ({ team_id: AWAY, player_id: p.id, slot: p.slot, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
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

test('the detail body states matchup.status null when a read fails, never a false scheduled (F1)', async (t) => {
  const body = await detailStatus(t, {
    throwLive: true,
    schedule: [
      { nfl_team: 'KC', opponent: 'LV', kickoff_at: '2026-10-25T17:00:00.000Z' },
      { nfl_team: 'DAL', opponent: 'NYG', kickoff_at: '2026-10-25T17:00:00.000Z' },
    ],
  });
  assert.equal(body.matchup.status, null);
  assert.equal(body.home.expectedFinal, null);
  // With no priced row the availability rule still speaks from the injury
  // designation alone: the Out RB says so, the healthy QB carries no reason.
  // Red-tell: returning null availability from the fallback turns this red.
  assert.deepEqual(body.away.starters[0].availability, { available: false, reason: 'out' });
  assert.deepEqual(body.home.starters[0].availability, { available: true, reason: null });
  assert.equal(body.away.starters[0].projected, null);
});

// ---------------------------------------------------------------------------
// #892: per-row game state, clock and headshot; the two week facts on the
// matchup object.
// ---------------------------------------------------------------------------

test('a final starter carries game_state final and no clock; a bench row carries its headshot; the matchup its week facts', async (t) => {
  const { body } = await getDetail(t);
  const passer = body.home.starters.find((p) => p.id === 101);
  assert.equal(passer.game_state, 'final');
  assert.equal(passer.game_clock, null);
  const wideout = body.home.starters.find((p) => p.id === 102);
  assert.equal(wideout.game_state, 'scheduled');
  const runner = body.home.bench.find((p) => p.id === 103);
  assert.equal(runner.photo_url, 'https://a.espncdn.com/i/headshots/nfl/players/full/103.png');
  assert.equal(body.home.starters.find((p) => p.id === 102).photo_url, null);
  // The earliest kickoff among either side's starters (KC at 17:00Z, PHI at
  // 20:25Z; the bye has none), and no live update time on a final-only row set.
  assert.equal(body.matchup.first_kickoff_at, '2099-10-25T17:00:00.000Z');
  assert.equal(body.matchup.synced_at, null);
});

test('an in-progress starter carries the live clock as one string', async (t) => {
  const body = await detailStatus(t, {
    live: [{ home_team: 'KC', away_team: 'LV', game_status: 'in_progress', quarter: 'Q3', time_remaining: '6:42', updated_at: '2026-10-25T17:58:00.000Z' }],
    schedule: [
      { nfl_team: 'KC', opponent: 'LV', kickoff_at: '2026-10-25T17:00:00.000Z' },
      { nfl_team: 'DAL', opponent: 'NYG', kickoff_at: '2026-10-27T00:20:00.000Z' },
    ],
  });
  const [homeQb] = body.home.starters;
  assert.equal(homeQb.game_state, 'in_progress');
  assert.equal(homeQb.game_clock, 'Q3 6:42');
  const [awayRb] = body.away.starters;
  assert.equal(awayRb.game_state, 'scheduled');
  assert.equal(awayRb.game_clock, null);
  assert.equal(body.matchup.synced_at, '2026-10-25T17:58:00.000Z');
  assert.equal(body.matchup.first_kickoff_at, '2026-10-25T17:00:00.000Z');
});

// ---------------------------------------------------------------------------
// #952: a settled (final) matchup. expectedFinal.service's decorateMatchups
// filters `!matchup.final` before it reads anything, so the shared producer
// never runs for a final matchup (decoration.home/away come back null) - the
// route's own per-team lineup SQL is what still builds both sides. No case
// before this one drove a final matchup, so that survival path had no guard.
// ---------------------------------------------------------------------------

const FINAL_MATCHUP_ROW = {
  ...MATCHUP_ROW,
  final: true,
  home_score: '134.58',
  away_score: '96.20',
};
const FINAL_HOME_STARTERS = [
  player(501, 'Settled Home QB', 'QB', 'KC', null, 'QB', null),
];
const FINAL_HOME_BENCH = [
  player(502, 'Settled Home Bench RB', 'RB', 'DAL', null, 'BENCH', null),
];
const FINAL_AWAY_STARTERS = [
  player(503, 'Settled Away WR', 'WR', 'PHI', null, 'WR', null),
];
const FINAL_AWAY_BENCH = [
  player(504, 'Settled Away Bench TE', 'TE', 'PHI', null, 'BENCH', null),
];

test('a final (settled) matchup still returns non-empty starters and bench for both sides, with the settled score (#952)', async (t) => {
  t.mock.method(projectionService, 'getWeeklyProjections', async () => ({ modelVersion: 'test', projections: new Map() }));
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(decisionService, 'liveWhatIf', async () => null);
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...FINAL_MATCHUP_ROW }] })],
    [select('leagues'), () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: false }] })],
    [/FROM "nfl_games"/, () => ({ rows: [] })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "view_matchup_nfl_games"/, () => ({ rows: [] })],
    // The route's own per-team reads (bench by slot, starters by NOT IN):
    // these are what still populate a settled matchup's lineups.
    [/"lineup_entries"\."slot" = \$4/, (text, params) => ({
      rows: params[0] === HOME ? FINAL_HOME_BENCH : FINAL_AWAY_BENCH,
    })],
    [/"players"\."id", "players"\."name"[\s\S]*"lineup_entries"\."slot" NOT IN/, (text, params) => ({
      rows: params[0] === HOME ? FINAL_HOME_STARTERS : FINAL_AWAY_STARTERS,
    })],
    // No handler for the producer's own read
    // (`"lineup_entries"."team_id", "lineup_entries"."player_id"...`): a
    // final matchup's `open` list is empty, so decorateMatchups never issues
    // it. If a refactor made the route depend on that read instead, this
    // fixture would throw "unexpected query" here rather than silently
    // passing.
  ]).install(t);

  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/matchups/7`)
    .set('Authorization', authed(42));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { body } = res;
  assert.equal(body.matchup.final, true);
  assert.equal(body.matchup.home_score, '134.58');
  assert.equal(body.matchup.away_score, '96.20');
  assert.ok(body.home.starters.length > 0, 'home starters non-empty');
  assert.ok(body.home.bench.length > 0, 'home bench non-empty');
  assert.ok(body.away.starters.length > 0, 'away starters non-empty');
  assert.ok(body.away.bench.length > 0, 'away bench non-empty');
});

// ---------------------------------------------------------------------------
// #953: a best-ball league. Nobody sets a lineup (CONTEXT.md, Best ball), so
// materialization writes BENCH for every row and the route's stored-slot split
// finds no starter - the bug was every player under Bench, next to a projected
// final computed from a different idea of who started. The starters are the
// optimizer's chosen lineup, the set the producer summed into the team's
// Expected final; the route must partition its own rows by that chosen set so
// the list and the number agree. This matchup is OPEN (not final), so the
// producer runs and its read IS registered here - the settled case above keeps
// its missing-handler guard (trap 2), which is a different, out-of-scope fix.
// ---------------------------------------------------------------------------

const BB_MATCHUP_ROW = { ...MATCHUP_ROW }; // open (final: false), same teams
// Two QBs per side, both stored BENCH. The optimizer fills the one QB slot with
// the higher projection and benches the other, so the chosen set is a strict
// subset and each list carries a distinct id. Home: 601 (20) starts, 602 (8)
// benches. Away: 603 (15) starts, 604 (6) benches.
const BB_HOME = [
  player(601, 'BB Home QB1', 'QB', 'KC', null, 'BENCH', null),
  player(602, 'BB Home QB2', 'QB', 'BUF', null, 'BENCH', null),
];
const BB_AWAY = [
  player(603, 'BB Away QB1', 'QB', 'SF', null, 'BENCH', null),
  player(604, 'BB Away QB2', 'QB', 'DAL', null, 'BENCH', null),
];
const BB_PROJECTIONS = new Map([
  [601, { points: 20 }],
  [602, { points: 8 }],
  [603, { points: 15 }],
  [604, { points: 6 }],
]);
// All 18 weeks present for every team so no team reads as on bye.
const BB_BYE_ROWS = [];
for (let w = 1; w <= 18; w++) {
  for (const teamCode of ['KC', 'BUF', 'SF', 'DAL']) BB_BYE_ROWS.push({ nfl_team: teamCode, week: w });
}
// Kickoffs far in the future, so every game reads scheduled at the real clock:
// a scheduled starter's expected final is exactly his projection, which lets
// the list-sums-to-total assertion compare projections directly.
const BB_SCHEDULE = [
  { nfl_team: 'KC', opponent: 'LV', kickoff_at: '2099-10-25T17:00:00.000Z' },
  { nfl_team: 'BUF', opponent: 'MIA', kickoff_at: '2099-10-25T17:00:00.000Z' },
  { nfl_team: 'SF', opponent: 'LAR', kickoff_at: '2099-10-25T20:25:00.000Z' },
  { nfl_team: 'DAL', opponent: 'NYG', kickoff_at: '2099-10-25T20:25:00.000Z' },
];

async function getBestBallDetail(t, { projectionsThrow = false } = {}) {
  t.mock.method(projectionService, 'getWeeklyProjections', async () => {
    if (projectionsThrow) throw new Error('projection store unavailable');
    return { modelVersion: 'test', projections: BB_PROJECTIONS };
  });
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(decisionService, 'liveWhatIf', async () => null);
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...BB_MATCHUP_ROW }] })],
    [select('leagues'), () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: true }] })],
    // The producer's bye read; must precede the bare nfl_games matcher below.
    [/FROM "nfl_games" "ng"/, () => ({ rows: BB_BYE_ROWS })],
    // Both the route's opponent map and the producer's kickoff map read this;
    // each row carries opponent and kickoff_at so both consumers are answered.
    [/FROM "nfl_games"/, () => ({ rows: BB_SCHEDULE })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "view_matchup_nfl_games"/, () => ({ rows: [] })],
    // The route's own per-team reads. Best ball stores BENCH for every row, so
    // the bench read returns the whole side and the starter read returns none -
    // exactly the shape that made the stored-slot split show no starters.
    [/"lineup_entries"\."slot" = \$4/, (text, params) => ({
      rows: params[0] === HOME ? BB_HOME : BB_AWAY,
    })],
    [/"players"\."id", "players"\."name"[\s\S]*"lineup_entries"\."slot" NOT IN/, () => ({ rows: [] })],
    // The producer's one read across both teams: every non-IR lineup row with
    // its slot, the candidate pool the optimizer chooses from.
    [/"lineup_entries"\."team_id", "lineup_entries"\."player_id"/, () => ({
      rows: [
        ...BB_HOME.map((p) => ({ team_id: HOME, player_id: p.id, slot: p.slot, position: p.position, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
        ...BB_AWAY.map((p) => ({ team_id: AWAY, player_id: p.id, slot: p.slot, position: p.position, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
      ],
    })],
  ]).install(t);
  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/matchups/7`)
    .set('Authorization', authed(42));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

const round2 = (x) => Math.round(x * 100) / 100;

test('a best-ball matchup lists the optimizer\'s chosen lineup as starters, not an empty starters list (#953)', async (t) => {
  const body = await getBestBallDetail(t);
  // Criterion 1: the starters list is non-empty (the bug listed every player
  // under Bench). Criterion 3 red-tell: reverting buildTeam to the stored-slot
  // split makes raw.starterRows (empty for best ball) the starters, so this
  // asserts empty and turns red.
  assert.ok(body.home.starters.length > 0, 'home starters non-empty');
  assert.ok(body.away.starters.length > 0, 'away starters non-empty');
});

test('the listed best-ball starters are exactly the set the returned total sums (#953)', async (t) => {
  const body = await getBestBallDetail(t);
  // Criterion 2: the list and the number cannot disagree. The chosen QB is the
  // higher projection on each side; the other QB rides in Bench and is NOT
  // summed. Asserting distinct ids proves the two lists are not the same query,
  // and comparing the starters' projections to expectedFinal proves the total
  // sums exactly those rows. Red-tell: the stored-slot split lists no starters
  // (sum 0) beside a producer total of 20, so both the id and the sum assertion
  // turn red.
  assert.deepEqual(body.home.starters.map((p) => p.id), [601]);
  assert.deepEqual(body.home.bench.map((p) => p.id), [602]);
  assert.equal(body.home.expectedFinal, 20);
  assert.equal(round2(body.home.starters.reduce((sum, p) => sum + p.projected, 0)), body.home.expectedFinal);

  assert.deepEqual(body.away.starters.map((p) => p.id), [603]);
  assert.deepEqual(body.away.bench.map((p) => p.id), [604]);
  assert.equal(body.away.expectedFinal, 15);
  assert.equal(round2(body.away.starters.reduce((sum, p) => sum + p.projected, 0)), body.away.expectedFinal);
});

test('a best-ball projection outage does not claim every player is a starter (#953 F1)', async (t) => {
  // When the projection read throws, the producer declines to choose a lineup
  // (statusReliable false) and hands back every candidate as `starters` with
  // null figures. Gating the best-ball branch on statusReliable makes the route
  // fall through to the stored-slot split instead of turning that refusal into
  // "every player started": the stored slot is BENCH for all, so starters is
  // empty and every player rides in Bench, exactly the pre-#953 behaviour and
  // no regression. Red-tell: dropping `team.statusReliable` from the gate makes
  // this list all four players as starters with an empty bench, turning the
  // starters-length and expectedFinal-null assertions red.
  const body = await getBestBallDetail(t, { projectionsThrow: true });
  assert.equal(body.home.starters.length, 0, 'no confident starter claim on an outage');
  assert.deepEqual(body.home.bench.map((p) => p.id).sort(), [601, 602]);
  assert.equal(body.home.expectedFinal, null);
  assert.equal(body.away.starters.length, 0);
  assert.deepEqual(body.away.bench.map((p) => p.id).sort(), [603, 604]);
  assert.equal(body.away.expectedFinal, null);
});

// ---------------------------------------------------------------------------
// #976: a SETTLED matchup lists the week AS PLAYED, not through the current
// roster. The score of record was computed over the as-played population
// (CONTEXT.md, Settle pass), so a detail page that joins `team_players` prints
// a list and a score that describe different teams: a starter who played and
// was dropped afterwards vanishes from the list while his points stay in the
// total, and a player acquired after his own kickoff appears in a week he did
// not play for this team.
//
// The fake performs no join, so the fixture's lineup handlers lift both
// properties out of the emitted statement (the precedent is
// finalWeekFreeze.test.js): the current-roster filter is applied only when the
// statement still names "team_players", and `player_id` rides on a row only
// when the select list actually asks for it. That second lift is what makes
// the 200 assertion bind edit 1 - drop the column from the SQL and
// `rowsHeldAsPlayed` reaches for an id that is not there, which
// `scheduleKeyFor` turns into a 500 rather than an empty exclusion set (#227).
// ---------------------------------------------------------------------------

const SETTLED_MATCHUP_ROW = {
  ...MATCHUP_ROW,
  final: true,
  home_score: '30.00',
  away_score: '5.00',
};
// Home: a starter still on the roster (10), a starter who played and was
// DROPPED afterwards (20), and a starter ACQUIRED AFTER HIS OWN KICKOFF (10),
// who is no part of the week as played. 30 is the stored home score.
const SETTLED_HOME_KEPT = player(801, 'Kept Starter', 'QB', 'KC', null, 'QB', { passingYards: 250 });
const SETTLED_HOME_DROPPED = player(802, 'Dropped Starter', 'RB', 'DAL', null, 'RB', { rushingYards: 200 });
const SETTLED_HOME_LATE = player(803, 'Late Acquirer', 'WR', 'PHI', null, 'WR', { receivingYards: 100 });
const SETTLED_HOME_BENCH = player(804, 'Settled Bench TE', 'TE', 'KC', null, 'BENCH', null);
const SETTLED_AWAY_KEPT = player(811, 'Away Starter', 'RB', 'SF', null, 'RB', { rushingYards: 50 });

const SETTLED_STARTERS = [SETTLED_HOME_KEPT, SETTLED_HOME_DROPPED, SETTLED_HOME_LATE, SETTLED_AWAY_KEPT];
const SETTLED_BENCH = [SETTLED_HOME_BENCH];
const SETTLED_TEAM_OF = new Map([[801, HOME], [802, HOME], [803, HOME], [804, HOME], [811, AWAY]]);
// The roster as it stands TODAY: 802 has been dropped since the week settled.
const SETTLED_ROSTER_TODAY = new Set([801, 803, 804, 811]);

const SETTLED_KICKOFFS = {
  KC: new Date('2026-10-25T17:00:00.000Z'),
  DAL: new Date('2026-10-25T17:00:00.000Z'),
  PHI: new Date('2026-10-25T20:25:00.000Z'),
  SF: new Date('2026-10-25T20:25:00.000Z'),
};
const SETTLED_SCHEDULE = Object.entries(SETTLED_KICKOFFS).map(([nfl_team, at]) => ({
  nfl_team, opponent: 'OPP', kickoff_at: at.toISOString(),
}));
// Explicit for the late acquirer only, with everyone else held since long
// before kickoff. Taking the helper's permissive default for all would make
// the tenure filter exclude nobody (a green bought for nothing); leaving
// `heldSince` null would exclude EVERYONE and buy the absence assertion by
// deleting the team.
const SETTLED_TENURES = [tenure(HOME, 803, new Date('2026-10-26T00:00:00.000Z'))];
const SETTLED_HELD_SINCE = new Date('2026-08-01T00:00:00.000Z');

async function getSettledDetail(t) {
  t.mock.method(projectionService, 'getWeeklyProjections', async () => ({ modelVersion: 'test', projections: new Map() }));
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(decisionService, 'liveWhatIf', async () => null);
  // The fake joins nothing, so answer these two questions the way the table
  // would: the current-roster filter applies only while the statement still
  // names team_players, and player_id rides only when it is selected.
  const answer = (pool, text, params) => {
    let rows = pool.filter((p) => SETTLED_TEAM_OF.get(p.id) === params[0]);
    if (/"team_players"/.test(text)) rows = rows.filter((p) => SETTLED_ROSTER_TODAY.has(p.id));
    const selectsPlayerId = /"lineup_entries"\."player_id",/.test(text);
    return { rows: rows.map((p) => (selectsPlayerId ? { ...p, player_id: p.id } : { ...p, player_id: undefined })) };
  };
  createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...SETTLED_MATCHUP_ROW }] })],
    [select('leagues'), () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: false }] })],
    // BEFORE the route's own unanchored nfl_games entry: tenureHandlers'
    // kickoff matcher is anchored on the same table, and fakePool takes the
    // first match, so the other order silently substitutes the route's
    // schedule for the tenure fixture's.
    ...tenureHandlers({
      schedule: SETTLED_KICKOFFS, tenures: SETTLED_TENURES, heldSince: SETTLED_HELD_SINCE,
    }),
    [/FROM "nfl_games"/, () => ({ rows: SETTLED_SCHEDULE })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "view_matchup_nfl_games"/, () => ({ rows: [] })],
    [/"lineup_entries"\."slot" = \$4/, (text, params) => answer(SETTLED_BENCH, text, params)],
    [/"players"\."id", "players"\."name"[\s\S]*"lineup_entries"\."slot" NOT IN/, (text, params) => answer(SETTLED_STARTERS, text, params)],
  ]).install(t);
  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/matchups/7`)
    .set('Authorization', authed(42));
  // 200, not 500: the settled reads carry lineup_entries.player_id, the field
  // rowsHeldAsPlayed reads. Removing it from either select list makes
  // scheduleKeyFor throw and this line report a 500 (#227).
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

test('a settled matchup lists a dropped starter and sums to the stored score (#976)', async (t) => {
  const body = await getSettledDetail(t);
  const homeStarterIds = body.home.starters.map((p) => p.id).sort();
  assert.ok(homeStarterIds.includes(802), `a starter dropped after the week still played it: ${homeStarterIds}`);
  const homeSum = round2(body.home.starters.reduce((sum, p) => sum + p.points, 0));
  assert.equal(homeSum, Number(body.matchup.home_score), 'the list and the score of record describe the same team');
  const awaySum = round2(body.away.starters.reduce((sum, p) => sum + p.points, 0));
  assert.equal(awaySum, Number(body.matchup.away_score));
});

test('a settled matchup excludes a player acquired after his own kickoff (#976)', async (t) => {
  const body = await getSettledDetail(t);
  const listed = [...body.home.starters, ...body.home.bench].map((p) => p.id);
  assert.equal(listed.includes(803), false, `acquired after his own kickoff: ${listed}`);
  // Not bought by emptying the team: the rest of the week is still listed.
  assert.deepEqual(listed.sort(), [801, 802, 804]);
});

// ---------------------------------------------------------------------------
// #978: a settled matchup's materialization is a no-op (its own finality
// guard returns immediately), so the reads that followed it wrapped a
// transaction around zero writes - a BEGIN, two finality probes and a COMMIT
// per page view, for nothing. A settled request now skips both the
// transaction and materializeLineup outright; an open matchup is unchanged.
// ---------------------------------------------------------------------------

// The expected body captured from the handler as it stood on this PR's parent
// commit (80cdafd9, #1020, already on origin/integration when this branch was
// cut): this ticket only removes the transaction bracket and the
// materializeLineup calls around the settled reads, so the settled response
// body itself must be byte-for-byte the same before and after.
const SETTLED_EXPECTED_BODY = {
  viewerTeamId: 11,
  viewerWhatIf: null,
  matchup: {
    id: 7,
    league_id: LEAGUE_ID,
    season: SEASON,
    week: WEEK,
    home_team_id: HOME,
    away_team_id: AWAY,
    home_score: '30.00',
    away_score: '5.00',
    final: true,
    home_team_name: 'Gridiron Ghosts',
    away_team_name: 'Sunday Scaries',
    home_team_avatar_url: null,
    away_team_avatar_url: null,
    home_team_avatar_static_url: null,
    away_team_avatar_static_url: null,
    status: 'final',
    first_kickoff_at: null,
    synced_at: null,
  },
  nflGameIds: [],
  home: {
    teamId: HOME,
    name: 'Gridiron Ghosts',
    starters: [
      {
        id: 801, name: 'Kept Starter', position: 'QB', nfl_team: 'KC', injury_status: null, slot: 'QB',
        stats: { passingYards: 250 }, points: 10, projected: null,
        availability: { available: true, reason: null }, opponent: 'OPP', game_state: null, game_clock: null, photo_url: null,
      },
      {
        id: 802, name: 'Dropped Starter', position: 'RB', nfl_team: 'DAL', injury_status: null, slot: 'RB',
        stats: { rushingYards: 200 }, points: 20, projected: null,
        availability: { available: true, reason: null }, opponent: 'OPP', game_state: null, game_clock: null, photo_url: null,
      },
    ],
    bench: [
      {
        id: 804, name: 'Settled Bench TE', position: 'TE', nfl_team: 'KC', injury_status: null, slot: 'BENCH',
        stats: null, points: 0, projected: null,
        availability: { available: true, reason: null }, opponent: 'OPP', game_state: null, game_clock: null, photo_url: null,
      },
    ],
    expectedFinal: null,
    playersRemaining: null,
  },
  away: {
    teamId: AWAY,
    name: 'Sunday Scaries',
    starters: [
      {
        id: 811, name: 'Away Starter', position: 'RB', nfl_team: 'SF', injury_status: null, slot: 'RB',
        stats: { rushingYards: 50 }, points: 5, projected: null,
        availability: { available: true, reason: null }, opponent: 'OPP', game_state: null, game_clock: null, photo_url: null,
      },
    ],
    bench: [],
    expectedFinal: null,
    playersRemaining: null,
  },
};

test('a settled matchup opens no transaction and never calls materializeLineup, and the body is unchanged (#978)', async (t) => {
  const materializeMock = t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(projectionService, 'getWeeklyProjections', async () => ({ modelVersion: 'test', projections: new Map() }));
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  t.mock.method(decisionService, 'liveWhatIf', async () => null);
  const answer = (pool, text, params) => {
    let rows = pool.filter((p) => SETTLED_TEAM_OF.get(p.id) === params[0]);
    if (/"team_players"/.test(text)) rows = rows.filter((p) => SETTLED_ROSTER_TODAY.has(p.id));
    const selectsPlayerId = /"lineup_entries"\."player_id",/.test(text);
    return { rows: rows.map((p) => (selectsPlayerId ? { ...p, player_id: p.id } : { ...p, player_id: undefined })) };
  };
  const fake = createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...SETTLED_MATCHUP_ROW }] })],
    [select('leagues'), () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: false }] })],
    ...tenureHandlers({
      schedule: SETTLED_KICKOFFS, tenures: SETTLED_TENURES, heldSince: SETTLED_HELD_SINCE,
    }),
    [/FROM "nfl_games"/, () => ({ rows: SETTLED_SCHEDULE })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "view_matchup_nfl_games"/, () => ({ rows: [] })],
    [/"lineup_entries"\."slot" = \$4/, (text, params) => answer(SETTLED_BENCH, text, params)],
    [/"players"\."id", "players"\."name"[\s\S]*"lineup_entries"\."slot" NOT IN/, (text, params) => answer(SETTLED_STARTERS, text, params)],
  ]).install(t);

  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/matchups/7`)
    .set('Authorization', authed(42));
  assert.equal(res.status, 200, JSON.stringify(res.body));

  // No BEGIN, no COMMIT: a settled request never opens the transaction.
  assert.deepEqual(fake.matching(/^BEGIN$/), []);
  assert.deepEqual(fake.matching(/^COMMIT$/), []);
  // materializeLineup is never called on the settled path, not just a no-op
  // inside its own finality guard.
  assert.equal(materializeMock.mock.callCount(), 0);
  // The response body is exactly what the handler produced before this
  // ticket: only the transaction bracket around it is gone.
  assert.deepEqual(res.body, SETTLED_EXPECTED_BODY);
});

test('an open matchup still opens a transaction and materializes each team once (#978)', async (t) => {
  const materializeMock = t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(projectionService, 'getWeeklyProjections', async () => ({ modelVersion: 'test', projections: PROJECTIONS }));
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  t.mock.method(decisionService, 'liveWhatIf', async () => null);
  const fake = createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...MATCHUP_ROW }] })],
    [select('leagues'), () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: false }] })],
    [/FROM "nfl_games" "ng"/, () => ({ rows: BYE_ROWS })],
    [/FROM "nfl_games"/, () => ({ rows: SCHEDULE })],
    [/FROM "live_game_states"/, () => ({ rows: LIVE })],
    [/FROM "view_matchup_nfl_games"/, () => ({ rows: [] })],
    [/"lineup_entries"\."slot" = \$4/, (text, params) => ({
      rows: params[0] === HOME ? HOME_BENCH : [],
    })],
    [/"players"\."id", "players"\."name"[\s\S]*"lineup_entries"\."slot" NOT IN/, (text, params) => ({
      rows: params[0] === HOME ? HOME_STARTERS : AWAY_STARTERS,
    })],
    [/"lineup_entries"\."team_id", "lineup_entries"\."player_id"/, (text) => {
      const rows = [
        ...[...HOME_STARTERS, ...HOME_BENCH].map((p) => ({ team_id: HOME, player_id: p.id, slot: p.slot, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
        ...AWAY_STARTERS.map((p) => ({ team_id: AWAY, player_id: p.id, slot: p.slot, nfl_team: p.nfl_team, injury_status: p.injury_status, stats: p.stats })),
      ];
      return { rows: /NOT IN \('BENCH'/.test(text) ? rows.filter((r) => r.slot !== 'BENCH') : rows };
    }],
  ]).install(t);

  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/matchups/7`)
    .set('Authorization', authed(42));
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal(fake.matching(/^BEGIN$/).length, 1);
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  assert.equal(materializeMock.mock.callCount(), 2, 'once per team');
});

// #1017 gave liveWhatIf an optional `weekIsFinal`, so a caller that already
// holds the settled fact does not make it buy isWeekFinal's own COUNT read
// again. The route holds that fact on `matchup.final` and now passes it
// through as `weekIsFinal`. liveWhatIf itself is NOT mocked here (every other
// case in this file mocks it away): the point is to observe the real call it
// makes against the fake pool.
test('a settled matchup passes weekIsFinal into liveWhatIf, buying it out of its own finality COUNT read (#978, #1017)', async (t) => {
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(projectionService, 'getWeeklyProjections', async () => ({ modelVersion: 'test', projections: new Map() }));
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  const answer = (pool, text, params) => {
    let rows = pool.filter((p) => SETTLED_TEAM_OF.get(p.id) === params[0]);
    if (/"team_players"/.test(text)) rows = rows.filter((p) => SETTLED_ROSTER_TODAY.has(p.id));
    const selectsPlayerId = /"lineup_entries"\."player_id",/.test(text);
    return { rows: rows.map((p) => (selectsPlayerId ? { ...p, player_id: p.id } : { ...p, player_id: undefined })) };
  };
  const fake = createFakePool([
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ '?column?': 1 }] })],
    [select('matchups'), () => ({ rows: [{ ...SETTLED_MATCHUP_ROW }] })],
    [select('leagues'), () => ({ rows: [{ id: LEAGUE_ID, scoring_preset: 'half_ppr', best_ball: false }] })],
    ...tenureHandlers({
      schedule: SETTLED_KICKOFFS, tenures: SETTLED_TENURES, heldSince: SETTLED_HELD_SINCE,
    }),
    [/FROM "nfl_games"/, () => ({ rows: SETTLED_SCHEDULE })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "view_matchup_nfl_games"/, () => ({ rows: [] })],
    [/"lineup_entries"\."slot" = \$4/, (text, params) => answer(SETTLED_BENCH, text, params)],
    [/"players"\."id", "players"\."name"[\s\S]*"lineup_entries"\."slot" NOT IN/, (text, params) => answer(SETTLED_STARTERS, text, params)],
    // liveWhatIf's own population read (distinct from the route's own lineup
    // SQL above: this one leads with lineup_entries.player_id, not players.id).
    [/^SELECT "lineup_entries"\."player_id"/, () => ({
      rows: [
        { player_id: 801, name: 'Kept Starter', position: 'QB', nfl_team: 'KC', slot: 'QB', stats: { passingYards: 250 } },
        { player_id: 802, name: 'Dropped Starter', position: 'RB', nfl_team: 'DAL', slot: 'RB', stats: { rushingYards: 200 } },
      ],
    })],
  ]).install(t);

  const res = await request(app)
    .get(`/api/league/${LEAGUE_ID}/matchups/7`)
    .set('Authorization', authed(42));
  assert.equal(res.status, 200, JSON.stringify(res.body));

  // No isWeekFinal COUNT read: liveWhatIf trusted the weekIsFinal it was handed.
  assert.deepEqual(fake.matching(/^SELECT COUNT\(\*\)::int AS "n"/), []);
  // And the settled short-circuit answered: no swaps to advise on a played week.
  assert.deepEqual(res.body.viewerWhatIf, {
    teamId: HOME, week: WEEK, actualPoints: 30, optimalPoints: 30, delta: 0, swaps: [],
  });
});
