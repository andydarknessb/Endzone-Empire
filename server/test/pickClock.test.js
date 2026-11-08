const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, update } = require('./helpers/fakePool');
const pickClock = require('../services/pickClock.service');
const { DraftError } = require('../services/draftError');

/**
 * The Pick clock module owns arming (#599, ADR 0018): every named event arms by
 * the ONE policy, and every event is the only writer of the deadline. These
 * tests drive each event against a fake client and read back the deadline the
 * event armed, so the assertion is the arming decision itself, not a value the
 * event was handed.
 *
 * The fake's leagues UPDATE computes the deadline the way Postgres would: it
 * finds the clock seconds the statement bound into `make_interval(secs => $N)`
 * and returns NOW + that many seconds (null when the statement clears the clock
 * with a NULL literal). BASE is frozen so an armed deadline is an exact,
 * assertable instant.
 */
const BASE = Date.parse('2026-09-01T00:00:00.000Z');
const LEAGUE_ID = 5;

/** The armed deadline for `seconds`, or null. Mirrors now() + make_interval. */
const armedAt = (seconds) => (seconds == null ? null : new Date(BASE + seconds * 1000).toISOString());

/**
 * A leagues UPDATE handler that reads the bound clock seconds out of the CASE
 * expression and answers the deadline they arm. A statement that clears with a
 * bare `= NULL` (pause, reset, all-keeper completion) binds no make_interval and
 * so returns null.
 */
function armingLeagueUpdate() {
  return [update('leagues'), (text, params) => {
    const match = text.match(/make_interval\(secs => \$(\d+)::int\)/);
    if (!match) return { rows: [{ pick_deadline_at: null }] };
    const seconds = params[Number(match[1]) - 1];
    return { rows: [{ pick_deadline_at: armedAt(seconds) }] };
  }];
}

/** The single leagues UPDATE this event issued. */
const leagueUpdate = (fake) => fake.matching(update('leagues'))[0];

/**
 * The world for the events that now read their own policy from the locked row
 * (#948): onSlotTaken, onAutodraftToggled and onPickUndone no longer take a
 * `league` argument, so each issues onResumed's policy SELECT before it arms.
 * This fake answers that SELECT with `league` (over the shared defaults) and the
 * arming UPDATE with the deadline it binds. Deleting `draft_type` from an offline
 * `league` here falls back to the timed default, which is exactly why the offline
 * cases redden when the policy read stops carrying the column - the defect #948
 * fixes.
 */
function policyWorld(league) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [{
      current_pick: 0, draft_rotation: 'snake', draft_order_overrides: null,
      draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10, ...league,
    }] })],
    armingLeagueUpdate(),
  ]);
}

async function withClient(fake, fn) {
  const client = await fake.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// --- draft started ----------------------------------------------------------

test('draft started: the active branch arms the first pick clock and fixes draft_rounds', async (t) => {
  const fake = createFakePool([armingLeagueUpdate()]).install(t);

  const deadline = await withClient(fake, (client) =>
    pickClock.onDraftStarted(client, { leagueId: LEAGUE_ID, currentPick: 0, clockSeconds: 60, rounds: 15 }));

  assert.equal(deadline, armedAt(60), 'the start arms the plan clock');
  const call = leagueUpdate(fake);
  assert.match(call.text, /"draft_status" = 'active'/);
  assert.match(call.text, /"draft_rounds" = \$/);
  assert.equal(call.params[1], 0, 'current_pick advances to the first open pick');
});

// --- a slot was taken (onSlotTaken, #2694) ----------------------------------

const draftCompletion = require('../services/draftCompletion');

/** Two Teams in a snake draft; with 3 rounds the open slot after taken [1..4] (index 4) is Team 11. */
const teamsWithAutodraft = (autodraft) => [
  { id: 11, autodraft, draft_position: 1 },
  { id: 12, autodraft: false, draft_position: 2 },
];

/** The Pick clock step's own reads: the locked policy row, the draft_picks count and taken set. */
function slotWorld(league, { takenPickNumbers = [], picksMade }) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [{
      current_pick: 3, draft_rotation: 'snake', draft_order_overrides: null,
      draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10, ...league,
    }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "draft_picks"/, () => ({ rows: [{ n: picksMade }] })],
    [/^SELECT "pick_number" FROM "draft_picks"/, () => ({ rows: takenPickNumbers.map((pick_number) => ({ pick_number })) })],
    armingLeagueUpdate(),
  ]);
}

const slot = (client, { teams, fromInclusive, rounds = null }) => pickClock.onSlotTaken(client, {
  leagueId: LEAGUE_ID, league: { draft_rounds: 3 }, teams,
  rotationOpts: { rotation: 'snake', overrides: null }, fromInclusive, rounds,
});

test('pick landed: a timed next team gets the full pick clock; the turn advances', async (t) => {
  const fake = slotWorld({ draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10 },
    { takenPickNumbers: [1, 2, 3, 4], picksMade: 4 }).install(t);

  const outcome = await withClient(fake, (client) => slot(client, { teams: teamsWithAutodraft(false), fromInclusive: 4 }));

  assert.equal(outcome.draftComplete, false);
  assert.equal(outcome.nextTeam.id, 11, 'the next open slot belongs to Team 11');
  assert.equal(outcome.pickDeadlineAt, armedAt(90));
  const call = leagueUpdate(fake);
  assert.equal(call.params[0], 4, 'current_pick advances to the next open slot');
  assert.equal(call.params[1], 'active');
});

test('pick landed: an autodrafting next team gets the short delay, not the full clock', async (t) => {
  const fake = slotWorld({ draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10 },
    { takenPickNumbers: [1, 2, 3, 4], picksMade: 4 }).install(t);

  const outcome = await withClient(fake, (client) => slot(client, { teams: teamsWithAutodraft(true), fromInclusive: 4 }));

  assert.equal(outcome.pickDeadlineAt, armedAt(10));
});

test('pick landed: the completing pick arms no clock and hands off completion', async (t) => {
  const fake = slotWorld({ draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10 },
    { takenPickNumbers: [1, 2, 3, 4, 5, 6], picksMade: 6 }).install(t);
  const completion = { kind: 'complete', id: 200 };
  let handedOff = false;
  t.mock.method(draftCompletion, 'completeDraft', async () => { handedOff = true; return completion; });

  const outcome = await withClient(fake, (client) => slot(client, { teams: teamsWithAutodraft(false), fromInclusive: 6 }));

  assert.equal(outcome.draftComplete, true);
  assert.equal(outcome.pickDeadlineAt, null);
  assert.equal(outcome.nextTeam, null);
  assert.equal(outcome.completion, completion);
  assert.equal(handedOff, true, 'completion is handed off by the step');
  assert.equal(leagueUpdate(fake).params[1], 'complete');
});

test('draft start: a keeper-complete start completes through the same step and arms no clock', async (t) => {
  const fake = slotWorld({ draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10 },
    { takenPickNumbers: [1, 2, 3, 4], picksMade: 4 }).install(t);
  t.mock.method(draftCompletion, 'completeDraft', async () => ({ kind: 'complete', id: 201 }));

  const outcome = await withClient(fake, (client) => slot(client, { teams: teamsWithAutodraft(false), fromInclusive: 0, rounds: 2 }));

  assert.equal(outcome.draftComplete, true);
  assert.equal(outcome.pickDeadlineAt, null, 'a keeper-complete draft never arms a clock');
  assert.equal(leagueUpdate(fake).params[4], 2, 'the start fixes draft_rounds');
});

test('pick landed: an offline draft arms no clock for the next team', async (t) => {
  // #948 coverage: the step reads draft_type from the locked row, so an offline draft arms
  // nothing even for a next team that would otherwise take the clock. Red tell: drop the
  // offline branch in clockSecondsFor and this arms the full 90s clock instead of null.
  const fake = slotWorld({ draft_type: 'offline', pick_time_seconds: 90, autodraft_delay_seconds: 10 },
    { takenPickNumbers: [1, 2, 3, 4], picksMade: 4 }).install(t);

  const outcome = await withClient(fake, (client) => slot(client, { teams: teamsWithAutodraft(false), fromInclusive: 4 }));

  assert.equal(outcome.pickDeadlineAt, null, 'an offline draft never arms a clock');
});

// --- an Autopick's timeout consequences (onTimeout, #2694) -----------------

test('a Team already in Autodraft is not timing out: no streak, no flip, no query', async (t) => {
  const fake = createFakePool([]).install(t);

  const moved = await withClient(fake, (client) => pickClock.onTimeout(client, {
    leagueId: LEAGUE_ID, team: { id: 11, autodraft: true }, nextTeamId: 11, draftActive: true,
  }));

  assert.equal(moved, null);
  assert.equal(fake.calls.length, 0, 'nothing is written for a Team already on Autodraft');
});

test('a timeout that moves the Team into Autodraft on a completing Pick arms nothing', async (t) => {
  const fake = createFakePool([
    [/^UPDATE "teams" SET "consecutive_timeouts" = "consecutive_timeouts" \+ 1/, () => ({ rows: [{ consecutive_timeouts: 2 }] })],
    [/^UPDATE "teams" SET "autodraft" = true/, () => ({ rows: [], rowCount: 1 })],
  ]).install(t);

  const moved = await withClient(fake, (client) => pickClock.onTimeout(client, {
    leagueId: LEAGUE_ID, team: { id: 11, autodraft: false }, nextTeamId: null, draftActive: false,
  }));

  assert.deepEqual(moved, { pickDeadlineAt: undefined }, 'the flip is reported with no re-arm');
  assert.equal(fake.matching(update('leagues')).length, 0, 'no clock is armed on a completed draft');
});

// --- paused -----------------------------------------------------------------

test('paused: the clock is cleared', async (t) => {
  const fake = createFakePool([armingLeagueUpdate()]).install(t);

  const deadline = await withClient(fake, (client) => pickClock.onPaused(client, { leagueId: LEAGUE_ID }));

  assert.equal(deadline, null);
  assert.match(leagueUpdate(fake).text, /"pick_deadline_at" = NULL/);
});

// --- resumed ----------------------------------------------------------------
// The regression cases, each with its own red tell against the pre-change
// pause/resume rule (full clock in a timed league, NULL in an untimed one).

function resumeWorld({ onClock, league }) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [{
      current_pick: 0, draft_rotation: 'snake', draft_order_overrides: null,
      draft_type: 'snake', pick_time_seconds: 0, autodraft_delay_seconds: 10, ...league,
    }] })],
    [select('teams'), () => ({ rows: [
      { id: 11, autodraft: onClock === 11, draft_position: 1 },
      { id: 12, autodraft: onClock === 12, draft_position: 2 },
    ] })],
    armingLeagueUpdate(),
  ]);
}

test('resumed: an autodrafting team in an untimed league gets the short delay, never NULL', async (t) => {
  // Red tell: the old rule armed NULL for an untimed league and froze the draft.
  const fake = resumeWorld({ onClock: 11, league: { pick_time_seconds: 0, autodraft_delay_seconds: 10 } }).install(t);

  const deadline = await withClient(fake, (client) => pickClock.onResumed(client, { leagueId: LEAGUE_ID }));

  assert.ok(deadline, 'an untimed autodrafting resume is never frozen');
  assert.equal(deadline, armedAt(10), 'it is the short autodraft delay');
});

test('resumed: an autodrafting team in a timed league gets the delay, not the full pick clock', async (t) => {
  // Red tell: the old rule armed the full 90s pick clock instead of the delay.
  const fake = resumeWorld({ onClock: 11, league: { pick_time_seconds: 90, autodraft_delay_seconds: 10 } }).install(t);

  const deadline = await withClient(fake, (client) => pickClock.onResumed(client, { leagueId: LEAGUE_ID }));

  assert.equal(deadline, armedAt(10), 'the short delay, not the full clock');
  assert.notEqual(deadline, armedAt(90));
});

test('resumed: a timed non-autodrafting team gets the full pick clock', async (t) => {
  const fake = resumeWorld({ onClock: 99, league: { pick_time_seconds: 90, autodraft_delay_seconds: 10 } }).install(t);

  const deadline = await withClient(fake, (client) => pickClock.onResumed(client, { leagueId: LEAGUE_ID }));

  assert.equal(deadline, armedAt(90));
});

test('resumed: an untimed non-autodrafting team gets no clock', async (t) => {
  const fake = resumeWorld({ onClock: 99, league: { pick_time_seconds: 0, autodraft_delay_seconds: 10 } }).install(t);

  const deadline = await withClient(fake, (client) => pickClock.onResumed(client, { leagueId: LEAGUE_ID }));

  assert.equal(deadline, null);
});

// --- autodraft toggled ------------------------------------------------------

test('autodraft toggled: the on-clock team now autodrafting gets the short delay at once', async (t) => {
  const fake = policyWorld({ draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 8 }).install(t);

  const deadline = await withClient(fake, (client) => pickClock.onAutodraftToggled(client, { leagueId: LEAGUE_ID }));

  assert.equal(deadline, armedAt(8), 'the short delay, floored at one second');
});

test('autodraft toggled: an offline draft arms no clock, like the other events', async (t) => {
  // The toggle route reaches this with an active offline draft (no draft_type
  // guard on that path), so this event must apply the offline rule too - it does
  // not arm a divergent deadline where the five siblings arm none (#598 story 7).
  // This guard already binds; #948 preserves it while the read moves off the
  // caller. Deleting draft_type from this fixture row (falling back to the timed
  // default) still reddens this assertion, so the offline column stays load-bearing.
  const fake = policyWorld({ draft_type: 'offline', pick_time_seconds: 90, autodraft_delay_seconds: 8 }).install(t);

  const deadline = await withClient(fake, (client) => pickClock.onAutodraftToggled(client, { leagueId: LEAGUE_ID }));

  assert.equal(deadline, null, 'an offline draft never arms a clock');
});

// --- pick undone ------------------------------------------------------------

test('pick undone: the turn rewinds and the team now on the clock is re-armed by the policy', async (t) => {
  const fake = policyWorld({ draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10 }).install(t);

  const deadline = await withClient(fake, (client) =>
    pickClock.onPickUndone(client, { leagueId: LEAGUE_ID, newCurrentPick: 2, onClockAutodraft: false }));

  assert.equal(deadline, armedAt(90));
  assert.equal(leagueUpdate(fake).params[0], 2, 'current_pick rewinds to the undone slot');
});

test('pick undone: rewinding onto an autodrafting team arms the short delay', async (t) => {
  const fake = policyWorld({ draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10 }).install(t);

  const deadline = await withClient(fake, (client) =>
    pickClock.onPickUndone(client, { leagueId: LEAGUE_ID, newCurrentPick: 2, onClockAutodraft: true }));

  assert.equal(deadline, armedAt(10));
});

test('pick undone: an offline draft arms no clock on rewind', async (t) => {
  // #948 coverage: onPickUndone had no offline case. It reads draft_type from
  // the locked row now, so rewinding onto a team in an offline draft arms
  // nothing. Red tell: default the policy read's missing/other draft_type to a
  // timed value (drop the offline branch in clockSecondsFor) and this arms the
  // full 90s clock instead of null.
  const fake = policyWorld({ draft_type: 'offline', pick_time_seconds: 90, autodraft_delay_seconds: 10 }).install(t);

  const deadline = await withClient(fake, (client) =>
    pickClock.onPickUndone(client, { leagueId: LEAGUE_ID, newCurrentPick: 2, onClockAutodraft: false }));

  assert.equal(deadline, null, 'an offline draft never arms a clock');
});

// --- #2549: autoPick stops when the clock moved on --------------------------

test('autoPick: a CLOCK_MOVED landing returns null, tries no other candidate and counts no timeout', async (t) => {
  const pickService = require('../services/pick.service');
  const deadline = new Date('2000-01-01T00:00:00.000Z');
  const league = {
    id: LEAGUE_ID, draft_status: 'active', draft_paused: false, current_pick: 0,
    draft_rotation: 'snake', draft_order_overrides: null, draft_rounds: 15,
    draft_type: 'snake', roster_slots: null, position_caps: null, bench_slots: 5, ir_slots: 1,
    pick_deadline_at: deadline,
  };
  const candidate = (id) => ({ id, name: `P${id}`, adp: id, position: 'RB', nfl_team: 'KC' });
  const fake = createFakePool([
    [/FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [league] })],
    [/EXTRACT\(MONTH FROM CURRENT_DATE\)/, () => ({ rows: [{ season: 2026 }] })],
    [/FROM "team_players" JOIN "players"/, () => ({ rows: [] })],
    [/FROM "players" LEFT JOIN/, () => ({ rows: [candidate(1), candidate(2)] })],
    [/FROM "draft_picks"/, () => ({ rows: [] })],
    [/FROM "league_feed_sequences"/, () => ({ rows: [{ last_seq: '1' }] })],
    [/FROM "teams"/, () => ({ rows: [{ id: 55, owner_id: 7, autodraft: false, draft_position: 1 }] })],
  ]).install(t);
  const landed = t.mock.method(pickService, 'landPick', async () => {
    throw new DraftError(409, 'the pick clock moved on', 'CLOCK_MOVED');
  });

  const outcome = await pickClock.autoPick({ leagueId: LEAGUE_ID });

  assert.equal(outcome, null);
  assert.equal(landed.mock.callCount(), 1, 'no second candidate is tried');
  assert.equal(landed.mock.calls[0].arguments[0].expiredTurn.deadline, deadline, 'the deadline it read rides to the commit');
  assert.equal(fake.matching(/consecutive_timeouts/).length, 0, 'no timeout is counted');
  assert.equal(fake.matching(/draft_paused/).length, 0, 'no stall escalation either');
});
