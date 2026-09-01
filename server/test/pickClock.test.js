const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, update } = require('./helpers/fakePool');
const pickClock = require('../services/pickClock.service');

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
    pickClock.onDraftStarted(client, { leagueId: LEAGUE_ID, complete: false, currentPick: 0, clockSeconds: 60, rounds: 15 }));

  assert.equal(deadline, armedAt(60), 'the start arms the plan clock');
  const call = leagueUpdate(fake);
  assert.match(call.text, /"draft_status" = 'active'/);
  assert.match(call.text, /"draft_rounds" = \$/);
  assert.equal(call.params[1], 0, 'current_pick advances to the first open pick');
});

test('draft started: an all-keeper completion arms no clock', async (t) => {
  const fake = createFakePool([armingLeagueUpdate()]).install(t);

  const deadline = await withClient(fake, (client) =>
    pickClock.onDraftStarted(client, { leagueId: LEAGUE_ID, complete: true, currentPick: 30, rounds: 15 }));

  assert.equal(deadline, null, 'a draft that completes on keepers never arms a clock');
  assert.match(leagueUpdate(fake).text, /"draft_status" = 'complete'/);
});

// --- pick landed ------------------------------------------------------------

test('pick landed: a timed next team gets the full pick clock; the turn advances', async (t) => {
  const fake = createFakePool([armingLeagueUpdate()]).install(t);
  const league = { draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10 };

  const deadline = await withClient(fake, (client) =>
    pickClock.onPickLanded(client, {
      leagueId: LEAGUE_ID, nextPick: 4, draftStatus: 'active', draftComplete: false,
      nextTeam: { id: 12, autodraft: false }, league,
    }));

  assert.equal(deadline, armedAt(90));
  const call = leagueUpdate(fake);
  assert.equal(call.params[0], 4, 'current_pick advances');
  assert.equal(call.params[1], 'active');
});

test('pick landed: an autodrafting next team gets the short delay, not the full clock', async (t) => {
  const fake = createFakePool([armingLeagueUpdate()]).install(t);
  const league = { draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10 };

  const deadline = await withClient(fake, (client) =>
    pickClock.onPickLanded(client, {
      leagueId: LEAGUE_ID, nextPick: 4, draftStatus: 'active', draftComplete: false,
      nextTeam: { id: 12, autodraft: true }, league,
    }));

  assert.equal(deadline, armedAt(10));
});

test('pick landed: the completing pick arms no clock', async (t) => {
  const fake = createFakePool([armingLeagueUpdate()]).install(t);
  const league = { draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10 };

  const deadline = await withClient(fake, (client) =>
    pickClock.onPickLanded(client, {
      leagueId: LEAGUE_ID, nextPick: 30, draftStatus: 'complete', draftComplete: true,
      nextTeam: null, league,
    }));

  assert.equal(deadline, null);
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
  const fake = createFakePool([armingLeagueUpdate()]).install(t);
  const league = { draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 8 };

  const deadline = await withClient(fake, (client) => pickClock.onAutodraftToggled(client, { leagueId: LEAGUE_ID, league }));

  assert.equal(deadline, armedAt(8), 'the short delay, floored at one second');
});

test('autodraft toggled: an offline draft arms no clock, like the other events', async (t) => {
  // The toggle route reaches this with an active offline draft (no draft_type
  // guard on that path), so this event must apply the offline rule too - it does
  // not arm a divergent deadline where the five siblings arm none (#598 story 7).
  const fake = createFakePool([armingLeagueUpdate()]).install(t);
  const league = { draft_type: 'offline', pick_time_seconds: 90, autodraft_delay_seconds: 8 };

  const deadline = await withClient(fake, (client) => pickClock.onAutodraftToggled(client, { leagueId: LEAGUE_ID, league }));

  assert.equal(deadline, null, 'an offline draft never arms a clock');
});

// --- pick undone ------------------------------------------------------------

test('pick undone: the turn rewinds and the team now on the clock is re-armed by the policy', async (t) => {
  const fake = createFakePool([armingLeagueUpdate()]).install(t);
  const league = { draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10 };

  const deadline = await withClient(fake, (client) =>
    pickClock.onPickUndone(client, { leagueId: LEAGUE_ID, newCurrentPick: 2, onClockAutodraft: false, league }));

  assert.equal(deadline, armedAt(90));
  assert.equal(leagueUpdate(fake).params[0], 2, 'current_pick rewinds to the undone slot');
});

test('pick undone: rewinding onto an autodrafting team arms the short delay', async (t) => {
  const fake = createFakePool([armingLeagueUpdate()]).install(t);
  const league = { draft_type: 'snake', pick_time_seconds: 90, autodraft_delay_seconds: 10 };

  const deadline = await withClient(fake, (client) =>
    pickClock.onPickUndone(client, { leagueId: LEAGUE_ID, newCurrentPick: 2, onClockAutodraft: true, league }));

  assert.equal(deadline, armedAt(10));
});
