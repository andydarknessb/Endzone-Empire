const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert } = require('./helpers/fakePool');
const { longestWinStreak, comebackTeam } = require('../services/trophy.service');
const { gradeTeams } = require('../services/draftgrade.service');
const { sendLineupReminders, sendPickemReminders } = require('../services/digest.service');
const { mergePrefs, validatePrefs, DEFAULT_PREFS } = require('../services/prefs.service');
const push = require('../services/push.service');

// --- trophy: longestWinStreak -----------------------------------------------

test('longestWinStreak finds runs in the middle and at the end', () => {
  assert.equal(longestWinStreak(['L', 'W', 'W', 'W', 'L', 'W']), 3);
  assert.equal(longestWinStreak(['L', 'L', 'W', 'W']), 2);
});

test('longestWinStreak: ties break streaks, empty list is 0', () => {
  assert.equal(longestWinStreak(['W', 'T', 'W']), 1);
  assert.equal(longestWinStreak([]), 0);
});

// --- trophy: comebackTeam ----------------------------------------------------

const standing = (teamId, winPct) => ({ teamId, winPct });

test('comebackTeam picks the qualifier with the worst midpoint record', () => {
  const mid = [standing(1, 0.8), standing(2, 0.25), standing(3, 0.4)];
  const result = comebackTeam(mid, new Set([1, 2, 3]));
  assert.equal(result.teamId, 2);
});

test('comebackTeam ignores non-qualifiers and requires sub-.500 midpoint', () => {
  const mid = [standing(1, 0.75), standing(2, 0.1), standing(3, 0.6)];
  // Team 2 (worst) missed the playoffs; remaining qualifiers were above .500
  assert.equal(comebackTeam(mid, new Set([1, 3])), null);
});

// --- draft grades: gradeTeams ------------------------------------------------

test('gradeTeams letters follow the z-score thresholds', () => {
  // Values chosen so z-scores hit each band: mean 100, stddev 10
  const teams = [
    { teamId: 1, name: 'A', rosterValue: 115 }, // z = 1.5  -> A
    { teamId: 2, name: 'B', rosterValue: 105 }, // z = 0.5  -> B
    { teamId: 3, name: 'C', rosterValue: 100 }, // z = 0    -> C
    { teamId: 4, name: 'D', rosterValue: 95 },  // z = -0.5 -> D
    { teamId: 5, name: 'F', rosterValue: 85 },  // z = -1.5 -> F
  ];
  const graded = gradeTeams(teams);
  const byId = new Map(graded.map((g) => [g.teamId, g]));
  assert.equal(byId.get(1).grade, 'A');
  assert.equal(byId.get(2).grade, 'B');
  assert.equal(byId.get(3).grade, 'C');
  assert.equal(byId.get(4).grade, 'D');
  assert.equal(byId.get(5).grade, 'F');
  assert.deepEqual(graded.map((g) => g.rank), [1, 2, 3, 4, 5]);
  assert.equal(graded[0].teamId, 1); // sorted best-first
});

test('gradeTeams: identical values grade everyone B; empty input is empty', () => {
  const graded = gradeTeams([
    { teamId: 1, name: 'A', rosterValue: 100 },
    { teamId: 2, name: 'B', rosterValue: 100 },
  ]);
  assert.ok(graded.every((g) => g.grade === 'B'));
  assert.deepEqual(gradeTeams([]), []);
});

// --- digest: the pre-lockout reminders -----------------------------------------

test('sendLineupReminders carries forward an unresolved IR stash before checking it', async (t) => {
  let materialized = false;
  const fake = createFakePool([
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{
      id: 501,
      current_season: 2026,
      current_week: 9,
      best_ball: false,
      roster_slots: [],
      bench_slots: 1,
      ir_slots: 1,
    }] })],
    [/^SELECT 1 FROM "nfl_games"/, () => ({ rows: [{ exists: 1 }] })],
    [/^SELECT "nfl_games"\."season"/, () => ({ rows: [] })], // the week's kickoffs: none locked
    [/^SELECT "teams"\."id"/, () => ({ rows: [{
      id: 601,
      name: 'Carry Forward',
      owner_id: 701,
      email: 'manager@example.test',
    }] })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({ rows: [] })],
    // The push_events ledger: every user's row is new.
    [/^INSERT INTO "push_events"/, (text, params) => ({ rows: params[0].map((user_id) => ({ user_id })) })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: [{ player_id: 801, position: 'RB' }],
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({ rows: [] })],
    [/^SELECT "player_id", "slot", "ir_attested" FROM "lineup_entries"/, () => ({
      rows: [{ player_id: 801, slot: 'IR', ir_attested: false }],
    })],
    [insert('lineup_entries'), (text, params) => {
      assert.equal(params[5], 'IR');
      assert.equal(params[6], false);
      materialized = true;
      return { rows: [] };
    }],
    [/^SELECT "lineup_entries"\."slot"/, () => ({
      rows: materialized ? [{
        slot: 'IR',
        name: 'Recovered Runner',
        injury_status: 'Q',
        ir_attested: false,
        on_bye: false,
      }] : [],
    })],
    [insert('notifications'), () => ({ rows: [] })],
  ]).install(t);
  const pushes = [];
  t.mock.method(push, 'sendPushToUsers', async (userIds, payload) => {
    pushes.push({ userIds, payload });
    return { sent: 1 };
  });

  const result = await sendLineupReminders();

  assert.deepEqual(result, { remindersSent: 1 });
  assert.equal(materialized, true);
  assert.deepEqual(pushes[0].userIds, [701]);
  assert.match(pushes[0].payload.body, /Recovered Runner \(IR\) is no longer IR-eligible \(questionable\)/);
  fake.assertClean();
});

test('sendLineupReminders ignores a dropped player left in lineup history', async (t) => {
  const fake = createFakePool([
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{
      id: 502,
      current_season: 2026,
      current_week: 10,
      best_ball: false,
      roster_slots: [],
      bench_slots: 1,
      ir_slots: 1,
    }] })],
    [/^SELECT 1 FROM "nfl_games"/, () => ({ rows: [{ exists: 1 }] })],
    [/^SELECT "nfl_games"\."season"/, () => ({ rows: [] })], // the week's kickoffs: none locked
    [/^SELECT "teams"\."id"/, () => ({ rows: [{
      id: 602,
      name: 'Drop Resolved',
      owner_id: 702,
      email: 'manager@example.test',
    }] })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({ rows: [] })],
    // The push_events ledger: every user's row is new.
    [/^INSERT INTO "push_events"/, (text, params) => ({ rows: params[0].map((user_id) => ({ user_id })) })],
    [/^SELECT "team_players"\."player_id"/, () => ({ rows: [] })],
    [/^SELECT "lineup_entries"\."slot"/, (text) => ({
      rows: text.includes('JOIN "team_players"') ? [] : [{
        slot: 'IR',
        name: 'Dropped Runner',
        injury_status: 'Q',
        on_bye: false,
      }],
    })],
  ]).install(t);
  const pushes = [];
  t.mock.method(push, 'sendPushToUsers', async (...args) => {
    pushes.push(args);
    return { sent: 1 };
  });

  const result = await sendLineupReminders();

  assert.deepEqual(result, { remindersSent: 0 });
  assert.deepEqual(pushes, []);
  fake.assertClean();
});

test('sendLineupReminders sends best-ball teams only the unresolved IR warning', async (t) => {
  const bestBallLeague = {
    id: 503,
    current_season: 2026,
    current_week: 9,
    best_ball: true,
    roster_slots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }],
    bench_slots: 5,
    ir_slots: 1,
  };
  const fake = createFakePool([
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, (text) => ({
      rows: text.includes('"best_ball" = false') ? [] : [bestBallLeague],
    })],
    [/^SELECT 1 FROM "nfl_games"/, () => ({ rows: [{ exists: 1 }] })],
    [/^SELECT "nfl_games"\."season"/, () => ({ rows: [] })], // the week's kickoffs: none locked
    [/^SELECT "teams"\."id"/, () => ({ rows: [{
      id: 603,
      name: 'Best Ball Recovery',
      owner_id: 703,
      email: 'best-ball@example.test',
    }] })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({ rows: [] })],
    // The push_events ledger: every user's row is new.
    [/^INSERT INTO "push_events"/, (text, params) => ({ rows: params[0].map((user_id) => ({ user_id })) })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: [{ player_id: 803, position: 'QB' }],
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: [{ player_id: 803 }],
    })],
    [/^SELECT "lineup_entries"\."slot"/, () => ({ rows: [{
      slot: 'IR',
      name: 'Recovered Best Ball Player',
      injury_status: 'Q',
      on_bye: false,
    }] })],
    [insert('notifications'), () => ({ rows: [] })],
  ]).install(t);
  const pushes = [];
  t.mock.method(push, 'sendPushToUsers', async (userIds, payload) => {
    pushes.push({ userIds, payload });
    return { sent: 1 };
  });

  const result = await sendLineupReminders();

  assert.deepEqual(result, { remindersSent: 1 });
  assert.deepEqual(pushes.map(({ payload }) => payload.body), [
    'Lineup check for week 9: Recovered Best Ball Player (IR) is no longer IR-eligible (questionable)',
  ]);
  fake.assertClean();
});

// --- reminders read the Home statuses (#1761) ---------------------------------

const HOUR = 60 * 60 * 1000;
const hoursFromNow = (h) => new Date(Date.now() + h * HOUR).toISOString();

// One live league, its teams, and a lineup that is already materialized. The
// week's kickoffs answer `kickoffRows`; `kickoffReads` records each read.
let nextTeamId = 6100;
function lineupReminderWorld(t, { entries, kickoffRows, teamCount = 1 }) {
  const kickoffReads = [];
  const ledger = new Set();
  const teams = Array.from({ length: teamCount }, (_, i) => ({
    id: nextTeamId + i, name: `Team ${i}`, owner_id: nextTeamId + 1000 + i, email: `manager${i}@example.test`,
  }));
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{
      id: 510,
      current_season: 2026,
      current_week: 9,
      best_ball: false,
      roster_slots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }, { key: 'WR', count: 1, eligiblePositions: ['WR'] }],
      bench_slots: 1,
      ir_slots: 1,
    }] })],
    [/^SELECT 1 FROM "nfl_games"/, () => ({ rows: [{ exists: 1 }] })],
    [/^SELECT "nfl_games"\."season"/, (text, params) => {
      kickoffReads.push(params);
      return { rows: kickoffRows };
    }],
    [/^SELECT "teams"\."id"/, () => ({ rows: teams })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({ rows: [] })],
    // The push_events unique index: a (user, kind, subject, fingerprint) goes in once.
    [/^INSERT INTO "push_events"/, (text, [userIds, ...key]) => ({
      rows: userIds
        .filter((id) => !ledger.has([id, ...key].join('|')) && ledger.add([id, ...key].join('|')))
        .map((user_id) => ({ user_id })),
    })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map((e, i) => ({ player_id: 900 + i, position: e.slot })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: entries.map((e, i) => ({ player_id: 900 + i })),
    })],
    [/^SELECT "lineup_entries"\."slot"/, () => ({ rows: entries })],
    [insert('notifications'), () => ({ rows: [] })],
  ]).install(t);
  const pushes = [];
  t.mock.method(push, 'sendPushToUsers', async (userIds, payload) => {
    pushes.push({ userIds, payload });
    return { sent: 1 };
  });
  nextTeamId += 10;
  return { fake, pushes, kickoffReads };
}

const lineupRow = (slot, name, nflTeam, extra = {}) => ({
  slot, name, nfl_team: nflTeam, injury_status: null, ir_attested: false, on_bye: false, ...extra,
});
const kickoff = (nflTeam, at) => ({ season: 2026, week: 9, nfl_team: nflTeam, kickoff_at: at });

test('sendLineupReminders does not name a starter who is Out once his game has kicked off', async (t) => {
  const { fake, pushes } = lineupReminderWorld(t, {
    entries: [
      lineupRow('QB', 'Locked Out QB', 'KC', { injury_status: 'O' }),
      lineupRow('WR', 'Open Out WR', 'GB', { injury_status: 'O' }),
    ],
    kickoffRows: [kickoff('KC', hoursFromNow(-1)), kickoff('GB', hoursFromNow(1))],
  });

  const result = await sendLineupReminders();

  assert.deepEqual(result, { remindersSent: 1 });
  assert.equal(pushes[0].payload.body, 'Lineup check for week 9: Open Out WR (WR) is Out');
  fake.assertClean();
});

test('sendLineupReminders names a Practice squad starter and a No NFL team starter (#1791)', async (t) => {
  const { fake, pushes } = lineupReminderWorld(t, {
    entries: [
      lineupRow('QB', 'PS Quarterback', 'KC', {
        nfl_roster_status: { status: 'practice_squad', capturedAt: new Date().toISOString() },
      }),
      lineupRow('WR', 'Free Agent WR', null),
    ],
    kickoffRows: [kickoff('KC', hoursFromNow(2))], // not kicked off yet
  });

  const result = await sendLineupReminders();

  assert.deepEqual(result, { remindersSent: 1 });
  assert.equal(
    pushes[0].payload.body,
    'Lineup check for week 9: PS Quarterback (QB) is on the practice squad; Free Agent WR (WR) has no NFL team'
  );
  fake.assertClean();
});

// #1791 QA: the reminder's own entries query keys on_bye off the same
// fn_normalize_nfl_team(players.nfl_team) = fn_normalize_nfl_team(nfl_games.nfl_team)
// LEFT JOIN as loadLineups. fn_normalize_nfl_team(NULL) is NULL, so a No NFL
// team row's join never matches and on_bye would read true (bye, wrongly)
// without the `players.nfl_team IS NOT NULL` guard - asserted on the actual
// SQL text sent, so reverting the guard goes red even though the mocked rows
// above never carry the pre-fix shape.
test("sendLineupReminders' entries query guards a No NFL team row from reading as on_bye (#1791)", async (t) => {
  const { fake } = lineupReminderWorld(t, {
    entries: [lineupRow('QB', 'Fine QB', 'KC')],
    kickoffRows: [],
  });

  await sendLineupReminders();

  const [entriesQuery] = fake.matching(/^SELECT "lineup_entries"\."slot"/);
  assert.ok(entriesQuery, 'the reminder entries query never ran');
  assert.match(
    entriesQuery.text,
    /\("players"\."nfl_team" IS NOT NULL AND "nfl_games"\."nfl_team" IS NULL\) AS "on_bye"/
  );
});

test('sendLineupReminders sends nothing when the only problem is a starter whose game has kicked off', async (t) => {
  const { fake, pushes } = lineupReminderWorld(t, {
    entries: [
      lineupRow('QB', 'Locked Out QB', 'KC', { injury_status: 'O' }),
      lineupRow('WR', 'Fine WR', 'GB'),
    ],
    kickoffRows: [kickoff('KC', hoursFromNow(-1)), kickoff('GB', hoursFromNow(1))],
  });

  const result = await sendLineupReminders();

  assert.deepEqual(result, { remindersSent: 0 });
  assert.deepEqual(pushes, []);
  fake.assertClean();
});

test('sendLineupReminders sends nothing once the week\'s last kickoff has passed', async (t) => {
  const { fake, pushes } = lineupReminderWorld(t, {
    // An empty WR seat and an Out QB: both problems before the last kickoff,
    // neither after it.
    entries: [lineupRow('QB', 'Out QB', 'KC', { injury_status: 'O' })],
    kickoffRows: [kickoff('KC', hoursFromNow(-3)), kickoff('GB', hoursFromNow(-1))],
  });

  const result = await sendLineupReminders();

  assert.deepEqual(result, { remindersSent: 0 });
  assert.deepEqual(pushes, []);
  fake.assertClean();
});

test('sendLineupReminders reminds a team-week once across two calls, held by the ledger', async (t) => {
  const { fake, pushes } = lineupReminderWorld(t, {
    entries: [lineupRow('QB', 'Open Out QB', 'GB', { injury_status: 'O' }), lineupRow('WR', 'Fine WR', 'GB')],
    kickoffRows: [kickoff('GB', hoursFromNow(1))],
  });

  assert.deepEqual(await sendLineupReminders(), { remindersSent: 1 });
  assert.deepEqual(await sendLineupReminders(), { remindersSent: 0 }); // the ledger returns no new row

  assert.equal(pushes.length, 1);
  assert.equal(fake.matching(insert('notifications')).length, 1);
  const [ledgerWrite] = fake.matching(insert('push_events'));
  assert.equal(ledgerWrite.params[1], 'lineup-reminder');
  assert.match(ledgerWrite.params[2], /^[0-9]+:2026:9$/);
  assert.equal(ledgerWrite.params[3], 'sent');
  fake.assertClean();
});

test('sendLineupReminders reads the week\'s kickoffs once per league and week, not per Team', async (t) => {
  const { fake, pushes, kickoffReads } = lineupReminderWorld(t, {
    entries: [lineupRow('QB', 'Open Out QB', 'GB', { injury_status: 'O' }), lineupRow('WR', 'Fine WR', 'GB')],
    kickoffRows: [kickoff('GB', hoursFromNow(1))],
    teamCount: 3,
  });

  const result = await sendLineupReminders();

  assert.deepEqual(result, { remindersSent: 3 });
  assert.equal(pushes.length, 3);
  assert.equal(kickoffReads.length, 1);
  assert.deepEqual(kickoffReads[0], [[2026], [9]]);
  fake.assertClean();
});

test('sendPickemReminders reminds a member about the open games they missed, not the locked ones', async (t) => {
  const pickem = require('../services/pickem.service');
  const slate = [
    { gameKey: 'BUF|MIA', kickoffAt: hoursFromNow(-1) }, // locked
    { gameKey: 'KC|LV', kickoffAt: hoursFromNow(1) },
    { gameKey: 'GB|MIN', kickoffAt: hoursFromNow(2) },
  ];
  t.mock.method(pickem, 'getWeekSlate', async () => slate);
  const fake = createFakePool([
    [/^SELECT "leagues"\."id", "leagues"\."name"/, () => ({ rows: [{ id: 520, name: 'Pick League', season: 2026, week: 9 }] })],
    [/^SELECT 1 FROM "nfl_games"/, () => ({ rows: [{ exists: 1 }] })],
    [/^SELECT "teams"\."owner_id", "users"\."email"/, () => ({ rows: [
      { owner_id: 721, email: 'missing@example.test' },
      { owner_id: 722, email: 'done@example.test' },
    ] })],
    [/^SELECT "user_id", "team_pair" FROM "pickem_picks"/, () => ({ rows: [
      // 721 picked one open game (and none of the locked one); 722 picked both open games.
      { user_id: 721, team_pair: 'KC|LV' },
      { user_id: 722, team_pair: 'KC|LV' },
      { user_id: 722, team_pair: 'GB|MIN' },
    ] })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
  ]).install(t);
  const pushes = [];
  t.mock.method(push, 'sendPushToUsers', async (userIds, payload) => {
    pushes.push({ userIds, payload });
    return { sent: 1 };
  });

  const result = await sendPickemReminders();

  assert.deepEqual(result, { remindersSent: 1 });
  assert.deepEqual(pushes.map((p) => p.userIds), [[721]]);
  assert.equal(pushes[0].payload.body, "Week 9 Pick'em: 1 game still unpicked before kickoff.");
  fake.assertClean();
});

// --- prefs -------------------------------------------------------------------

test('mergePrefs fills defaults and respects stored overrides', () => {
  assert.deepEqual(mergePrefs(undefined), DEFAULT_PREFS);
  const merged = mergePrefs({ weeklyRecap: false, junk: true, lineupReminder: 'yes' });
  assert.equal(merged.weeklyRecap, false);
  assert.equal(merged.lineupReminder, true); // non-boolean stored value ignored
  assert.equal('junk' in merged, false);
});

test('validatePrefs rejects unknown keys, non-booleans, and non-objects', () => {
  assert.deepEqual(validatePrefs({ weeklyRecap: false }), []);
  assert.equal(validatePrefs({ bogus: true }).length, 1);
  assert.equal(validatePrefs({ weeklyRecap: 'nope' }).length, 1);
  assert.equal(validatePrefs(null).length, 1);
  assert.equal(validatePrefs([true]).length, 1);
});

test('irAlerts is an opt-out preference that defaults on', () => {
  assert.equal(mergePrefs(undefined).irAlerts, true);
  assert.equal(mergePrefs({ irAlerts: false }).irAlerts, false);
  assert.deepEqual(validatePrefs({ irAlerts: false }), []);
});

test('injuryAlerts and scoreUpdates are opt-out preferences that default on', () => {
  for (const key of ['injuryAlerts', 'scoreUpdates']) {
    assert.equal(mergePrefs(undefined)[key], true);
    assert.equal(mergePrefs({ [key]: false })[key], false);
    assert.deepEqual(validatePrefs({ [key]: false }), []);
  }
});
