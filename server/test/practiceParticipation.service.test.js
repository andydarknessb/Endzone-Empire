const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');
const axios = require('axios');
const pool = require('../modules/pool');
const { createFakePool, insert } = require('./helpers/fakePool');
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

// --- weekInPlay ---------------------------------------------------------------

// nfl_games bounds for weeks 4-6 of 2026: Monday-night last kickoffs.
const BOUNDS = [
  { week: 4, lastKickoffAt: new Date('2026-10-06T00:15:00Z') },
  { week: 5, lastKickoffAt: new Date('2026-10-13T00:15:00Z') },
  { week: 6, lastKickoffAt: new Date('2026-10-20T00:15:00Z') },
];

test('weekInPlay: the smallest week whose last kickoff is still ahead, whatever any league sits on', () => {
  assert.equal(practice.weekInPlay(BOUNDS, new Date('2026-10-02T16:00:00Z')), 4, 'Friday of week 4');
  assert.equal(practice.weekInPlay(BOUNDS, new Date('2026-10-05T23:00:00Z')), 4, 'Monday before the night game');
  assert.equal(practice.weekInPlay(BOUNDS, new Date('2026-10-06T00:15:00Z')), 5, 'at the last kickoff the next week is in play');
  assert.equal(practice.weekInPlay(BOUNDS, new Date('2026-10-07T16:00:00Z')), 5, 'Wednesday of week 5');
  assert.equal(practice.weekInPlay([...BOUNDS].reverse(), new Date('2026-10-07T16:00:00Z')), 5, 'order of bounds is irrelevant');
});

test('weekInPlay: nothing more than a week before the next last kickoff, after the season, or with no schedule', () => {
  assert.equal(practice.weekInPlay(BOUNDS, new Date('2026-09-28T00:00:00Z')), null, 'eight days before week 4 closes');
  assert.equal(practice.weekInPlay(BOUNDS, new Date('2026-09-29T00:15:00Z')), 4, 'seven days before');
  assert.equal(practice.weekInPlay(BOUNDS, new Date('2026-10-20T00:15:00Z')), null, 'every week closed');
  assert.equal(practice.weekInPlay([], new Date('2026-10-07T16:00:00Z')), null);
  assert.equal(practice.weekInPlay(undefined, new Date('2026-10-07T16:00:00Z')), null);
});

// --- the poll ----------------------------------------------------------------

const HEADER = 'season,game_type,team,week,gsis_id,report_primary_injury,report_status,practice_primary_injury,practice_status';
const FILE = [
  HEADER,
  '2026,REG,WAS,5,00-0039924,Hamstring,Questionable,Hamstring,Did Not Participate In Practice',
  '2026,REG,KC,5,00-0000002,Knee,,Knee,Limited Participation in Practice',
  '2026,REG,KC,4,00-0039924,Hamstring,,Hamstring,Full Participation in Practice',
  '2026,REG,KC,5,00-0000009,Ankle,,Ankle,Limited Participation in Practice',
  // A Thursday-game team's week 6 report, published while week 5 is in play.
  '2026,REG,KC,6,00-0000002,Knee,,Knee,Did Not Participate In Practice',
].join('\n');
const TIMESTAMP_URL = 'https://github.com/nflverse/nflverse-data/releases/download/injuries/timestamp.json';
const WEEK5_WEDNESDAY = new Date('2026-10-07T16:00:00Z');

function stubFeed(t, { lastUpdated = '2026-10-07T15:00:00', timestampFails = false, fileFails = false } = {}) {
  const log = [];
  t.mock.method(axios, 'get', async (url) => {
    log.push(url);
    if (url === TIMESTAMP_URL) {
      if (timestampFails) throw new Error('timestamp 503');
      return { data: JSON.stringify(lastUpdated === null ? {} : { last_updated: lastUpdated }) };
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

// The schedule as nfl_games holds it (SEASON_KICKOFFS_SQL rows), weeks 4-6.
const KICKOFF_ROWS = BOUNDS.map((b) => ({ week: b.week, kickoff_at: b.lastKickoffAt.toISOString() }));

function fakePracticePool(t, { kickoffs = KICKOFF_ROWS, seen = false, latest = [], runRows = [], inserts = [] } = {}) {
  return createFakePool([
    [/EXTRACT\(MONTH FROM CURRENT_DATE\)/, () => ({ rows: [{ season: 2026 }] })],
    [/FROM "nfl_games"/, () => ({ rows: kickoffs })],
    [/^SELECT 1 FROM "data_sync_runs"/, () => ({ rows: seen ? [{ '?column?': 1 }] : [] })],
    [/^SELECT "id", "external_id" FROM "players"/, () => ({ rows: [{ id: 42, external_id: '4429795' }, { id: 43, external_id: '4429796' }] }), 'pool'],
    [/FROM "player_practice_observations"/, () => ({ rows: latest }), 'client'],
    [insert('player_practice_observations'), (text, params) => { inserts.push(params); return { rowCount: params[0].length, rows: [] }; }, 'client'],
    [insert('data_sync_runs'), (text, params) => { runRows.push(params); return { rows: [] }; }],
  ]).install(t);
}

test('syncCurrentWeeks captures the NFL week in play and any later week in the file, records the nflverse timestamp, and drops players it cannot place', async (t) => {
  const log = stubFeed(t);
  const inserts = [];
  const runRows = [];
  const fake = fakePracticePool(t, { inserts, runRows });

  const out = await practice.syncCurrentWeeks({ now: WEEK5_WEDNESDAY });

  assert.deepEqual(out.synced, [{ season: 2026, fromWeek: 5, inserted: 3, unmapped: 1 }]);
  assert.equal(inserts.length, 1);
  const [playerIds, gsisIds, season, weeks, teams, practiceStatuses, , reportStatuses, , observedAt, sourceLastUpdated] = inserts[0];
  assert.deepEqual(playerIds, [42, 43, 43], 'week 4 and the unmapped player are not written');
  assert.deepEqual(gsisIds, ['00-0039924', '00-0000002', '00-0000002']);
  assert.equal(season, 2026);
  assert.deepEqual(weeks, [5, 5, 6], 'the week rides per row: week 6 is already in the file');
  assert.deepEqual(teams, ['WAS', 'KC', 'KC'], 'the team as nflverse spells it');
  assert.deepEqual(practiceStatuses, ['Did Not Participate In Practice', 'Limited Participation in Practice', 'Did Not Participate In Practice']);
  assert.deepEqual(reportStatuses, ['Questionable', null, null], 'a blank cell is null');
  assert.equal(new Date(observedAt).toISOString(), '2026-10-07T16:00:00.000Z', 'our observation time');
  assert.equal(sourceLastUpdated, '2026-10-07T15:00:00', 'nflverse\'s timestamp, verbatim');
  assert.equal(runRows[0][0], 'nflverse-practice');
  assert.deepEqual(JSON.parse(runRows[0][3]), { sourceLastUpdated: '2026-10-07T15:00:00', season: 2026, fromWeek: 5, inserted: 3, unmapped: 1 });
  assert.ok(log.some((u) => u.includes('injuries_2026.csv')));
  assert.equal(log.filter((u) => u.includes('players.csv')).length, 1, 'players.csv once per poll');
  const playerReads = fake.calls.filter((c) => /^SELECT "id", "external_id" FROM "players"/.test(c.text));
  assert.equal(playerReads.length, 1, 'the id map is read once per poll');
  assert.equal(playerReads[0].via, 'pool', 'and outside the write transaction');
  assert.ok(!fake.calls.some((c) => /\b(DELETE|UPDATE|TRUNCATE)\b/i.test(c.text)), 'the table is only ever appended to');
  assert.ok(!fake.calls.some((c) => /FROM "leagues"/.test(c.text)), 'no league state is read: the NFL calendar decides the week');
  assert.deepEqual(fake.calls.find((c) => /FROM "player_practice_observations"/.test(c.text)).params, [2026, 5], 'the diff reads week 5 on');
  fake.assertClean();
});

test('syncCurrentWeeks on the Friday of week 4 captures week 4, not the week a league may already sit on', async (t) => {
  stubFeed(t);
  const inserts = [];
  fakePracticePool(t, { inserts });

  const out = await practice.syncCurrentWeeks({ now: new Date('2026-10-02T16:00:00Z') });

  assert.deepEqual(out.synced, [{ season: 2026, fromWeek: 4, inserted: 4, unmapped: 1 }]);
  assert.deepEqual(inserts[0][3], [5, 5, 4, 6], 'week 4 and every later week in the file');
});

test('syncCurrentWeeks inserts only the players whose practice or report fields changed since the latest stored row', async (t) => {
  stubFeed(t);
  const inserts = [];
  fakePracticePool(t, {
    inserts,
    latest: [
      // 42 unchanged; 43 was Full on the last poll, now Limited; 43's week 6 row unchanged.
      { player_id: 42, season: 2026, week: 5, practice_status: 'Did Not Participate In Practice', practice_primary_injury: 'Hamstring', report_status: 'Questionable', report_primary_injury: 'Hamstring' },
      { player_id: 43, season: 2026, week: 5, practice_status: 'Full Participation in Practice', practice_primary_injury: 'Knee', report_status: null, report_primary_injury: 'Knee' },
      { player_id: 43, season: 2026, week: 6, practice_status: 'Did Not Participate In Practice', practice_primary_injury: 'Knee', report_status: null, report_primary_injury: 'Knee' },
    ],
  });

  const out = await practice.syncCurrentWeeks({ now: WEEK5_WEDNESDAY });

  assert.deepEqual(out.synced, [{ season: 2026, fromWeek: 5, inserted: 1, unmapped: 1 }]);
  assert.deepEqual(inserts[0][0], [43]);
  assert.deepEqual(inserts[0][3], [5]);
});

test('syncCurrentWeeks downloads nothing when nflverse\'s timestamp is the one already captured', async (t) => {
  const log = stubFeed(t);
  const runRows = [];
  const fake = fakePracticePool(t, { seen: true, runRows });

  const out = await practice.syncCurrentWeeks({ now: WEEK5_WEDNESDAY });

  assert.deepEqual(out.synced, []);
  assert.deepEqual(log, [TIMESTAMP_URL]);
  assert.equal(runRows.length, 0, 'no run row for a check that found nothing new');
  assert.deepEqual(fake.calls.find((c) => /FROM "data_sync_runs"/.test(c.text)).params, ['2026-10-07T15:00:00', '2026', '5']);
});

test('syncCurrentWeeks: a timestamp.json with no last_updated is a failed poll, never a download', async (t) => {
  const errors = [];
  t.mock.method(console, 'error', (...args) => { errors.push(util.format(...args)); });
  const log = stubFeed(t, { lastUpdated: null });
  const runRows = [];
  const fake = fakePracticePool(t, { runRows });

  const out = await practice.syncCurrentWeeks({ now: WEEK5_WEDNESDAY });

  assert.deepEqual(out.synced, []);
  assert.deepEqual(log, [TIMESTAMP_URL], 'no season file, no players.csv');
  assert.equal(runRows.length, 0);
  assert.ok(!fake.calls.some((c) => /INSERT INTO "player_practice_observations"/.test(c.text)));
  assert.ok(errors.some((e) => /practice participation poll failed for 2026 week 5: nflverse injuries timestamp.json has no last_updated/.test(e)));
});

test('syncCurrentWeeks: an outage loses only that poll and never touches stored rows', async (t) => {
  const errors = [];
  for (const failure of [{ timestampFails: true }, { fileFails: true }]) {
    t.mock.restoreAll();
    t.mock.method(console, 'error', (...args) => { errors.push(util.format(...args)); });
    stubFeed(t, failure);
    const fake = fakePracticePool(t);
    const out = await practice.syncCurrentWeeks({ now: WEEK5_WEDNESDAY });
    assert.deepEqual(out.synced, [], JSON.stringify(failure));
    assert.ok(!fake.calls.some((c) => /INSERT INTO "player_practice_observations"|\b(DELETE|UPDATE|TRUNCATE)\b/i.test(c.text)), JSON.stringify(failure));
  }
  assert.ok(errors.some((e) => /practice participation poll failed for 2026 week 5: timestamp 503/.test(e)));
  assert.ok(errors.some((e) => /practice participation poll failed for 2026 week 5: file 503/.test(e)));
});

test('syncCurrentWeeks asks nothing of nflverse between seasons or with no schedule on file', async (t) => {
  const log = stubFeed(t);
  fakePracticePool(t, { kickoffs: [] });
  assert.deepEqual((await practice.syncCurrentWeeks({ now: WEEK5_WEDNESDAY })).synced, []);
  fakePracticePool(t);
  assert.deepEqual((await practice.syncCurrentWeeks({ now: new Date('2026-10-20T00:15:00Z') })).synced, [], 'every week closed');
  assert.deepEqual((await practice.syncCurrentWeeks({ now: new Date('2026-09-20T00:00:00Z') })).synced, [], 'more than a week before week 4 closes');
  assert.deepEqual(log, []);
});

// --- loadWeekObservations ----------------------------------------------------

test('loadWeekObservations: one batched read, oldest first, grouped by player, with the observation time', async (t) => {
  const fake = createFakePool([
    [/FROM "player_practice_observations"/, () => ({
      rows: [
        { player_id: 1, practice_status: 'Did Not Participate In Practice', practice_primary_injury: 'Knee', report_primary_injury: 'Knee', observed_at: new Date('2026-10-07T22:00:00Z') },
        { player_id: 2, practice_status: null, practice_primary_injury: null, report_primary_injury: null, observed_at: new Date('2026-10-07T22:00:00Z') },
        { player_id: 1, practice_status: 'Limited Participation in Practice', practice_primary_injury: 'Knee', report_primary_injury: 'Knee', observed_at: new Date('2026-10-08T22:00:00Z') },
      ],
    })],
  ]).install(t);

  const byPlayer = await practice.loadWeekObservations(pool, { season: 2026, week: 5, playerIds: [1, 2, 3] });

  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].text, /ORDER BY "observed_at", "id"/);
  assert.deepEqual(fake.calls[0].params, [2026, 5, [1, 2, 3]]);
  assert.deepEqual(byPlayer.get(1).map((o) => o.practiceStatus), ['Did Not Participate In Practice', 'Limited Participation in Practice']);
  assert.deepEqual(byPlayer.get(1).map((o) => o.observedAt.toISOString()), ['2026-10-07T22:00:00.000Z', '2026-10-08T22:00:00.000Z']);
  assert.equal(byPlayer.get(2)[0].practiceStatus, null);
  assert.equal(byPlayer.has(3), false);
});

test('loadWeekObservations: no players, no query', async (t) => {
  const fake = createFakePool([]).install(t);
  assert.equal((await practice.loadWeekObservations(pool, { season: 2026, week: 5, playerIds: [] })).size, 0);
  assert.equal(fake.calls.length, 0);
});

// --- practiceLabel / practiceEntries / weekPracticeEntries (#1923) -------------

test('practiceLabel maps the three nflverse statuses by anchored pattern and nothing else', () => {
  assert.equal(practice.practiceLabel('Did Not Participate In Practice'), 'Did not participate');
  assert.equal(practice.practiceLabel('Limited Participation in Practice'), 'Limited');
  assert.equal(practice.practiceLabel('Full Participation in Practice'), 'Full');
  assert.equal(practice.practiceLabel('Not Injury Related - Did Not Participate'), null);
  assert.equal(practice.practiceLabel('Rest'), null);
  assert.equal(practice.practiceLabel(null), null);
});

const obs = (practiceStatus, observedAt) => ({ practiceStatus, practicePrimaryInjury: null, reportPrimaryInjury: null, observedAt: new Date(observedAt) });

test('practiceEntries: oldest first, a report-only repeat of the last label is not shown again', () => {
  assert.deepEqual(
    practice.practiceEntries([
      obs('Did Not Participate In Practice', '2026-10-07T22:00:00Z'),
      obs('Did Not Participate In Practice', '2026-10-08T22:00:00Z'),
      obs('Limited Participation in Practice', '2026-10-09T22:00:00Z'),
      obs('Full Participation in Practice', '2026-10-10T22:00:00Z'),
    ]),
    [
      { status: 'Did not participate', day: 'Wed' },
      { status: 'Limited', day: 'Fri' },
      { status: 'Full', day: 'Sat' },
    ],
  );
});

test('practiceEntries: null and unrecognised rows are skipped before the dedupe, so they never break a run', () => {
  assert.deepEqual(
    practice.practiceEntries([
      obs('Limited Participation in Practice', '2026-10-07T22:00:00Z'),
      obs(null, '2026-10-08T22:00:00Z'),
      obs('Rest', '2026-10-08T23:00:00Z'),
      obs('Limited Participation in Practice', '2026-10-09T22:00:00Z'),
    ]),
    [{ status: 'Limited', day: 'Wed' }],
  );
});

test('practiceEntries: the day is the America/New_York weekday of observedAt (03:30Z on Fri 2 Oct reads Thu)', () => {
  assert.deepEqual(
    practice.practiceEntries([obs('Full Participation in Practice', '2026-10-02T03:30:00Z')]),
    [{ status: 'Full', day: 'Thu' }],
  );
});

test('practiceEntries: two entries on one day both show; nothing surviving is null', () => {
  assert.deepEqual(
    practice.practiceEntries([
      obs('Limited Participation in Practice', '2026-10-07T15:00:00Z'),
      obs('Full Participation in Practice', '2026-10-07T20:00:00Z'),
    ]).map((e) => e.day),
    ['Wed', 'Wed'],
  );
  assert.equal(practice.practiceEntries([obs(null, '2026-10-07T15:00:00Z')]), null);
  assert.equal(practice.practiceEntries([]), null);
});

test('weekPracticeEntries reads the one player\'s week and returns the mapped entries, null for a player with no rows', async (t) => {
  const fake = createFakePool([
    [/FROM "player_practice_observations"/, (_text, params) => ({
      rows: params[2][0] !== 1 ? [] : [{ player_id: 1, practice_status: 'Limited Participation in Practice', practice_primary_injury: null, report_primary_injury: null, observed_at: new Date('2026-10-07T22:00:00Z') }],
    })],
  ]).install(t);
  assert.deepEqual(await practice.weekPracticeEntries(pool, { season: 2026, week: 5, playerId: 1 }), [{ status: 'Limited', day: 'Wed' }]);
  assert.deepEqual(fake.calls[0].params, [2026, 5, [1]]);
  assert.equal(await practice.weekPracticeEntries(pool, { season: 2026, week: 5, playerId: 2 }), null);
});
