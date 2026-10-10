const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');

// #2117: the player run reads ESPN rosters and spends no Tank01 call. Record and
// refuse any tank01Get before the service loads, so a call fails loudly here.
const tank01Client = require('../modules/tank01Client');
const tank01Calls = [];
tank01Client.tank01Get = async (...args) => {
  tank01Calls.push(args);
  throw new Error('unexpected Tank01 call');
};
const {
  missingTeamDefenses,
  syncTeamDefenses,
  syncPlayers,
  normalizeRosterRow,
  syncPlayerSeasonStats,
  syncSchedule,
} = require('../services/feedSyncRuns.service');

// One ESPN roster row (espnAthleteClient.normalizeTeamRoster's shape) and a
// `sweep` seam standing in for espnFactsSync.sharedRosterSweep.
const rosterRow = (athleteId, teamCode, extra = {}) => ({
  athleteId: String(athleteId), teamCode, rosterStatus: 'active', name: `Player ${athleteId}`, position: 'WR', jerseyNumber: null, photoUrl: null, ...extra,
});
const sweepOf = (rows, complete = true) => async () => ({ units: [{ teamCode: 'ANY', rows }], complete });

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
test('syncPlayers upserts every roster row inside one transaction under PLAYERS_BULK_WRITE_LOCK', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({ rows: [] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncPlayers({ season: 2026, sweep: sweepOf([rosterRow(1, 'BUF')]) });

  assert.deepEqual(result, {
    season: 2026, playersUpserted: 1, skippedNonFantasy: 0, rosterComplete: true,
    teamChanges: 0, teamsCleared: 0, teamsDeferred: 0,
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

// #2117: the player run reads the ESPN rosters and spends no Tank01 call. The
// stub at the top of this file records and refuses any `tank01Get`; the three
// criteria in one run: no Tank01 call, a player ESPN moved gets his team
// written, a stored player on no roster gets his team cleared.
test('#2117: the player run makes zero tank01Get calls, writes a team move, and clears a player on no roster', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 11, external_id: '1001', name: 'Mover', position: 'WR', nfl_team: 'ARI' }, // ESPN has him on NE
        { id: 12, external_id: '1002', name: 'Gone', position: 'WR', nfl_team: 'HOU' }, // on no roster
        { id: 13, external_id: '1003', name: 'Stays', position: 'WR', nfl_team: 'KC' }, // control
      ],
    }), 'client'],
    [select('leagues'), () => ({ rows: [] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);
  const callsBefore = tank01Calls.length;

  const result = await syncPlayers({
    season: 2026,
    sweep: sweepOf([rosterRow(1001, 'NE'), rosterRow(1003, 'KC')]),
  });

  assert.equal(tank01Calls.length, callsBefore, 'no Tank01 call');
  assert.deepEqual(fake.matching(insert('players'))[0].params[3], ['NE', 'KC'], 'the upsert carries the ESPN team, not the stored one');
  const clear = fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text));
  assert.deepEqual(clear.params, [[12]], 'only the player on no roster clears');
  assert.deepEqual(
    { teamChanges: result.teamChanges, teamsCleared: result.teamsCleared, teamsDeferred: result.teamsDeferred },
    { teamChanges: 1, teamsCleared: 1, teamsDeferred: 0 },
  );
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
// row between the lock and COMMIT. The player sync also reads the stored
// players once (team moves and clears) ahead of that INSERT - still one query
// each, independent of row count.
test('syncPlayers issues a fixed number of statements between the lock and COMMIT regardless of row count', async (t) => {
  const rows = Array.from({ length: 250 }, (_, i) => rosterRow(2000 + i, 'BUF'));
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({ rows: [] }), 'client'],
    [insert('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncPlayers({ season: 2026, sweep: sweepOf(rows) });

  assert.deepEqual(result, {
    season: 2026, playersUpserted: 250, skippedNonFantasy: 0, rosterComplete: true,
    teamChanges: 0, teamsCleared: 0, teamsDeferred: 0,
  });
  const lockIdx = fake.calls.findIndex((c) => /^SELECT pg_advisory_xact_lock/.test(c.text));
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  const between = fake.calls.slice(lockIdx + 1, commitIdx);
  assert.equal(between.length, 2, 'one existing-rows read plus one write, independent of row count');
  assert.ok(between[0].text.startsWith('SELECT "id", "external_id", "name", "position", "nfl_team" FROM "players"'));
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

test('syncPlayers dedupes a duplicate external_id within one batch, last row wins, counted once', async (t) => {
  let insertParams = null;
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({ rows: [] }), 'client'],
    [insert('players'), (text, params) => { insertParams = params; return { rows: [] }; }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncPlayers({
    season: 2026,
    sweep: sweepOf([
      rosterRow(77, 'BUF', { name: 'Old Name', jerseyNumber: '11' }),
      rosterRow('077', 'MIA', { name: 'New Name', jerseyNumber: '22' }),
    ]),
  });

  assert.equal(result.playersUpserted, 1);
  assert.equal(insertParams[0].length, 1, 'one parallel-array row for the deduped external_id');
  assert.deepEqual(insertParams[1], ['New Name'], 'the later row wins');
  assert.deepEqual(insertParams[3], ['MIA'], 'the later row wins');
  assert.deepEqual(insertParams[5], ['22'], 'the later row wins');
  fake.assertClean();
});

test('syncPlayers inserts an athlete no stored row carries, with the ESPN id as external_id and his roster name, position, jersey and photo', async (t) => {
  let insertParams = null;
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({ rows: [] }), 'client'],
    [insert('players'), (text, params) => { insertParams = params; return { rows: [] }; }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  await syncPlayers({
    season: 2026,
    sweep: sweepOf([rosterRow(4431562, 'NYG', {
      name: 'New Rookie', position: 'PK', jerseyNumber: '9', photoUrl: 'https://a.espncdn.com/p/4431562.png',
    })]),
  });

  assert.deepEqual(insertParams, [
    ['4431562'], ['New Rookie'], ['K'], ['NYG'], ['https://a.espncdn.com/p/4431562.png'], ['9'],
  ]);
  fake.assertClean();
});

// normalizeRosterRow: the ESPN roster row -> player shape (replaces the Tank01
// entry normaliser's cases, #2117).
test('normalizeRosterRow maps a roster row, uppercases the position and stringifies the id', () => {
  assert.deepEqual(
    normalizeRosterRow({ athleteId: 42, teamCode: 'KC', name: 'A Player', position: 'rb', jerseyNumber: '7', photoUrl: 'https://x/42.png' }),
    { externalId: '42', name: 'A Player', position: 'RB', nflTeam: 'KC', photoUrl: 'https://x/42.png', jerseyNumber: '7' },
  );
});

test("normalizeRosterRow translates ESPN's PK to our K and carries null jersey and photo when the roster omits them", () => {
  const parsed = normalizeRosterRow({ athleteId: '9', teamCode: 'DAL', name: 'A Kicker', position: 'PK' });
  assert.equal(parsed.position, 'K');
  assert.equal(parsed.jerseyNumber, null);
  assert.equal(parsed.photoUrl, null);
});

test('normalizeRosterRow drops non-fantasy positions, keeps individual defenders, and returns null for a missing id, name, position or row', () => {
  assert.equal(normalizeRosterRow({ athleteId: '1', teamCode: 'SF', name: 'A Lineman', position: 'OT' }), null);
  assert.equal(normalizeRosterRow({ athleteId: '2', teamCode: 'SF', name: 'A Center', position: 'C' }), null);
  for (const position of ['DE', 'DT', 'LB', 'CB', 'S']) {
    assert.equal(normalizeRosterRow({ athleteId: `d-${position}`, teamCode: 'SF', name: 'A Defender', position }).position, position);
  }
  assert.equal(normalizeRosterRow({ teamCode: 'SF', name: 'No Id', position: 'WR' }), null);
  assert.equal(normalizeRosterRow({ athleteId: '1', teamCode: 'SF', position: 'WR' }), null);
  assert.equal(normalizeRosterRow({ athleteId: '1', teamCode: 'SF', name: 'No Position' }), null);
  assert.equal(normalizeRosterRow(null), null);
});

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
// syncScheduleFromNflverse takes, so an ESPN run and an nflverse run started
// together serialize instead of interleaving their upserts.
//
// #2116: the week's games come from ESPN's free scoreboard (ADR 0060), not
// Tank01. `transport` is the axios-like ESPN client; scoreboard-week.json is a
// real week-5 payload trimmed to four events (fixtures/espn/README.md).

const SCOREBOARD_WEEK = require('./fixtures/espn/scoreboard-week.json');
const { ESPN_SCOREBOARD_URL, espnAbbrToOurs } = require('../modules/espnScoreboard');
const tank01Feed = require('../services/tank01Feed');
const { buildGameKey } = tank01Feed;

// What each fixture event must write: home/away as our Team spellings, the
// competition's own kickoff instant.
const FIXTURE_GAMES = SCOREBOARD_WEEK.events.map((event) => {
  const competition = event.competitions[0];
  const side = (homeAway) =>
    espnAbbrToOurs(competition.competitors.find((c) => c.homeAway === homeAway).team.abbreviation);
  return { home: side('home'), away: side('away'), kickoffAt: new Date(competition.date) };
});

// Tank01's quota-metered client must never be touched by the schedule run:
// tank01Get resolves its transport through tank01Feed.rapidApiClient() at call
// time, so a stub there is reached by ANY counted Tank01 call the service makes
// (a reintroduced module-level tank01Get included), not just one on an argument.
function stubTank01(t) {
  return t.mock.method(tank01Feed, 'rapidApiClient', () => {
    throw new Error('the schedule run must not call Tank01');
  });
}

// A not-yet-flexed game as ESPN lists it (live 2026-10-08: all 16 week-18 events
// sat at 2027-01-10T05:00Z, competitions[0].timeValid false, shortDetail 'TBD').
const TBD_KICKOFF = '2027-01-10T05:00Z';
const TBD_EVENT = {
  id: 'tbd-buf-nyj',
  date: TBD_KICKOFF,
  competitions: [{
    date: TBD_KICKOFF,
    timeValid: false,
    competitors: [
      { homeAway: 'home', team: { abbreviation: 'BUF' } },
      { homeAway: 'away', team: { abbreviation: 'NYJ' } },
    ],
  }],
};

function scoreboardTransport(respond = () => ({ data: SCOREBOARD_WEEK })) {
  const calls = [];
  return {
    calls,
    async get(url, opts) {
      calls.push({ url, ...opts.params });
      return respond(opts.params.week);
    },
  };
}

test('syncSchedule fetches all 18 weeks from the ESPN scoreboard before writing, then upserts both team perspectives in one transaction under NFL_GAMES_BULK_WRITE_LOCK', async (t) => {
  const transport = scoreboardTransport();
  const tank01 = stubTank01(t);
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('nfl_games'), () => ({ rows: [{ inserted: true }] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncSchedule({ season: 2026, transport });

  assert.equal(tank01.mock.callCount(), 0, 'zero Tank01 calls: nothing resolved the Tank01 transport');

  assert.deepEqual(
    transport.calls.map((c) => [c.url, c.week, c.seasontype, c.dates]),
    Array.from({ length: 18 }, (_, i) => [ESPN_SCOREBOARD_URL, i + 1, 2, 2026]),
    'exactly one scoreboard call per regular-season week'
  );
  const writes = fake.matching(insert('nfl_games'));
  const expected = 18 * FIXTURE_GAMES.length * 2;
  assert.equal(writes.length, expected, 'every event, two rows per game (home + away perspective), every week');
  // The RESOLVED value (and so what both routes forward as JSON) stays
  // exactly { season, gamesUpserted } - the pre-launch lead note's "the
  // routes see exactly what they see today". failedWeeks lives only in the
  // recorded data_sync_runs row, asserted below.
  assert.deepEqual(result, { season: 2026, gamesUpserted: expected });
  const recordedDetail = JSON.parse(fake.matching(insert('data_sync_runs'))[0].params[3]);
  assert.deepEqual(recordedDetail, { season: 2026, gamesUpserted: expected, failedWeeks: [] });

  // Every fixture game lands as a home row and an away row carrying the
  // scoreboard's kickoff instant and the nfl_games.game_key spelling. Params
  // are ($1 season, $2 week, $3 team, $4 opponent, $5 kickoff_at, $6 game_key,
  // $7 home_away).
  for (let week = 1; week <= 18; week++) {
    const weekRows = writes.filter((w) => w.params[1] === week).map((w) => w.params);
    for (const { home, away, kickoffAt } of FIXTURE_GAMES) {
      const gameKey = buildGameKey({ season: 2026, week, away, home });
      assert.ok(
        weekRows.some((p) => p[2] === home && p[3] === away && p[6] === 'home' && p[5] === gameKey && +p[4] === +kickoffAt),
        `week ${week}: ${home} home row for ${away} at ${home}`
      );
      assert.ok(
        weekRows.some((p) => p[2] === away && p[3] === home && p[6] === 'away' && p[5] === gameKey && +p[4] === +kickoffAt),
        `week ${week}: ${away} away row for ${away} at ${home}`
      );
    }
    assert.ok(weekRows.some((p) => p[2] === 'WSH'), `week ${week}: Washington is written as WSH, the nfl_games spelling (ADR 0011)`);
  }

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

test('syncSchedule skips a game ESPN lists with timeValid false: a placeholder kickoff never overwrites kickoff_at', async (t) => {
  const transport = scoreboardTransport(() => ({ data: { events: [...SCOREBOARD_WEEK.events, TBD_EVENT] } }));
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('nfl_games'), () => ({ rows: [{ inserted: true }] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncSchedule({ season: 2026, transport });

  const writes = fake.matching(insert('nfl_games'));
  const expected = 18 * FIXTURE_GAMES.length * 2;
  assert.equal(writes.length, expected, 'only the valid-time events are written, the TBD event adds nothing');
  assert.deepEqual(result, { season: 2026, gamesUpserted: expected });
  assert.equal(
    writes.filter((w) => +w.params[4] === +new Date(TBD_KICKOFF) || w.params[2] === 'NYJ').length,
    0,
    'no row carries the placeholder kickoff, and the TBD game NYJ at BUF (not on the valid slate) is not written at all'
  );
  fake.assertClean();
});

test('syncSchedule tolerates a throwing week and a non-array week: still calls every week and carries both in failedWeeks', async (t) => {
  const transport = scoreboardTransport((week) => {
    if (week === 3) throw new Error('espn unreachable');
    if (week === 7) return { data: { events: { not: 'an array' } } };
    return { data: SCOREBOARD_WEEK };
  });
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [insert('nfl_games'), () => ({ rows: [{ inserted: true }] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  const result = await syncSchedule({ season: 2026, transport });

  assert.equal(transport.calls.length, 18, 'every week is still called regardless of earlier failures');
  // Resolved value: exactly { season, gamesUpserted }, no failedWeeks.
  assert.deepEqual(result, { season: 2026, gamesUpserted: 16 * FIXTURE_GAMES.length * 2 }, '16 successful weeks; the other weeks wrote nothing');

  const recordedDetail = JSON.parse(fake.matching(insert('data_sync_runs'))[0].params[3]);
  assert.deepEqual(recordedDetail.failedWeeks.map((f) => f.week), [3, 7]);
  assert.equal(recordedDetail.failedWeeks[0].message, 'espn unreachable');
  assert.match(recordedDetail.failedWeeks[1].message, /unexpected scoreboard response shape/);
  assert.equal(recordedDetail.gamesUpserted, 16 * FIXTURE_GAMES.length * 2);
  fake.assertClean();
});

test('syncSchedule: when every week fails to fetch, the run is fetch_failed and nothing is written', async (t) => {
  const transport = scoreboardTransport(() => { throw new Error('espn down'); });
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [] })],
  ]).install(t);

  await assert.rejects(syncSchedule({ season: 2026, transport }), /every week failed to fetch/);

  assert.equal(fake.calls.some((c) => c.text === 'BEGIN'), false, 'fetch failed before any unit reached the transaction');
  const runInsert = fake.matching(insert('data_sync_runs'))[0];
  assert.ok(runInsert, 'the failed run is still recorded');
  const detail = JSON.parse(runInsert.params[3]);
  assert.equal(detail.reason, 'fetch_failed');
});
