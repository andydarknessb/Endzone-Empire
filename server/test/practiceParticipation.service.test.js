const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const axios = require('axios');
const pool = require('../modules/pool');
const { createFakePool, insert, select } = require('./helpers/fakePool');
const practice = require('../services/practiceParticipation.service');

// --- normalizeInjuryRow ------------------------------------------------------

const CSV_ROW = {
  season: '2026', game_type: 'REG', team: 'WAS', week: '5', gsis_id: '00-0039924',
  report_primary_injury: 'Hamstring', report_status: 'Questionable',
  practice_primary_injury: 'Hamstring', practice_status: 'Limited Participation in Practice',
};

test('normalizeInjuryRow reads the four tracked fields, the team as nflverse spells it, and the ids as numbers', () => {
  assert.deepEqual(practice.normalizeInjuryRow(CSV_ROW), {
    gsisId: '00-0039924', season: 2026, week: 5, team: 'WAS',
    practiceStatus: 'Limited Participation in Practice', practicePrimaryInjury: 'Hamstring',
    reportStatus: 'Questionable', reportPrimaryInjury: 'Hamstring',
  });
});

test('normalizeInjuryRow: blank and whitespace cells are null, not empty strings', () => {
  const row = practice.normalizeInjuryRow({ ...CSV_ROW, practice_status: '', practice_primary_injury: '  ', report_status: undefined, team: '' });
  assert.equal(row.practiceStatus, null);
  assert.equal(row.practicePrimaryInjury, null);
  assert.equal(row.reportStatus, null);
  assert.equal(row.team, null);
  assert.equal(practice.normalizeInjuryRow({ ...CSV_ROW, practice_status: '  Did Not Participate In Practice ' }).practiceStatus, 'Did Not Participate In Practice', 'trimmed');
});

test('normalizeInjuryRow drops rows with no player, a non-regular-season game or no usable season and week', () => {
  assert.equal(practice.normalizeInjuryRow({ ...CSV_ROW, gsis_id: '' }), null);
  assert.equal(practice.normalizeInjuryRow({ ...CSV_ROW, gsis_id: '0' }), null, 'the placeholder id');
  assert.equal(practice.normalizeInjuryRow({ ...CSV_ROW, game_type: 'POST' }), null);
  assert.equal(practice.normalizeInjuryRow({ ...CSV_ROW, week: 'x' }), null);
  assert.equal(practice.normalizeInjuryRow({ ...CSV_ROW, season: '' }), null);
  assert.ok(practice.normalizeInjuryRow({ ...CSV_ROW, game_type: undefined }), 'a file with no game_type column is still read');
});

// --- observationsToInsert ----------------------------------------------------

const fetched = (playerId, week, extra = {}) => ({
  playerId, gsisId: `g${playerId}`, season: 2026, week, team: 'KC',
  practiceStatus: 'Did Not Participate In Practice', practicePrimaryInjury: 'Knee',
  reportStatus: 'Questionable', reportPrimaryInjury: 'Knee', ...extra,
});
const latestOf = (...rows) => new Map(rows.map((r) => [practice.observationKey(r), r]));
const BLANK = { practiceStatus: null, practicePrimaryInjury: null, reportStatus: null, reportPrimaryInjury: null };

test('observationsToInsert: a player with no stored row is inserted, even with every field blank', () => {
  const out = practice.observationsToInsert({ latest: new Map(), fetched: [fetched(1, 5), fetched(2, 5, BLANK)] });
  assert.deepEqual(out.map((r) => r.playerId), [1, 2]);
});

test('observationsToInsert: an unchanged row is not inserted again, and null equals a stored blank', () => {
  assert.deepEqual(practice.observationsToInsert({ latest: latestOf(fetched(1, 5)), fetched: [fetched(1, 5)] }), []);
  assert.deepEqual(practice.observationsToInsert({ latest: latestOf(fetched(2, 5, BLANK)), fetched: [fetched(2, 5, BLANK)] }), []);
});

test('observationsToInsert: a change to any one of the four fields is inserted', () => {
  const latest = latestOf(fetched(1, 5));
  for (const change of [
    { practiceStatus: 'Limited Participation in Practice' },
    { practicePrimaryInjury: 'Hamstring' },
    { reportStatus: 'Doubtful' },
    { reportPrimaryInjury: 'Not injury related - resting player' },
    { practiceStatus: null },
  ]) {
    const out = practice.observationsToInsert({ latest, fetched: [fetched(1, 5, change)] });
    assert.equal(out.length, 1, JSON.stringify(change));
    assert.equal(out[0].playerId, 1);
  }
});

test('observationsToInsert: the team alone changing is not a new observation; weeks are independent', () => {
  const latest = latestOf(fetched(1, 5));
  assert.deepEqual(practice.observationsToInsert({ latest, fetched: [fetched(1, 5, { team: 'DAL' })] }), []);
  const out = practice.observationsToInsert({ latest, fetched: [fetched(1, 6)] });
  assert.equal(out.length, 1, 'week 6 has no stored row for him');
  assert.equal(out[0].week, 6);
});

test('observationsToInsert: a repeated row in one file counts once, the last one winning', () => {
  const out = practice.observationsToInsert({
    latest: new Map(),
    fetched: [fetched(1, 5), fetched(1, 5, { practiceStatus: 'Full Participation in Practice' })],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].practiceStatus, 'Full Participation in Practice');
});

// --- attachPlayerIds ---------------------------------------------------------

test('attachPlayerIds maps gsis -> espn -> players.id and counts the rows it could not place', () => {
  const rows = ['00-0039924', '00-0000001', '00-0000002'].map((g) => ({ gsisId: g, season: 2026, week: 5 }));
  const crosswalk = new Map([['00-0039924', '4429795'], ['00-0000002', '999']]);
  const idByExternal = new Map([['4429795', 42]]);
  const out = practice.attachPlayerIds(rows, { crosswalk, idByExternal });
  assert.deepEqual(out.rows.map((r) => [r.gsisId, r.playerId]), [['00-0039924', 42]]);
  assert.equal(out.unmapped, 2, 'no crosswalk row, and a crosswalk row for a player we do not roster');
});

// --- the poll ----------------------------------------------------------------

const HEADER = 'season,game_type,team,week,gsis_id,report_primary_injury,report_status,practice_primary_injury,practice_status';
const FILE = [
  HEADER,
  '2026,REG,WAS,5,00-0039924,Hamstring,Questionable,Hamstring,Did Not Participate In Practice',
  '2026,REG,KC,5,00-0000002,Knee,,Knee,Limited Participation in Practice',
  '2026,REG,KC,4,00-0039924,Hamstring,,Hamstring,Full Participation in Practice',
  '2026,REG,KC,5,00-0000009,Ankle,,Ankle,Limited Participation in Practice',
].join('\n');
const TIMESTAMP_URL = 'https://github.com/nflverse/nflverse-data/releases/download/injuries/timestamp.json';

function stubFeed(t, { lastUpdated = '2026-10-02T15:00:00', timestampFails = false, fileFails = false } = {}) {
  const log = [];
  t.mock.method(axios, 'get', async (url) => {
    log.push(url);
    if (url === TIMESTAMP_URL) {
      if (timestampFails) throw new Error('timestamp 503');
      return { data: JSON.stringify({ last_updated: lastUpdated }) };
    }
    if (url.includes('injuries_')) {
      if (fileFails) throw new Error('file 503');
      return { data: FILE };
    }
    if (url.includes('players.csv')) return { data: 'gsis_id,espn_id\n00-0039924,4429795\n00-0000002,4429796\n' };
    throw new Error(`unexpected GET ${url}`);
  });
  return log;
}

function fakePracticePool(t, { leagues = [{ id: 7, current_season: 2026, current_week: 5 }], seen = false, latest = [], runRows = [], inserts = [] } = {}) {
  return createFakePool([
    [select('leagues'), () => ({ rows: leagues })],
    [/^SELECT 1 FROM "data_sync_runs"/, () => ({ rows: seen ? [{ '?column?': 1 }] : [] })],
    [/^SELECT "id", "external_id" FROM "players"/, () => ({ rows: [{ id: 42, external_id: '4429795' }, { id: 43, external_id: '4429796' }] }), 'client'],
    [/FROM "player_practice_observations"/, () => ({ rows: latest }), 'client'],
    [insert('player_practice_observations'), (text, params) => { inserts.push(params); return { rowCount: params[0].length, rows: [] }; }, 'client'],
    [insert('data_sync_runs'), (text, params) => { runRows.push(params); return { rows: [] }; }],
  ]).install(t);
}

test('syncCurrentWeeks stores one row per player-week on first sight, records the nflverse timestamp, and drops players we cannot place', async (t) => {
  const log = stubFeed(t);
  const inserts = [];
  const runRows = [];
  const fake = fakePracticePool(t, { inserts, runRows });

  const out = await practice.syncCurrentWeeks({ now: new Date('2026-10-02T16:00:00Z') });

  assert.deepEqual(out.synced, [{ season: 2026, week: 5, inserted: 2, unmapped: 1 }]);
  assert.equal(inserts.length, 1);
  const [playerIds, gsisIds, season, week, teams, practiceStatuses, , reportStatuses, , observedAt, sourceLastUpdated] = inserts[0];
  assert.deepEqual(playerIds, [42, 43], 'week 4 and the unmapped player are not written');
  assert.deepEqual(gsisIds, ['00-0039924', '00-0000002']);
  assert.equal(season, 2026);
  assert.equal(week, 5);
  assert.deepEqual(teams, ['WAS', 'KC'], 'the team as nflverse spells it');
  assert.deepEqual(practiceStatuses, ['Did Not Participate In Practice', 'Limited Participation in Practice']);
  assert.deepEqual(reportStatuses, ['Questionable', null], 'a blank cell is null');
  assert.equal(new Date(observedAt).toISOString(), '2026-10-02T16:00:00.000Z', 'our observation time');
  assert.equal(sourceLastUpdated, '2026-10-02T15:00:00', 'nflverse\'s timestamp, verbatim');
  assert.equal(runRows[0][0], 'nflverse-practice');
  assert.deepEqual(JSON.parse(runRows[0][3]), { sourceLastUpdated: '2026-10-02T15:00:00', season: 2026, week: 5, inserted: 2, unmapped: 1 });
  assert.ok(log.some((u) => u.includes('injuries_2026.csv')));
  assert.ok(!fake.calls.some((c) => /\b(DELETE|UPDATE|TRUNCATE)\b/i.test(c.text)), 'the table is only ever appended to');
  fake.assertClean();
});

test('syncCurrentWeeks inserts only the players whose practice or report fields changed since the latest stored row', async (t) => {
  stubFeed(t);
  const inserts = [];
  fakePracticePool(t, {
    inserts,
    latest: [
      // 42 unchanged; 43 was Full on the last poll, now Limited.
      { player_id: 42, season: 2026, week: 5, practice_status: 'Did Not Participate In Practice', practice_primary_injury: 'Hamstring', report_status: 'Questionable', report_primary_injury: 'Hamstring' },
      { player_id: 43, season: 2026, week: 5, practice_status: 'Full Participation in Practice', practice_primary_injury: 'Knee', report_status: null, report_primary_injury: 'Knee' },
    ],
  });

  const out = await practice.syncCurrentWeeks();

  assert.deepEqual(out.synced, [{ season: 2026, week: 5, inserted: 1, unmapped: 1 }]);
  assert.deepEqual(inserts[0][0], [43]);
});

test('syncCurrentWeeks downloads nothing when nflverse\'s timestamp is the one already captured', async (t) => {
  const log = stubFeed(t);
  const runRows = [];
  const fake = fakePracticePool(t, { seen: true, runRows });

  const out = await practice.syncCurrentWeeks();

  assert.deepEqual(out.synced, []);
  assert.deepEqual(log, [TIMESTAMP_URL]);
  assert.equal(runRows.length, 0, 'no run row for a check that found nothing new');
  assert.deepEqual(fake.calls.find((c) => /FROM "data_sync_runs"/.test(c.text)).params, ['2026-10-02T15:00:00', '2026', '5']);
});

test('syncCurrentWeeks: an outage loses only that poll and never touches stored rows', async (t) => {
  const errors = [];
  for (const failure of [{ timestampFails: true }, { fileFails: true }]) {
    t.mock.restoreAll();
    t.mock.method(console, 'error', (...args) => { errors.push(util.format(...args)); });
    stubFeed(t, failure);
    const fake = fakePracticePool(t);
    const out = await practice.syncCurrentWeeks();
    assert.deepEqual(out.synced, [], JSON.stringify(failure));
    assert.ok(!fake.calls.some((c) => /INSERT INTO "player_practice_observations"|\b(DELETE|UPDATE|TRUNCATE)\b/i.test(c.text)), JSON.stringify(failure));
  }
  assert.ok(errors.some((e) => /practice participation poll failed for 2026 week 5: timestamp 503/.test(e)));
  assert.ok(errors.some((e) => /practice participation poll failed for 2026 week 5: file 503/.test(e)));
});

test('syncCurrentWeeks asks nothing of nflverse when no league is in season', async (t) => {
  const log = stubFeed(t);
  fakePracticePool(t, { leagues: [] });
  assert.deepEqual((await practice.syncCurrentWeeks()).synced, []);
  assert.deepEqual(log, []);
});

// --- loadWeekObservations ----------------------------------------------------

test('loadWeekObservations: one batched read, oldest first, grouped by player', async (t) => {
  const fake = createFakePool([
    [/FROM "player_practice_observations"/, () => ({
      rows: [
        { player_id: 1, practice_status: 'Did Not Participate In Practice', practice_primary_injury: 'Knee', report_primary_injury: 'Knee' },
        { player_id: 2, practice_status: null, practice_primary_injury: null, report_primary_injury: null },
        { player_id: 1, practice_status: 'Limited Participation in Practice', practice_primary_injury: 'Knee', report_primary_injury: 'Knee' },
      ],
    })],
  ]).install(t);

  const byPlayer = await practice.loadWeekObservations(pool, { season: 2026, week: 5, playerIds: [1, 2, 3] });

  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].text, /ORDER BY "observed_at", "id"/);
  assert.deepEqual(fake.calls[0].params, [2026, 5, [1, 2, 3]]);
  assert.deepEqual(byPlayer.get(1).map((o) => o.practiceStatus), ['Did Not Participate In Practice', 'Limited Participation in Practice']);
  assert.equal(byPlayer.get(2)[0].practiceStatus, null);
  assert.equal(byPlayer.has(3), false);
});

test('loadWeekObservations: no players, no query', async (t) => {
  const fake = createFakePool([]).install(t);
  assert.equal((await practice.loadWeekObservations(pool, { season: 2026, week: 5, playerIds: [] })).size, 0);
  assert.equal(fake.calls.length, 0);
});
