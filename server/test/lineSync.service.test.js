/**
 * The hourly Line Sync run (#1262, ADR 0038): Record, Venue and Broadcast for
 * a week's slate, read off the free ESPN scoreboard and written onto the
 * seven columns this job owns on `live_game_states` — never the score,
 * status, clock or Situation columns the thirty-second poll owns.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/espn-scoreboard-2025-w1.json');
const { createFakePool, update, insert } = require('./helpers/fakePool');
const { fetchLineUnits, applyLineUnit, syncLine, LINE_SYNC_JOB } = require('../services/lineSync.service');

const gbAtChiPayload = () => ({
  events: [
    {
      shortName: 'GB @ CHI',
      competitions: [
        {
          date: '2026-09-13T17:00Z',
          status: { type: { state: 'pre' } },
          venue: { fullName: 'Soldier Field', address: { city: 'Chicago' }, indoor: false },
          neutralSite: false,
          broadcasts: [{ names: ['FOX'] }],
          competitors: [
            {
              homeAway: 'home',
              score: '0',
              team: { abbreviation: 'CHI' },
              records: [
                { type: 'total', summary: '5-7' },
                { type: 'home', summary: '3-3' },
                { type: 'road', summary: '2-4' },
              ],
            },
            {
              homeAway: 'away',
              score: '0',
              team: { abbreviation: 'GB' },
              records: [
                { type: 'total', summary: '10-2' },
                { type: 'home', summary: '6-0' },
                { type: 'road', summary: '4-2' },
              ],
            },
          ],
        },
      ],
    },
  ],
});

// ---------------------------------------------------------------------------
// fetchLineUnits — the Sync run's fetch()
// ---------------------------------------------------------------------------

test('fetchLineUnits: an event carrying Venue/Broadcast/Record becomes one unit for the whole slate', async () => {
  const transport = { async get() { return { data: gbAtChiPayload() }; } };
  const units = await fetchLineUnits({ season: 2026, week: 2, transport });
  assert.equal(units.length, 1, 'one unit for the whole slate');
  assert.equal(units[0].rows.length, 1);
  const [row] = units[0].rows;
  assert.equal(row.tank01GameId, '20260913_GB@CHI');
  assert.equal(row.venueName, 'Soldier Field');
  assert.equal(row.broadcast, 'FOX');
  assert.deepEqual(row.homeRecord, { total: '5-7', home: '3-3', road: '2-4' });
});

test('fetchLineUnits: an event with none of Venue/Broadcast/Record resolves to zero units, not a refusal', async () => {
  const noLineFields = {
    events: [
      {
        shortName: 'DAL @ PHI',
        competitions: [
          {
            date: '2026-09-13T17:00Z',
            status: { type: { state: 'pre' } },
            competitors: [
              { homeAway: 'home', score: '0', team: { abbreviation: 'PHI' } },
              { homeAway: 'away', score: '0', team: { abbreviation: 'DAL' } },
            ],
          },
        ],
      },
    ],
  };
  const transport = { async get() { return { data: noLineFields }; } };
  const units = await fetchLineUnits({ season: 2026, week: 2, transport });
  assert.deepEqual(units, []);
});

test('fetchLineUnits: a real 16-game week keeps only events that carry a Venue/Broadcast/Record field', async () => {
  const transport = { async get() { return { data: fixture }; } };
  const units = await fetchLineUnits({ season: 2025, week: 1, transport });
  // The shared fixture (used by espnScoreboard.test.js/espnOddsProvider.test.js)
  // carries no venue/broadcasts/records blocks on any event.
  assert.deepEqual(units, []);
});

// ---------------------------------------------------------------------------
// applyLineUnit — the Sync run's apply()
// ---------------------------------------------------------------------------

test('applyLineUnit: updates exactly the seven Venue/Broadcast/Record columns, never score/status/clock', async (t) => {
  const fake = createFakePool([
    [update('live_game_states'), (text, params) => {
      assert.doesNotMatch(text, /"game_status"|"current_score_home"|"current_score_away"|"quarter"|"time_remaining"|"possession"/);
      return { rows: [{ tank01_game_id: params[0][0] }], rowCount: 1 };
    }],
  ]).install(t);

  const result = await applyLineUnit(fake, {
    rows: [
      {
        tank01GameId: '20260913_GB@CHI',
        venueName: 'Soldier Field',
        venueCity: 'Chicago',
        isIndoor: false,
        isNeutralSite: false,
        broadcast: 'FOX',
        homeRecord: { total: '5-7', home: '3-3', road: '2-4' },
        awayRecord: { total: '10-2', home: '6-0', road: '4-2' },
      },
    ],
  });
  assert.deepEqual(result, { gamesUpdated: 1 });
  const [call] = fake.matching(update('live_game_states'));
  assert.deepEqual(call.params[0], ['20260913_GB@CHI']);
  assert.deepEqual(call.params[1], ['Soldier Field']);
  assert.deepEqual(call.params[6], [JSON.stringify({ total: '5-7', home: '3-3', road: '2-4' })]);
});

// ---------------------------------------------------------------------------
// syncLine — the Sync run test, via the existing sync-run harness
// ---------------------------------------------------------------------------

const dataSyncRuns = (calls) => calls.filter((c) => insert('data_sync_runs').test(c.text));

test('syncLine: fetches the slate once outside any transaction, writes inside one transaction, records ok=true', async (t) => {
  const transport = { async get() { return { data: gbAtChiPayload() }; } };
  const fake = createFakePool([
    [update('live_game_states'), () => ({ rows: [], rowCount: 1 })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncLine({ season: 2026, week: 2, transport });

  assert.deepEqual(result, { gamesUpdated: 1 });
  assert.equal(fake.matching(/^BEGIN$/).length, 1);
  assert.equal(fake.matching(update('live_game_states')).length, 1);
  const beginIdx = fake.calls.findIndex((c) => c.text === 'BEGIN');
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  const updateIdx = fake.calls.findIndex((c) => update('live_game_states').test(c.text));
  assert.ok(beginIdx < updateIdx && updateIdx < commitIdx, 'the write sits inside the transaction');
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[2], true, 'ok is true');
  fake.assertClean();
});

test('syncLine: no lock is taken (this job never races the poll on the columns it owns)', async (t) => {
  const transport = { async get() { return { data: gbAtChiPayload() }; } };
  const fake = createFakePool([
    [update('live_game_states'), () => ({ rows: [], rowCount: 1 })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await syncLine({ season: 2026, week: 2, transport });
  assert.equal(fake.matching(/pg_advisory_xact_lock/).length, 0);
});

test('syncLine: a week with no Venue/Broadcast/Record fields opens no transaction and still records an ok run', async (t) => {
  const noLineFields = { events: [] };
  const transport = { async get() { return { data: noLineFields }; } };
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncLine({ season: 2026, week: 2, transport });
  assert.deepEqual(result, { results: [] });
  assert.equal(fake.matching(/^BEGIN$/).length, 0);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs[0].params[2], true);
  fake.assertClean();
});

test('syncLine: an ESPN fetch failure is recorded fetch_failed and rethrown, no transaction opens', async (t) => {
  const transport = { async get() { throw new Error('ESPN unavailable'); } };
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(syncLine({ season: 2026, week: 2, transport }), /ESPN unavailable/);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[2], false);
  const detail = JSON.parse(runs[0].params[3]);
  assert.equal(detail.reason, 'fetch_failed');
  assert.equal(fake.matching(/^BEGIN$/).length, 0);
});

test('LINE_SYNC_JOB is the job literal recorded on data_sync_runs', () => {
  assert.equal(LINE_SYNC_JOB, 'line-sync');
});
