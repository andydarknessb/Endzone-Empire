const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const feedSyncRuns = require('../services/feedSyncRuns.service');
const nflverseSync = require('../services/nflverseSync.service');
const sleeper = require('../services/sleeper.service');
const adp = require('../services/adp.service');
const sportsdb = require('../services/sportsdb.service');
const scoringRouter = require('../routes/scoring.router');

/**
 * The eight global feed routes spend upstream quota and rewrite shared
 * tables, so a signed-in league member must not reach them (#2271): only a
 * platform admin does. Each path answers 403 and no feed service runs.
 */

const previousSecret = process.env.JWT_SECRET;
const previousAdmins = process.env.PLATFORM_ADMIN_IDS;
process.env.JWT_SECRET = 'scoring-sync-admin-gate-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
  if (previousAdmins === undefined) delete process.env.PLATFORM_ADMIN_IDS;
  else process.env.PLATFORM_ADMIN_IDS = previousAdmins;
});

const app = express();
app.use(express.json());
app.use('/api/scoring', scoringRouter);

const authed = () => `Bearer ${signToken({ id: 7, username: 'member' })}`;

// Valid bodies, so a 403 can only come from the gate and not from validation.
const ROUTES = [
  ['/sync', { season: 2026, week: 1 }],
  ['/sync-schedule', { season: 2026 }],
  ['/sync-players', { season: 2026 }],
  ['/sync-photos', {}],
  ['/sync-season-stats', {}],
  ['/sync-adp', {}],
  ['/backfill-seasons', {}],
  ['/sync-injuries', {}],
];

const SERVICES = [
  [feedSyncRuns, ['syncWeekStats', 'syncSchedule', 'syncPlayers', 'syncPlayerSeasonStats', 'syncInjuries']],
  [nflverseSync, ['syncScheduleFromNflverse']],
  [sleeper, ['syncSeasonStats']],
  [adp, ['syncAdp']],
  [sportsdb, ['syncPlayerPhotos']],
];

for (const admins of [undefined, '99']) {
  for (const [path, body] of ROUTES) {
    test(`POST ${path} is 403 for a non-admin (PLATFORM_ADMIN_IDS ${admins === undefined ? 'unset' : admins})`, async (t) => {
      if (admins === undefined) delete process.env.PLATFORM_ADMIN_IDS;
      else process.env.PLATFORM_ADMIN_IDS = admins;
      const mocks = [];
      for (const [svc, names] of SERVICES) {
        for (const name of names) {
          mocks.push(t.mock.method(svc, name, async () => { throw new Error(`${name} must not run`); }));
        }
      }

      const res = await request(app).post(`/api/scoring${path}`).set('Authorization', authed()).send(body);

      assert.equal(res.status, 403, JSON.stringify(res.body));
      assert.deepEqual(mocks.map((m) => m.mock.callCount()), mocks.map(() => 0));
    });
  }
}
