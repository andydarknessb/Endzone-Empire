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
  current_week: 1,
  regular_season_weeks: 1,
  waiver_period_hours: 24,
  best_ball: false,
};

const TWO_TEAMS = [{ id: 11 }, { id: 12 }];

/**
 * A world covering the whole completeDraft transaction on the caller's
 * client. `rosterByTeam` (teamId -> [{ player_id, position }]) answers the
 * lineup seed's per-team roster query; teams absent from it (or given no
 * `rosterByTeam` at all) have an empty roster, so `seedDraftedLineups` issues
 * its team_players read but writes nothing - the shape the three pre-#1569
 * tests below exercise unchanged.
 */
function completionPool(league, rosterByTeam = {}) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [{ ...league }] })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
    [update('teams'), () => ({ rows: [], rowCount: TWO_TEAMS.length })],
    [select('teams'), () => ({ rows: TWO_TEAMS.map((t) => ({ ...t })) })],
    // generateRegularSeason's per-week existing-schedule probe and its insert.
    [select('matchups'), () => ({ rows: [] })],
    [insert('matchups'), () => ({ rows: [], rowCount: 1 })],
    // #1569's lineup seed: each team's full post-draft roster.
    [select('team_players'), (text, params) => ({ rows: rosterByTeam[params[0]] || [] })],
    [insert('lineup_entries'), () => ({ rows: [], rowCount: 1 })],
    [insert('draft_activity'), () => ({
      rows: [{ id: 70, feed_seq: '5', created_at: '2026-09-01T00:00:00.000Z' }],
      rowCount: 1,
    })],
  ]);
}

// A 14-player roster shaped to fill DEFAULT_ROSTER_SLOTS' 9 starting seats
// (QB, RB x2, WR x2, TE, FLEX, K, DEF) with 5 left for BENCH, in an array
// order that pins `optimalLineup`'s greedy fill deterministically: every
// starting position's slot is satisfied by its first listed player before
// FLEX ever gets a look, so FLEX lands on the one extra RB placed right
// after the other starters. `base` offsets player ids so two teams' rosters
// never collide.
function fourteenPlayerRoster(base) {
  return [
    { player_id: base + 1, position: 'QB' },
    { player_id: base + 2, position: 'RB' },
    { player_id: base + 3, position: 'RB' },
    { player_id: base + 4, position: 'WR' },
    { player_id: base + 5, position: 'WR' },
    { player_id: base + 6, position: 'TE' },
    { player_id: base + 7, position: 'K' },
    { player_id: base + 8, position: 'DEF' },
    { player_id: base + 9, position: 'RB' }, // takes FLEX; RB/WR/TE starters are already spoken for
    { player_id: base + 10, position: 'WR' },
    { player_id: base + 11, position: 'RB' },
    { player_id: base + 12, position: 'TE' },
    { player_id: base + 13, position: 'QB' },
    { player_id: base + 14, position: 'DEF' },
  ];
}

const EXPECTED_STARTER_SLOTS = {
  1: 'QB',
  2: 'RB',
  3: 'RB',
  4: 'WR',
  5: 'WR',
  6: 'TE',
  7: 'K',
  8: 'DEF',
  9: 'FLEX',
};

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

test('completeDraft seeds waiver priority from reverse draft order, before the schedule', async (t) => {
  const fake = completionPool(COMPLETE_LEAGUE);
  const client = await fake.connect();

  await completeDraft(client, { leagueId: 1 });

  const seeds = fake.calls.filter((c) => update('teams').test(c.text));
  assert.equal(seeds.length, 1, 'one seed statement for the whole league');
  assert.ok(/"waiver_priority"/.test(seeds[0].text), 'it writes waiver_priority');
  assert.ok(
    /ROW_NUMBER\(\) OVER \(ORDER BY "draft_position" DESC NULLS LAST, "id" DESC\)/.test(seeds[0].text),
    'ranked by reverse draft order: the last pick claims first'
  );
  assert.deepEqual(seeds[0].params, [1], 'scoped to the league');

  const seedAt = fake.calls.findIndex((c) => update('teams').test(c.text));
  const scheduledAt = fake.calls.findIndex((c) => insert('matchups').test(c.text));
  assert.ok(seedAt < scheduledAt, 'the order exists before the season is scheduled');
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
  assert.equal(fake.calls.filter((c) => update('teams').test(c.text)).length, 0);
  assert.equal(fake.calls.filter((c) => insert('matchups').test(c.text)).length, 0);
  assert.equal(fake.calls.filter((c) => insert('draft_activity').test(c.text)).length, 0);
});

test('completeDraft seeds every team a legal lineup over its full roster, after the schedule and before the completion activity (#1569)', async (t) => {
  const rosterByTeam = { 11: fourteenPlayerRoster(100), 12: fourteenPlayerRoster(200) };
  const fake = completionPool(COMPLETE_LEAGUE, rosterByTeam);
  const client = await fake.connect();

  await completeDraft(client, { leagueId: 1 });

  const writes = fake.calls.filter((c) => insert('lineup_entries').test(c.text));
  assert.equal(writes.length, 28, 'one write per rostered player across both 14-player teams');

  for (const [teamId, roster] of Object.entries(rosterByTeam)) {
    const base = teamId === '11' ? 100 : 200;
    const teamWrites = writes.filter((c) => c.params[1] === Number(teamId));
    assert.equal(teamWrites.length, roster.length, `every rostered player on team ${teamId} got a write`);

    const slotByPlayer = new Map(teamWrites.map((c) => [c.params[2] - base, c.params[5]]));
    for (const [offset, slot] of Object.entries(EXPECTED_STARTER_SLOTS)) {
      assert.equal(slotByPlayer.get(Number(offset)), slot, `player ${offset} starts at ${slot}`);
    }
    for (let offset = 10; offset <= 14; offset++) {
      assert.equal(slotByPlayer.get(offset), 'BENCH', `player ${offset} sits on BENCH`);
    }

    // league_id, season, week and ir_attested are consistent across every write.
    for (const call of teamWrites) {
      assert.equal(call.params[0], COMPLETE_LEAGUE.id, 'league_id');
      assert.equal(call.params[3], COMPLETE_LEAGUE.current_season, 'season');
      assert.equal(call.params[4], COMPLETE_LEAGUE.current_week, 'week');
      assert.ok(/"ir_attested"\)\s+VALUES \([^)]*, false\)/.test(call.text), 'ir_attested is false');
      // The ruling's whole point: this OVERWRITES a rostered player's
      // draft-time row on conflict. Red-tell: swap this to the DO NOTHING
      // `materializeLineup`'s own first-ever seed uses beside it, and every
      // drafted team keeps its one-starter/13-BENCH per-pick rows exactly as
      // the #1569 defect left them - the seed INSERT hits the existing
      // (team_id, season, week, player_id) row and is silently discarded.
      assert.match(
        call.text,
        /ON CONFLICT \("team_id", "season", "week", "player_id"\) DO UPDATE SET "slot" = EXCLUDED\."slot", "ir_attested" = false/,
        'the upsert overwrites slot and ir_attested on conflict, not DO NOTHING'
      );
    }
  }

  const scheduledAt = fake.calls.findIndex((c) => insert('matchups').test(c.text));
  const firstSeedAt = fake.calls.findIndex((c) => insert('lineup_entries').test(c.text));
  const lastSeedAt = fake.calls.length - 1 - [...fake.calls].reverse().findIndex((c) => insert('lineup_entries').test(c.text));
  const activityAt = fake.calls.findIndex((c) => insert('draft_activity').test(c.text));
  assert.ok(scheduledAt < firstSeedAt, 'the lineup seed runs after the schedule is generated');
  assert.ok(lastSeedAt < activityAt, 'the lineup seed runs before the completion activity');
});

test('completeDraft writes no lineup_entries for a best-ball league (#1569)', async (t) => {
  const league = { ...COMPLETE_LEAGUE, best_ball: true };
  const rosterByTeam = { 11: fourteenPlayerRoster(100), 12: fourteenPlayerRoster(200) };
  const fake = completionPool(league, rosterByTeam);
  const client = await fake.connect();

  await completeDraft(client, { leagueId: 1 });

  assert.equal(
    fake.calls.filter((c) => insert('lineup_entries').test(c.text)).length,
    0,
    'best ball scores server-side and never reads a starting slot'
  );
  assert.equal(
    fake.calls.filter((c) => select('team_players').test(c.text)).length,
    0,
    'a best-ball league never even reads a roster to seed'
  );
});
