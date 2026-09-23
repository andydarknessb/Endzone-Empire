const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert } = require('./helpers/fakePool');
const {
  missingTeamDefenses,
  syncTeamDefenses,
  syncPlayers,
  syncPlayerSeasonStats,
  syncSchedule,
} = require('../services/feedSyncRuns.service');

// The following moved from scoring.service.test.js (#1506, spec #1492): all
// exercise feedSyncRuns.service.js, the feed Sync run jobs module.

// --- Team-DEF backfill (missingTeamDefenses) ----------------------------------

test('missingTeamDefenses returns all 32 teams when none exist yet', () => {
  const missing = missingTeamDefenses([]);
  assert.equal(missing.length, 32);
  assert(missing.includes('Arizona Cardinals'));
  assert(missing.includes('San Francisco 49ers'));
});

test('missingTeamDefenses excludes teams already present, matched by abbreviation regardless of stored format', () => {
  const missing = missingTeamDefenses(['San Francisco 49ers', 'DAL']);
  assert.equal(missing.length, 30);
  assert(!missing.includes('San Francisco 49ers'));
  assert(!missing.includes('Dallas Cowboys'));
});

test('missingTeamDefenses ignores unresolvable/empty nfl_team values and null/undefined input', () => {
  assert.equal(missingTeamDefenses([null, '', 'Not A Real Team']).length, 32);
  assert.equal(missingTeamDefenses(undefined).length, 32);
});

// --- syncTeamDefenses as a Sync run job (#1204, ADR 0036) --------------------

test('syncTeamDefenses upserts every missing team inside one transaction under PLAYERS_BULK_WRITE_LOCK', async (t) => {
  const fake = createFakePool([
    [select('players'), () => ({ rows: [{ nfl_team: 'BUF' }] }), 'pool'],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncTeamDefenses();

  assert.deepEqual(result, { teamsInserted: 31, totalDefTeams: 32 }, '32 teams minus the one BUF row already seeded');
  assert.equal(fake.matching(insert('players')).length, 31);

  // Red-tell: remove the lock and this ordering assertion goes red.
  const beginIdx = fake.calls.findIndex((c) => c.text === 'BEGIN');
  const lockIdx = fake.calls.findIndex((c) => /^SELECT pg_advisory_xact_lock/.test(c.text));
  const firstWriteIdx = fake.calls.findIndex((c) => /^INSERT INTO "players"/.test(c.text));
  assert.ok(beginIdx >= 0 && beginIdx < lockIdx, 'BEGIN precedes the lock');
  assert.deepEqual(fake.calls[lockIdx].params, [23004], 'the lock id is 23004 (players-bulk-write)');
  assert.ok(lockIdx < firstWriteIdx, 'the lock is taken before the first insert');
  fake.assertClean();
});

// Formal review f1 (#1204): only team-defenses had a lock-ordering test above,
// though the issue names PLAYERS_BULK_WRITE_LOCK for all three players-table
// jobs and, for players, it is the #904 guard against a row-lock deadlock
// with syncInjuries/syncAdp. Without these two, `lock: null` in either
// syncPlayers or syncPlayerSeasonStats leaves every other test green.
test('syncPlayers upserts every fetched entry inside one transaction under PLAYERS_BULK_WRITE_LOCK', async (t) => {
  const api = async (path) => {
    assert.equal(path, '/getNFLPlayerList');
    return { data: { body: [{ playerID: '1', longName: 'Test Player', pos: 'WR', team: 'BUF' }] } };
  };
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({ rows: [] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncPlayers({ season: 2026, api });

  assert.deepEqual(result, {
    season: 2026, playersUpserted: 1, skippedNonFantasy: 0, skippedDuplicateIdentity: [],
  });

  // Red-tell: remove the lock and this ordering assertion goes red.
  const beginIdx = fake.calls.findIndex((c) => c.text === 'BEGIN');
  const lockIdx = fake.calls.findIndex((c) => /^SELECT pg_advisory_xact_lock/.test(c.text));
  const firstWriteIdx = fake.calls.findIndex((c) => /^INSERT INTO "players"/.test(c.text));
  assert.ok(beginIdx >= 0 && beginIdx < lockIdx, 'BEGIN precedes the lock');
  assert.deepEqual(fake.calls[lockIdx].params, [23004], 'the lock id is 23004 (players-bulk-write)');
  assert.ok(lockIdx < firstWriteIdx, 'the lock is taken before the first insert');
  fake.assertClean();
});

test('syncPlayerSeasonStats upserts every rollup inside one transaction under PLAYERS_BULK_WRITE_LOCK', async (t) => {
  const fake = createFakePool([
    [/FROM "player_stats"/, () => ({ rows: [
      { player_id: 1, season: 2025, stats: { rec: 1 }, fantasy_points: '10.00' },
    ] }), 'pool'],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('player_season_stats'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncPlayerSeasonStats({ currentSeason: 2026 });

  assert.deepEqual(result, { cutoffSeason: 2026, seasonsUpserted: 1 });

  // Red-tell: remove the lock and this ordering assertion goes red.
  const beginIdx = fake.calls.findIndex((c) => c.text === 'BEGIN');
  const lockIdx = fake.calls.findIndex((c) => /^SELECT pg_advisory_xact_lock/.test(c.text));
  const firstWriteIdx = fake.calls.findIndex((c) => /^INSERT INTO "player_season_stats"/.test(c.text));
  assert.ok(beginIdx >= 0 && beginIdx < lockIdx, 'BEGIN precedes the lock');
  assert.deepEqual(fake.calls[lockIdx].params, [23004], 'the lock id is 23004 (players-bulk-write)');
  assert.ok(lockIdx < firstWriteIdx, 'the lock is taken before the first insert');
  fake.assertClean();
});

// #1251: the players and season-stats applies rewritten as one bulk `unnest`
// upsert each, so the number of write statements per unit is a fixed
// constant, not one per row. Each test drives a unit of hundreds of rows -
// this goes red against the old per-row loop, which issued one INSERT per
// row between the lock and COMMIT. #1562 adds one fixed existing-rows SELECT
// (the identity guard's own read) ahead of that INSERT - still one query
// each, independent of row count.
test('syncPlayers issues a fixed number of statements between the lock and COMMIT regardless of row count', async (t) => {
  const entries = Array.from({ length: 250 }, (_, i) => (
    { playerID: String(2000 + i), longName: `Bulk Player ${i}`, pos: 'WR', team: 'BUF' }
  ));
  const api = async () => ({ data: { body: entries } });
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({ rows: [] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncPlayers({ season: 2026, api });

  assert.deepEqual(result, {
    season: 2026, playersUpserted: 250, skippedNonFantasy: 0, skippedDuplicateIdentity: [],
  });
  const lockIdx = fake.calls.findIndex((c) => /^SELECT pg_advisory_xact_lock/.test(c.text));
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  const between = fake.calls.slice(lockIdx + 1, commitIdx);
  assert.equal(between.length, 2, 'one existing-rows read plus one write, independent of row count');
  assert.ok(between[0].text.startsWith('SELECT "external_id", "name", "position", "nfl_team" FROM "players"'));
  assert.ok(between[1].text.startsWith('INSERT INTO "players"'));
  fake.assertClean();
});

test('syncPlayerSeasonStats issues a fixed number of write statements between the lock and COMMIT regardless of row count', async (t) => {
  const weeklyRows = Array.from({ length: 300 }, (_, i) => (
    { player_id: i + 1, season: 2025, stats: { rec: 1 }, fantasy_points: '10.00' }
  ));
  const fake = createFakePool([
    [/FROM "player_stats"/, () => ({ rows: weeklyRows }), 'pool'],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('player_season_stats'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncPlayerSeasonStats({ currentSeason: 2026 });

  assert.deepEqual(result, { cutoffSeason: 2026, seasonsUpserted: 300 });
  const lockIdx = fake.calls.findIndex((c) => /^SELECT pg_advisory_xact_lock/.test(c.text));
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  const between = fake.calls.slice(lockIdx + 1, commitIdx);
  assert.equal(between.length, 1, 'one write statement independent of row count');
  assert.ok(between[0].text.startsWith('INSERT INTO "player_season_stats"'));
  fake.assertClean();
});

test('syncPlayers dedupes a duplicate external_id within one batch, last entry wins, counted once', async (t) => {
  const api = async () => ({
    data: {
      body: [
        { playerID: '77', longName: 'Old Name', pos: 'WR', team: 'BUF', jerseyNum: '11' },
        { playerID: '77', longName: 'New Name', pos: 'WR', team: 'MIA', jerseyNum: '22' },
      ],
    },
  });
  let insertParams = null;
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({ rows: [] }), 'client'],
    [insert('players'), (text, params) => { insertParams = params; return { rows: [] }; }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncPlayers({ season: 2026, api });

  assert.deepEqual(result, {
    season: 2026, playersUpserted: 1, skippedNonFantasy: 0, skippedDuplicateIdentity: [],
  });
  assert.equal(insertParams[0].length, 1, 'one parallel-array row for the deduped external_id');
  assert.deepEqual(insertParams[0], ['77']);
  assert.deepEqual(insertParams[1], ['New Name'], 'the later entry wins');
  assert.deepEqual(insertParams[3], ['MIA'], 'the later entry wins');
  assert.deepEqual(insertParams[5], ['22'], 'the later entry wins');
  fake.assertClean();
});

// #1562: applySyncPlayersUnit's identity guard. Root cause: `players`' only
// identity is `external_id`, so a known athlete arriving under a
// never-seen `playerID` (a new source id) was inserted as a second row -
// the worked example being a teamless Davante Adams copy under a new id,
// rostered in two leagues and scoring 0. These four cases are the issue's
// own red-tell plus its stated companions.

test('#1562 arm (b): a teamless entry under a new playerID matching an existing rostered player by name+position is refused, not inserted', async (t) => {
  const api = async () => ({
    data: {
      body: [
        { playerID: '16800', longName: 'Davante Adams', pos: 'WR', team: 'LAR' },
        { playerID: '2589699', longName: 'Davante Adams', pos: 'WR', team: 'LV', isFreeAgent: 'True' },
      ],
    },
  });
  let insertParams = null;
  let recordedDetail = null;
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ external_id: 16800, name: 'Davante Adams', position: 'WR', nfl_team: 'LAR' }],
    }), 'client'],
    [insert('players'), (text, params) => { insertParams = params; return { rows: [] }; }, 'client'],
    [insert('data_sync_runs'), (text, params) => { recordedDetail = JSON.parse(params[3]); return { rows: [] }; }],
  ]).install(t);

  const result = await syncPlayers({ season: 2026, api });

  assert.deepEqual(insertParams[0], ['16800'], 'only the already-known external id reaches the insert');
  assert.equal(result.playersUpserted, 1);
  assert.deepEqual(result.skippedDuplicateIdentity, [{ playerId: '2589699', matchedExternalId: '16800' }]);
  assert.deepEqual(recordedDetail.skippedDuplicateIdentity, [{ playerId: '2589699', matchedExternalId: '16800' }],
    'the refusal is also visible on the recorded data_sync_runs row');
  fake.assertClean();
});

test('#1562 arm (a): a new playerID whose numeric espnID matches an existing external_id is refused, even under a misspelled name', async (t) => {
  const api = async () => ({
    data: {
      body: [
        { playerID: '999', longName: 'Davante Adamms', pos: 'WR', team: 'LAR', espnID: '16800' },
      ],
    },
  });
  let insertParams = null;
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ external_id: 16800, name: 'Davante Adams', position: 'WR', nfl_team: 'LAR' }],
    }), 'client'],
    [insert('players'), (text, params) => { insertParams = params; return { rows: [] }; }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncPlayers({ season: 2026, api });

  assert.equal(insertParams, null, 'no INSERT ran at all: the sole entry in the batch was refused');
  assert.deepEqual(result, {
    season: 2026,
    playersUpserted: 0,
    skippedNonFantasy: 0,
    skippedDuplicateIdentity: [{ playerId: '999', matchedExternalId: '16800' }],
  });
  fake.assertClean();
});

test('#1562: a teamed same-name player under a new playerID still inserts (a real second athlete, not a duplicate)', async (t) => {
  const api = async () => ({
    data: {
      body: [
        { playerID: '2589699', longName: 'Davante Adams', pos: 'WR', team: 'LV' },
      ],
    },
  });
  let insertParams = null;
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ external_id: 16800, name: 'Davante Adams', position: 'WR', nfl_team: 'LAR' }],
    }), 'client'],
    [insert('players'), (text, params) => { insertParams = params; return { rows: [] }; }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncPlayers({ season: 2026, api });

  assert.deepEqual(insertParams[0], ['2589699'], 'a teamed same-name player is a distinct athlete, never folded away');
  assert.equal(result.playersUpserted, 1);
  assert.deepEqual(result.skippedDuplicateIdentity, []);
  fake.assertClean();
});

test('#1562: a playerID already known as an existing external_id upserts as before, even if it would otherwise look like a duplicate', async (t) => {
  const api = async () => ({
    data: {
      body: [
        { playerID: '16800', longName: 'Davante Adams', pos: 'WR', team: 'LV', isFreeAgent: 'True' },
      ],
    },
  });
  let insertParams = null;
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ external_id: 16800, name: 'Davante Adams', position: 'WR', nfl_team: 'LAR' }],
    }), 'client'],
    [insert('players'), (text, params) => { insertParams = params; return { rows: [] }; }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncPlayers({ season: 2026, api });

  assert.deepEqual(insertParams[0], ['16800'], 'the known id upserts, untouched by the identity guard');
  assert.equal(result.playersUpserted, 1);
  assert.deepEqual(result.skippedDuplicateIdentity, []);
  fake.assertClean();
});

// team-defenses' INSERT sets no column any real constraint protects
// (external_id stays NULL; name/position/nfl_team carry no UNIQUE or CHECK,
// per 20260710000001_initial_schema.js), so no real feed data can make its
// second row fail against actual Postgres the way the other three jobs' pg
// tests do (server/test/playersFamilySync.pg.test.js) - this fakePool test
// proves the same rollback wiring instead: a throw mid-unit stops the loop
// and rolls back rather than being swallowed by a per-team try/catch.
test('syncTeamDefenses: a later insert that throws rolls back the run (no per-team try/catch survives it any more)', async (t) => {
  let insertCount = 0;
  const fake = createFakePool([
    [select('players'), () => ({ rows: [] }), 'pool'], // all 32 teams missing
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('players'), () => {
      insertCount += 1;
      if (insertCount === 2) throw new Error('insert exploded');
      return { rows: [] };
    }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  await assert.rejects(syncTeamDefenses(), /insert exploded/);

  assert.equal(insertCount, 2, 'the loop stopped at the throwing insert instead of continuing past it');
  assert.equal(fake.calls.some((c) => c.text === 'COMMIT'), false, 'no COMMIT: withTransaction rolled back instead');
  assert.ok(fake.calls.some((c) => c.text === 'ROLLBACK'), 'withTransaction issued the ROLLBACK');
  const recordedDetail = JSON.parse(fake.matching(insert('data_sync_runs'))[0].params[3]);
  assert.equal(recordedDetail.reason, 'write_failed');
  fake.assertClean();
});

// #1203: syncSchedule (Sync run module, ADR 0036, job 'schedule') fetches all
// 18 weeks before writing anything, then upserts the single unit in one
// transaction under NFL_GAMES_BULK_WRITE_LOCK (23005) - the same lock
// syncScheduleFromNflverse takes, so a Tank01 run and an nflverse run started
// together serialize instead of interleaving their upserts.

test('syncSchedule fetches all 18 weeks before writing, then upserts both team perspectives in one transaction under NFL_GAMES_BULK_WRITE_LOCK', async (t) => {
  const apiCalls = [];
  const api = async (path, opts) => {
    assert.equal(path, '/getNFLGamesForWeek');
    apiCalls.push(opts.params.week);
    return {
      data: {
        body: [{ home: 'NYJ', away: 'BUF', gameTime_epoch: String(1700000000 + opts.params.week) }],
      },
    };
  };
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('nfl_games'), () => ({ rows: [{ inserted: true }] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncSchedule({ season: 2026, api });

  assert.deepEqual(apiCalls, Array.from({ length: 18 }, (_, i) => i + 1), 'exactly one call per regular-season week');
  const writes = fake.matching(insert('nfl_games'));
  assert.equal(writes.length, 36, 'one game per week, two rows per game (home + away perspective)');
  // The RESOLVED value (and so what both routes forward as JSON) stays
  // exactly { season, gamesUpserted } - the pre-launch lead note's "the
  // routes see exactly what they see today". failedWeeks lives only in the
  // recorded data_sync_runs row, asserted below.
  assert.deepEqual(result, { season: 2026, gamesUpserted: 36 });
  const recordedDetail = JSON.parse(fake.matching(insert('data_sync_runs'))[0].params[3]);
  assert.deepEqual(recordedDetail, { season: 2026, gamesUpserted: 36, failedWeeks: [] });

  // Red-tell: remove the lock and this ordering assertion (or the pg
  // serialization test) goes red.
  const beginIdx = fake.calls.findIndex((c) => c.text === 'BEGIN');
  const lockIdx = fake.calls.findIndex((c) => /^SELECT pg_advisory_xact_lock/.test(c.text));
  const firstWriteIdx = fake.calls.findIndex((c) => /^INSERT INTO "nfl_games"/.test(c.text));
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  assert.ok(lockIdx >= 0, 'the advisory lock is acquired');
  assert.equal(fake.calls[lockIdx].via, 'client', 'the lock sits inside the transaction client');
  assert.deepEqual(fake.calls[lockIdx].params, [23005], 'the lock id is 23005 (nfl-games-bulk-write)');
  assert.ok(beginIdx >= 0 && beginIdx < lockIdx, 'BEGIN precedes the lock');
  assert.ok(lockIdx < firstWriteIdx, 'the lock is taken before the first upsert');
  assert.ok(commitIdx > firstWriteIdx, 'every write commits in the same transaction');
  fake.assertClean();
});

test('syncSchedule tolerates a throwing week and a non-array week: still calls every week and carries both in failedWeeks', async (t) => {
  const apiCalls = [];
  const api = async (path, opts) => {
    const { week } = opts.params;
    apiCalls.push(week);
    if (week === 3) throw new Error('tank01 quota exceeded');
    if (week === 7) return { data: { body: { not: 'an array' } } };
    return { data: { body: [{ home: 'NYJ', away: 'BUF', gameTime_epoch: '1700000000' }] } };
  };
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('nfl_games'), () => ({ rows: [{ inserted: true }] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncSchedule({ season: 2026, api });

  assert.equal(apiCalls.length, 18, 'every week is still called - Tank01 quota is metered per call regardless of earlier failures');
  // Resolved value: exactly { season, gamesUpserted }, no failedWeeks.
  assert.deepEqual(result, { season: 2026, gamesUpserted: 32 }, '16 successful weeks x 2 rows; the other weeks wrote nothing');

  const recordedDetail = JSON.parse(fake.matching(insert('data_sync_runs'))[0].params[3]);
  assert.deepEqual(recordedDetail.failedWeeks.map((f) => f.week), [3, 7]);
  assert.equal(recordedDetail.failedWeeks[0].message, 'tank01 quota exceeded');
  assert.match(recordedDetail.failedWeeks[1].message, /unexpected getNFLGamesForWeek response shape/);
  assert.equal(recordedDetail.gamesUpserted, 32);
  fake.assertClean();
});

test('syncSchedule: when every week fails to fetch, the run is fetch_failed and nothing is written', async (t) => {
  const api = async () => { throw new Error('tank01 down'); };
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  await assert.rejects(syncSchedule({ season: 2026, api }), /every week failed to fetch/);

  assert.equal(fake.calls.some((c) => c.text === 'BEGIN'), false, 'fetch failed before any unit reached the transaction');
  const runInsert = fake.matching(insert('data_sync_runs'))[0];
  assert.ok(runInsert, 'the failed run is still recorded');
  const detail = JSON.parse(runInsert.params[3]);
  assert.equal(detail.reason, 'fetch_failed');
});
