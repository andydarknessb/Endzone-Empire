const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, update } = require('./helpers/fakePool');
const { finalizeWeekAndAdvance } = require('../services/season.service');
const lineupService = require('../services/lineup.service');

/**
 * The week advance gives every team in a matchup of the week that just
 * opened its lineup rows, so an expected final exists for it from the
 * moment the week opens rather than from the first score sync. Best-effort
 * and after the advance commits: a seed failure logs, it never undoes the
 * advance.
 */

const LEAGUE = {
  id: 1,
  draft_status: 'complete',
  season_status: 'regular',
  current_season: 2026,
  current_week: 3,
  regular_season_weeks: 14,
  playoff_teams: 4,
  playoff_consolation: false,
  best_ball: false,
};
const TEAMS = [{ id: 11, name: 'A', owner_id: 1 }, { id: 12, name: 'B', owner_id: 2 }, { id: 13, name: 'C', owner_id: 3 }, { id: 14, name: 'D', owner_id: 4 }];
const WEEK_3 = [
  { id: 31, league_id: 1, season: 2026, week: 3, home_team_id: 11, away_team_id: 12, home_score: '90', away_score: '80', final: false, is_playoff: false },
  { id: 32, league_id: 1, season: 2026, week: 3, home_team_id: 13, away_team_id: 14, home_score: '70', away_score: '75', final: false, is_playoff: false },
];
const WEEK_4 = [
  { id: 41, league_id: 1, season: 2026, week: 4, home_team_id: 11, away_team_id: 13, final: false, is_playoff: false },
  { id: 42, league_id: 1, season: 2026, week: 4, home_team_id: 12, away_team_id: 14, final: false, is_playoff: false },
];

function advancePool() {
  return createFakePool([
    [select('leagues'), () => ({ rows: [{ ...LEAGUE }] })],
    [select('teams'), () => ({ rows: TEAMS })],
    [select('matchups'), (text, params) => {
      const week = params.length >= 3 ? Number(params[2]) : null;
      if (week === 3) return { rows: WEEK_3 };
      if (week === 4) return { rows: WEEK_4 };
      return { rows: [...WEEK_3, ...WEEK_4] }; // whole-season read
    }],
    [update('matchups'), () => ({ rows: [], rowCount: 2 })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
  ]);
}

test('advancing a regular-season week materializes every team in a matchup of the new week, in its own transaction', async (t) => {
  const materialized = [];
  t.mock.method(lineupService, 'materializeLineup', async (client, args) => {
    materialized.push({ teamId: args.teamId, week: args.week, season: args.season, bestBall: args.league.best_ball });
    assert.equal(typeof client.query, 'function');
  });
  const fake = advancePool().install(t);

  const outcome = await finalizeWeekAndAdvance({ leagueId: 1 });

  assert.equal(outcome.advancedTo, 4);
  assert.deepEqual(
    materialized.map((m) => m.teamId).sort((a, b) => a - b),
    [11, 12, 13, 14]
  );
  for (const m of materialized) {
    assert.equal(m.week, 4);
    assert.equal(m.season, 2026);
    assert.equal(m.bestBall, false, 'the league row rides along: materialize reads its best_ball and lineup settings');
  }
  // Two transactions: the advance itself, then the materialization pass.
  const begins = fake.calls.filter((c) => /^BEGIN/.test(c.text));
  const commits = fake.calls.filter((c) => /^COMMIT/.test(c.text));
  assert.equal(begins.length, 2);
  assert.equal(commits.length, 2);
  fake.assertClean();
});

test('a materialization failure is logged and the advance still succeeds', async (t) => {
  t.mock.method(lineupService, 'materializeLineup', async () => {
    throw new Error('roster read failed');
  });
  t.mock.method(console, 'error', () => {});
  const fake = advancePool().install(t);

  const outcome = await finalizeWeekAndAdvance({ leagueId: 1 });

  assert.equal(outcome.advancedTo, 4);
  const commits = fake.calls.filter((c) => /^COMMIT/.test(c.text));
  const rollbacks = fake.calls.filter((c) => /^ROLLBACK/.test(c.text));
  assert.equal(commits.length, 1, 'the advance committed');
  assert.equal(rollbacks.length, 1, 'the materialization pass rolled back on its own');
  assert.ok(console.error.mock.calls.some((c) => /lineups not materialized/.test(String(c.arguments[0]))));
  fake.assertClean();
});

test('a new week with no matchups (nothing scheduled) opens no transaction and materializes nobody', async (t) => {
  const materialized = [];
  t.mock.method(lineupService, 'materializeLineup', async (client, args) => {
    materialized.push(args.teamId);
  });
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [{ ...LEAGUE }] })],
    [select('teams'), () => ({ rows: TEAMS })],
    [select('matchups'), (text, params) => {
      const week = params.length >= 3 ? Number(params[2]) : null;
      if (week === 3) return { rows: WEEK_3 };
      if (week === 4) return { rows: [] }; // nothing scheduled for the new week
      return { rows: WEEK_3 };
    }],
    [update('matchups'), () => ({ rows: [], rowCount: 2 })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);

  const outcome = await finalizeWeekAndAdvance({ leagueId: 1 });

  assert.equal(outcome.advancedTo, 4);
  assert.deepEqual(materialized, []);
  assert.equal(fake.calls.filter((c) => /^BEGIN/.test(c.text)).length, 1, 'only the advance opened a transaction');
  fake.assertClean();
});

test('a pool that cannot hand out a second connection still leaves the advance committed', async (t) => {
  t.mock.method(console, 'error', () => {});
  const fake = advancePool().install(t);
  // install() patched the pool module's connect; wrap that patched version
  // so the SECOND checkout (the materialization pass) fails the way a pool
  // at its ceiling does. node:test restores the original at test end.
  const pool = require('../modules/pool');
  const installedConnect = pool.connect;
  let handed = 0;
  pool.connect = async (...args) => {
    handed += 1;
    if (handed === 2) throw new Error('timeout exceeded when trying to connect');
    return installedConnect(...args);
  };

  const outcome = await finalizeWeekAndAdvance({ leagueId: 1 });

  assert.equal(outcome.advancedTo, 4);
  assert.equal(fake.calls.filter((c) => /^COMMIT/.test(c.text)).length, 1);
  assert.ok(console.error.mock.calls.some((c) => /lineups not materialized/.test(String(c.arguments[0]))));
  fake.assertClean();
});
