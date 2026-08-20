const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert } = require('./helpers/fakePool');
const { longestWinStreak, comebackTeam } = require('../services/trophy.service');
const { gradeTeams } = require('../services/draftgrade.service');
const { lineupProblems, sendLineupReminders } = require('../services/digest.service');
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

// --- digest: lineupProblems --------------------------------------------------

const entry = (slot, name, overrides = {}) => ({
  slot, name, onBye: false, injury_status: null, ...overrides,
});

const slots = (counts) => Object.entries(counts).map(([key, count]) => ({ key, count, eligiblePositions: [key] }));

test('lineupProblems flags empty starting slots against the league config', () => {
  const problems = lineupProblems([entry('QB', 'QB1')], slots({ QB: 1, RB: 2 }));
  assert.deepEqual(problems, ['2 empty RB slots']);
});

test('lineupProblems flags bye and Out/IR starters but ignores the bench', () => {
  const problems = lineupProblems(
    [
      entry('QB', 'Healthy QB'),
      entry('RB', 'Bye RB', { onBye: true }),
      entry('WR', 'Hurt WR', { injury_status: 'O' }),
      entry('BENCH', 'Hurt Bench Guy', { injury_status: 'IR' }),
    ],
    slots({ QB: 1, RB: 1, WR: 1 })
  );
  assert.deepEqual(problems, ['Bye RB (RB) is on bye', 'Hurt WR (WR) is Out']);
});

test('lineupProblems: questionable players do not trigger, clean lineup is empty', () => {
  const problems = lineupProblems(
    [entry('QB', 'Q Guy', { injury_status: 'Q' })],
    slots({ QB: 1 })
  );
  assert.deepEqual(problems, []);
});

test('lineupProblems resurfaces an unresolved ineligible IR stash before kickoff', () => {
  const problems = lineupProblems(
    [
      entry('QB', 'Healthy QB'),
      entry('IR', 'Test Runner', { injury_status: 'Q' }),
    ],
    slots({ QB: 1 })
  );

  assert.deepEqual(problems, [
    'Test Runner (IR) is no longer IR-eligible (questionable)',
  ]);
});

test('lineupProblems never resurfaces a commissioner-attested stash (#100)', () => {
  const problems = lineupProblems(
    [
      entry('QB', 'Healthy QB'),
      entry('IR', 'Attested Runner', { injury_status: 'Q', ir_attested: true }),
    ],
    slots({ QB: 1 })
  );

  assert.deepEqual(problems, []);
});

test('sendLineupReminders carries forward an unresolved IR stash before checking it', async (t) => {
  let materialized = false;
  const fake = createFakePool([
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
    [/^SELECT "teams"\."id"/, () => ({ rows: [{
      id: 601,
      name: 'Carry Forward',
      owner_id: 701,
      email: 'manager@example.test',
    }] })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({ rows: [] })],
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
