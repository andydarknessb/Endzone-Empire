const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const pickClock = require('../services/pickClock.service');
const draftStartService = require('../services/draftStart.service');
const prefs = require('../services/prefs.service');
const { processScheduledDrafts } = require('../services/draftSchedule.service');

/**
 * #615: the WORKER's scheduled-autostart path arms the in-process Pick-clock
 * expiry timer for the first pick's deadline, so an autostarted timed draft
 * fires its first Autopick on time instead of up to one backstop poll late.
 *
 * The process boundary is the whole point (ADR 0018, #601). startDraft is the
 * single entry for both the worker's scheduled autostart AND the manual-start
 * API path, and in production the API process has no timer registry at all
 * (server.js starts the scheduler only under runJobsInWeb, false there). So the
 * arm must live in the worker caller - the scheduler's start action - never
 * inside startDraft, which would arm in the API process too. These tests pin
 * both halves: the worker path arms, the direct startDraft call does not.
 *
 * Two instruments, both through the module interface:
 *  - the spy tests stub pickClock.armExpiryTimer (the exported arming function)
 *    and read back whether the seam called it and with which deadline;
 *  - the end-to-end tests leave armExpiryTimer real, enable fake timers, and
 *    count autoPick's first league read - the same "a fired timer ran autoPick"
 *    proxy the stopScheduler test in scheduler.test.js uses - so a real armed
 *    timer is observed firing, and a negative case is proven non-blind by the
 *    identical counter observing a fire in the paired positive case.
 */

const LEAGUE_ID = 1;
const OWNER = 7;

// A pending league whose draft_date has passed with enough teams present, so
// scheduledDraftAction resolves to 'start' and processScheduledDrafts drives
// runStartAction -> startDraft on the WORKER path.
const dueStartLeagueRow = (over = {}) => ({
  id: LEAGUE_ID, name: 'Ballers', owner_id: OWNER, draft_status: 'pending',
  draft_date: new Date(Date.now() - 60000).toISOString(), draft_type: 'snake',
  min_teams: 1, pick_time_seconds: 60, draft_reminder_stage: 0,
  draft_autostart_failed: false, team_count: 8, ...over,
});

/**
 * The pool queries runStartAction issues AFTER a successful start (notifyLeague
 * owners, the push owners), plus the autoPick league read a FIRED timer would
 * make (counted through onAutoPickRead). startDraft is mocked in these worker
 * tests, so its own DB path never runs here; push is kept quiet so the
 * best-effort branch adds no noise.
 */
function workerStartPool(t, { leagueRow = dueStartLeagueRow(), onAutoPickRead } = {}) {
  const fake = createFakePool([
    [/^SELECT "id", "name", "owner_id", "draft_status", "draft_date"/, () => ({ rows: [leagueRow] })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [] })],
    [/^SELECT "owner_id" FROM "teams"/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => {
      if (onAutoPickRead) onAutoPickRead();
      return { rows: [] };
    }],
  ]).install(t);
  t.mock.method(prefs, 'usersWanting', async () => []);
  return fake;
}

// --- worker seam: the arming decision (spy on the exported armExpiryTimer) ----

test('worker scheduled autostart of a timed draft arms the timer for the deadline the start returned (#615 AC1)', async (t) => {
  workerStartPool(t);
  const deadline = '2026-09-01T00:01:00.000Z';
  t.mock.method(draftStartService, 'startDraft', async ({ leagueId, userId }) => {
    assert.equal(userId, null, 'the scheduler starts with no acting user');
    return { leagueId, pickDeadlineAt: deadline };
  });
  const armed = [];
  t.mock.method(pickClock, 'armExpiryTimer', (leagueId, dl) => armed.push({ leagueId, dl }));

  const actions = await processScheduledDrafts({ now: new Date() });

  assert.deepEqual(actions, [{ leagueId: LEAGUE_ID, action: 'start' }]);
  assert.deepEqual(armed, [{ leagueId: LEAGUE_ID, dl: deadline }],
    'the worker armed exactly one timer, for the deadline the start returned');
});

test('worker scheduled autostart of an untimed (or keeper-complete) draft arms nothing (#615 AC2)', async (t) => {
  // startDraft returns a null deadline for both an untimed clock and a
  // keeper-complete start (see the startDraft contract tests below), so the
  // seam sees the same null on either path.
  workerStartPool(t);
  t.mock.method(draftStartService, 'startDraft', async ({ leagueId }) => ({ leagueId, pickDeadlineAt: null }));
  const armed = [];
  t.mock.method(pickClock, 'armExpiryTimer', (leagueId, dl) => armed.push({ leagueId, dl }));

  await processScheduledDrafts({ now: new Date() });

  // Positive control: the identical spy captured a real deadline in the AC1
  // test above, so it is not blind. What this test proves is that the seam
  // reached the arm and passed null; that a null deadline actually arms nothing
  // is proved by the end-to-end sibling below (armExpiryTimer is stubbed here,
  // so its cancel-without-arming behaviour cannot be observed from this test).
  assert.deepEqual(armed, [{ leagueId: LEAGUE_ID, dl: null }], 'the seam passed a null deadline to the arm');
});

test('a worker scheduled start that rolls back arms nothing (#615 AC4)', async (t) => {
  workerStartPool(t);
  // A rolled-back start rejects (startDraft ROLLBACKs then rethrows). The arm
  // line sits after a successful return, so it is never reached.
  t.mock.method(draftStartService, 'startDraft', async () => { throw new Error('start transaction rolled back'); });
  const armed = [];
  t.mock.method(pickClock, 'armExpiryTimer', (leagueId, dl) => armed.push({ leagueId, dl }));

  const actions = await processScheduledDrafts({ now: new Date() });

  // Positive control: the AC1 test shows this same spy records an arm on a
  // successful start; a rejected start records none.
  assert.deepEqual(actions, [], 'a failed start is not reported as taken');
  assert.deepEqual(armed, [], 'a rolled-back start armed no timer');
});

// --- end-to-end: a real armed timer actually fires (fake timers) -------------

test('end-to-end: the armed worker timer fires the autopick once the deadline passes (#615 AC1)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => pickClock.cancelAllExpiryTimers());
  let autoPickReads = 0;
  workerStartPool(t, { onAutoPickRead: () => { autoPickReads += 1; } });
  const deadline = new Date(Date.now() + 60000); // 60s into the fake future
  t.mock.method(draftStartService, 'startDraft', async ({ leagueId }) => ({ leagueId, pickDeadlineAt: deadline }));

  await processScheduledDrafts({ now: new Date() });
  assert.equal(autoPickReads, 0, 'nothing fires before the deadline');

  t.mock.timers.tick(61000);
  await new Promise((resolve) => setImmediate(resolve)); // let the fired autopick run

  assert.equal(autoPickReads, 1, 'the armed timer fired autoPick once the deadline passed');
});

test('end-to-end: an untimed worker autostart arms no timer, so nothing fires (#615 AC2)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  t.after(() => pickClock.cancelAllExpiryTimers());
  let autoPickReads = 0;
  workerStartPool(t, { onAutoPickRead: () => { autoPickReads += 1; } });
  t.mock.method(draftStartService, 'startDraft', async ({ leagueId }) => ({ leagueId, pickDeadlineAt: null }));

  await processScheduledDrafts({ now: new Date() });
  t.mock.timers.tick(10 * 60 * 1000);
  await new Promise((resolve) => setImmediate(resolve));

  // Positive control: the timed sibling fired autoPick exactly once with this
  // same counter and tick; a null deadline arms nothing, so it stays at zero.
  assert.equal(autoPickReads, 0, 'no timer was armed, so no autopick fired');
});

// --- startDraft contract + the manual API path (real startDraft) -------------
// The manual-start API path (draftSocket / league.router) calls startDraft
// directly, in the API process. It must arm nothing: arming lives only in the
// worker caller. These drive the REAL startDraft, spy armExpiryTimer, and prove
// it is never touched - while also pinning the deadline startDraft returns
// (non-null timed, null untimed/keeper-complete) that the worker seam relies on.

const BASE = Date.parse('2026-09-01T00:00:00.000Z');
const manualBaseLeague = {
  id: LEAGUE_ID, owner_id: OWNER, draft_status: 'pending', draft_type: 'snake',
  draft_rotation: 'snake', draft_order_overrides: null, keepers_enabled: false,
  keeper_count: 0, min_teams: 1, roster_limit: 2, ir_slots: 0,
  pick_time_seconds: 60, autodraft_delay_seconds: 10,
};
const manualTeams = [{ id: 11, name: 'Team Eleven', owner_id: OWNER, draft_position: 1, autodraft: false, locked: false }];
const KEEPER_FILLED = {
  ...manualBaseLeague, roster_limit: 1, ir_slots: 0, keepers_enabled: true,
  keeper_count: 1, current_season: 2026, waiver_period_hours: 24, regular_season_weeks: 0,
};
const TWO_TEAMS = [
  { id: 11, name: 'Team Eleven', owner_id: 7, draft_position: 1, autodraft: false, locked: false },
  { id: 12, name: 'Team Twelve', owner_id: 8, draft_position: 2, autodraft: false, locked: false },
];
const TWO_KEEPERS = [
  { team_id: 11, player_id: 101, draft_round: 1 },
  { team_id: 12, player_id: 201, draft_round: 1 },
];

/**
 * A stateful fake for the real startDraft path. The leagues UPDATE answers the
 * deadline the way Postgres would: it reads the clock seconds bound into
 * make_interval(secs => $N) and returns now-plus-that (null when the bound
 * seconds are null, i.e. an untimed clock, or when the statement clears the
 * clock with a bare NULL, i.e. a keeper-complete start).
 */
function realStartPool(t, { league = manualBaseLeague, teams = manualTeams, keepers = [] } = {}) {
  const row = { ...league };
  return createFakePool([
    [select('leagues'), () => ({ rows: [{ ...row }] })],
    [/^SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })],
    [update('leagues'), (text, params) => {
      if (/'complete'/.test(text)) row.draft_status = 'complete';
      else if (/'active'/.test(text)) row.draft_status = 'active';
      const m = text.match(/make_interval\(secs => \$(\d+)::int\)/);
      const secs = m ? params[Number(m[1]) - 1] : null;
      const deadline = secs == null ? null : new Date(BASE + secs * 1000).toISOString();
      return { rows: [{ pick_deadline_at: deadline }], rowCount: 1 };
    }],
    [select('teams'), () => ({ rows: teams })],
    [select('keepers'), () => ({ rows: keepers })],
    [select('matchups'), () => ({ rows: [] })],
    [insert('matchups'), () => ({ rows: [], rowCount: 1 })],
    [insert('draft_picks'), () => ({ rows: [], rowCount: 1 })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [insert('draft_activity'), (() => { let seq = 100; return () => ({ rows: [{ id: seq, feed_seq: String(seq++), created_at: '2026-09-01T00:00:00.000Z' }], rowCount: 1 }); })()],
  ]).install(t);
}

test('the manual API startDraft path arms no timer, even though a real deadline was available (#615 AC3)', async (t) => {
  const fake = realStartPool(t);
  const armed = [];
  t.mock.method(pickClock, 'armExpiryTimer', (leagueId, dl) => armed.push({ leagueId, dl }));

  const result = await startDraftDirect({ leagueId: LEAGUE_ID, userId: OWNER });

  // Positive control that the instrument is not blind: a real, non-null
  // deadline WAS produced by the start, so a timer COULD have been armed - and
  // still none was, because arming does not live inside startDraft.
  assert.equal(result.pickDeadlineAt, new Date(BASE + 60 * 1000).toISOString(), 'the timed start returned a real deadline');
  assert.deepEqual(armed, [], 'the direct (API-process) start armed no timer');
  assert.equal(fake.matching(/^COMMIT$/).length, 1);
  fake.assertClean();
});

test('startDraft contract: an untimed live start returns a null deadline', async (t) => {
  const fake = realStartPool(t, { league: { ...manualBaseLeague, pick_time_seconds: 0 } });

  const result = await startDraftDirect({ leagueId: LEAGUE_ID, userId: OWNER });

  assert.equal(result.leagueId, LEAGUE_ID);
  assert.equal(result.pickDeadlineAt, null, 'an untimed, non-autodrafting clock arms nothing');
  fake.assertClean();
});

test('startDraft contract: a keeper-complete start returns a null deadline', async (t) => {
  const fake = realStartPool(t, { league: KEEPER_FILLED, teams: TWO_TEAMS, keepers: TWO_KEEPERS });

  const result = await startDraftDirect({ leagueId: LEAGUE_ID, userId: OWNER });

  assert.equal(result.pickDeadlineAt, null, 'a draft complete on keepers never arms a clock');
  assert.equal(fake.matching(/"draft_status" = 'complete'/).length, 1, 'the start completed the draft');
  fake.assertClean();
});

// startDraft is required fresh here (not the top-level draftStartService whose
// startDraft the worker tests mock) so these exercise the real implementation.
function startDraftDirect(args) {
  return require('../services/draftStart.service').startDraft(args);
}
