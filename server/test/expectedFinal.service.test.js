const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const projectionService = require('../services/projection.service');
const {
  expectedFinalForStarter,
  gameStateFor,
  expectedFinalsForWeek,
  statusForMatchup,
  attachExpectedFinals,
} = require('../services/expectedFinal.service');

/**
 * Expected final (CONTEXT.md): projection before kickoff, points plus the
 * floored shortfall while in progress, points alone once final; a team's is
 * the sum over its starters; players remaining counts starters whose game
 * has not finished. The service is the one producer behind the matchup
 * list, the matchup detail and the live-score socket event.
 */

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

test('a starter is his projection before kickoff, his floor-gapped points in progress, his points when final', () => {
  assert.equal(expectedFinalForStarter({ projection: 18.4, points: 0, gameState: 'scheduled' }), 18.4);
  // Quiet so far: still expected to reach his projection.
  assert.equal(expectedFinalForStarter({ projection: 18.4, points: 6.1, gameState: 'in_progress' }), 18.4);
  // Exploded early: nothing left to add, points stand.
  assert.equal(expectedFinalForStarter({ projection: 18.4, points: 27.3, gameState: 'in_progress' }), 27.3);
  // Final: whatever he scored, even below projection.
  assert.equal(expectedFinalForStarter({ projection: 18.4, points: 9.9, gameState: 'final' }), 9.9);
  // A starter ruled out (projection 0) and not yet final contributes nothing.
  assert.equal(expectedFinalForStarter({ projection: 0, points: 0, gameState: 'scheduled' }), 0);
});

test('game state: the live table wins, kickoff decides with no row, points prove a game began, bye is final', () => {
  const now = '2026-10-25T18:00:00.000Z';
  const before = '2026-10-25T20:15:00.000Z';
  const past = '2026-10-25T17:00:00.000Z';
  assert.equal(gameStateFor({ liveStatus: 'final', kickoffAt: before, onBye: false, points: 0, now }), 'final');
  assert.equal(gameStateFor({ liveStatus: 'in_progress', kickoffAt: before, onBye: false, points: 0, now }), 'in_progress');
  assert.equal(gameStateFor({ liveStatus: 'scheduled', kickoffAt: past, onBye: false, points: 0, now }), 'scheduled');
  assert.equal(gameStateFor({ liveStatus: null, kickoffAt: before, onBye: false, points: 0, now }), 'scheduled');
  assert.equal(gameStateFor({ liveStatus: null, kickoffAt: past, onBye: false, points: 0, now }), 'in_progress');
  assert.equal(gameStateFor({ liveStatus: null, kickoffAt: null, onBye: false, points: 0, now }), 'scheduled');
  // Points on the board with a stale 'scheduled' row: the game began.
  assert.equal(gameStateFor({ liveStatus: 'scheduled', kickoffAt: before, onBye: false, points: 4.2, now }), 'in_progress');
  // A bye has no game to wait for.
  assert.equal(gameStateFor({ liveStatus: null, kickoffAt: null, onBye: true, points: 0, now }), 'final');
  // No live row and kickoff long past: the game is over, whatever the
  // points say. Five hours is the bound; four hours fifty-nine is still on.
  const longAgo = '2026-10-25T12:59:00.000Z';
  const justUnder = '2026-10-25T13:00:01.000Z';
  assert.equal(gameStateFor({ liveStatus: null, kickoffAt: longAgo, onBye: false, points: 0, now }), 'final');
  assert.equal(gameStateFor({ liveStatus: null, kickoffAt: longAgo, onBye: false, points: 17.2, now }), 'final');
  assert.equal(gameStateFor({ liveStatus: null, kickoffAt: justUnder, onBye: false, points: 0, now }), 'in_progress');
  // A live row saying in progress outranks the schedule's clock.
  assert.equal(gameStateFor({ liveStatus: 'in_progress', kickoffAt: longAgo, onBye: false, points: 0, now }), 'in_progress');
});

// ---------------------------------------------------------------------------
// expectedFinalsForWeek against the fake pool
// ---------------------------------------------------------------------------

const SEASON = 2026;
const WEEK = 8;
const NOW = '2026-10-25T18:30:00.000Z'; // Sunday, after the 17:00Z kickoffs
const LEAGUE = { id: 5, scoring_preset: 'half_ppr', best_ball: false };

// Team 10: QB (Chiefs, final, 22.5 actual), RB (Bills, in progress, 4.0 so
// far, proj 14.0), WR (Eagles, not kicked off, proj 11.3).
// Team 20: RB on bye (proj 9.0 counts 0, final), K ruled Out (proj 8.0
// counts 0, game in progress with no points).
const STARTERS = [
  { team_id: 10, player_id: 1, position: 'QB', nfl_team: 'KC', injury_status: null, stats: { passingYards: 562.5 } }, // 22.5
  { team_id: 10, player_id: 2, position: 'RB', nfl_team: 'BUF', injury_status: 'Q', stats: { rushingYards: 40 } }, // 4.0
  { team_id: 10, player_id: 3, position: 'WR', nfl_team: 'Philadelphia Eagles', injury_status: null, stats: null },
  { team_id: 20, player_id: 4, position: 'RB', nfl_team: 'Ghosts', injury_status: null, stats: null }, // no game this week
  { team_id: 20, player_id: 5, position: 'K', nfl_team: 'DAL', injury_status: 'O', stats: null },
];
const PROJECTIONS = new Map([
  [1, { points: 19.0 }],
  [2, { points: 14.0 }],
  [3, { points: 11.3 }],
  [4, { points: 9.0 }],
  [5, { points: 8.0 }],
]);
const LIVE = [
  { home_team: 'KC', away_team: 'LV', game_status: 'final' },
  { home_team: 'BUF', away_team: 'MIA', game_status: 'in_progress' },
  { home_team: 'DAL', away_team: 'NYG', game_status: 'in_progress' },
  // Eagles: no live row yet; the schedule's 20:25Z kickoff decides.
];
const SCHEDULE = [
  { nfl_team: 'KC', kickoff_at: '2026-10-25T17:00:00.000Z' },
  { nfl_team: 'BUF', kickoff_at: '2026-10-25T17:00:00.000Z' },
  { nfl_team: 'DAL', kickoff_at: '2026-10-25T17:00:00.000Z' },
  { nfl_team: 'PHI', kickoff_at: '2026-10-25T20:25:00.000Z' },
];
// computeByeWeeks reads the whole regular season and answers in the
// caller's own team vocabulary. Every team plays every week except the
// Ghosts, who sit out WEEK: a bye must come from a real one-week gap.
const BYE_ROWS = [];
for (let w = 1; w <= 18; w++) {
  for (const team of ['KC', 'BUF', 'DAL', 'Philadelphia Eagles']) BYE_ROWS.push({ nfl_team: team, week: w });
  if (w !== WEEK) BYE_ROWS.push({ nfl_team: 'Ghosts', week: w });
}

/**
 * `starters` may be an array or a (text, params) => rows function so one
 * fake can answer differently per queried week.
 */
function weekPool(t, { starters = STARTERS, live = LIVE, schedule = SCHEDULE, projections = PROJECTIONS } = {}) {
  t.mock.method(projectionService, 'getWeeklyProjections', async () => {
    if (projections instanceof Error) throw projections;
    return { modelVersion: 'test', projections };
  });
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  return createFakePool([
    // The fake answers the read's slot predicate the way the table would: a
    // statement that still excludes BENCH rows gets none. This is what binds
    // the #883 WHERE clause change (`!= 'IR'` for every league): restoring the
    // old NOT IN ('BENCH', 'IR') predicate turns the bench cases red.
    [/FROM "lineup_entries"/, (text, params) => {
      const rows = typeof starters === 'function' ? starters(text, params) : starters;
      const excludesBench = /NOT IN \('BENCH'/.test(text);
      return { rows: excludesBench ? rows.filter((r) => r.slot !== 'BENCH') : rows };
    }],
    [/FROM "nfl_games" "ng"/, () => ({ rows: BYE_ROWS })],
    [/FROM "live_game_states"/, () => ({ rows: live })],
    [/FROM "nfl_games" WHERE/, () => ({ rows: schedule })],
  ]);
}

test('a team is the sum of its starters across all three phases, with players remaining counted', async (t) => {
  const fake = weekPool(t);
  const byTeam = await expectedFinalsForWeek({
    league: LEAGUE, season: SEASON, week: WEEK, teamIds: [10, 20], db: fake, now: NOW,
  });
  const home = byTeam.get(10);
  // 22.5 (final) + 14.0 (4.0 so far, 10.0 still expected) + 11.3 (not started) = 47.8
  assert.equal(home.expectedFinal, 47.8);
  assert.equal(home.playersRemaining, 2);
  assert.deepEqual(home.starters.map((s) => [s.playerId, s.gameState, s.expectedFinal]), [
    [1, 'final', 22.5],
    [2, 'in_progress', 14],
    [3, 'scheduled', 11.3],
  ]);
  const away = byTeam.get(20);
  // Bye counts 0 and is final; Out counts 0 in progress, nothing to add.
  assert.equal(away.expectedFinal, 0);
  assert.equal(away.playersRemaining, 1);
  assert.deepEqual(away.starters.map((s) => [s.playerId, s.gameState, s.projection]), [
    [4, 'final', 0],
    [5, 'in_progress', 0],
  ]);
});

// #883: bench rows are priced by the same rule as starters and ride on the
// team's entry, but never enter the Expected final or Players remaining.
// Red-tell: adding a bench row's figure into the sum turns the sum case red
// and no other.
test('bench rows are priced alongside the starters, with the availability rule, and never summed', async (t) => {
  const bench = [
    // An available bench RB, in progress at 3.0 with a 10.0 projection.
    { team_id: 10, player_id: 6, slot: 'BENCH', position: 'RB', nfl_team: 'BUF', injury_status: null, stats: { rushingYards: 30 } },
    // A bench WR ruled Out: priced zero, and the row says why.
    { team_id: 10, player_id: 7, slot: 'BENCH', position: 'WR', nfl_team: 'DAL', injury_status: 'O', stats: null },
  ];
  const projections = new Map([...PROJECTIONS, [6, { points: 10.0 }], [7, { points: 12.0 }]]);
  const fake = weekPool(t, { starters: [...STARTERS, ...bench], projections });
  const byTeam = await expectedFinalsForWeek({
    league: LEAGUE, season: SEASON, week: WEEK, teamIds: [10, 20], db: fake, now: NOW,
  });
  const home = byTeam.get(10);
  // The sum and the count are the starters' alone: 47.8 and 2, as above.
  assert.equal(home.expectedFinal, 47.8);
  assert.equal(home.playersRemaining, 2);
  assert.deepEqual(home.starters.map((s) => s.playerId), [1, 2, 3]);
  assert.deepEqual(home.bench.map((b) => [b.playerId, b.projection, b.gameState, b.expectedFinal, b.availability]), [
    [6, 10, 'in_progress', 10, { available: true, reason: null }],
    [7, 0, 'in_progress', 0, { available: false, reason: 'out' }],
  ]);
  // Starters carry the same verdict shape; the Out kicker on team 20 says so,
  // and the Questionable RB on team 10 carries no reason at all (Q and D are
  // available). Red-tell: carrying the rule's raw reason turns this red.
  assert.deepEqual(byTeam.get(20).starters.map((s) => [s.playerId, s.availability.reason]), [[4, 'bye'], [5, 'out']]);
  assert.deepEqual(home.starters.find((s) => s.playerId === 2).availability, { available: true, reason: null });
  assert.deepEqual(byTeam.get(20).bench, []);
  // One projection read covers starters and bench together.
  const [call] = projectionService.getWeeklyProjections.mock.calls;
  assert.deepEqual([...call.arguments[0].playerIds].sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test('the projection run is asked once for the union of every starter under the league', async (t) => {
  const fake = weekPool(t);
  await expectedFinalsForWeek({ league: LEAGUE, season: SEASON, week: WEEK, teamIds: [10, 20], db: fake, now: NOW });
  const calls = projectionService.getWeeklyProjections.mock.calls;
  assert.equal(calls.length, 1);
  const args = calls[0].arguments[0];
  assert.equal(args.league, LEAGUE);
  assert.equal(args.season, SEASON);
  assert.equal(args.week, WEEK);
  assert.deepEqual([...args.playerIds].sort(), [1, 2, 3, 4, 5]);
});

test('a team with no lineup rows is absent; a team with only bench rows is present with null figures and a priced bench', async (t) => {
  // No rows of any slot: absent, as before.
  let fake = weekPool(t, { starters: STARTERS.filter((s) => s.team_id === 10) });
  let byTeam = await expectedFinalsForWeek({ league: LEAGUE, season: SEASON, week: WEEK, teamIds: [10, 20], db: fake, now: NOW });
  assert.ok(byTeam.has(10));
  assert.equal(byTeam.has(20), false);

  // Only bench rows (#883): present, so the route can read the priced bench,
  // but the figures stay null (a bench is never summed, and null is not a
  // forecast of zero) and the status cascade reads it as no starters.
  const benchOnly = [
    ...STARTERS.filter((s) => s.team_id === 10),
    { team_id: 30, player_id: 8, slot: 'BENCH', position: 'RB', nfl_team: 'BUF', injury_status: null, stats: null },
  ];
  fake = weekPool(t, { starters: benchOnly, projections: new Map([...PROJECTIONS, [8, { points: 5 }]]) });
  byTeam = await expectedFinalsForWeek({ league: LEAGUE, season: SEASON, week: WEEK, teamIds: [10, 30], db: fake, now: NOW });
  const team = byTeam.get(30);
  assert.ok(team, 'a bench-only team gets an entry');
  assert.equal(team.expectedFinal, null);
  assert.equal(team.playersRemaining, null);
  assert.deepEqual(team.starters, []);
  assert.deepEqual(team.bench.map((b) => [b.playerId, b.projection]), [[8, 5]]);
  assert.equal(statusForMatchup({ settled: false, home: byTeam.get(10), away: team, computed: true, unreliable: false }), 'live');
});

// Best-ball rows are materialized on BENCH (lineup.service never seeds a
// starting slot in best ball and refuses moves outside BENCH/IR), so these
// fixtures carry that shape. Red-tell (#883): dropping the best-ball keep in the
// producer's BENCH branch (`if (!league.best_ball) continue;` -> `continue;`)
// turns this case red (expectedFinal null, starters []) and the 'status in best
// ball' case red (status scheduled); F2 is an absence case and stays green.
test('best ball optimizes per-player expected finals rather than raw projections', async (t) => {
  const candidates = [
    { team_id: 10, player_id: 6, slot: 'BENCH', position: 'QB', nfl_team: 'BUF', injury_status: null, stats: { passingYards: 750 } },
    { team_id: 10, player_id: 7, slot: 'BENCH', position: 'QB', nfl_team: 'Philadelphia Eagles', injury_status: null, stats: null },
  ];
  const projections = new Map([[6, { points: 10 }], [7, { points: 20 }]]);
  const league = {
    ...LEAGUE,
    best_ball: true,
    roster_slots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }],
  };
  const fake = weekPool(t, { starters: candidates, projections });

  const byTeam = await expectedFinalsForWeek({ league, season: SEASON, week: WEEK, teamIds: [10], db: fake, now: NOW });
  const team = byTeam.get(10);

  // Player 6 already has 30 points in progress. Raw projections would choose
  // player 7 (20), while expected finals correctly choose player 6 (30).
  assert.equal(team.expectedFinal, 30);
  assert.equal(team.playersRemaining, 1);
  assert.deepEqual(team.starters.map((starter) => starter.playerId), [6]);
  // Every best-ball row also rides in `bench`, chosen or not, so the detail
  // route reads a priced row for the one the optimizer left out.
  assert.deepEqual(team.bench.map((b) => b.playerId), [6, 7]);
  assert.deepEqual(projectionService.getWeeklyProjections.mock.calls[0].arguments[0].playerIds.sort(), [6, 7]);

  const decorated = await attachExpectedFinals(
    [{ id: 7, season: SEASON, week: WEEK, home_team_id: 10, away_team_id: 20, final: false }],
    { league, db: fake, now: NOW }
  );
  assert.equal(decorated[0].home_expected_final, 30);
  assert.equal(decorated[0].home_players_remaining, 1);
});

test('a projection outage withholds the figures but still classifies the game (no forecast of zero)', async (t) => {
  const fake = weekPool(t, { projections: new Error('run store down') });
  const byTeam = await expectedFinalsForWeek({ league: LEAGUE, season: SEASON, week: WEEK, teamIds: [10, 20], db: fake, now: NOW });
  // The pass still runs: teams with starters are present, but every figure is
  // null (a dash), never a points-only forecast of zero.
  const home = byTeam.get(10);
  assert.equal(home.expectedFinal, null);
  assert.equal(home.playersRemaining, null);
  for (const s of home.starters) assert.equal(s.projection, null, 'no per-player projection either');
  // The per-starter game state is real regardless of the projection outage,
  // so the Matchup status stays truthful (ADR 0030): this team has a game in
  // progress, so the matchup is live, not scheduled.
  assert.deepEqual(home.starters.map((s) => s.gameState), ['final', 'in_progress', 'scheduled']);
  assert.equal(statusForMatchup({ settled: false, home, away: byTeam.get(20) }), 'live');
});

test('on a projection outage the list row is null on figures but carries the true status', async (t) => {
  const fake = weekPool(t, { projections: new Error('run store down') });
  const out = await attachExpectedFinals(
    [{ id: 7, season: SEASON, week: WEEK, home_team_id: 10, away_team_id: 20, final: false }],
    { league: LEAGUE, db: fake, now: NOW }
  );
  assert.equal(out[0].home_expected_final, null);
  assert.equal(out[0].home_players_remaining, null);
  assert.equal(out[0].status, 'live');
});

test('attachExpectedFinals decorates open rows and leaves final rows and untouched weeks null', async (t) => {
  // Week 9 is open but nobody has a lineup yet.
  const fake = weekPool(t, { starters: (text, params) => (Number(params[2]) === WEEK ? STARTERS : []) });
  const rows = [
    { id: 7, season: SEASON, week: WEEK, home_team_id: 10, away_team_id: 20, final: false },
    { id: 6, season: SEASON, week: WEEK - 1, home_team_id: 10, away_team_id: 20, final: true },
    { id: 8, season: SEASON, week: WEEK + 1, home_team_id: 20, away_team_id: 10, final: false },
  ];
  const out = await attachExpectedFinals(rows, { league: LEAGUE, db: fake, now: NOW });
  const open = out.find((m) => m.id === 7);
  assert.equal(open.home_expected_final, 47.8);
  assert.equal(open.away_expected_final, 0);
  assert.equal(open.home_players_remaining, 2);
  assert.equal(open.away_players_remaining, 1);
  for (const id of [6, 8]) {
    const m = out.find((r) => r.id === id);
    assert.equal(m.home_expected_final, null);
    assert.equal(m.away_expected_final, null);
    assert.equal(m.home_players_remaining, null);
    assert.equal(m.away_players_remaining, null);
  }
  // One projection read: the open week with lineups. Week 9 had no starters.
  assert.equal(projectionService.getWeeklyProjections.mock.calls.length, 1);
  // The input rows are not mutated.
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'home_expected_final'), false);
});

// ---------------------------------------------------------------------------
// Matchup status
// ---------------------------------------------------------------------------

test('status is a pure cascade over the per-starter game states plus the settled flag', () => {
  const team = (...states) => ({ starters: states.map((gameState) => ({ gameState })) });
  assert.equal(statusForMatchup({ settled: true, home: team('in_progress'), away: null }), 'final');
  assert.equal(statusForMatchup({ settled: false, home: team('in_progress'), away: team('scheduled') }), 'live');
  assert.equal(statusForMatchup({ settled: false, home: team('final'), away: team('final') }), 'played');
  assert.equal(statusForMatchup({ settled: false, home: team('scheduled'), away: team('scheduled') }), 'scheduled');
  // No lineup rows on either side: scheduled (both team results absent).
  assert.equal(statusForMatchup({ settled: false, home: null, away: null }), 'scheduled');
});

test('status in best ball reads the optimizer\'s chosen lineup, not every candidate', async (t) => {
  // Chosen QB (KC) is final at 30; the benched candidate (BUF) is in progress.
  // Reading the chosen lineup gives played; reading every candidate would give live.
  const candidates = [
    { team_id: 10, player_id: 6, slot: 'BENCH', position: 'QB', nfl_team: 'KC', injury_status: null, stats: { passingYards: 750 } }, // 30, final
    { team_id: 10, player_id: 7, slot: 'BENCH', position: 'QB', nfl_team: 'BUF', injury_status: null, stats: { passingYards: 125 } }, // 5, in progress
  ];
  const projections = new Map([[6, { points: 10 }], [7, { points: 20 }]]);
  const league = { ...LEAGUE, best_ball: true, roster_slots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }] };
  const fake = weekPool(t, { starters: candidates, projections });
  const out = await attachExpectedFinals(
    [{ id: 7, season: SEASON, week: WEEK, home_team_id: 10, away_team_id: 20, final: false }],
    { league, db: fake, now: NOW }
  );
  assert.equal(out[0].home_expected_final, 30, 'the chosen QB is the final one at 30');
  assert.equal(out[0].status, 'played');
});

test('a matchup with no lineup rows on either side is scheduled', async (t) => {
  const fake = weekPool(t, { starters: [] });
  const out = await attachExpectedFinals(
    [{ id: 7, season: SEASON, week: WEEK, home_team_id: 10, away_team_id: 20, final: false }],
    { league: LEAGUE, db: fake, now: NOW }
  );
  assert.equal(out[0].home_expected_final, null);
  assert.equal(out[0].status, 'scheduled');
});

test('the settled flag wins as final and never reads the database', async () => {
  const fake = createFakePool([]);
  const out = await attachExpectedFinals(
    [{ id: 6, season: SEASON, week: WEEK, home_team_id: 10, away_team_id: 20, final: true }],
    { league: LEAGUE, db: fake, now: NOW }
  );
  assert.equal(out[0].status, 'final');
  assert.equal(fake.calls.length, 0);
});

test('the five-hour no-live-row bound yields played when every starter is past it', async (t) => {
  const starters = [
    { team_id: 10, player_id: 1, position: 'QB', nfl_team: 'KC', injury_status: null, stats: null },
    { team_id: 10, player_id: 2, position: 'RB', nfl_team: 'BUF', injury_status: null, stats: null },
  ];
  const projections = new Map([[1, { points: 15 }], [2, { points: 12 }]]);
  // No live rows at all; both games kicked off eight hours before now, well
  // past the five-hour bound, so every starter is final and the matchup played.
  const schedule = [
    { nfl_team: 'KC', kickoff_at: '2026-10-25T10:30:00.000Z' },
    { nfl_team: 'BUF', kickoff_at: '2026-10-25T10:30:00.000Z' },
  ];
  const fake = weekPool(t, { starters, live: [], schedule, projections });
  const out = await attachExpectedFinals(
    [{ id: 7, season: SEASON, week: WEEK, home_team_id: 10, away_team_id: 20, final: false }],
    { league: LEAGUE, db: fake, now: NOW }
  );
  assert.equal(out[0].status, 'played');
});

test('a failed read states no status, never a false scheduled (F1)', async (t) => {
  t.mock.method(projectionService, 'getWeeklyProjections', async () => ({ modelVersion: 'test', projections: PROJECTIONS }));
  t.mock.method(projectionService, 'toLegacyProjectionMap', (run) => run.projections);
  // The live-game read fails - the query most likely to fail transiently and
  // the one on the live path. The game classification cannot be produced, so
  // the status is unknown; it must not be asserted as scheduled beside a live
  // score (ADR 0030).
  const fake = createFakePool([
    [/FROM "lineup_entries"/, () => ({ rows: STARTERS })],
    [/FROM "nfl_games" "ng"/, () => ({ rows: BYE_ROWS })],
    [/FROM "live_game_states"/, () => { throw new Error('live table unavailable'); }],
    [/FROM "nfl_games" WHERE/, () => ({ rows: SCHEDULE })],
  ]);
  const out = await attachExpectedFinals(
    [{ id: 7, season: SEASON, week: WEEK, home_team_id: 10, away_team_id: 20, final: false }],
    { league: LEAGUE, db: fake, now: NOW }
  );
  assert.equal(out[0].status, null, 'a read failure is not a scheduled matchup');
  assert.equal(out[0].home_expected_final, null);
  assert.equal(out[0].home_players_remaining, null);
});

test('best ball without a projection run states no status, never a false played (F2)', async (t) => {
  // Chosen lineup needs expected finals to be ordered; without a projection run
  // there is no chosen lineup, so points-only ordering would pick the finished
  // player over the in-progress one and the matchup would read played mid-slate.
  const candidates = [
    { team_id: 10, player_id: 6, slot: 'BENCH', position: 'QB', nfl_team: 'KC', injury_status: null, stats: { passingYards: 750 } }, // final, 30 pts
    { team_id: 10, player_id: 7, slot: 'BENCH', position: 'QB', nfl_team: 'BUF', injury_status: null, stats: null }, // in progress, 0 pts
  ];
  const league = { ...LEAGUE, best_ball: true, roster_slots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }] };
  const fake = weekPool(t, { starters: candidates, projections: new Error('run store down') });
  const out = await attachExpectedFinals(
    [{ id: 7, season: SEASON, week: WEEK, home_team_id: 10, away_team_id: 20, final: false }],
    { league, db: fake, now: NOW }
  );
  assert.equal(out[0].status, null, 'no projection run means no chosen lineup, so status is unknown');
  assert.equal(out[0].home_expected_final, null);
});

test('a final-only list never touches the database', async () => {
  const fake = createFakePool([]);
  const out = await attachExpectedFinals(
    [{ id: 6, season: SEASON, week: WEEK, home_team_id: 10, away_team_id: 20, final: true }],
    { league: LEAGUE, db: fake, now: NOW }
  );
  assert.equal(out[0].home_expected_final, null);
  assert.equal(fake.calls.length, 0);
});
