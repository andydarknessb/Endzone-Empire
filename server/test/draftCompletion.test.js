const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const { completeDraft } = require('../services/draftCompletion');

// draftCompletion.completeDraft is the ONE writer of the draft->season handoff
// (#789), called from the completing Pick (pick.service) and the all-keeper
// start (draftStart.service) on the caller's transaction, AFTER the clock has
// flipped draft_status to 'complete'. These tests drive it directly against a
// fakePool: the happy path pins the single waiver-window spelling, the order of
// the three side effects, and the completion entry; the guard proves it refuses
// a league whose flip has not happened and writes nothing.

const COMPLETE_LEAGUE = {
  id: 1,
  draft_status: 'complete',
  current_season: 2026,
  regular_season_weeks: 1,
  waiver_period_hours: 24,
};

const TWO_TEAMS = [{ id: 11 }, { id: 12 }];

/** A world covering the whole completeDraft transaction on the caller's client. */
function completionPool(league) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [{ ...league }] })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
    [select('teams'), () => ({ rows: TWO_TEAMS.map((t) => ({ ...t })) })],
    // generateRegularSeason's per-week existing-schedule probe and its insert.
    [select('matchups'), () => ({ rows: [] })],
    [insert('matchups'), () => ({ rows: [], rowCount: 1 })],
    [insert('draft_activity'), () => ({
      rows: [{ id: 70, feed_seq: '5', created_at: '2026-09-01T00:00:00.000Z' }],
      rowCount: 1,
    })],
  ]);
}

test('completeDraft opens the waiver window, schedules the season, then appends complete, in that order (#789 AC1)', async (t) => {
  const fake = completionPool(COMPLETE_LEAGUE);
  const client = await fake.connect();

  const entry = await completeDraft(client, { leagueId: 1 });

  // Exactly one waiver-window write, in the one spelling: column-based, so the
  // interval reads "waiver_period_hours" off the row and binds no hours param.
  const waiverWrites = fake.calls.filter(
    (c) => update('leagues').test(c.text) && /"waivers_clear_at"/.test(c.text)
  );
  assert.equal(waiverWrites.length, 1, 'exactly one waivers_clear_at UPDATE');
  assert.ok(/"waiver_period_hours"/.test(waiverWrites[0].text), 'column-based interval');
  assert.ok(
    !/make_interval\(hours => \$/.test(waiverWrites[0].text),
    'no bound $ parameter for the hours'
  );
  assert.deepEqual(waiverWrites[0].params, [1], 'the leagueId is the only bound param');

  // The three side effects run in order: waiver window, season schedule, activity.
  const waiverAt = fake.calls.findIndex(
    (c) => update('leagues').test(c.text) && /"waivers_clear_at"/.test(c.text)
  );
  const scheduledAt = fake.calls.findIndex((c) => insert('matchups').test(c.text));
  const activityAt = fake.calls.findIndex((c) => insert('draft_activity').test(c.text));
  assert.notEqual(scheduledAt, -1, 'the season schedule was generated');
  assert.notEqual(activityAt, -1, 'the completion activity was appended');
  assert.ok(waiverAt < scheduledAt, 'the waiver window opens before the schedule');
  // Swapping schedule and activity in the module turns this red.
  assert.ok(scheduledAt < activityAt, 'the schedule is generated before the completion activity');

  // Exactly one completion activity, an actor-less state transition.
  const activityWrites = fake.calls.filter((c) => insert('draft_activity').test(c.text));
  assert.equal(activityWrites.length, 1, 'one draft_activity insert');
  assert.equal(activityWrites[0].params[1], 'complete', 'kind complete');
  assert.equal(activityWrites[0].params[2], null, 'no team_id');
  assert.equal(activityWrites[0].params[3], null, 'no team_name');

  // The completion entry is returned for the caller to broadcast after COMMIT.
  assert.equal(entry.kind, 'complete');
});

test('completeDraft refuses a league whose status flip has not happened, and writes nothing (#789 AC1)', async (t) => {
  const fake = completionPool({ ...COMPLETE_LEAGUE, draft_status: 'active' });
  const client = await fake.connect();

  await assert.rejects(
    () => completeDraft(client, { leagueId: 1 }),
    (err) => {
      assert.equal(err.statusCode, 500, 'a 500: the caller broke the flip-first precondition');
      assert.match(err.message, /complete/, 'the message names the precondition');
      return true;
    }
  );

  // It threw before any write: only the precondition read ran.
  assert.equal(fake.calls.filter((c) => update('leagues').test(c.text)).length, 0);
  assert.equal(fake.calls.filter((c) => insert('matchups').test(c.text)).length, 0);
  assert.equal(fake.calls.filter((c) => insert('draft_activity').test(c.text)).length, 0);
});
