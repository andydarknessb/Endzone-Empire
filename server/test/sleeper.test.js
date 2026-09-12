const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { createFakePool, select, insert } = require('./helpers/fakePool');
const {
  mapSleeperStats,
  normalizeSleeperEntry,
  buildSeasonStatUpdates,
  syncSeasonStats,
} = require('../services/sleeper.service');

test('mapSleeperStats translates Sleeper fields to our flat keys, dropping zeros', () => {
  const out = mapSleeperStats({
    rec: 66, rec_yd: 654, rec_td: 7, rush_yd: 20, rush_td: 0,
    pass_yd: 0, fum_lost: 1, gp: 17, rec_air_yd: 900 /* ignored */,
  });
  assert.deepEqual(out, {
    receptions: 66, receivingYards: 654, receivingTDs: 7, rushingYards: 20, fumbles: 1,
  });
});

test('normalizeSleeperEntry joins meta + stats into a match shape', () => {
  const out = normalizeSleeperEntry(
    { full_name: 'Justin Jefferson', position: 'WR' },
    { gp: 17, rec: 100, rec_yd: 1533, rec_td: 10 }
  );
  assert.equal(out.nameKey, 'justin jefferson');
  assert.equal(out.position, 'WR');
  assert.equal(out.games, 17);
  assert.equal(out.stats.receivingYards, 1533);
});

test('normalizeSleeperEntry rejects no-name, zero-game, and statless (defense) rows', () => {
  assert.equal(normalizeSleeperEntry({ position: 'WR' }, { gp: 17, rec: 5 }), null);
  assert.equal(normalizeSleeperEntry({ full_name: 'X' }, { gp: 0, rec: 5 }), null);
  assert.equal(normalizeSleeperEntry({ full_name: 'A Defense' }, { gp: 17 }), null); // no mappable stats
});

const entries = [
  { nameKey: 'justin jefferson', position: 'WR', games: 17, stats: { receivingYards: 1533 } },
  { nameKey: 'josh allen', position: 'QB', games: 17, stats: { passingYards: 4300 } },
  { nameKey: 'josh allen', position: 'LB', games: 16, stats: { fumbles: 1 } },
];

test('buildSeasonStatUpdates matches by name and stamps the season', () => {
  const updates = buildSeasonStatUpdates([{ id: 5, name: 'Justin Jefferson', position: 'WR' }], entries, 2024);
  assert.deepEqual(updates, [{ playerId: 5, season: 2024, games: 17, stats: { receivingYards: 1533 } }]);
});

test('buildSeasonStatUpdates disambiguates same-named players by position', () => {
  const updates = buildSeasonStatUpdates([{ id: 1, name: 'Josh Allen', position: 'QB' }], entries, 2024);
  assert.equal(updates[0].stats.passingYards, 4300); // the QB, not the LB
});

test('buildSeasonStatUpdates skips unmatched players', () => {
  const updates = buildSeasonStatUpdates([{ id: 9, name: 'Nobody', position: 'RB' }], entries, 2024);
  assert.deepEqual(updates, []);
});

// #1251: upsertSeasonStats now runs inside its own transaction under
// PLAYERS_BULK_WRITE_LOCK (23004), taken directly (not withAdvisoryLock) as a
// blocking pg_advisory_xact_lock, so it serializes against season-stats's own
// writer of player_season_stats instead of racing it to a deadlock.

function stubSleeper(t, { meta, stats }) {
  t.mock.method(axios, 'create', () => ({
    get: async (url) => {
      if (url === '/players/nfl') return { data: meta };
      if (url === '/stats/nfl/regular/2025') return { data: stats };
      throw new Error(`unexpected Sleeper url: ${url}`);
    },
  }));
}

const SLEEPER_META = { s1: { full_name: 'Justin Jefferson', position: 'WR' } };
const SLEEPER_STATS = { s1: { gp: 17, rec: 100, rec_yd: 1533, rec_td: 10 } };

test('syncSeasonStats: upsertSeasonStats issues BEGIN, the advisory lock, one bulk INSERT, then COMMIT', async (t) => {
  stubSleeper(t, { meta: SLEEPER_META, stats: SLEEPER_STATS });
  const fake = createFakePool([
    [select('players'), () => ({ rows: [{ id: 5, name: 'Justin Jefferson', position: 'WR' }] }), 'pool'],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('player_season_stats'), () => ({ rows: [] }), 'client'],
  ]).install(t);

  const result = await syncSeasonStats({ seasons: [2025] });

  assert.deepEqual(result, { seasons: [{ season: 2025, sleeperPlayers: 1, playersUpserted: 1 }] });

  const clientCalls = fake.calls.filter((c) => c.via === 'client');
  assert.equal(clientCalls.length, 4);
  assert.equal(clientCalls[0].text, 'BEGIN');
  assert.equal(clientCalls[1].text, 'SELECT pg_advisory_xact_lock($1)');
  assert.deepEqual(clientCalls[1].params, [23004], 'the lock id is 23004 (players-bulk-write)');
  assert.ok(clientCalls[2].text.startsWith('INSERT INTO "player_season_stats"'));
  assert.equal(clientCalls[3].text, 'COMMIT');
  fake.assertClean();
});

test('syncSeasonStats: a failing bulk upsert rolls back and is captured per-season instead of rejecting the run', async (t) => {
  t.mock.method(console, 'error', () => {});
  stubSleeper(t, { meta: SLEEPER_META, stats: SLEEPER_STATS });
  const fake = createFakePool([
    [select('players'), () => ({ rows: [{ id: 5, name: 'Justin Jefferson', position: 'WR' }] }), 'pool'],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('player_season_stats'), () => { throw new Error('deadlock detected'); }, 'client'],
  ]).install(t);

  const result = await syncSeasonStats({ seasons: [2025] });

  assert.deepEqual(result, { seasons: [{ season: 2025, error: 'deadlock detected' }] });
  assert.ok(fake.calls.some((c) => c.text === 'ROLLBACK'), 'withTransaction rolled back the failed upsert');
  assert.equal(fake.calls.some((c) => c.text === 'COMMIT'), false, 'no COMMIT after the failure');
  fake.assertClean();
});
