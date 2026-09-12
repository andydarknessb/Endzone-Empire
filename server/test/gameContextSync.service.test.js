/**
 * The hourly game-context Sync run (#1262, ADR 0038): Record, Venue and
 * Broadcast for a week's slate, read off the free ESPN scoreboard and
 * upserted onto `live_game_states`, touching only the seven columns this job
 * owns — never the score, status, clock or Situation columns the
 * thirty-second poll owns.
 *
 * It upserts rather than only updating (qa-reviewer #1262 finding 1): the
 * poll's own kickoff window only opens once a kickoff has already happened,
 * so a game's row often does not exist yet when this job runs pre-kickoff —
 * exactly when Pick'em needs Venue/Broadcast/Record to inform a pick.
 *
 * Named for what it writes, not "Line" (pl-endzone formal review, #1262 f1):
 * CONTEXT.md's Line is the spread/total Sync run in espnOdds.provider.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/espn-scoreboard-2025-w1.json');
const { createFakePool, insert } = require('./helpers/fakePool');
const {
  fetchGameContextUnits,
  applyGameContextUnit,
  syncGameContext,
  GAME_CONTEXT_SYNC_JOB,
} = require('../services/gameContextSync.service');

const liveGameStates = insert('live_game_states');

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
// fetchGameContextUnits — the Sync run's fetch()
// ---------------------------------------------------------------------------

test('fetchGameContextUnits: an event carrying Venue/Broadcast/Record becomes one unit for the whole slate', async () => {
  const transport = { async get() { return { data: gbAtChiPayload() }; } };
  const units = await fetchGameContextUnits({ season: 2026, week: 2, transport });
  assert.equal(units.length, 1, 'one unit for the whole slate');
  assert.equal(units[0].rows.length, 1);
  const [row] = units[0].rows;
  assert.equal(row.tank01GameId, '20260913_GB@CHI');
  assert.equal(row.venueName, 'Soldier Field');
  assert.equal(row.broadcast, 'FOX');
  assert.deepEqual(row.homeRecord, { total: '5-7', home: '3-3', road: '2-4' });
});

test('fetchGameContextUnits: an event with none of Venue/Broadcast/Record resolves to zero units, not a refusal', async () => {
  const noGameContextFields = {
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
  const transport = { async get() { return { data: noGameContextFields }; } };
  const units = await fetchGameContextUnits({ season: 2026, week: 2, transport });
  assert.deepEqual(units, []);
});

test('fetchGameContextUnits: a real 16-game week keeps only events that carry a Venue/Broadcast/Record field', async () => {
  const transport = { async get() { return { data: fixture }; } };
  const units = await fetchGameContextUnits({ season: 2025, week: 1, transport });
  // The shared fixture (used by espnScoreboard.test.js/espnOddsProvider.test.js)
  // carries no venue/broadcasts/records blocks on any event.
  assert.deepEqual(units, []);
});

// ---------------------------------------------------------------------------
// applyGameContextUnit — the Sync run's apply()
// ---------------------------------------------------------------------------

test('applyGameContextUnit: upserts the base identity plus exactly the seven Venue/Broadcast/Record columns; ON CONFLICT never touches score/status/clock/Situation', async (t) => {
  const fake = createFakePool([
    [liveGameStates, (text, params) => {
      assert.match(text, /"venue_name"/);
      assert.match(text, /"home_record"/);
      // The base identity columns an INSERT needs are fine on the column
      // list; only the ON CONFLICT ... DO UPDATE SET clause matters for
      // "never touches" — that clause must name none of the poll's columns.
      const setClause = text.slice(text.indexOf('DO UPDATE SET'));
      assert.doesNotMatch(
        setClause,
        /"game_status"|"current_score_home"|"current_score_away"|"quarter"|"time_remaining"|"possession"|"home_win_probability"|"linescores"|"headline"/
      );
      return { rows: [{ tank01_game_id: params[0][0] }], rowCount: 1 };
    }],
  ]).install(t);

  const result = await applyGameContextUnit(fake, {
    rows: [
      {
        tank01GameId: '20260913_GB@CHI',
        season: 2026,
        week: 2,
        homeTeam: 'CHI',
        awayTeam: 'GB',
        gameStatus: 'scheduled',
        startTime: new Date('2026-09-13T17:00:00Z'),
        currentScoreHome: 0,
        currentScoreAway: 0,
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
  const [call] = fake.matching(liveGameStates);
  assert.deepEqual(call.params[0], ['20260913_GB@CHI'], 'tank01_game_id is params[0]');
  assert.deepEqual(call.params[9], ['Soldier Field'], 'venue_name is params[9]');
  assert.deepEqual(
    call.params[14],
    [JSON.stringify({ total: '5-7', home: '3-3', road: '2-4' })],
    'home_record is params[14]'
  );
  assert.deepEqual(
    call.params[15],
    [JSON.stringify({ total: '10-2', home: '6-0', road: '4-2' })],
    'away_record is params[15]'
  );
});

// ---------------------------------------------------------------------------
// syncGameContext — the Sync run test, via the existing sync-run harness
// ---------------------------------------------------------------------------

const dataSyncRuns = (calls) => calls.filter((c) => insert('data_sync_runs').test(c.text));

test('syncGameContext: fetches the slate once outside any transaction, writes inside one transaction, records ok=true', async (t) => {
  const transport = { async get() { return { data: gbAtChiPayload() }; } };
  const fake = createFakePool([
    [liveGameStates, () => ({ rows: [], rowCount: 1 })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncGameContext({ season: 2026, week: 2, transport });

  assert.deepEqual(result, { gamesUpdated: 1 });
  assert.equal(fake.matching(/^BEGIN$/).length, 1);
  assert.equal(fake.matching(liveGameStates).length, 1);
  const beginIdx = fake.calls.findIndex((c) => c.text === 'BEGIN');
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  const upsertIdx = fake.calls.findIndex((c) => liveGameStates.test(c.text));
  assert.ok(beginIdx < upsertIdx && upsertIdx < commitIdx, 'the write sits inside the transaction');
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[2], true, 'ok is true');
  fake.assertClean();
});

test('syncGameContext: no lock is taken', async (t) => {
  const transport = { async get() { return { data: gbAtChiPayload() }; } };
  const fake = createFakePool([
    [liveGameStates, () => ({ rows: [], rowCount: 1 })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await syncGameContext({ season: 2026, week: 2, transport });
  assert.equal(fake.matching(/pg_advisory_xact_lock/).length, 0);
});

test('syncGameContext: a week with no Venue/Broadcast/Record fields opens no transaction and still records an ok run', async (t) => {
  const noGameContextFields = { events: [] };
  const transport = { async get() { return { data: noGameContextFields }; } };
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncGameContext({ season: 2026, week: 2, transport });
  assert.deepEqual(result, { results: [] });
  assert.equal(fake.matching(/^BEGIN$/).length, 0);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs[0].params[2], true);
  fake.assertClean();
});

test('syncGameContext: an ESPN fetch failure is recorded fetch_failed and rethrown, no transaction opens', async (t) => {
  const transport = { async get() { throw new Error('ESPN unavailable'); } };
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(syncGameContext({ season: 2026, week: 2, transport }), /ESPN unavailable/);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[2], false);
  const detail = JSON.parse(runs[0].params[3]);
  assert.equal(detail.reason, 'fetch_failed');
  assert.equal(fake.matching(/^BEGIN$/).length, 0);
});

test('GAME_CONTEXT_SYNC_JOB is the job literal recorded on data_sync_runs', () => {
  assert.equal(GAME_CONTEXT_SYNC_JOB, 'game-context');
});
