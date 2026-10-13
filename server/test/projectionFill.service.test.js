const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const projectionFill = require('../services/projectionFill.service');
const projection = require('../services/projection.service');

// The nightly-projection-run Sync run body, driven directly (the scheduler
// keeps the gate and the day stamp; scheduler.projectionRefill.test.js covers
// it end to end). Each case reads the recorded data_sync_runs row.

const NOW = new Date('2026-09-19T09:00:00Z');
const LIVE_LEAGUE_ROW = { id: 137, current_season: 2026, current_week: 2, regular_season_weeks: 14, playoff_teams: 4 };

function world(t, { leaguesHandler = () => ({ rows: [LIVE_LEAGUE_ROW] }) } = {}) {
  const syncRuns = [];
  createFakePool([
    [/FROM "leagues"/, leaguesHandler],
    [/FROM "players"/, () => ({ rows: [{ id: 101 }] })],
    [/^INSERT INTO "data_sync_runs"/, (text, params) => {
      syncRuns.push({ job: params[0], ok: params[2], detail: JSON.parse(params[3]) });
      return { rows: [] };
    }],
  ]).install(t);
  t.mock.method(projection, 'liveReconcileScope', async () => null);
  t.mock.method(require('../services/nflSeason.service'), 'upcomingNflSeason', async () => null);
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  return syncRuns;
}

test('runNightlyFill records an ok row and returns the summary', async (t) => {
  t.mock.method(projection, 'getWeeklyProjections', async ({ playerIds }) => ({
    projections: new Map(playerIds.map((id) => [id, { median: 5, cached: false }])),
  }));
  const syncRuns = world(t);

  const summary = await projectionFill.runNightlyFill({ now: NOW });

  assert.equal(summary.leagues, 1);
  assert.equal(summary.weeksGenerated, 15);
  assert.equal(summary.weeksSkipped, 0);
  assert.equal(syncRuns.length, 1);
  assert.equal(syncRuns[0].job, 'nightly-projection-run');
  assert.equal(syncRuns[0].ok, true);
  assert.deepEqual(syncRuns[0].detail, { leagueId: 137, weeksGenerated: 15, weeksSkipped: 0 });
});

test('runNightlyFill records write_failed when a league apply throws, and rethrows', async (t) => {
  t.mock.method(projection, 'getWeeklyProjections', async () => { throw new Error('generator blew up'); });
  const syncRuns = world(t);

  await assert.rejects(projectionFill.runNightlyFill({ now: NOW }), /generator blew up/);

  assert.equal(syncRuns.length, 1);
  assert.equal(syncRuns[0].ok, false);
  assert.equal(syncRuns[0].detail.reason, 'write_failed');
});

test('runNightlyFill records fetch_failed when the leagues read throws, and rethrows', async (t) => {
  t.mock.method(projection, 'getWeeklyProjections', async () => { throw new Error('must not be reached'); });
  const syncRuns = world(t, { leaguesHandler: () => { throw new Error('connection reset'); } });

  await assert.rejects(projectionFill.runNightlyFill({ now: NOW }), /connection reset/);

  assert.equal(syncRuns.length, 1);
  assert.equal(syncRuns[0].ok, false);
  assert.equal(syncRuns[0].detail.reason, 'fetch_failed');
});
