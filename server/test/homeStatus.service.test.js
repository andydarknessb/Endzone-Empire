const { test } = require('node:test');
const assert = require('node:assert/strict');
const homeStatus = require('../services/homeStatus.service');
const expectedFinalService = require('../services/expectedFinal.service');
const projectionService = require('../services/projection.service');
const { createFakePool } = require('./helpers/fakePool');

/**
 * homeStatus.service: the statuses the reminders, the Home to-do list and the
 * league status cards share. Pure over rows, so every case here is a fixture
 * in and an answer out; the routes that batch the reads have their own
 * supertest suites.
 */

const slots = (spec) => Object.entries(spec).map(([key, count]) => ({ key, count }));

// ADR 0061: starter availability is the Start verdict the Weekly projection read
// gives by player id, never a fact of the lineup row. A fixture entry names the
// verdict the read would give it (`verdict`, test-only); the stand-in accessor
// answers by player id, as the read's `startVerdictFor` does.
const HEALTHY = { outcome: 'recommendable', reason: null, numberTrusted: true };
const unavailable = (reason) => ({ outcome: 'unavailable', reason, numberTrusted: true });
let nextPlayerId = 1;
const entry = (slot, name, extra = {}) => ({ playerId: nextPlayerId++, slot, name, injury_status: null, ...extra });
const readOf = (entries) => (playerId) => (entries.find((e) => e.playerId === playerId) || {}).verdict || HEALTHY;
const lineupStatus = (args) => homeStatus.lineupStatus({ startVerdictFor: readOf(args.entries), ...args });

// --- the lineup problems, read through lineupStatus (nothing locked) --------

// A week with no schedule and no clock pressure: nothing has kicked off, so
// the status' problems are the whole lineup's.
const unlockedProblems = (args) => lineupStatus({
  kickoffByTeam: new Map(),
  weekLastKickoff: null,
  now: new Date('2026-10-04T12:00:00.000Z'),
  ...args,
}).problems;

test('lineupStatus checks a standard league in full against its roster slots', () => {
  const problems = unlockedProblems({
    entries: [entry('QB', 'Quarterback', { verdict: unavailable('bye') })],
    rosterSlots: slots({ QB: 1, RB: 1 }),
    bestBall: false,
  });
  assert.deepEqual(problems, ['1 empty RB slot', 'Quarterback (QB) is on bye']);
});

// #2391: a seat spent by a spared off-roster row is filled, as spentStartingSlots treats it on a save.
test('lineupStatus counts a spent starting seat as filled and never nags its departed player', () => {
  const entries = [
    entry('QB', 'Quarterback'),
    entry('K', 'Spared Kicker', { spent: true, verdict: unavailable('no_team') }),
  ];
  const problems = unlockedProblems({ entries, rosterSlots: slots({ QB: 1, K: 1 }), bestBall: false });
  assert.deepEqual(problems, []);
  assert.deepEqual(lineupStatus({
    entries, rosterSlots: slots({ QB: 1, K: 1 }), bestBall: false,
    kickoffByTeam: new Map(), weekLastKickoff: null, now: new Date('2026-10-04T12:00:00.000Z'),
  }).emptySlots, []);
});

test('lineupEntryFromRow carries a spent row (no team_players match) as spent', () => {
  assert.equal(homeStatus.lineupEntryFromRow({ player_id: 4, slot: 'K', name: 'Kicker', spent: true }).spent, true);
});

test('lineupStatus gives a best-ball league only its unresolved IR stashes', () => {
  const problems = unlockedProblems({
    entries: [
      entry('QB', 'Benched By Optimizer', { injury_status: 'O', verdict: unavailable('out') }),
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
      entry('RB', 'Bye RB', { verdict: unavailable('bye') }),
      entry('WR', 'Hurt WR', { injury_status: 'O', verdict: unavailable('out') }),
      entry('TE', 'Q Guy', { injury_status: 'Q', verdict: { outcome: 'recommendable', reason: 'questionable', numberTrusted: true } }),
      entry('BENCH', 'Hurt Bench Guy', { injury_status: 'IR', verdict: unavailable('ir') }),
    ],
    rosterSlots: slots({ QB: 1, RB: 1, WR: 1, TE: 1 }),
    bestBall: false,
  });
  assert.deepEqual(problems, ['Bye RB (RB) is on bye', 'Hurt WR (WR) is Out']);
});

// #1791: a Practice squad or a No NFL team starter raises a problem here
// exactly as the Lineup and Start/sit pages mark him Unavailable: the problem
// reads the one Start verdict, so it can never disagree with them. (The
// precedence between the reasons and the 48-hour Practice squad window live in
// the verdict itself: unavailable.test.js.)
test('lineupStatus flags a Practice squad starter and a No NFL team starter (#1791)', () => {
  const problems = unlockedProblems({
    entries: [
      entry('QB', 'Healthy QB'),
      entry('RB', 'PS Runner', { nflTeam: 'GB', verdict: unavailable('practice_squad') }),
      entry('WR', 'Free Agent WR', { nflTeam: null, verdict: unavailable('no_team') }),
    ],
    rosterSlots: slots({ QB: 1, RB: 1, WR: 1 }),
    bestBall: false,
  });
  assert.deepEqual(problems, ['PS Runner (RB) is on the practice squad', 'Free Agent WR (WR) has no NFL team']);
});

test('lineupStatus flags a suspended starter (#2150)', () => {
  const problems = unlockedProblems({
    entries: [entry('RB', 'Banned Runner', { nflTeam: 'GB', verdict: unavailable('suspended') })],
    rosterSlots: slots({ RB: 1 }),
    bestBall: false,
  });
  assert.deepEqual(problems, ['Banned Runner (RB) is suspended']);
});

test('lineupStatus: a locked Practice squad starter sheds his problem too, like a locked bye or injury', () => {
  const status = lineupStatus({
    entries: [entry('QB', 'Locked PS Quarterback', { nflTeam: 'KC', verdict: unavailable('practice_squad') })],
    rosterSlots: slots({ QB: 1 }),
    bestBall: false,
    kickoffByTeam: KICKOFFS,
    weekLastKickoff: LAST_KICKOFF,
    now: at('2026-10-04T18:00:00.000Z'), // after KC's 17:00 kickoff
  });
  assert.deepEqual(status.problems, []);
});

test('lineupStatus: Not recommended is no lineup problem; only Unavailable names a starter', () => {
  const problems = unlockedProblems({
    entries: [
      entry('QB', 'Doubtful QB', { verdict: { outcome: 'not_recommended', reason: 'doubtful', numberTrusted: true } }),
      entry('RB', 'Backup Runner', { verdict: { outcome: 'not_recommended', reason: 'backup', numberTrusted: false } }),
    ],
    rosterSlots: slots({ QB: 1, RB: 1 }),
    bestBall: false,
  });
  assert.deepEqual(problems, []);
});

// ADR 0061: the lineup read carries no availability fact (bye, roster status),
// only the player id the Start verdict is asked by. The verdict reaches the
// league card's lineup line through the Weekly projection read: seed the
// starter Out in the run and the card names him; seed him healthy and it does
// not.
test('leagueStatuses names a starter the Weekly projection read says is Out, and not a healthy one (ADR 0061)', async (t) => {
  const outRun = homeWorld(t, { verdict: unavailable('out') });
  const out = await homeStatus.leagueStatuses(outRun, { userId: 7, leagues: [HOME_LEAGUE], now: HOME_NOW });
  assert.deepEqual(out.get(71).status.lineup.problems, ['1 empty FLEX slot', 'Quarterback (QB) is Out']);
  assert.deepEqual(projectionCalls.at(-1).playerIds, [901], 'the read is asked for the roster alone');
  const [sourceQuery] = outRun.matching(/FROM "source"/);
  assert.ok(sourceQuery, 'loadLineups\' query never ran');
  assert.doesNotMatch(sourceQuery.text, /on_bye|nfl_roster_status/, 'no availability fact rides the lineup read');

  t.mock.restoreAll();
  const healthyRun = homeWorld(t);
  const healthy = await homeStatus.leagueStatuses(healthyRun, { userId: 7, leagues: [HOME_LEAGUE], now: HOME_NOW });
  assert.deepEqual(healthy.get(71).status.lineup.problems, ['1 empty FLEX slot']);
});

// The fake pool never runs the SQL, so the guard is on the query text: a starter
// spared after kickoff (#627, #2391) keeps his seat only through the LEFT JOIN
// and the slot OR; an inner join or a dropped OR would silently empty his seat.
test('loadLineups keeps a lineup row whose roster row is gone unless it sits on BENCH or IR (#2430)', async (t) => {
  const run = homeWorld(t);
  await homeStatus.leagueStatuses(run, { userId: 7, leagues: [HOME_LEAGUE], now: HOME_NOW });
  const [sourceQuery] = run.matching(/FROM "source"/);
  assert.ok(sourceQuery, 'loadLineups\' query never ran');
  assert.match(sourceQuery.text, /LEFT JOIN "team_players"/);
  assert.match(sourceQuery.text, /OR "lineup_entries"\."slot" NOT IN \('BENCH', 'IR'\)/);
});

test('leagueStatuses names a starter on bye in the run', async (t) => {
  const fake = homeWorld(t, { verdict: unavailable('bye') });
  const statuses = await homeStatus.leagueStatuses(fake, { userId: 7, leagues: [HOME_LEAGUE], now: HOME_NOW });
  assert.deepEqual(statuses.get(71).status.lineup.problems, ['1 empty FLEX slot', 'Quarterback (QB) is on bye']);
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
    homeStatus.lineupEntryFromRow({ player_id: 9, slot: 'RB', name: 'Runner', injury_status: 'Q', ir_attested: false, extra: 1 }),
    { playerId: 9, slot: 'RB', name: 'Runner', injury_status: 'Q', ir_attested: false, spent: false }
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
  const status = lineupStatus({
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
  const status = lineupStatus({
    entries: [
      entry('QB', 'Locked Out Quarterback', { nflTeam: 'KC', injury_status: 'O', verdict: unavailable('out') }),
      entry('RB', 'Late Out Runner', { nflTeam: 'DAL', injury_status: 'O', verdict: unavailable('out') }),
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
  const status = lineupStatus({
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
  const status = lineupStatus({
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
  const status = lineupStatus({
    entries: [
      entry('QB', 'Out Quarterback', { nflTeam: 'DAL', injury_status: 'O', verdict: unavailable('out') }),
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
  const status = lineupStatus({
    entries: [entry('QB', 'Bye Quarterback', { nflTeam: 'NYJ', verdict: unavailable('bye') })],
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
  assert.deepEqual(status, {
    made: 2, total: 4, missing: 2, nextLockAt: '2026-10-04T20:25:00.000Z', weekPoints: 0, finals: 0, inProgress: true,
  });
});

test('pickemStatus: fully picked (or all locked) has nothing missing and no lock', () => {
  const done = homeStatus.pickemStatus({
    slate: SLATE,
    made: new Set(SLATE.map((g) => g.gameKey)),
    now: at('2026-10-04T12:00:00.000Z'),
  });
  assert.deepEqual(done, {
    made: 4, total: 4, missing: 0, nextLockAt: null, weekPoints: 0, finals: 0, inProgress: false,
  });
  const over = homeStatus.pickemStatus({ slate: SLATE, made: new Set(), now: at('2026-10-06T00:00:00.000Z') });
  assert.deepEqual(over, {
    made: 0, total: 4, missing: 0, nextLockAt: null, weekPoints: 0, finals: 0, inProgress: false,
  });
});

// A final, an in-progress and a scheduled game; the viewer picked all three.
const SCORED_SLATE = [
  { gameKey: 'BUF|MIA', kickoffAt: '2026-10-04T17:00:00.000Z', status: 'final', homeTeam: 'BUF', awayTeam: 'MIA', homeScore: 24, awayScore: 17 },
  { gameKey: 'DAL|NYG', kickoffAt: '2026-10-04T20:25:00.000Z', status: 'in_progress', homeTeam: 'DAL', awayTeam: 'NYG', homeScore: 7, awayScore: 3 },
  { gameKey: 'GB|MIN', kickoffAt: '2026-10-05T00:20:00.000Z', status: 'scheduled', homeTeam: 'GB', awayTeam: 'MIN', homeScore: null, awayScore: null },
];
const SCORED_PICKS = [
  { userId: 7, gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 3 },
  { userId: 7, gameKey: 'DAL|NYG', pickedTeam: 'DAL', confidence: 2 },
  { userId: 7, gameKey: 'GB|MIN', pickedTeam: 'GB', confidence: 1 },
];

test('pickemStatus scores only final games: confidence pays the pick, straight pays 1', () => {
  const now = at('2026-10-04T21:00:00.000Z');
  const confidence = homeStatus.pickemStatus({ slate: SCORED_SLATE, picks: SCORED_PICKS, mode: 'confidence', now });
  assert.equal(confidence.weekPoints, 3);
  assert.equal(confidence.finals, 1);
  assert.equal(confidence.total, 3);
  const straight = homeStatus.pickemStatus({ slate: SCORED_SLATE, picks: SCORED_PICKS, mode: 'straight', now });
  assert.equal(straight.weekPoints, 1);
});

test('pickemStatus.inProgress: a game kicked off and not final; false when all final or none kicked off', () => {
  const run = (slate, iso) => homeStatus.pickemStatus({ slate, now: at(iso) }).inProgress;
  assert.equal(run(SCORED_SLATE, '2026-10-04T21:00:00.000Z'), true);
  assert.equal(run(SCORED_SLATE, '2026-10-04T12:00:00.000Z'), false);
  assert.equal(run(SCORED_SLATE.map((g) => ({ ...g, status: 'final' })), '2026-10-05T12:00:00.000Z'), false);
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

// The Weekly projection reads the league cards and the to-do list make, one
// per league, with the verdict the stored run gives the lone starter.
const projectionCalls = [];
function homeWorld(t, { matchups = [], kickoffs = [], trades = [], verdict = HEALTHY } = {}) {
  t.mock.method(projectionService, 'getWeeklyProjections', async (args) => {
    projectionCalls.push(args);
    return { startVerdictFor: () => verdict };
  });
  t.mock.method(expectedFinalService, 'expectedFinalsForWeek', async () => new Map([
    [11, { expectedFinal: 118.6, playersRemaining: 4, yetToPlay: 2, statusReliable: true, firstKickoffAt: '2026-10-04T17:00:00.000Z', syncedAt: null, starters: [{ gameState: 'in_progress', availability: { available: true, reason: null } }], bench: [] }],
    [12, { expectedFinal: 104.1, playersRemaining: 3, yetToPlay: 1, statusReliable: true, firstKickoffAt: '2026-10-04T17:00:00.000Z', syncedAt: null, starters: [{ gameState: 'in_progress', availability: { available: true, reason: null } }], bench: [] }],
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
      { team_id: 11, player_id: 901, slot: 'QB', name: 'Quarterback', injury_status: null, ir_attested: false, nfl_team: 'KC' },
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
    kickoffAt: '2026-10-04T17:00:00.000Z',
    opponent: { teamId: 12, name: 'Frozen Tundra FC' },
    my: { score: null, expectedFinal: 118.6, playersRemaining: 4, yetToPlay: 2 },
    opp: { score: 71.2, expectedFinal: 104.1, playersRemaining: 3, yetToPlay: 1 },
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

// --- inProgress: a postponed game must not hold Home in game day ----------

test('pickemStatus.inProgress: kicked off 2 h ago and not final is true; 9 h ago and not final is false', () => {
  const slate = [{ gameKey: 'DAL|NYG', kickoffAt: '2026-10-04T12:00:00.000Z', status: 'scheduled' }];
  assert.equal(homeStatus.pickemStatus({ slate, now: at('2026-10-04T14:00:00.000Z') }).inProgress, true);
  assert.equal(homeStatus.pickemStatus({ slate, now: at('2026-10-04T21:00:00.000Z') }).inProgress, false);
});

// --- loadPickemStandings, read through leagueStatuses ----------------------
//
// A confidence pick'em league, viewer 7 ("Picker") 2nd of 3. Week 3 is final
// (recaps), week 4 has BUF-MIA final (live row, recap) and DAL-NYG pending.

const PICKEM_LEAGUE = {
  id: 90, name: 'Pool', pickem_only: true, best_ball: false,
  draft_status: 'pending', season_status: 'regular', current_season: 2026, current_week: 4,
  max_teams: 20, draft_date: null, draft_timezone: null,
  my_team_id: 21, my_team_name: 'Picker', team_count: 3, is_owner: false, is_commissioner: false,
};
const gameRows = (week, home, away, kickoff) => [
  { week, nfl_team: home, opponent: away, kickoff_at: kickoff, game_key: `${week}${home}`, roof: null, home_away: 'home' },
  { week, nfl_team: away, opponent: home, kickoff_at: kickoff, game_key: `${week}${home}`, roof: null, home_away: 'away' },
];
const ALL_GAMES = [
  ...gameRows(3, 'KC', 'LV', '2026-09-27T17:00:00.000Z'),
  ...gameRows(3, 'GB', 'MIN', '2026-09-27T20:00:00.000Z'),
  ...gameRows(4, 'BUF', 'MIA', '2026-10-04T12:00:00.000Z'),
  ...gameRows(4, 'DAL', 'NYG', '2026-10-04T20:25:00.000Z'),
];
const recap = (week, home, away, homeScore, awayScore) => ({ week, home_team: home, away_team: away, home_score: homeScore, away_score: awayScore });
const pick = (userId, week, pair, picked, confidence) => ({
  league_id: 90, user_id: userId, week, team_pair: pair, picked_team: picked, confidence, mode: 'confidence',
});
const SEASON_PICKS = [
  pick(7, 3, 'KC|LV', 'KC', 5), pick(7, 3, 'GB|MIN', 'GB', 3), pick(7, 4, 'BUF|MIA', 'BUF', 2), pick(7, 4, 'DAL|NYG', 'DAL', 1),
  pick(8, 3, 'KC|LV', 'KC', 10), pick(8, 3, 'GB|MIN', 'MIN', 8), pick(8, 4, 'BUF|MIA', 'BUF', 4),
  pick(9, 3, 'KC|LV', 'KC', 1),
];

function pickemWorld({ picks = SEASON_PICKS, recaps, teamsFail = false } = {}) {
  return createFakePool([
    [/fn_normalize_nfl_team\("opponent"\)/, (text, params) => ({ rows: ALL_GAMES.filter((g) => params[1] == null || g.week === params[1]) })],
    [/FROM "live_game_states"/, () => ({ rows: [{
      week: 4, tank01_game_id: 'g', home_team: 'BUF', away_team: 'MIA', game_status: 'final', current_score_home: 17, current_score_away: 10,
    }] })],
    [/FROM "private"."game_recaps"/, () => ({ rows: recaps || [
      recap(3, 'KC', 'LV', 24, 10), recap(3, 'GB', 'MIN', 20, 30), recap(4, 'BUF', 'MIA', 17, 10),
    ] })],
    [/^SELECT "league_id", "owner_id", "name" FROM "teams"/, () => {
      if (teamsFail) throw new Error('teams read failed');
      return { rows: [7, 8, 9].map((owner) => ({ league_id: 90, owner_id: owner, name: { 7: 'Picker', 8: 'Ace', 9: 'Bob' }[owner] })) };
    }],
    [/FROM "pickem_picks"/, (text) => ({
      rows: text.includes('JOIN "teams"') ? picks.filter((p) => p.user_id === 7 && p.week === 4) : picks,
    })],
  ]);
}
const NOW_4 = new Date('2026-10-04T14:00:00.000Z');

test('season standing: sorted by points desc, leaderPoints is rank 1, lastWeek is the previous week, confidence scores the pick', async () => {
  const out = await homeStatus.leagueStatuses(pickemWorld(), { userId: 7, leagues: [PICKEM_LEAGUE], now: NOW_4 });
  const { status } = out.get(90);
  // Ace 22 (18 + 4), Picker 7 (5 + 2), Bob 1.
  assert.deepEqual(status.standing, { rank: 2, of: 3 });
  assert.equal(status.pickem.points, 7);
  assert.equal(status.pickem.leaderPoints, 22);
  assert.deepEqual(status.pickem.lastWeek, { week: 3, points: 5 });
  assert.equal(status.pickem.weekPoints, 2);
  assert.equal(status.pickem.finals, 1);
});

test('before any points exist the season figures and the pick\'em-only standing are left out', async () => {
  const out = await homeStatus.leagueStatuses(pickemWorld({ picks: [], recaps: [] }), { userId: 7, leagues: [PICKEM_LEAGUE], now: NOW_4 });
  const { status } = out.get(90);
  assert.equal('standing' in status, false);
  assert.deepEqual(Object.keys(status.pickem).sort(), ['finals', 'inProgress', 'made', 'missing', 'nextLockAt', 'total', 'weekPoints']);
});

test('a failed standings read keeps the week figures on a pick\'em-only card', async () => {
  const out = await homeStatus.leagueStatuses(pickemWorld({ teamsFail: true }), { userId: 7, leagues: [PICKEM_LEAGUE], now: NOW_4 });
  const { status, statusError } = out.get(90);
  assert.equal(statusError, false);
  assert.equal('standing' in status, false);
  assert.equal(status.pickem.total, 2);
  assert.equal(status.pickem.weekPoints, 2);
  assert.equal('points' in status.pickem, false);
});

// Draft slot and on the clock (#2316): a live draft carries the viewer's slot
// in the current round and whether the clock is theirs, in the draft room's order.
const DRAFTING = {
  ...HOME_LEAGUE, id: 81, draft_status: 'active', season_status: 'pre',
  draft_rotation: 'snake', draft_order_overrides: null, current_pick: 0, team_count: 12, draft_rounds: 3,
};
const draftOrderFake = (ids, taken = []) => createFakePool([
  [/FROM "draft_picks" WHERE "league_id" = ANY[(].1[)]/,
    () => ({ rows: taken.map(([league_id, pick_number]) => ({ league_id, pick_number })) })],
  [/FROM "teams" WHERE "league_id" = ANY\(\$1\) ORDER BY "draft_position" NULLS LAST, "teams"\."id"/,
    () => ({ rows: ids.map((id) => ({ id, league_id: 81 })) })],
]);
const TWELVE = Array.from({ length: 12 }, (_, i) => 101 + i);
const draftOf = async (fake, league) => (
  await homeStatus.leagueStatuses(fake, { userId: 7, leagues: [league], now: HOME_NOW })
).get(league.id).status.draft;

test('leagueStatuses puts a snake draft\'s second round in reverse: position 7 picks 6th', async () => {
  const draft = await draftOf(draftOrderFake(TWELVE), { ...DRAFTING, my_team_id: 107, current_pick: 12 });
  assert.equal(draft.round, 2);
  assert.equal(draft.slot, 6);
  assert.equal(draft.onTheClock, false);
});

test('leagueStatuses reads a linear rotation straight through every round', async () => {
  const draft = await draftOf(draftOrderFake(TWELVE), {
    ...DRAFTING, my_team_id: 107, draft_rotation: 'linear', current_pick: 12,
  });
  assert.deepEqual([draft.round, draft.slot], [2, 7]);
});

test('leagueStatuses follows a per-round override', async () => {
  const draft = await draftOf(draftOrderFake(TWELVE), {
    ...DRAFTING, my_team_id: 107, current_pick: 12,
    draft_order_overrides: { 2: [107, ...TWELVE.filter((id) => id !== 107)] },
  });
  assert.deepEqual([draft.round, draft.slot, draft.onTheClock], [2, 1, true]);
});

test('leagueStatuses says onTheClock when the pick on the clock is the viewer\'s', async () => {
  const draft = await draftOf(draftOrderFake(TWELVE), { ...DRAFTING, my_team_id: 107, current_pick: 6 });
  assert.deepEqual([draft.round, draft.slot, draft.onTheClock], [1, 7, true]);
});

test('leagueStatuses gives a viewer with no team a null slot', async () => {
  const draft = await draftOf(draftOrderFake(TWELVE), { ...DRAFTING, my_team_id: null });
  assert.equal(draft.slot, null);
  assert.equal(draft.onTheClock, false);
});

test('leagueStatuses names the NEXT pick of the viewer: a pick already made this round moves it to the next round', async () => {
  const fake = draftOrderFake(TWELVE, [[81, 18]]);
  for (const current of [18, 23]) {
    // eslint-disable-next-line no-await-in-loop
    const draft = await draftOf(fake, { ...DRAFTING, my_team_id: 107, current_pick: current });
    assert.deepEqual([draft.round, draft.slot, draft.onTheClock], [3, 7, false]);
  }
});

test('leagueStatuses skips a keeper-filled pick', async () => {
  // Position 7 picks index 6 (round 1) but a keeper already holds it.
  const draft = await draftOf(draftOrderFake(TWELVE, [[81, 7]]), { ...DRAFTING, my_team_id: 107, current_pick: 0 });
  assert.deepEqual([draft.round, draft.slot], [2, 6]);
});

test('leagueStatuses gives a viewer with no picks left null round and slot', async () => {
  const draft = await draftOf(draftOrderFake(TWELVE), { ...DRAFTING, my_team_id: 107, current_pick: 31 });
  assert.deepEqual([draft.round, draft.slot, draft.onTheClock], [null, null, false]);
});

test('leagueStatuses answers two drafting leagues from one batch of reads', async () => {
  const fake = createFakePool([
    [/FROM "draft_picks" WHERE "league_id" = ANY[(].1[)]/, () => ({ rows: [] })],
    [/ORDER BY "draft_position" NULLS LAST/, () => ({ rows: [
      ...TWELVE.map((id) => ({ id, league_id: 81 })), ...[1, 2, 3, 4].map((id) => ({ id, league_id: 82 })),
    ] })],
    [/FROM "pickem_settings"/, () => ({ rows: [] })],
  ]);
  const second = { ...DRAFTING, id: 82, my_team_id: 3, team_count: 4, current_pick: 1 };
  const out = await homeStatus.leagueStatuses(fake, { userId: 7, leagues: [{ ...DRAFTING, my_team_id: 107 }, second], now: HOME_NOW });
  assert.deepEqual([out.get(81).status.draft.round, out.get(81).status.draft.slot], [1, 7]);
  assert.deepEqual([out.get(82).status.draft.round, out.get(82).status.draft.slot], [1, 3]);
  assert.equal(fake.calls.filter((c) => /ANY[(].1[)]/.test(c.text) && /draft_/.test(c.text)).length, 2);
});

test('a failed draft-order read drops only round, slot and onTheClock', async () => {
  const fake = createFakePool([
    [/FROM "draft_picks"/, () => { throw new Error('picks read failed'); }],
    [/ORDER BY "draft_position" NULLS LAST/, () => ({ rows: [] })],
  ]);
  const { status, statusError } = (await homeStatus.leagueStatuses(fake, { userId: 7, leagues: [{ ...DRAFTING, my_team_id: 107 }], now: HOME_NOW })).get(81);
  assert.equal(statusError, false);
  assert.deepEqual(Object.keys(status.draft).sort(), ['date', 'maxTeams', 'seatsFilled', 'timezone']);
});

test('leagueStatuses leaves round, slot and onTheClock off a pre-draft league', async () => {
  const fake = draftOrderFake(TWELVE);
  const pre = await draftOf(fake, { ...DRAFTING, draft_status: 'pending', my_team_id: 107 });
  assert.deepEqual(Object.keys(pre).sort(), ['date', 'maxTeams', 'seatsFilled', 'timezone']);
  assert.equal(fake.calls.some((c) => /ORDER BY "draft_position"/.test(c.text)), false);
});
