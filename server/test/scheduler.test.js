const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const push = require('../services/push.service');
const prefs = require('../services/prefs.service');
const { alertCloseMatchups } = require('../modules/scheduler');

test('close-matchup push targets Game Center instead of the retired Matchups route', async (t) => {
  let sent;
  t.mock.method(pool, 'query', async () => ({ rows: [{ owner_id: 11 }, { owner_id: 22 }] }));
  t.mock.method(prefs, 'usersWanting', async (ownerIds, key) => {
    assert.deepEqual(ownerIds, [11, 22]);
    assert.equal(key, 'closeMatchups');
    return ownerIds;
  });
  t.mock.method(push, 'sendPushToUsers', async (ownerIds, payload) => {
    sent = { ownerIds, payload };
    return { sent: ownerIds.length };
  });

  await alertCloseMatchups({
    leagueId: 42,
    week: 7,
    scored: [{ matchupId: 987654, homeTeamId: 3, awayTeamId: 4, homeScore: 101, awayScore: 96.5 }],
  });

  assert.deepEqual(sent.ownerIds, [11, 22]);
  assert.equal(sent.payload.url, '/#/league/42/game-center');
  assert.equal(sent.payload.title, 'Your matchup is close!');
});

// ---- quota-aware stat-sync cadence -----------------------------------------

const scheduler = require('../modules/scheduler');
const tank01Client = require('../modules/tank01Client');

test('syncEveryTicks doubles the box-score cadence once quota is degraded', async (t) => {
  t.mock.method(tank01Client, 'getQuotaState', async () => ({ mode: 'degraded' }));
  assert.equal(await scheduler.syncEveryTicks(), scheduler.SYNC_EVERY_TICKS * 2);
});

test('syncEveryTicks keeps the normal cadence while quota is healthy', async (t) => {
  t.mock.method(tank01Client, 'getQuotaState', async () => ({ mode: 'ok' }));
  assert.equal(await scheduler.syncEveryTicks(), scheduler.SYNC_EVERY_TICKS);
});

test('syncEveryTicks falls back to the default when quota state is unavailable', async (t) => {
  t.mock.method(tank01Client, 'getQuotaState', async () => {
    throw new Error('quota table missing');
  });
  assert.equal(await scheduler.syncEveryTicks(), scheduler.SYNC_EVERY_TICKS);
});

// ---- scoring is decoupled from syncing -------------------------------------

test('syncAndScoreLiveWeeks still scores when the stat sync fetched nothing', async (t) => {
  // Every game final and already ingested (or quota exhausted): scoreMatchups is
  // DB-only, so it must still run — finals ingested via the recap path get
  // scored promptly this way.
  const scoring = require('../services/scoring.service');
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "leagues"')) {
      return { rows: [{ id: 42, current_season: 2026, current_week: 3 }] };
    }
    if (text.includes('FROM "nfl_games"')) return { rows: [{ '?column?': 1 }] };
    return { rows: [] };
  });
  t.mock.method(scoring, 'syncWeekStats', async () => {
    throw new Error('quota exhausted');
  });
  let scoredFor = null;
  t.mock.method(scoring, 'scoreMatchups', async ({ leagueId, plays }) => {
    scoredFor = { leagueId, plays };
    return { scored: [] };
  });

  const prevKey = process.env.RAPID_API_KEY;
  const prevHost = process.env.RAPID_API_HOST;
  process.env.RAPID_API_KEY = 'test-key';
  process.env.RAPID_API_HOST = 'test-host';
  try {
    const ran = await scheduler.syncAndScoreLiveWeeks();
    assert.equal(ran, true);
  } finally {
    if (prevKey === undefined) delete process.env.RAPID_API_KEY;
    else process.env.RAPID_API_KEY = prevKey;
    if (prevHost === undefined) delete process.env.RAPID_API_HOST;
    else process.env.RAPID_API_HOST = prevHost;
  }
  assert.deepEqual(scoredFor, { leagueId: 42, plays: [] });
});
