const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, select, update } = require('./helpers/fakePool');
const prefs = require('../services/prefs.service');
const push = require('../services/push.service');
const { syncInjuries } = require('../services/feedSyncRuns.service');
const espnAthleteClient = require('../modules/espnAthleteClient');
const injuriesFixture = require('./fixtures/espn/injuries.json');
const { DEFAULT_ROSTER_SLOTS, setLineup } = require('../services/lineup.service');

// The document floor (#2115) is exercised by its own tests below; every other
// case here feeds a handful of entries, so it is off for this file.
process.env.INJURY_DOC_FLOOR = '0';

// One row of the ESPN injuries document as espnAthleteClient.injuries() returns it (#2115).
const listed = (athleteId, status, detail = null) => ({ athleteId, status, detail });

test('syncInjuries commits designation updates and IR flags before delivering gated push', async (t) => {
  const notifications = [];
  const fake = createFakePool([
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    // ADR 0058: the save reads the team's open Called shot; none in this world.
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 21, external_id: 'espn-21', injury_status: 'O' },
        { id: 22, external_id: 'espn-22', injury_status: 'Q' },
      ],
    }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [/FROM "lineup_entries"/, () => ({
      rows: [{
        player_id: 21,
        player_name: 'Test Runner',
        injury_status: 'Q',
        team_id: 31,
        owner_id: 41,
        league_id: 51,
      }],
    }), 'client'],
    [insert('notifications'), (text, params) => {
      notifications.push({ type: params[2], message: params[3] });
      return { rows: [] };
    }, 'client'],
    [TEAM_PLAYERS_ROSTER, () => ({ rows: [] })], // nobody rosters the changed player
  ]).install(t);
  t.mock.method(prefs, 'usersWanting', async (userIds, key) => {
    assert.ok(fake.calls.some((call) => call.text === 'COMMIT'));
    assert.deepEqual(userIds, [41]);
    assert.equal(key, 'irAlerts');
    return [];
  });
  t.mock.method(push, 'sendPushToUsers', async () => {
    throw new Error('opted-out manager must not receive push');
  });

  const result = await syncInjuries({
    fetchInjuries: async () => [
            listed('espn-21', 'Questionable', 'Ankle'),
            listed('espn-22', 'Active'),
          ],
  });

  assert.deepEqual(result, { playersUpdated: 2, irFlags: 1 });
  assert.match(fake.matching(select('players'))[0].text, /FOR UPDATE$/);
  // #929: one bulk UPDATE replaces the per-player loop. Rewritten from the old
  // assertion `fake.matching(update('players')).length === 2`, which pinned two
  // single-row writes; it now pins the SAME observable outcome - both matched
  // players carry their new designation and detail into the write - as one
  // statement whose three parallel parameter arrays (ids int[], statuses
  // text[], details text[], built in JS over every feed match in scan order)
  // carry exactly those two ids and their new values. espn-22 is Active, so its
  // status and detail are null; nulls reach SQL as NULL.
  const injuryWrites = fake.matching(update('players'));
  assert.equal(injuryWrites.length, 1, 'exactly one bulk UPDATE, not a per-row loop');
  assert.deepEqual(injuryWrites[0].params, [
    [21, 22],
    ['Q', null],
    ['Ankle', null],
  ], 'ids, statuses, details as three parallel arrays in scan order');
  // #904: syncInjuries serializes with syncAdp on the same transaction-scoped
  // advisory lock (id 23004, players-bulk-write). The lock is the FIRST statement
  // inside the transaction - after BEGIN, before the FOR UPDATE scan takes any
  // row locks - so it cannot form the deadlock cycle it exists to prevent. It
  // runs on the transaction client and is the blocking xact form (released by
  // COMMIT/ROLLBACK, never an explicit unlock). Red-tell: deleting the lock
  // statement, or moving it after the FOR UPDATE, turns this red.
  const beginIdx = fake.calls.findIndex((c) => c.text === 'BEGIN');
  const lockIdx = fake.calls.findIndex((c) => /^SELECT pg_advisory_xact_lock/.test(c.text));
  const forUpdateIdx = fake.calls.findIndex((c) => /FOR UPDATE$/.test(c.text));
  assert.ok(lockIdx >= 0, 'the advisory lock is acquired');
  assert.equal(fake.calls[lockIdx].via, 'client', 'the lock sits inside the transaction client');
  assert.deepEqual(fake.calls[lockIdx].params, [23004], 'the lock id is 23004 (players-bulk-write)');
  assert.ok(beginIdx >= 0 && beginIdx < lockIdx, 'BEGIN precedes the lock');
  assert.ok(lockIdx < forUpdateIdx, 'the lock is taken before the FOR UPDATE scan takes any row locks');
  assert.deepEqual(notifications, [{
    type: 'ir_flag',
    message: 'Test Runner is no longer IR-eligible (questionable). Move him out of IR before saving your lineup.',
  }]);
  const commitAt = fake.calls.findIndex((call) => call.text === 'COMMIT');
  assert.ok(commitAt >= 0);
  fake.assertClean();
});

test('an injury refresh cannot pass an IR placement before scanning the committed stash', { timeout: 2000 }, async (t) => {
  let playerDesignation = 'O';
  let lineupSlot = 'BENCH';
  let notifications = 0;
  let lineupReadHasLock = false;
  let signalDesignationRead;
  let signalSyncAttempted;
  let signalLineupMoved;
  let signalSyncScanned;
  const designationRead = new Promise((resolve) => { signalDesignationRead = resolve; });
  const syncAttempted = new Promise((resolve) => { signalSyncAttempted = resolve; });
  const lineupMoved = new Promise((resolve) => { signalLineupMoved = resolve; });
  const syncScanned = new Promise((resolve) => { signalSyncScanned = resolve; });

  const fake = createFakePool([
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    // ADR 0058: the save reads the team's open Called shot; none in this world.
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{
      id: 5,
      current_season: 2026,
      current_week: 8,
      roster_slots: DEFAULT_ROSTER_SLOTS,
      bench_slots: 5,
      ir_slots: 1,
    }] })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10 }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: [{ player_id: 1, position: 'RB' }],
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({ rows: [{ player_id: 1 }] })],
    [/^SELECT "lineup_entries"\."player_id", "lineup_entries"\."slot"/, async (text) => {
      const designationAtRead = playerDesignation;
      lineupReadHasLock = /FOR SHARE OF "players"$/.test(text);
      signalDesignationRead();
      await syncAttempted;
      if (!lineupReadHasLock) await syncScanned;
      return { rows: [{
        player_id: 1,
        name: 'Test Runner',
        position: 'RB',
        nfl_team: 'MIN',
        injury_status: designationAtRead,
        slot: lineupSlot,
      }] };
    }],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
    // No surviving as-played rows in this world (#627). Matched explicitly so
    // the spent-slot read cannot fall through to the /FROM "lineup_entries"/
    // catch-all below, whose handler signals the IR scan.
    [/^SELECT "players"\."position"/, () => ({ rows: [] })],
    [/^UPDATE "lineup_entries" SET "slot"/, (text, params) => {
      lineupSlot = params[0];
      signalLineupMoved();
      return { rows: [] };
    }],
    [/^UPDATE "lineup_entries" SET "ir_attested"/, () => ({ rows: [] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), async () => {
      signalSyncAttempted();
      if (lineupReadHasLock) await lineupMoved;
      return { rows: [{ id: 1, external_id: 'espn-1', injury_status: playerDesignation }] };
    }, 'client'],
    [update('players'), (text, params) => {
      // #929: under the bulk form params[0] is the id array and params[1] is
      // the parallel status array; this world has one feed match, so its new
      // designation is params[1][0]. Rewritten from `playerDesignation =
      // params[0]` (which read a single-row UPDATE's scalar status); it pins the
      // same observable outcome - the written designation the committed stash
      // scan then reads back is the feed's value.
      playerDesignation = params[1][0];
      return { rows: [] };
    }, 'client'],
    [/FROM "lineup_entries"/, () => {
      const rows = lineupSlot === 'IR' ? [{
        player_id: 1,
        player_name: 'Test Runner',
        injury_status: playerDesignation,
        team_id: 10,
        owner_id: 20,
        league_id: 5,
      }] : [];
      signalSyncScanned();
      return { rows };
    }, 'client'],
    [insert('notifications'), () => {
      notifications += 1;
      return { rows: [] };
    }, 'client'],
  ]).install(t);
  t.mock.method(prefs, 'usersWanting', async () => []);

  const lineupSave = setLineup({
    leagueId: 5,
    userId: 7,
    week: 8,
    moves: [{ playerId: 1, slot: 'IR' }],
  });
  await designationRead;
  const injuryRefresh = syncInjuries({
    fetchInjuries: async () => [listed('espn-1', 'Questionable')],
  });

  const [lineupResult, injuryResult] = await Promise.all([lineupSave, injuryRefresh]);

  assert.deepEqual({
    lineupUpdated: lineupResult.updated,
    irFlags: injuryResult.irFlags,
    playerDesignation,
    lineupSlot,
    notifications,
  }, {
    lineupUpdated: 1,
    irFlags: 1,
    playerDesignation: 'Q',
    lineupSlot: 'IR',
    notifications: 1,
  });
  fake.assertClean();
});

test('#929: the bulk write skips a no-op row via its own IS DISTINCT FROM predicate', async (t) => {
  // The FOR UPDATE scan does not select injury_detail (not widened, #929 out of
  // scope), so the two-column no-op filter cannot live in JS: it lives in the
  // write statement, against the target row p. The parameter arrays therefore
  // carry EVERY feed match; the statement itself drops the rows that match. The
  // fake is an observation harness, not a database, so that predicate is applied
  // here against the same stored rows, gated on it actually being present in the
  // SQL. stored[61] equals its feed values (a no-op); stored[62] differs.
  const stored = new Map([
    [61, { injury_status: 'Q', injury_detail: 'Ankle' }],
    [62, { injury_status: 'D', injury_detail: 'Knee' }],
  ]);
  const written = [];
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    // ADR 0058: the save reads the team's open Called shot; none in this world.
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 61, external_id: 'espn-61', injury_status: 'Q' },
        { id: 62, external_id: 'espn-62', injury_status: 'D' },
      ],
    }), 'client'],
    [update('players'), (text, params) => {
      const hasNoOpPredicate = /IS DISTINCT FROM/.test(text);
      const [ids, statuses, details] = params;
      for (let i = 0; i < ids.length; i++) {
        const row = stored.get(ids[i]);
        const distinct = row.injury_status !== statuses[i]
          || row.injury_detail !== details[i];
        if (!hasNoOpPredicate || distinct) written.push(ids[i]);
      }
      return { rows: [] };
    }, 'client'],
  ]).install(t);
  t.mock.method(prefs, 'usersWanting', async () => []);

  const result = await syncInjuries({
    fetchInjuries: async () => [
          listed('espn-61', 'Questionable', 'Ankle'),
          listed('espn-62', 'Out', 'Hamstring'),
        ],
  });

  // Both matches ride in the parameter arrays (the filter is SQL-side, and the
  // scan is not widened to compare injury_detail in JS).
  const injuryWrites = fake.matching(update('players'));
  assert.equal(injuryWrites.length, 1);
  assert.deepEqual(injuryWrites[0].params, [
    [61, 62],
    ['Q', 'O'],
    ['Ankle', 'Hamstring'],
  ]);
  // The predicate compares BOTH columns against the target row p, and the
  // statement never names nfl_team (ADR 0060: the Tank01 player sync owns it).
  assert.match(
    injuryWrites[0].text,
    /"injury_status" IS DISTINCT FROM v\."status"[\s\S]*OR[\s\S]*"injury_detail" IS DISTINCT FROM v\."detail"/,
  );
  assert.doesNotMatch(injuryWrites[0].text, /nfl_team/);
  // The changed row is written; the no-op is not. Red-tell: removing the
  // IS DISTINCT FROM clause writes both -> written becomes [61, 62] -> red.
  assert.deepEqual(written, [62]);
  // playersUpdated still counts feed matches, not the written rows.
  assert.equal(result.playersUpdated, 2);
  fake.assertClean();
});

test('#929: the bulk designation write is issued before the IR stash is read', async (t) => {
  // Ordering is load-bearing: flagRecoveredIrStashes re-reads players.injury_status
  // to build its message, so the write must land first. The stash handler returns
  // the value the write set (not a literal), so the order is observable.
  const notifications = [];
  let writtenStatus = 'O'; // pre-write stored value
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    // ADR 0058: the save reads the team's open Called shot; none in this world.
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 71, external_id: 'espn-71', injury_status: 'O' }],
    }), 'client'],
    [update('players'), (text, params) => {
      writtenStatus = params[1][0];
      return { rows: [] };
    }, 'client'],
    [/FROM "lineup_entries"/, () => ({
      rows: [{
        player_id: 71,
        player_name: 'Test Runner',
        injury_status: writtenStatus,
        team_id: 31,
        owner_id: 41,
        league_id: 51,
      }],
    }), 'client'],
    [insert('notifications'), (text, params) => {
      notifications.push({ type: params[2], message: params[3] });
      return { rows: [] };
    }, 'client'],
  ]).install(t);
  t.mock.method(prefs, 'usersWanting', async () => []);
  t.mock.method(push, 'sendPushToUsers', async () => ({ sent: 0 }));

  const result = await syncInjuries({
    fetchInjuries: async () => [listed('espn-71', 'Questionable')],
  });

  assert.equal(result.irFlags, 1);
  // The stash read saw the written 'Q', so the UPDATE ran first. Red-tell:
  // hoisting flagRecoveredIrStashes above the write reads the pre-write 'O' and
  // the message reads 'out' -> red.
  assert.deepEqual(notifications, [{
    type: 'ir_flag',
    message: 'Test Runner is no longer IR-eligible (questionable). Move him out of IR before saving your lineup.',
  }]);
  fake.assertClean();
});

// ---- #961: every syncInjuries run appends one data_sync_runs row ----------
// A minimal happy path: one player goes healthy -> Questionable. That is not an
// IR recovery, so flagRecoveredIrStashes returns [] without a query, and the run
// is playersUpdated 1, irFlags 0. The data_sync_runs INSERT matches on the pool
// (no side tag), which is the observable that proves it is written outside the
// transaction, not on the checked-out client.
const dataSyncRuns = (calls) => calls.filter((c) => insert('data_sync_runs').test(c.text));
const healthyToQuestionableFeed = async () => [listed('espn-91', 'Questionable', 'Ankle')];

test('#961 success: one ok=true data_sync_runs row with job "injuries" and the run counts', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 91, external_id: 'espn-91', injury_status: null }],
    }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  // 23:30 US Central on the 20th is already 04:30 UTC the 21st - the input
  // that turns a local-calendar-day comparison red (fleet#1509 red-tell).
  const result = await syncInjuries({ fetchInjuries: healthyToQuestionableFeed, now: new Date('2026-08-20T23:30:00-05:00') });

  assert.deepEqual(result, { playersUpdated: 1, irFlags: 0 });
  const records = dataSyncRuns(fake.calls);
  // Red-tell for criterion 2: deleting the ok=true record call empties this.
  assert.equal(records.length, 1, 'exactly one data_sync_runs row is appended');
  assert.equal(records[0].via, 'pool', 'the record is written on the pool, outside the transaction');
  assert.equal(records[0].params[0], 'injuries', 'the job is the literal "injuries"');
  assert.equal(records[0].params[2], true, 'ok is true');
  // #1509: `day` rides fetch's run-level detail, the UTC day, not the local
  // en-CA day (2026-08-20).
  assert.deepEqual(
    JSON.parse(records[0].params[3]),
    { day: '2026-08-21', playersUpdated: 1, irFlags: 0 },
    'detail carries the UTC day and the run counts',
  );
  // Recorded after the run committed, never mid-transaction.
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  const recordIdx = fake.calls.findIndex((c) => insert('data_sync_runs').test(c.text));
  assert.ok(commitIdx >= 0 && commitIdx < recordIdx, 'the record follows COMMIT');
  fake.assertClean();
});

test('#961 failure: one ok=false row carries the error message, and the run still rethrows', async (t) => {
  const boom = new Error('scan blew up');
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => { throw boom; }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  // Red-tell for the rethrow half of criterion 3: swallowing the rethrow makes
  // this reject-assertion red (syncInjuries would resolve instead).
  const promise = syncInjuries({ fetchInjuries: healthyToQuestionableFeed });
  await assert.rejects(promise, /scan blew up/);
  const error = await promise.catch((e) => e);
  // Red-tell: dropping runSyncJob's tagReason fallback for a per-unit throw
  // (server/modules/syncRun.js) drops this, and detail.failed[0].reason below,
  // to undefined. The run's own detail.reason (asserted next) is a literal
  // 'write_failed' set unconditionally at the record call, so it cannot pin
  // this fallback by itself - the per-unit tag is what can.
  assert.equal(error.syncFailureReason, 'write_failed', 'the rejected error carries the same tag callers read');

  const records = dataSyncRuns(fake.calls);
  // Red-tell for the record half of criterion 3: deleting the failure record
  // call empties this.
  assert.equal(records.length, 1, 'exactly one data_sync_runs row is appended on failure');
  assert.equal(records[0].params[0], 'injuries');
  assert.equal(records[0].params[2], false, 'ok is false');
  const detail = JSON.parse(records[0].params[3]);
  assert.equal(detail.reason, 'write_failed', 'the run outcome is write_failed');
  // ADR 0036: a failed unit is recorded in detail.failed[], one entry per unit
  // that threw (injuries has exactly one unit, so exactly one entry here).
  assert.equal(detail.failed[0].message, 'scan blew up', 'the error message is in detail.failed[]');
  assert.equal(detail.failed[0].reason, 'write_failed', 'the per-unit tag (not the record\'s literal reason above) is what the fallback drives');
  // Ruling 1 control: this scan throws but the ROLLBACK succeeds cleanly, so
  // the connection is healthy and must be returned to the pool, not destroyed.
  // Red-tell: destroying on every error path (release with an Error
  // unconditionally) makes this fail.
  assert.equal(fake.releaseArgs()[0], undefined, 'an ordinary error keeps its healthy connection');
  fake.assertClean();
});

test('#961 survives rollback: the failure row is written on the pool, after ROLLBACK', async (t) => {
  // Criterion 5, the reason the ticket exists. The scan throws inside the
  // transaction, so the run rolls back. Because the record is written on the
  // pool AFTER the ROLLBACK, the failure row survives; a record moved inside the
  // transaction and written on that client would be lost with the rollback.
  // Red-tell: moving the record call inside the transaction on the client turns
  // via to 'client' and lands it before ROLLBACK, reddening both asserts below.
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => { throw new Error('scan blew up'); }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(syncInjuries({ fetchInjuries: healthyToQuestionableFeed }), /scan blew up/);

  const rollbackIdx = fake.calls.findIndex((c) => c.text === 'ROLLBACK');
  const recordIdx = fake.calls.findIndex((c) => insert('data_sync_runs').test(c.text));
  assert.ok(rollbackIdx >= 0, 'the run rolled back');
  assert.equal(fake.calls[recordIdx].via, 'pool', 'the record is written on the pool, not the rolled-back client');
  assert.ok(rollbackIdx < recordIdx, 'the record is written after the ROLLBACK');
  fake.assertClean();
});

test('#961 upstream failure: a fetch throw records ok=false with reason "fetch_failed"', async (t) => {
  // The upstream ESPN call throws before the transaction opens. It carries no
  // statusCode, so only a tag distinguishes it from a database failure - which
  // is the whole point of splitting the reason (finding 1): "upstream or us" is
  // the highest-value question the row answers, and this sync is quota-metered.
  // Red-tell: an untagged fetch throw is tagged fetch_failed by runSyncJob's own
  // fetch-catch fallback (server/modules/syncRun.js's tagReason, also pinned
  // directly in syncRun.test.js); this test pins that the SAME tag reaches the
  // rejected error syncInjuries's own callers see, not just the recorded row.
  // Control: reason is 'fetch_failed' here, 'bad_response' in the shape-guard
  // test, 'write_failed' in the in-transaction test.
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const promise = syncInjuries({ fetchInjuries: async () => { throw new Error('ESPN timed out'); } });
  await assert.rejects(promise, /ESPN timed out/);
  const error = await promise.catch((e) => e);
  assert.equal(error.syncFailureReason, 'fetch_failed', 'the rejected error carries the same tag the record uses');

  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1, 'exactly one data_sync_runs row on an upstream failure');
  assert.equal(records[0].via, 'pool');
  assert.equal(records[0].params[0], 'injuries');
  assert.equal(records[0].params[2], false, 'ok is false');
  const detail = JSON.parse(records[0].params[3]);
  assert.equal(detail.message, 'ESPN timed out', 'the upstream error message is in detail');
  assert.equal(detail.reason, 'fetch_failed', 'an upstream throw is fetch_failed, not merged with our failures');
  // No transaction was opened: the failure is upstream of pool.connect().
  assert.equal(fake.calls.filter((c) => c.text === 'BEGIN').length, 0, 'no transaction on an upstream failure');
  fake.assertClean();
});

test('#2115 unusable document: a null answer (failed GET or no team groups) records ok=false with reason "fetch_failed" and opens no transaction', async (t) => {
  // espnAthleteClient.injuries() answers null for a failed GET and for a
  // document with no team groups; either way an empty league must never read
  // as everyone healthy. Control: 'fetch_failed' here, 'write_failed' in the
  // in-transaction tests.
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const promise = syncInjuries({ fetchInjuries: async () => null });
  await assert.rejects(promise, /ESPN injuries document unavailable/);
  const error = await promise.catch((e) => e);
  assert.equal(error.syncFailureReason, 'fetch_failed', 'the rejected error carries the same tag the record uses');

  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1, 'exactly one data_sync_runs row on an unusable document');
  assert.equal(records[0].via, 'pool');
  assert.equal(records[0].params[2], false, 'ok is false');
  const detail = JSON.parse(records[0].params[3]);
  assert.equal(detail.message, 'ESPN injuries document unavailable');
  assert.equal(detail.reason, 'fetch_failed');
  assert.equal(fake.calls.filter((c) => c.text === 'BEGIN').length, 0, 'no transaction, so nobody is cleared to healthy');
  fake.assertClean();
});

test('#1041 connect failure: pool.connect() rejecting records ok=false with reason "write_failed"', async (t) => {
  // The #839 shape: pool exhaustion or refusal makes pool.connect() itself
  // throw, above the transaction try/catch/finally (no client exists yet to
  // ROLLBACK or release). Before this fix that throw carried no
  // syncFailureReason and fell through to an unclassified fallback, even
  // though it is unambiguously the database side. Control: 'write_failed'
  // here matches the in-transaction test above; 'fetch_failed'/'bad_response'
  // are the two upstream sibling tests.
  const connectError = new Error('connection refused by pooler');
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]);
  const pool = require('../modules/pool');
  // Mock query and connect separately, rather than fake.install(t) followed by
  // a second t.mock.method(pool, 'connect', ...): node:test's MockTracker
  // restores each mocked method to what it was at the time IT was mocked, in
  // registration order, so mocking the same method twice leaves pool.connect
  // pointed at this test's fake connect (not the real one) once the test ends
  // and t.mock.reset() runs - a leak into whichever test happens to run next.
  t.mock.method(pool, 'query', (sql, params) => fake.query(sql, params));
  t.mock.method(pool, 'connect', async () => { throw connectError; });

  // Criterion 2: assert on the rejection's message, not merely that it
  // rejected. A TypeError about `release` reaching the caller (the hazard the
  // ticket exists to avoid) would also make this reject, so only the message
  // proves the original connection error survived intact.
  const promise = syncInjuries({ fetchInjuries: healthyToQuestionableFeed });
  await assert.rejects(promise, /connection refused by pooler/);
  const error = await promise.catch((e) => e);
  // Red-tell: dropping runSyncJob's tagReason fallback for a per-unit throw
  // (server/modules/syncRun.js) drops this, and detail.failed[0].reason below,
  // to undefined. The run's own detail.reason (asserted next) is a literal
  // 'write_failed' set unconditionally at the record call, so it cannot pin
  // this fallback by itself - the per-unit tag is what can.
  assert.equal(error.syncFailureReason, 'write_failed', 'the rejected error carries the same tag callers read');

  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1, 'exactly one data_sync_runs row on a connect failure');
  assert.equal(records[0].via, 'pool');
  assert.equal(records[0].params[0], 'injuries');
  assert.equal(records[0].params[2], false, 'ok is false');
  const detail = JSON.parse(records[0].params[3]);
  assert.equal(detail.reason, 'write_failed', 'a connect failure is the database side');
  assert.equal(detail.failed[0].message, 'connection refused by pooler', 'the connect error message is in detail.failed[]');
  assert.equal(detail.failed[0].reason, 'write_failed', 'the per-unit tag (not the record\'s literal reason above) is what the fallback drives');
  assert.equal(fake.calls.filter((c) => c.text === 'BEGIN').length, 0, 'no transaction opens: connect() never returned a client');
  // No client was ever acquired, so none is left unreleased.
  fake.assertClean();
});

test('#1048 rollback rejects: the original error survives and still tags write_failed', async (t) => {
  // The #839 hazard's sibling: a ROLLBACK that itself rejects. The bare
  // `await client.query('ROLLBACK')` in the transaction catch used to let a
  // rejecting ROLLBACK replace the scan's original error, so the caller would
  // see "rollback rejected" instead of "scan blew up" and the write_failed tag
  // would be lost along with it.
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => { throw new Error('scan blew up'); }, 'client'],
    [/^ROLLBACK$/, () => { throw new Error('rollback rejected'); }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  // Red-tell: reverting the inner try/catch around ROLLBACK (leaving the bare
  // `await client.query('ROLLBACK')`) makes this reject with "rollback
  // rejected" instead, since the unhandled ROLLBACK rejection replaces boom.
  const promise = syncInjuries({ fetchInjuries: healthyToQuestionableFeed });
  await assert.rejects(promise, /scan blew up/);
  const error = await promise.catch((e) => e);
  assert.equal(error.rollbackError.message, 'rollback rejected',
    'the rollback failure is attached to the original error, not swallowed silently');

  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1, 'exactly one data_sync_runs row despite the rollback failure');
  assert.equal(records[0].params[2], false, 'ok is false');
  const detail = JSON.parse(records[0].params[3]);
  assert.equal(detail.reason, 'write_failed', 'a rollback failure never changes the tag');
  assert.equal(detail.failed[0].message, 'scan blew up', 'the original error message survives the rollback failure');

  // A rejecting ROLLBACK leaves the transaction open on the socket, so the
  // finally now releases the client WITH an Error: pg-pool destroys the
  // connection and Postgres frees the session's locks (the players advisory
  // lock included) on disconnect. The fake reports clean because the client was
  // destroyed, not because the transaction closed. Red-tell: reverting the
  // finally to a bare `client.release()` returns the open-transaction client to
  // the pool, and this assertClean() goes red on "transaction left open".
  fake.assertClean();
  assert.ok(fake.releaseArgs()[0] instanceof Error, 'a rejecting ROLLBACK destroys the connection');
});

test('#961 best-effort: a record write that throws changes neither outcome nor return value', async (t) => {
  // The table may not exist yet in a given environment (the migration is a
  // maintainer step). A thrown record write must not turn a correct run into a
  // rejection. Red-tell: removing the swallow in services/dataSyncRuns makes
  // syncInjuries reject here instead of returning the result.
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 91, external_id: 'espn-91', injury_status: null }],
    }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => { throw new Error('relation "data_sync_runs" does not exist'); }],
  ]).install(t);

  const result = await syncInjuries({ fetchInjuries: healthyToQuestionableFeed });

  assert.deepEqual(
    result,
    { playersUpdated: 1, irFlags: 0 },
    'the run returns its real result',
  );
  assert.equal(dataSyncRuns(fake.calls).length, 1, 'the record write was attempted once');
  fake.assertClean();
});

test('#929: playersUpdated counts feed matches, not written rows (3 matches, 1 no-op -> 3)', async (t) => {
  // Three feed matches; espn-81 equals its stored row (a no-op the statement
  // drops), the other two differ. playersUpdated is the length of the
  // transitions array (feed matches), so it is 3, not the 2 rows the statement
  // writes. Red-tell: deriving playersUpdated from the write count returns 2.
  const stored = new Map([
    [81, { injury_status: 'Q', injury_detail: 'Ankle' }],
    [82, { injury_status: 'Q', injury_detail: 'Ankle' }],
    [83, { injury_status: null, injury_detail: null }],
  ]);
  const written = [];
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    // ADR 0058: the save reads the team's open Called shot; none in this world.
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 81, external_id: 'espn-81', injury_status: 'Q' },
        { id: 82, external_id: 'espn-82', injury_status: 'Q' },
        { id: 83, external_id: 'espn-83', injury_status: null },
      ],
    }), 'client'],
    [update('players'), (text, params) => {
      const [ids, statuses, details] = params;
      for (let i = 0; i < ids.length; i++) {
        const row = stored.get(ids[i]);
        if (row.injury_status !== statuses[i] || row.injury_detail !== details[i]) written.push(ids[i]);
      }
      return { rows: [] };
    }, 'client'],
  ]).install(t);

  const result = await syncInjuries({
    fetchInjuries: async () => [
          listed('espn-81', 'Questionable', 'Ankle'),
          listed('espn-82', 'Doubtful', 'Knee'),
          listed('espn-83', 'Out', 'Groin'),
        ],
  });

  assert.deepEqual(written, [82, 83], 'the statement writes only the two changed rows');
  assert.equal(result.playersUpdated, 3, 'but playersUpdated counts all three feed matches');
  assert.equal(result.irFlags, 0);
  fake.assertClean();
});

// ---------------------------------------------------------------------------
// #1789: the cached engine's availability verdict is patched by an
// availability reconcile after this pass writes - scoped to exactly the ids
// the write actually changed (RETURNING) plus any departure, on the SAME
// transaction client, guarded by a SAVEPOINT so a reconcile failure can never
// abort the designation write this run already committed to.
// ---------------------------------------------------------------------------

const MAIN_INJURY_UPDATE = /^UPDATE "players" p\s+SET "injury_status"/;
const SAVEPOINT_STMT = /^SAVEPOINT reconcile_availability$/;
const RELEASE_SAVEPOINT_STMT = /^RELEASE SAVEPOINT reconcile_availability$/;
const ROLLBACK_TO_SAVEPOINT_STMT = /^ROLLBACK TO SAVEPOINT reconcile_availability$/;

test('#1789: syncInjuries reconciles availability with exactly the changed + departed ids, on the transaction client, after both writes', async (t) => {
  const projection = require('../services/projection.service');
  let reconcileArgs = null;
  t.mock.method(projection, 'liveReconcileScope', async () => ({ season: 2026, fromWeek: 4 }));
  t.mock.method(projection, 'reconcileAvailability', async (args) => {
    reconcileArgs = args;
    return { checked: 1, updated: 1 };
  });
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 601, external_id: 'espn-601', injury_status: null }],
    }), 'client'],
    [MAIN_INJURY_UPDATE, () => ({ rows: [{ id: 601 }] }), 'client'], // RETURNING: the row actually changed
    [SAVEPOINT_STMT, () => ({ rows: [] }), 'client'],
    [RELEASE_SAVEPOINT_STMT, () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const now = new Date('2026-09-29T12:00:00Z');
  await syncInjuries({
    fetchInjuries: async () => [listed('espn-601', 'Questionable')],
    now,
  });

  assert.ok(reconcileArgs, 'reconcileAvailability was called');
  assert.deepEqual(reconcileArgs.playerIds, [601], 'exactly the RETURNING id, no untouched no-op match');
  assert.equal(reconcileArgs.season, 2026);
  assert.equal(reconcileArgs.fromWeek, 4);
  assert.equal(reconcileArgs.now, now, 'the injected now threads through');
  assert.equal(typeof reconcileArgs.client.query, 'function', 'the reconcile runs on a real client, not the pool');
  const savepointCall = fake.calls.find((c) => SAVEPOINT_STMT.test(c.text));
  assert.equal(savepointCall.via, 'client', 'the reconcile runs on the SAME transaction client');
  const releaseIdx = fake.calls.findIndex((c) => RELEASE_SAVEPOINT_STMT.test(c.text));
  assert.ok(releaseIdx >= 0, 'the savepoint is released on success');
  const updateIdx = fake.calls.findIndex((c) => MAIN_INJURY_UPDATE.test(c.text));
  const savepointIdx = fake.calls.findIndex((c) => SAVEPOINT_STMT.test(c.text));
  assert.ok(updateIdx >= 0 && updateIdx < savepointIdx, 'the reconcile follows the designation write');
  fake.assertClean();
});

test('#1789: a run with no designation change and no departure never reconciles - no SAVEPOINT, reconcileAvailability not called', async (t) => {
  const projection = require('../services/projection.service');
  let reconcileCalls = 0;
  t.mock.method(projection, 'reconcileAvailability', async () => { reconcileCalls += 1; return { checked: 0, updated: 0 }; });
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 602, external_id: 'espn-602', injury_status: 'Q' }],
    }), 'client'],
    // A no-op match: the RETURNING clause reports nothing changed.
    [MAIN_INJURY_UPDATE, () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await syncInjuries({
    fetchInjuries: async () => [listed('espn-602', 'Questionable')],
  });

  assert.equal(reconcileCalls, 0, 'nothing changed, so no reconcile is attempted');
  assert.equal(fake.calls.some((c) => SAVEPOINT_STMT.test(c.text)), false, 'no savepoint is opened for nothing');
  fake.assertClean();
});

test('#1789: a reconcile failure is isolated by ROLLBACK TO SAVEPOINT and never fails the sync', async (t) => {
  const projection = require('../services/projection.service');
  t.mock.method(projection, 'liveReconcileScope', async () => ({ season: 2026, fromWeek: 4 }));
  t.mock.method(projection, 'reconcileAvailability', async () => { throw new Error('reconcile blew up'); });
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 603, external_id: 'espn-603', injury_status: null }],
    }), 'client'],
    [MAIN_INJURY_UPDATE, () => ({ rows: [{ id: 603 }] }), 'client'],
    [SAVEPOINT_STMT, () => ({ rows: [] }), 'client'],
    [ROLLBACK_TO_SAVEPOINT_STMT, () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    fetchInjuries: async () => [listed('espn-603', 'Questionable')],
  });

  // The sync itself succeeds despite the reconcile throwing.
  assert.equal(result.playersUpdated, 1);
  assert.ok(fake.calls.some((c) => ROLLBACK_TO_SAVEPOINT_STMT.test(c.text)), 'the failed reconcile rolls back to its own savepoint');
  assert.equal(fake.calls.some((c) => RELEASE_SAVEPOINT_STMT.test(c.text)), false, 'a failed reconcile is never released');
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  assert.ok(commitIdx >= 0, 'the designation write still commits - the reconcile failure never poisons this transaction');
  fake.assertClean();
});

// ---- #2115: the ESPN injuries document is the writer ----------------------

/** The common world for the #2115 cases: a locked scan of `players`, a bulk write, an optional IR stash. */
function espnWorld(t, { players, stash = [], notifications = [] }) {
  return createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({ rows: players }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [/FROM "lineup_entries"/, () => ({ rows: stash }), 'client'],
    [insert('notifications'), (text, params) => {
      notifications.push({ type: params[2], message: params[3] });
      return { rows: [] };
    }, 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
    [TEAM_PLAYERS_ROSTER, () => ({ rows: [] })], // nobody rosters the changed players
  ]).install(t);
}

test('#2115: Questionable, Doubtful, Out, Injured Reserve, Active and an unlisted player write Q, D, O, IR, null, null', async (t) => {
  // The five-entry fixture is a trimmed real ESPN document; the Doubtful entry
  // has no shortComment (detail falls back to the type), the Out entry has no
  // player-card link (its id comes from the headshot filename).
  const fake = espnWorld(t, {
    players: [
      { id: 1, external_id: '4870808', injury_status: null },
      { id: 2, external_id: '4873232', injury_status: null },
      { id: 3, external_id: '5084939', injury_status: null },
      { id: 4, external_id: '4428991', injury_status: null },
      { id: 5, external_id: '3127287', injury_status: null },
      { id: 6, external_id: '999', injury_status: null },
    ],
  });
  t.mock.method(prefs, 'usersWanting', async () => []);

  const result = await syncInjuries({ fetchInjuries: async () => espnAthleteClient.normalizeInjuries(injuriesFixture) });

  const [write] = fake.matching(update('players'));
  assert.deepEqual(write.params[0], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(write.params[1], ['Q', 'D', 'O', 'IR', null, null], 'Active and the unlisted player are healthy');
  const details = write.params[2];
  assert.match(details[0], /^Love \(ankle\)/, 'detail is the shortComment');
  assert.equal(details[1], 'doubtful Knee - MCL', 'no shortComment: the type description plus the injury type');
  assert.match(details[2], /^Cardinals head coach/);
  assert.match(details[3], /placed Johnson \(biceps\) on injured reserve/);
  assert.equal(details[4], null, 'an Active entry carries a news note, not an injury: no detail');
  assert.equal(details[5], null);
  assert.deepEqual(result, { playersUpdated: 5, irFlags: 0 }, 'playersUpdated counts the five players the document lists');
  fake.assertClean();
});

test('#2115: an unknown ESPN status writes null and is logged once per run', async (t) => {
  const fake = espnWorld(t, {
    players: [
      { id: 1, external_id: '11', injury_status: 'Q' },
      { id: 2, external_id: '12', injury_status: null },
      { id: 3, external_id: '13', injury_status: null },
    ],
  });
  t.mock.method(prefs, 'usersWanting', async () => []);
  const warn = t.mock.method(console, 'warn', () => {});

  await syncInjuries({
    fetchInjuries: async () => [
      listed('11', 'Suspended', 'Violated policy'),
      listed('12', 'Suspended', 'Violated policy'),
      listed('13', 'Questionable', 'Ankle'),
    ],
  });

  const [write] = fake.matching(update('players'));
  assert.deepEqual(write.params[1], [null, null, 'Q'], 'the unknown string is healthy, never guessed');
  assert.deepEqual(write.params[2], [null, null, 'Ankle'], 'and carries no detail');
  assert.equal(warn.mock.callCount(), 1, 'two players with the same unknown string log once');
  assert.match(warn.mock.calls[0].arguments[0], /unknown ESPN status treated as healthy: Suspended/);
  fake.assertClean();
});

test('#2115: the run makes exactly one ESPN GET and no Tank01 call', async (t) => {
  const axios = require('axios');
  const tank01Client = require('../modules/tank01Client');
  const tank01 = t.mock.method(tank01Client, 'tank01Get', async () => { throw new Error('Tank01 must not be called'); });
  const get = t.mock.method(axios, 'get', async () => ({ data: injuriesFixture }));
  const fake = espnWorld(t, { players: [{ id: 1, external_id: '4870808', injury_status: null }] });
  t.mock.method(prefs, 'usersWanting', async () => []);

  await syncInjuries();

  assert.equal(get.mock.callCount(), 1, 'one document, all 32 teams');
  const [url, config] = get.mock.calls[0].arguments;
  assert.match(url, /^https:\/\/site\.web\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/injuries$/);
  assert.match(config.headers['User-Agent'], /Mozilla/, 'the browser user agent every ESPN client sends');
  assert.equal(tank01.mock.callCount(), 0);
  fake.assertClean();
});

test('#2115: a player ESPN drops from the document (IR to unlisted) is cleared and flags his IR stash', async (t) => {
  const notifications = [];
  const fake = espnWorld(t, {
    players: [{ id: 31, external_id: '3131', injury_status: 'IR' }],
    stash: [{
      player_id: 31, player_name: 'Test Runner', injury_status: null, team_id: 41, owner_id: 51, league_id: 61,
    }],
    notifications,
  });
  t.mock.method(prefs, 'usersWanting', async () => []);

  const result = await syncInjuries({ fetchInjuries: async () => [listed('9999', 'Out', 'Hamstring')] });

  const [write] = fake.matching(update('players'));
  assert.deepEqual(write.params, [[31], [null], [null]], 'unlisted means healthy: both columns cleared');
  assert.equal(result.irFlags, 1);
  assert.equal(result.playersUpdated, 0, 'he was not in the document');
  assert.deepEqual(notifications, [{
    type: 'ir_flag',
    message: 'Test Runner is no longer IR-eligible (healthy). Move him out of IR before saving your lineup.',
  }]);
  fake.assertClean();
});

// ---- #2106: injury alerts ----------------------------------------------------

const TEAM_PLAYERS_ROSTER = /FROM "team_players" tp JOIN "teams"/;

/** One player (id 700, stored `before`) moving to the feed's `designation`; `rostered` is the post-commit roster read. */
async function injuryAlertRun(t, { before = null, designation, description, rostered = [] }) {
  const sends = [];
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 700, external_id: 'espn-700', injury_status: before }],
    }), 'client'],
    [MAIN_INJURY_UPDATE, () => ({ rows: [{ id: 700 }] }), 'client'],
    [SAVEPOINT_STMT, () => ({ rows: [] }), 'client'],
    [RELEASE_SAVEPOINT_STMT, () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
    [TEAM_PLAYERS_ROSTER, () => ({
      rows: rostered.map(([owner_id, league_id]) => ({
        player_id: 700, league_id, owner_id, name: 'Test Runner', injury_detail: description || null,
      })),
    })],
  ]).install(t);
  t.mock.method(push, 'sendPushOnce', async (args) => { sends.push(args); return { sent: args.userIds.length, skipped: 0 }; });
  await syncInjuries({
    fetchInjuries: async () => [listed('espn-700', designation, description)],
    now: new Date('2026-10-08T12:00:00Z'),
  });
  return { sends, fake };
}

test('#2106: a player moving null to Out pushes once per manager across leagues, after COMMIT', async (t) => {
  const { sends, fake } = await injuryAlertRun(t, { designation: 'Out', description: 'Knee', rostered: [[11, 1], [12, 2]] });

  assert.equal(sends.length, 2, 'one call per distinct lineup url');
  assert.deepEqual(sends.map((s) => s.userIds), [[11], [12]], 'exactly the two rostering managers');
  assert.deepEqual(sends.map((s) => s.payload.url), ['/#/league/1/lineup', '/#/league/2/lineup'], 'each manager gets his own league');
  assert.equal(sends[0].kind, 'injury');
  assert.equal(sends[0].prefKey, 'injuryAlerts');
  assert.equal(sends[0].subject, '700');
  assert.equal(sends[0].fingerprint, 'Out:2026-10-08');
  assert.deepEqual(sends[0].payload, { title: 'Test Runner is now Out', body: 'Knee', url: '/#/league/1/lineup' });
  assert.match(fake.matching(TEAM_PLAYERS_ROSTER)[0].text, /"season_status" != 'complete'/, 'finished leagues are skipped');
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  const rosterIdx = fake.calls.findIndex((c) => TEAM_PLAYERS_ROSTER.test(c.text));
  assert.ok(commitIdx >= 0 && commitIdx < rosterIdx, 'the roster read and the push follow the commit');
  fake.assertClean();
});

test('#2106: one manager rostering the player in two leagues is one target, with the first league lineup url', async (t) => {
  const { sends } = await injuryAlertRun(t, { designation: 'Out', rostered: [[11, 1], [11, 2]] });

  assert.deepEqual(sends.map((s) => s.userIds), [[11]]);
  assert.equal(sends[0].payload.url, '/#/league/1/lineup');
  assert.equal(sends[0].payload.body, '', 'no injury_detail: empty body');
});

test('#2106: a manager in leagues 1 and 2 and another only in league 2 each get their own first league', async (t) => {
  const { sends } = await injuryAlertRun(t, { designation: 'Out', rostered: [[11, 1], [12, 2], [11, 2]] });

  assert.deepEqual(sends.map((s) => [s.userIds, s.payload.url]), [
    [[11], '/#/league/1/lineup'],
    [[12], '/#/league/2/lineup'],
  ]);
});

test('#2106: clearing a designation pushes "healthy"; an unchanged designation pushes nothing', async (t) => {
  const cleared = await injuryAlertRun(t, { before: 'Q', designation: 'Active', rostered: [[11, 1]] });
  assert.equal(cleared.sends[0].payload.title, 'Test Runner is now healthy');
  assert.equal(cleared.sends[0].fingerprint, 'healthy:2026-10-08');

  const unchanged = await injuryAlertRun(t, { before: 'Q', designation: 'Questionable', description: 'New detail', rostered: [[11, 1]] });
  assert.deepEqual(unchanged.sends, []);
  assert.equal(unchanged.fake.matching(TEAM_PLAYERS_ROSTER).length, 0, 'no change: no roster read either');
});

test('#2115: a player moving Questionable to Out through the ESPN document pushes the Out alert', async (t) => {
  const { sends } = await injuryAlertRun(t, { before: 'Q', designation: 'Out', description: 'Knee', rostered: [[11, 1]] });

  assert.equal(sends.length, 1);
  assert.equal(sends[0].fingerprint, 'Out:2026-10-08');
  assert.deepEqual(sends[0].payload, { title: 'Test Runner is now Out', body: 'Knee', url: '/#/league/1/lineup' });
});

// ---- #2115: the document floor and the detail cap ---------------------------

/** An ESPN injuries document: `groups` team groups, `perGroup` Out entries in each, athlete ids from 1000. */
function espnDocument(groups, perGroup, status = 'Out') {
  let next = 1000;
  return {
    injuries: Array.from({ length: groups }, () => ({
      injuries: Array.from({ length: perGroup }, () => {
        const id = next++;
        return { status, shortComment: `note ${id}`, athlete: { links: [{ href: `https://www.espn.com/nfl/player/_/id/${id}/x` }] } };
      }),
    })),
  };
}

test('#2115 floor: a 200 document with 32 empty team groups is fetch_failed and writes nothing', async (t) => {
  delete process.env.INJURY_DOC_FLOOR;
  t.after(() => { process.env.INJURY_DOC_FLOOR = '0'; });
  const axios = require('axios');
  t.mock.method(axios, 'get', async () => ({ data: espnDocument(32, 0) }));
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const promise = syncInjuries();
  await assert.rejects(promise, /too small: 0 entries listed, floor 50/);
  assert.equal((await promise.catch((e) => e)).syncFailureReason, 'fetch_failed');
  assert.equal(fake.calls.filter((c) => c.text === 'BEGIN').length, 0, 'no transaction: nothing cleared, no alert');
  assert.equal(fake.matching(update('players')).length, 0);
  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1);
  assert.equal(records[0].params[2], false);
  fake.assertClean();
});

test('#2115 floor: 49 listed entries are refused, 50 Active-only entries are an ok run, and the real document is ok at the default', async (t) => {
  delete process.env.INJURY_DOC_FLOOR;
  t.after(() => { process.env.INJURY_DOC_FLOOR = '0'; });
  const axios = require('axios');
  const get = t.mock.method(axios, 'get', async () => ({ data: espnDocument(7, 7) })); // 49 Out entries
  createFakePool([[insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })]]).install(t);
  await assert.rejects(syncInjuries(), /too small: 49 entries listed, floor 50/);

  // The guard is against an empty or truncated document, not a quiet week: 50
  // Active entries are a well-formed document and the run proceeds.
  get.mock.mockImplementation(async () => ({ data: espnDocument(5, 10, 'Active') }));
  const quiet = espnWorld(t, { players: [{ id: 1, external_id: '1000', injury_status: 'Q' }] });
  t.mock.method(prefs, 'usersWanting', async () => []);
  const result = await syncInjuries();
  assert.equal(result.playersUpdated, 1);
  assert.deepEqual(quiet.matching(update('players'))[0].params[1], [null], 'Active is healthy');

  // The real (trimmed) document has only five entries, so it needs the floor
  // lowered here; the full 800-entry document clears 50 many times over.
  process.env.INJURY_DOC_FLOOR = '5';
  get.mock.mockImplementation(async () => ({ data: injuriesFixture }));
  espnWorld(t, { players: [{ id: 2, external_id: '4870808', injury_status: null }] });
  assert.equal((await syncInjuries()).playersUpdated, 1);
});

test('#2115: a detail longer than 255 characters is cut to 255', async (t) => {
  const fake = espnWorld(t, { players: [{ id: 1, external_id: '21', injury_status: null }] });
  t.mock.method(prefs, 'usersWanting', async () => []);

  await syncInjuries({ fetchInjuries: async () => [listed('21', 'Out', 'x'.repeat(300))] });

  const detail = fake.matching(update('players'))[0].params[2][0];
  assert.equal(detail.length, 255);
});
