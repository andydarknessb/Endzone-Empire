const { test } = require('node:test');
const assert = require('node:assert/strict');
const homeStatus = require('../services/homeStatus.service');

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

test('isValidTimeZone accepts IANA zones and refuses anything else', () => {
  assert.equal(homeStatus.isValidTimeZone('America/Chicago'), true);
  assert.equal(homeStatus.isValidTimeZone('UTC'), true);
  assert.equal(homeStatus.isValidTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(homeStatus.isValidTimeZone(''), false);
  assert.equal(homeStatus.isValidTimeZone(undefined), false);
  assert.equal(homeStatus.isValidTimeZone(['UTC']), false);
});
