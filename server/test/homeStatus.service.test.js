const { test } = require('node:test');
const assert = require('node:assert/strict');
const homeStatus = require('../services/homeStatus.service');
const expectedFinalService = require('../services/expectedFinal.service');
const { createFakePool } = require('./helpers/fakePool');

/**
 * homeStatus.service: the statuses the reminders, the Home to-do list and the
 * league status cards share. Pure over rows, so every case here is a fixture
 * in and an answer out; the routes that batch the reads have their own
 * supertest suites.
 */

const slots = (spec) => Object.entries(spec).map(([key, count]) => ({ key, count }));
const entry = (slot, name, extra = {}) => ({ slot, name, onBye: false, injury_status: null, ...extra });

// --- the lineup problems, read through lineupStatus (nothing locked) --------

// A week with no schedule and no clock pressure: nothing has kicked off, so
// the status' problems are the whole lineup's.
const unlockedProblems = (args) => homeStatus.lineupStatus({
  kickoffByTeam: new Map(),
  weekLastKickoff: null,
  now: new Date('2026-10-04T12:00:00.000Z'),
  ...args,
}).problems;

test('lineupStatus checks a standard league in full against its roster slots', () => {
  const problems = unlockedProblems({
    entries: [entry('QB', 'Quarterback', { onBye: true })],
    rosterSlots: slots({ QB: 1, RB: 1 }),
    bestBall: false,
  });
  assert.deepEqual(problems, ['1 empty RB slot', 'Quarterback (QB) is on bye']);
});

test('lineupStatus gives a best-ball league only its unresolved IR stashes', () => {
  const problems = unlockedProblems({
    entries: [
      entry('QB', 'Benched By Optimizer', { injury_status: 'O' }),
      entry('IR', 'Healthy Stash', { injury_status: 'Q', ir_attested: false }),
    ],
    rosterSlots: slots({ QB: 1, RB: 2 }),
    bestBall: true,
  });
  assert.deepEqual(problems, ['Healthy Stash (IR) is no longer IR-eligible (questionable)']);
});

test('lineupStatus flags bye and Out/IR starters, ignores the bench, and lets a questionable starter be', () => {
  const problems = unlockedProblems({
    entries: [
      entry('QB', 'Healthy QB'),
      entry('RB', 'Bye RB', { onBye: true }),
      entry('WR', 'Hurt WR', { injury_status: 'O' }),
      entry('TE', 'Q Guy', { injury_status: 'Q' }),
      entry('BENCH', 'Hurt Bench Guy', { injury_status: 'IR' }),
    ],
    rosterSlots: slots({ QB: 1, RB: 1, WR: 1, TE: 1 }),
    bestBall: false,
  });
  assert.deepEqual(problems, ['Bye RB (RB) is on bye', 'Hurt WR (WR) is Out']);
});

test('lineupStatus resurfaces an unresolved ineligible IR stash but never a commissioner-attested one (#100)', () => {
  const stash = (extra) => unlockedProblems({
    entries: [entry('QB', 'Healthy QB'), entry('IR', 'Test Runner', { injury_status: 'Q', ...extra })],
    rosterSlots: slots({ QB: 1 }),
    bestBall: false,
  });
  assert.deepEqual(stash({}), ['Test Runner (IR) is no longer IR-eligible (questionable)']);
  assert.deepEqual(stash({ ir_attested: true }), []);
});

test('lineupEntryFromRow reads the lineup query row into the builder shape', () => {
  assert.deepEqual(
    homeStatus.lineupEntryFromRow({ slot: 'RB', name: 'Runner', on_bye: true, injury_status: 'Q', ir_attested: false, extra: 1 }),
    { slot: 'RB', name: 'Runner', onBye: true, injury_status: 'Q', ir_attested: false }
  );
});

test('pickemStatus drops games at or past kickoff and the ones already picked (picksMadeByUser rows)', () => {
  const now = new Date('2026-10-04T17:00:00.000Z');
  const slate = [
    { gameKey: 'BUF|MIA', kickoffAt: '2026-10-04T16:59:00.000Z' },
    { gameKey: 'DAL|NYG', kickoffAt: '2026-10-04T17:00:00.000Z' }, // locks inclusively
    { gameKey: 'KC|LV', kickoffAt: '2026-10-04T20:25:00.000Z' },
    { gameKey: 'GB|MIN', kickoffAt: '2026-10-05T00:20:00.000Z' },
  ];
  const made = homeStatus.picksMadeByUser([
    { user_id: 7, team_pair: 'KC|LV' },
    { user_id: 7, team_pair: 'BUF|MIA' },
    { user_id: 8, team_pair: 'GB|MIN' },
  ]);
  assert.equal(homeStatus.pickemStatus({ slate, made: made.get(7), now }).missing, 1); // GB|MIN
  assert.equal(homeStatus.pickemStatus({ slate, made: made.get(9), now }).missing, 2); // KC|LV, GB|MIN
});

// --- lineupStatus: the lineup card and the lineup_problem to-do row ---------

// Sunday 1pm ET window: KC and BUF kick off at 17:00Z, DAL at 20:25Z, the
// week's last game (GB) at 00:20Z Monday.
const KICKOFFS = new Map([
  ['KC', '2026-10-04T17:00:00.000Z'],
  ['BUF', '2026-10-04T17:00:00.000Z'],
  ['DAL', '2026-10-04T20:25:00.000Z'],
  ['GB', '2026-10-05T00:20:00.000Z'],
]);
const LAST_KICKOFF = '2026-10-05T00:20:00.000Z';
const at = (iso) => new Date(iso);

test('lineupStatus names each empty seat, its problems, and the next lock among the roster', () => {
  const status = homeStatus.lineupStatus({
    entries: [
      entry('QB', 'Quarterback', { nflTeam: 'KC' }),
      entry('RB', 'Runner', { nflTeam: 'DAL' }),
      entry('BENCH', 'Bench Back', { nflTeam: 'GB' }),
    ],
    rosterSlots: slots({ QB: 1, RB: 1, FLEX: 1 }),
    bestBall: false,
    kickoffByTeam: KICKOFFS,
    weekLastKickoff: LAST_KICKOFF,
    now: at('2026-10-04T12:00:00.000Z'),
  });
  assert.deepEqual(status, {
    emptySlots: ['FLEX'],
    problems: ['1 empty FLEX slot'],
    nextLockAt: '2026-10-04T17:00:00.000Z',
  });
});

test('lineupStatus: a starter whose game has kicked off is locked, so his status is no longer a to-do', () => {
  const status = homeStatus.lineupStatus({
    entries: [
      entry('QB', 'Locked Out Quarterback', { nflTeam: 'KC', injury_status: 'O' }),
      entry('RB', 'Late Out Runner', { nflTeam: 'DAL', injury_status: 'O' }),
    ],
    rosterSlots: slots({ QB: 1, RB: 1 }),
    bestBall: false,
    kickoffByTeam: KICKOFFS,
    weekLastKickoff: LAST_KICKOFF,
    now: at('2026-10-04T18:00:00.000Z'),
  });
  // The locked QB still fills his seat; only the unlocked RB is actionable,
  // and the next lock is the RB's own 20:25 kickoff.
  assert.deepEqual(status.emptySlots, []);
  assert.deepEqual(status.problems, ['Late Out Runner (RB) is Out']);
  assert.equal(status.nextLockAt, '2026-10-04T20:25:00.000Z');
});

test('lineupStatus falls back to the week\'s last kickoff once every roster team has kicked off', () => {
  const status = homeStatus.lineupStatus({
    entries: [entry('QB', 'Quarterback', { nflTeam: 'KC' })],
    rosterSlots: slots({ QB: 1, FLEX: 1 }),
    bestBall: false,
    kickoffByTeam: KICKOFFS,
    weekLastKickoff: LAST_KICKOFF,
    now: at('2026-10-04T21:00:00.000Z'),
  });
  // A free agent in the Monday game could still fill the FLEX.
  assert.deepEqual(status.problems, ['1 empty FLEX slot']);
  assert.equal(status.nextLockAt, LAST_KICKOFF);
});

test('lineupStatus: after the week\'s last kickoff nothing is actionable', () => {
  const status = homeStatus.lineupStatus({
    entries: [entry('QB', 'Quarterback', { nflTeam: 'KC' })],
    rosterSlots: slots({ QB: 1, FLEX: 1 }),
    bestBall: false,
    kickoffByTeam: KICKOFFS,
    weekLastKickoff: LAST_KICKOFF,
    now: at('2026-10-05T01:00:00.000Z'),
  });
  assert.deepEqual(status, { emptySlots: [], problems: [], nextLockAt: null });
});

test('lineupStatus: best ball carries no emptySlots and only its IR problems, like the digest', () => {
  const status = homeStatus.lineupStatus({
    entries: [
      entry('QB', 'Out Quarterback', { nflTeam: 'DAL', injury_status: 'O' }),
      entry('IR', 'Healthy Stash', { nflTeam: 'GB', injury_status: null, ir_attested: false }),
    ],
    rosterSlots: slots({ QB: 1, RB: 2 }),
    bestBall: true,
    kickoffByTeam: KICKOFFS,
    weekLastKickoff: LAST_KICKOFF,
    now: at('2026-10-04T12:00:00.000Z'),
  });
  assert.equal('emptySlots' in status, false);
  assert.equal(status.problems.length, 1);
  assert.match(status.problems[0], /Healthy Stash \(IR\) is no longer IR-eligible/);
  assert.equal(status.nextLockAt, '2026-10-04T20:25:00.000Z');
});

test('lineupStatus: two missing seats of one slot are two emptySlots entries; bye starters are flagged', () => {
  const status = homeStatus.lineupStatus({
    entries: [entry('QB', 'Bye Quarterback', { nflTeam: 'NYJ', onBye: true })],
    rosterSlots: slots({ QB: 1, RB: 2 }),
    bestBall: false,
    kickoffByTeam: KICKOFFS,
    weekLastKickoff: LAST_KICKOFF,
    now: at('2026-10-04T12:00:00.000Z'),
  });
  assert.deepEqual(status.emptySlots, ['RB', 'RB']);
  assert.deepEqual(status.problems, ['2 empty RB slots', 'Bye Quarterback (QB) is on bye']);
  // A bye team has no kickoff; the week's last kickoff is the lock.
  assert.equal(status.nextLockAt, LAST_KICKOFF);
});

// --- pickemStatus: the Pick'em card and the picks_open to-do row -----------

const SLATE = [
  { gameKey: 'BUF|MIA', kickoffAt: '2026-10-04T17:00:00.000Z' },
  { gameKey: 'DAL|NYG', kickoffAt: '2026-10-04T20:25:00.000Z' },
  { gameKey: 'KC|LV', kickoffAt: '2026-10-04T20:25:00.000Z' },
  { gameKey: 'GB|MIN', kickoffAt: '2026-10-05T00:20:00.000Z' },
];

test('pickemStatus counts picks made in this slate and locks on the earliest unpicked open game', () => {
  const status = homeStatus.pickemStatus({
    slate: SLATE,
    made: new Set(['BUF|MIA', 'KC|LV', 'SEA|SF']), // SEA|SF is not in this slate
    now: at('2026-10-04T18:00:00.000Z'),
  });
  // BUF|MIA has locked; of the open three, DAL|NYG and GB|MIN are unpicked.
  assert.deepEqual(status, { made: 2, total: 4, missing: 2, nextLockAt: '2026-10-04T20:25:00.000Z' });
});

test('pickemStatus: fully picked (or all locked) has nothing missing and no lock', () => {
  const done = homeStatus.pickemStatus({
    slate: SLATE,
    made: new Set(SLATE.map((g) => g.gameKey)),
    now: at('2026-10-04T12:00:00.000Z'),
  });
  assert.deepEqual(done, { made: 4, total: 4, missing: 0, nextLockAt: null });
  const over = homeStatus.pickemStatus({ slate: SLATE, made: new Set(), now: at('2026-10-06T00:00:00.000Z') });
  assert.deepEqual(over, { made: 0, total: 4, missing: 0, nextLockAt: null });
});

// --- leagueStatuses / actionItems over a fake pool -------------------------
//
// The matchup summary and the action-item ordering are internal now; these
// two cases (dropped with their direct unit tests) are reached through the
// exported reads, over the same query shapes the route suites use.

const HOME_NOW = new Date('2026-10-04T16:00:00.000Z');
const HOME_LEAGUE = {
  id: 71, name: 'Winsconsota', pickem_only: false, best_ball: false,
  draft_status: 'complete', season_status: 'regular',
  current_season: 2026, current_week: 4,
  roster_slots: [{ key: 'QB', count: 1 }, { key: 'FLEX', count: 1 }],
  max_teams: 12, draft_date: null, draft_timezone: null, join_approval: false,
  my_team_id: 11, my_team_name: 'Cheese Curds', team_count: 2,
  is_owner: false, is_commissioner: false,
};

function homeWorld(t, { matchups = [], kickoffs = [], trades = [] } = {}) {
  t.mock.method(expectedFinalService, 'expectedFinalsForWeek', async () => new Map([
    [11, { expectedFinal: 118.6, playersRemaining: 4, statusReliable: true, firstKickoffAt: '2026-10-04T17:00:00.000Z', syncedAt: null, starters: [{ gameState: 'in_progress', availability: { available: true, reason: null } }], bench: [] }],
    [12, { expectedFinal: 104.1, playersRemaining: 3, statusReliable: true, firstKickoffAt: '2026-10-04T17:00:00.000Z', syncedAt: null, starters: [{ gameState: 'in_progress', availability: { available: true, reason: null } }], bench: [] }],
  ]));
  return createFakePool([
    [/AS "is_commissioner" FROM "leagues"/, () => ({ rows: [{ ...HOME_LEAGUE }] })],
    [/^SELECT "teams"\."id", "teams"\."league_id", "teams"\."name" FROM "teams"/, () => ({ rows: [
      { id: 11, league_id: 71, name: 'Cheese Curds' },
      { id: 12, league_id: 71, name: 'Frozen Tundra FC' },
    ] })],
    [/FROM "matchups"/, () => ({ rows: matchups })],
    // One KC quarterback and no FLEX: a lineup with a problem.
    [/FROM "source"/, () => ({ rows: [
      { team_id: 11, slot: 'QB', name: 'Quarterback', injury_status: null, ir_attested: false, nfl_team: 'KC', on_bye: false },
    ] })],
    [/FROM "nfl_games" JOIN unnest/, () => ({ rows: kickoffs })],
    [/FROM "pickem_settings"/, () => ({ rows: [] })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "trades"/, () => ({ rows: trades })],
    [/FROM "join_requests"/, () => ({ rows: [] })],
    [/FROM "waiver_claims"/, () => ({ rows: [] })],
  ]).install(t);
}

test('leagueStatuses reads the matchup from the home side, and a null score stays null', async (t) => {
  const fake = homeWorld(t, {
    // The caller (team 11) is the HOME team and has no score yet.
    matchups: [{
      id: 921, league_id: 71, season: 2026, week: 4, home_team_id: 11, away_team_id: 12,
      home_score: null, away_score: '71.20', final: false, is_playoff: false,
    }],
  });

  const statuses = await homeStatus.leagueStatuses(fake, { userId: 7, leagues: [HOME_LEAGUE], now: HOME_NOW });

  const { status, statusError } = statuses.get(71);
  assert.equal(statusError, false);
  assert.deepEqual(status.matchup, {
    id: 921,
    status: 'live',
    opponent: { teamId: 12, name: 'Frozen Tundra FC' },
    my: { score: null, expectedFinal: 118.6, playersRemaining: 4 },
    opp: { score: 71.2, expectedFinal: 104.1, playersRemaining: 3 },
    winProbability: null,
  });
});

test('actionItems orders a timed item with no deadline after the dated timed items', async (t) => {
  const fake = homeWorld(t, {
    // No kickoffs for the week: the lineup problem has no lock, so no deadline.
    kickoffs: [],
    trades: [{
      id: 502, league_id: 71, status: 'accepted', review_ends_at: '2026-10-05T12:00:00.000Z',
      created_at: '2026-10-03T12:00:00.000Z',
      proposing_team_name: 'Lake Effect', receiving_team_name: 'Supper Club',
    }],
  });

  const out = await homeStatus.actionItems(fake, { userId: 7, now: HOME_NOW, tz: 'UTC' });

  assert.deepEqual(out.partial, []);
  assert.deepEqual(out.items.map((i) => [i.id, i.severity, i.deadlineAt]), [
    ['trade_review:71:502', 'timed', '2026-10-05T12:00:00.000Z'],
    ['lineup_problem:71:2026-4', 'timed', null],
  ]);
});

test('isValidTimeZone accepts IANA zones and refuses anything else', () => {
  assert.equal(homeStatus.isValidTimeZone('America/Chicago'), true);
  assert.equal(homeStatus.isValidTimeZone('UTC'), true);
  assert.equal(homeStatus.isValidTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(homeStatus.isValidTimeZone(''), false);
  assert.equal(homeStatus.isValidTimeZone(undefined), false);
  assert.equal(homeStatus.isValidTimeZone(['UTC']), false);
});
