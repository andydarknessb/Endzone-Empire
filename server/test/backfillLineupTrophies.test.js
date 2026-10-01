const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const decisionSvc = require('../services/decision.service');
const { parseArgs, backfill } = require('../../scripts/backfill-lineup-trophies');

const S = 2026;
const startersFor = () => [
  { playerId: 1, name: 'Quinn QB', position: 'QB', slot: 'QB', points: 20 },
];

// One lineup league (7) with weeks 1 and 2 final, home 10 against away 20.
function world(t, { newInserts = true } = {}) {
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues" WHERE "pickem_only" = false AND "best_ball" = false/, () => ({
      rows: [{ id: 7, draft_status: 'complete', season_status: 'regular', regular_season_weeks: 14, best_ball: false }],
    })],
    [/^SELECT DISTINCT "week" FROM "matchups"/, () => ({ rows: [{ week: 1 }, { week: 2 }] })],
    [/^SELECT \* FROM "matchups" WHERE/, () => ({
      rows: [{ home_team_id: 10, away_team_id: 20, home_score: 98, away_score: 110 }],
    })],
    [/^SELECT 1 FROM/, () => ({ rows: [] })],
    [/^INSERT INTO "trophies"/, () => ({ rows: newInserts ? [{ id: 1 }] : [] })],
    [/^INSERT INTO "league_analytics"/, () => ({ rows: newInserts ? [{ week: 1 }] : [] })],
  ]);
  fake.install(t);
  t.mock.method(decisionSvc, 'weekHindsightRoster', async ({ teamId }) => (teamId === 10
    ? { actualPoints: 98, optimalPoints: 98, pointsLeftOnBench: 0, counted: startersFor() }
    : { actualPoints: 110, optimalPoints: 118, pointsLeftOnBench: 8, counted: [] }));
  return fake;
}

test('parseArgs needs an integer season and knows --dry-run', () => {
  assert.deepEqual(parseArgs(['--season', '2026']), { season: 2026, dryRun: false });
  assert.deepEqual(parseArgs(['--season=2026', '--dry-run']), { season: 2026, dryRun: true });
  assert.throws(() => parseArgs([]), /--season/);
  assert.throws(() => parseArgs(['--season', 'x']), /--season/);
  assert.throws(() => parseArgs(['--season', '2026', '--force']), /Unknown argument/);
});

test('#1864: reads only lineup leagues and their final weeks of the season', async (t) => {
  const fake = world(t);
  await backfill({ season: S, dryRun: true, log: () => {} });
  assert.equal(fake.matching(/^SELECT DISTINCT "week" FROM "matchups"/)[0].params[1], S);
  assert.match(fake.matching(/^SELECT DISTINCT "week" FROM "matchups"/)[0].text, /"final" = true/);
  assert.deepEqual(decisionSvc.weekHindsightRoster.mock.calls.map((c) => c.arguments[0].week), [1, 1, 2, 2]);
});

test('#1864: a dry run prints every row it would write and writes nothing', async (t) => {
  const fake = world(t);
  const lines = [];
  const { rows } = await backfill({ season: S, dryRun: true, log: (l) => lines.push(l) });
  assert.equal(fake.matching(/^(INSERT|UPDATE|DELETE)/).length, 0);
  assert.equal(rows, 4, 'a perfect lineup and a points-left row per week');
  assert.equal(lines.filter((l) => l.startsWith('would write ')).length, 4);
});

test('#1864: a real run writes only trophies and points-left rows: no Recap, digest, notification or called row', async (t) => {
  const fake = world(t);
  await backfill({ season: S, dryRun: false, log: () => {} });
  const writes = fake.calls.filter((c) => /^(INSERT|UPDATE|DELETE)/.test(c.text));
  assert.ok(writes.length > 0);
  assert.ok(writes.every((c) => /^INSERT INTO "(trophies|league_analytics)"/.test(c.text)), 'only the award and analytics inserts');
  assert.ok(writes.every((c) => /DO NOTHING/.test(c.text)));
  assert.equal(fake.matching(/lineup_overrides|notifications|recap/i).length, 0);
  const trophyTypes = fake.matching(/^INSERT INTO "trophies"/).map((c) => c.params[4]);
  assert.ok(trophyTypes.every((type) => ['perfect_lineup', 'captain_hindsight'].includes(type)));
});

test('#1864: a re-run, where every insert hits ON CONFLICT, reports and writes nothing new', async (t) => {
  world(t, { newInserts: false });
  const lines = [];
  const { rows } = await backfill({ season: S, dryRun: false, log: (l) => lines.push(l) });
  assert.equal(rows, 0);
  assert.deepEqual(lines, ['Done: 0 row(s) written.']);
});
