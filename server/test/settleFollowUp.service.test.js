const { test } = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const montecarlo = require('../services/montecarlo.service');
const recap = require('../services/recap.service');
const trophies = require('../services/trophy.service');
const digest = require('../services/digest.service');
const { settleFollowUp } = require('../services/settleFollowUp.service');
const { createFakePool } = require('./helpers/fakePool');

const ARGS = { leagueId: 7, season: 2026, week: 5 };

// Every step is stubbed at its module object and appends its name to one
// shared log, so the log IS the order the follow-up ran in.
function stubAll(t, { failing } = {}) {
  const order = [];
  const step = (label, mod, fn) =>
    t.mock.method(mod, fn, async (arg) => {
      order.push({ label, arg });
      if (failing === label) throw new Error(`${label} boom`);
      return {};
    });
  step('odds', montecarlo, 'computeLeagueOdds');
  step('generateWeeklyRecap', recap, 'generateWeeklyRecap');
  step('computeAndStoreWeeklyRecap', recap, 'computeAndStoreWeeklyRecap');
  step('awardWeeklyTrophies', trophies, 'awardWeeklyTrophies');
  step('reconcileWeeklyHighScoreTrophy', trophies, 'reconcileWeeklyHighScoreTrophy');
  step('sendWeeklyRecapDigest', digest, 'sendWeeklyRecapDigest');
  return order;
}

// #1854: the Recap narrates the week's trophies, so it reads the trophy rows
// the trophy step just wrote: trophies come before the Recap in both modes.
test('advance: odds, then every trophy, then the announced recap, then the digest', async (t) => {
  const order = stubAll(t);
  await settleFollowUp({ ...ARGS, mode: 'advance' });
  assert.deepEqual(
    order.map((o) => o.label),
    ['odds', 'awardWeeklyTrophies', 'generateWeeklyRecap', 'sendWeeklyRecapDigest']
  );
  assert.deepEqual(order[0].arg, { leagueId: 7 });
  for (const call of order.slice(1)) assert.deepEqual(call.arg, ARGS);
});

test('correction: odds, then the weekly high score reconcile, then the silent recap, no digest', async (t) => {
  const order = stubAll(t);
  await settleFollowUp({ ...ARGS, mode: 'correction' });
  assert.deepEqual(
    order.map((o) => o.label),
    ['odds', 'reconcileWeeklyHighScoreTrophy', 'computeAndStoreWeeklyRecap']
  );
  assert.deepEqual(order[1].arg, ARGS);
  assert.deepEqual(order[2].arg, ARGS);
});

for (const [mode, labels] of [
  ['advance', ['odds', 'awardWeeklyTrophies', 'generateWeeklyRecap', 'sendWeeklyRecapDigest']],
  ['correction', ['odds', 'reconcileWeeklyHighScoreTrophy', 'computeAndStoreWeeklyRecap']],
]) {
  for (const failing of labels) {
    test(`${mode}: ${failing} throwing is logged and the next step still runs`, async (t) => {
      const order = stubAll(t, { failing });
      const logs = [];
      t.mock.method(console, 'error', (...args) => { logs.push(args); });
      await settleFollowUp({ ...ARGS, mode });
      assert.deepEqual(order.map((o) => o.label), labels, 'every step still ran');
      assert.equal(logs.length, 1, 'the failure is logged once');
      assert.match(util.format(...logs[0]), /settle follow-up \((advance|correction)\): .* failed for league 7 week 5: .*boom/);
    });
  }
}

test('an unknown mode is refused before any step runs', async (t) => {
  const order = stubAll(t);
  await assert.rejects(settleFollowUp({ ...ARGS, mode: 'sideways' }), /mode/);
  assert.equal(order.length, 0);
});

// ---- #1860: Called shots through the real trophy and Recap steps ------------
//
// A stateful fake pool holds the league's `lineup_overrides` rows, so the
// judge's UPDATE is what the Recap's read then sees. Odds and the digest are
// stubbed; Hindsight is the one seam below the judge (it has its own suites).
const decisionSvc = require('../services/decision.service');

const shotRow = (over) => ({
  team_id: 10, team_name: 'Team A', called: true, probability: '0.65', outcome: 'pending',
  starter_player_id: 7, benched_player_id: 21, starter_name: 'Flex Guy', benched_name: 'Ben Bench',
  starter_points_actual: null, benched_points_actual: null, ...over,
});

function shotWorld(t, shots) {
  const stored = [];
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({
      rows: [{ id: 7, draft_status: 'complete', season_status: 'in_season', regular_season_weeks: 14, best_ball: false, scoring_rules: null }],
    })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [] }), 'client'],
    [/^SELECT \* FROM "matchups"/, () => ({ rows: [{ id: 1, final: true, home_team_id: 10, away_team_id: 20, home_score: 98, away_score: 110 }] })],
    [/^SELECT "id", "team_id", "data" FROM "trophies"/, () => ({ rows: [] }), 'client'],
    [/^SELECT "id", "team_id", "week"/, (text, params) => ({
      rows: shots.filter((s) => s.outcome === 'pending' && s.week <= params[2]),
    })],
    [/^UPDATE "lineup_overrides"/, (text, params) => {
      const s = shots.find((x) => x.id === params[0] && x.outcome === 'pending');
      if (!s) return { rows: [] };
      Object.assign(s, { outcome: params[1], starter_points_actual: params[2], benched_points_actual: params[3] });
      return { rows: [{ id: s.id }] };
    }],
    [/^SELECT "teams"\."name" AS "team_name".* FROM "lineup_overrides"/, (text, params) => ({
      rows: shots.filter((s) => s.week === params[2] && (s.outcome === 'hit' || s.outcome === 'miss')),
    })],
    [/^INSERT INTO "trophies"/, () => ({ rows: [{ id: 1 }] })],
    [/^SELECT "trophies"\."type"/, () => ({ rows: [] })],
    [/^SELECT "matchups"\.\*/, () => ({
      rows: [{ id: 1, final: true, home_team_id: 10, away_team_id: 20, home_team_name: 'Team A', away_team_name: 'Team B', home_score: 98, away_score: 110 }],
    })],
    [/^SELECT .* FROM "transactions"/, () => ({ rows: [] })],
    [/^SELECT "data" FROM "league_analytics"/, () => ({ rows: [] })],
    [/^INSERT INTO "league_analytics"/, (text, params) => { stored.push(JSON.parse(params[3])); return { rows: [] }; }],
    [/^SELECT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 1 }] })],
    [/^SELECT DISTINCT "owner_id"/, () => ({ rows: [] })],
    [/^INSERT INTO "(notifications|transactions)"/, () => ({ rows: [] })],
  ]);
  fake.install(t);
  const roster = {
    actualPoints: 98, optimalPoints: 98, pointsLeftOnBench: 0,
    counted: [
      { playerId: 7, name: 'Flex Guy', position: 'WR', slot: 'FLEX', points: 11.4, appeared: true },
      { playerId: 21, name: 'Ben Bench', position: 'WR', slot: 'BENCH', points: 6.2, appeared: true },
    ],
  };
  t.mock.method(decisionSvc, 'weekHindsightRoster', async () => roster);
  t.mock.method(decisionSvc, 'weekHindsight', async () => ({ pointsLeftOnBench: 0 }));
  t.mock.method(montecarlo, 'computeLeagueOdds', async () => ({}));
  t.mock.method(digest, 'sendWeeklyRecapDigest', async () => ({}));
  return { fake, stored };
}

const calledTrophies = (fake) => fake.matching(/^INSERT INTO "trophies"/).filter((c) => c.params[4] === 'called_shot');

test('#1860 advance: the week\'s shots are judged in the trophy step, before the Recap reads them', async (t) => {
  const shots = [shotRow({ id: 1, week: 5, team_id: 20, team_name: 'Team B', probability: '0.85' })];
  const { fake, stored } = shotWorld(t, shots);

  await settleFollowUp({ ...ARGS, mode: 'advance' });

  assert.equal(shots[0].outcome, 'hit');
  assert.deepEqual([shots[0].starter_points_actual, shots[0].benched_points_actual], [11.4, 6.2]);
  assert.equal(calledTrophies(fake).length, 1);
  assert.equal(JSON.parse(calledTrophies(fake)[0].params[6]).bold, true);
  assert.deepEqual(stored[0].facts.calledShots, [
    { team: 'Team B', starter: 'Flex Guy', benched: 'Ben Bench', starterPoints: 11.4, benchedPoints: 6.2, outcome: 'hit', bold: true },
  ]);
  assert.match(stored[0].narrative, /Team B called it: Flex Guy over Ben Bench, 11\.4 to 6\.2\. A bold call\./);
});

test('#1860 advance catch-up: week N advanced with a pending row in week N-1 judges it, writes its trophy under N-1, and gives it no Recap line', async (t) => {
  const shots = [shotRow({ id: 1, week: ARGS.week - 1 })];
  const { fake, stored } = shotWorld(t, shots);

  await settleFollowUp({ ...ARGS, mode: 'advance' });

  assert.equal(shots[0].outcome, 'hit');
  assert.deepEqual([shots[0].starter_points_actual, shots[0].benched_points_actual], [11.4, 6.2]);
  assert.equal(calledTrophies(fake).length, 1);
  assert.equal(calledTrophies(fake)[0].params[3], ARGS.week - 1, 'the hit is written under the shot\'s own week');
  assert.equal(stored.length, 1, 'week N\'s Recap was written');
  assert.equal('calledShots' in stored[0].facts, false, 'and carries no line for the week N-1 shot');
  assert.doesNotMatch(stored[0].narrative, /called/);
});

test('#1860 advance: a miss is narrated, a void is not, and neither writes a trophy', async (t) => {
  const shots = [
    shotRow({ id: 1, week: 5, team_id: 10 }),
    shotRow({ id: 2, week: 5, team_id: 20, team_name: 'Team B', starter_player_id: 99 }),
  ];
  const { fake, stored } = shotWorld(t, shots);
  decisionSvc.weekHindsightRoster.mock.mockImplementation(async ({ teamId }) => ({
    counted: [
      { playerId: 7, name: 'Flex Guy', position: 'WR', slot: 'FLEX', points: teamId === 10 ? 3 : 11.4, appeared: true },
      { playerId: 21, name: 'Ben Bench', position: 'WR', slot: 'BENCH', points: 6.2, appeared: true },
    ],
  }));

  await settleFollowUp({ ...ARGS, mode: 'advance' });

  assert.deepEqual(shots.map((s) => s.outcome), ['miss', 'void']);
  assert.equal(calledTrophies(fake).length, 0);
  assert.equal(stored[0].facts.calledShots.length, 1, 'the void adds no line');
  assert.match(stored[0].narrative, /Team A called Flex Guy over Ben Bench and missed, 3 to 6\.2\./);
});

test('#1860 advance twice: the second run judges nothing again and the trophy stays one', async (t) => {
  const shots = [shotRow({ id: 1, week: 5 })];
  const { fake } = shotWorld(t, shots);

  await settleFollowUp({ ...ARGS, mode: 'advance' });
  await settleFollowUp({ ...ARGS, mode: 'advance' });

  assert.equal(fake.matching(/^UPDATE "lineup_overrides"/).length, 1, 'a resolved row is never read as pending again');
});

test('#1860 correction: outcomes, trophies and the shot\'s Recap facts are left as judged', async (t) => {
  const shots = [shotRow({ id: 1, week: 5, outcome: 'hit', starter_points_actual: 11.4, benched_points_actual: 6.2 })];
  const { fake, stored } = shotWorld(t, shots);
  // A correction moved the live stat lines: nothing may be re-read from them.
  decisionSvc.weekHindsightRoster.mock.mockImplementation(async () => { throw new Error('a correction must not re-judge'); });

  await settleFollowUp({ ...ARGS, mode: 'correction' });

  assert.equal(fake.matching(/^UPDATE "lineup_overrides"/).length, 0);
  assert.equal(calledTrophies(fake).length, 0);
  assert.equal(shots[0].outcome, 'hit');
  assert.equal(stored[0].facts.calledShots[0].starterPoints, 11.4, 'the rebuilt Recap reads the frozen numbers');
});
