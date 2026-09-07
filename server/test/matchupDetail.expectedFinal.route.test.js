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
const player = (id, name, position, nfl_team, injury_status, slot, stats) => ({
  id, name, position, nfl_team, injury_status, slot, stats,
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

async function getBestBallDetail(t) {
  t.mock.method(projectionService, 'getWeeklyProjections', async () => ({ modelVersion: 'test', projections: BB_PROJECTIONS }));
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
