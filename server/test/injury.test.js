const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, select, update } = require('./helpers/fakePool');
const prefs = require('../services/prefs.service');
const push = require('../services/push.service');
const { normalizeInjuryStatus, syncInjuries, NFL_PLAYER_LIST_FLOOR } = require('../services/scoring.service');
const { DEFAULT_ROSTER_SLOTS, setLineup } = require('../services/lineup.service');

test('normalizeInjuryStatus maps designations to badge codes', () => {
  assert.equal(normalizeInjuryStatus('Questionable'), 'Q');
  assert.equal(normalizeInjuryStatus('questionable - ankle'), 'Q');
  assert.equal(normalizeInjuryStatus('Doubtful'), 'D');
  assert.equal(normalizeInjuryStatus('Out'), 'O');
  assert.equal(normalizeInjuryStatus('Injured Reserve'), 'IR');
  assert.equal(normalizeInjuryStatus('IR'), 'IR');
});

test('normalizeInjuryStatus: healthy/unknown values return null', () => {
  assert.equal(normalizeInjuryStatus(null), null);
  assert.equal(normalizeInjuryStatus(''), null);
  assert.equal(normalizeInjuryStatus('Probable'), null);
  assert.equal(normalizeInjuryStatus('Active'), null);
});

test('normalizeInjuryStatus: IR wins over Out when both words appear', () => {
  assert.equal(normalizeInjuryStatus('Out - Injured Reserve'), 'IR');
});

test('syncInjuries commits designation updates and IR flags before delivering gated push', async (t) => {
  const notifications = [];
  const fake = createFakePool([
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 21, external_id: 'tank-21', injury_status: 'O', nfl_team: 'BUF' },
        { id: 22, external_id: 'tank-22', injury_status: 'Q', nfl_team: 'MIA' },
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
    api: async (path) => {
      assert.equal(path, '/getNFLPlayerList');
      return {
        data: {
          body: [
            { playerID: 'tank-21', team: 'BUF', injury: { designation: 'Questionable', description: 'Ankle' } },
            { playerID: 'tank-22', team: 'MIA', injury: { designation: 'Active' } },
          ],
        },
      };
    },
  });

  assert.deepEqual(result, { playersUpdated: 2, irFlags: 1, teamChanges: 0, teamsCleared: 0, teamsDeferred: 0 });
  assert.match(fake.matching(select('players'))[0].text, /FOR UPDATE$/);
  // #929: one bulk UPDATE replaces the per-player loop. Rewritten from the old
  // assertion `fake.matching(update('players')).length === 2`, which pinned two
  // single-row writes; it now pins the SAME observable outcome - both matched
  // players carry their new designation and detail into the write - as one
  // statement whose three parallel parameter arrays (ids int[], statuses
  // text[], details text[], built in JS over every feed match in scan order)
  // carry exactly those two ids and their new values. tank-22 is Active, so its
  // status and detail are null; nulls reach SQL as NULL.
  const injuryWrites = fake.matching(update('players'));
  assert.equal(injuryWrites.length, 1, 'exactly one bulk UPDATE, not a per-row loop');
  assert.deepEqual(injuryWrites[0].params, [
    [21, 22],
    ['Q', null],
    ['Ankle', null],
    ['BUF', 'MIA'],
  ], 'ids, statuses, details, teams as four parallel arrays in scan order');
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
      return { rows: [{ id: 1, external_id: 'tank-1', injury_status: playerDesignation }] };
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
    api: async () => ({
      data: { body: [{ playerID: 'tank-1', injury: { designation: 'Questionable' } }] },
    }),
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
    [61, { injury_status: 'Q', injury_detail: 'Ankle', nfl_team: 'KC' }],
    [62, { injury_status: 'D', injury_detail: 'Knee', nfl_team: 'LV' }],
  ]);
  const written = [];
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 61, external_id: 'tank-61', injury_status: 'Q', nfl_team: 'KC' },
        { id: 62, external_id: 'tank-62', injury_status: 'D', nfl_team: 'LV' },
      ],
    }), 'client'],
    [update('players'), (text, params) => {
      const hasNoOpPredicate = /IS DISTINCT FROM/.test(text);
      const [ids, statuses, details, teams] = params;
      for (let i = 0; i < ids.length; i++) {
        const row = stored.get(ids[i]);
        const distinct = row.injury_status !== statuses[i]
          || row.injury_detail !== details[i]
          || row.nfl_team !== teams[i];
        if (!hasNoOpPredicate || distinct) written.push(ids[i]);
      }
      return { rows: [] };
    }, 'client'],
  ]).install(t);
  t.mock.method(prefs, 'usersWanting', async () => []);

  const result = await syncInjuries({
    api: async () => ({
      data: {
        body: [
          { playerID: 'tank-61', team: 'KC', injury: { designation: 'Questionable', description: 'Ankle' } },
          { playerID: 'tank-62', team: 'LV', injury: { designation: 'Out', description: 'Hamstring' } },
        ],
      },
    }),
  });

  // Both matches ride in the parameter arrays (the filter is SQL-side, and the
  // scan is not widened to compare injury_detail in JS).
  const injuryWrites = fake.matching(update('players'));
  assert.equal(injuryWrites.length, 1);
  assert.deepEqual(injuryWrites[0].params, [
    [61, 62],
    ['Q', 'O'],
    ['Ankle', 'Hamstring'],
    ['KC', 'LV'],
  ]);
  // The predicate compares ALL THREE columns against the target row p.
  assert.match(
    injuryWrites[0].text,
    /"injury_status" IS DISTINCT FROM v\."status"[\s\S]*OR[\s\S]*"injury_detail" IS DISTINCT FROM v\."detail"[\s\S]*OR[\s\S]*"nfl_team" IS DISTINCT FROM v\."team"/,
  );
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
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 71, external_id: 'tank-71', injury_status: 'O' }],
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
    api: async () => ({
      data: { body: [{ playerID: 'tank-71', injury: { designation: 'Questionable' } }] },
    }),
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
const healthyToQuestionableApi = async () => ({
  data: { body: [{ playerID: 'tank-91', team: 'SEA', injury: { designation: 'Questionable', description: 'Ankle' } }] },
});

test('#961 success: one ok=true data_sync_runs row with job "injuries" and the run counts', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 91, external_id: 'tank-91', injury_status: null, nfl_team: 'SEA' }],
    }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({ api: healthyToQuestionableApi });

  assert.deepEqual(result, { playersUpdated: 1, irFlags: 0, teamChanges: 0, teamsCleared: 0, teamsDeferred: 0 });
  const records = dataSyncRuns(fake.calls);
  // Red-tell for criterion 2: deleting the ok=true record call empties this.
  assert.equal(records.length, 1, 'exactly one data_sync_runs row is appended');
  assert.equal(records[0].via, 'pool', 'the record is written on the pool, outside the transaction');
  assert.equal(records[0].params[0], 'injuries', 'the job is the literal "injuries"');
  assert.equal(records[0].params[2], true, 'ok is true');
  // #1385: floorGuardTripped rides in from fetch's run-level detail (#1202) -
  // this one-entry feed is far below NFL_PLAYER_LIST_FLOOR, so it reads true.
  assert.deepEqual(
    JSON.parse(records[0].params[3]),
    { floorGuardTripped: true, playersUpdated: 1, irFlags: 0, teamChanges: 0, teamsCleared: 0, teamsDeferred: 0 },
    'detail carries the run counts and the floor guard state',
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
  const promise = syncInjuries({ api: healthyToQuestionableApi });
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

  await assert.rejects(syncInjuries({ api: healthyToQuestionableApi }), /scan blew up/);

  const rollbackIdx = fake.calls.findIndex((c) => c.text === 'ROLLBACK');
  const recordIdx = fake.calls.findIndex((c) => insert('data_sync_runs').test(c.text));
  assert.ok(rollbackIdx >= 0, 'the run rolled back');
  assert.equal(fake.calls[recordIdx].via, 'pool', 'the record is written on the pool, not the rolled-back client');
  assert.ok(rollbackIdx < recordIdx, 'the record is written after the ROLLBACK');
  fake.assertClean();
});

test('#961 upstream failure: an api() throw records ok=false with reason "fetch_failed"', async (t) => {
  // The upstream Tank01 call throws before the transaction opens. It carries no
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

  const promise = syncInjuries({ api: async () => { throw new Error('Tank01 timed out'); } });
  await assert.rejects(promise, /Tank01 timed out/);
  const error = await promise.catch((e) => e);
  assert.equal(error.syncFailureReason, 'fetch_failed', 'the rejected error carries the same tag the record uses');

  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1, 'exactly one data_sync_runs row on an upstream failure');
  assert.equal(records[0].via, 'pool');
  assert.equal(records[0].params[0], 'injuries');
  assert.equal(records[0].params[2], false, 'ok is false');
  const detail = JSON.parse(records[0].params[3]);
  assert.equal(detail.message, 'Tank01 timed out', 'the upstream error message is in detail');
  assert.equal(detail.reason, 'fetch_failed', 'an upstream throw is fetch_failed, not merged with our failures');
  // No transaction was opened: the failure is upstream of pool.connect().
  assert.equal(fake.calls.filter((c) => c.text === 'BEGIN').length, 0, 'no transaction on an upstream failure');
  fake.assertClean();
});

test('#961 bad response: a non-array getNFLPlayerList body records ok=false with reason "bad_response"', async (t) => {
  // Tank01 answered, but the body is not an array, so the 502 shape guard throws
  // before the transaction. Red-tell: dropping the bad_response tag (or the
  // guard) changes this reason. Control: 'bad_response' here vs 'fetch_failed'
  // and 'write_failed' in the sibling tests.
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(
    syncInjuries({ api: async () => ({ data: { body: { notAnArray: true } } }) }),
    /unexpected getNFLPlayerList response shape/,
  );

  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1, 'exactly one data_sync_runs row on a bad response');
  assert.equal(records[0].via, 'pool');
  assert.equal(records[0].params[2], false, 'ok is false');
  const detail = JSON.parse(records[0].params[3]);
  assert.equal(detail.message, 'unexpected getNFLPlayerList response shape', 'the shape-guard message is in detail');
  assert.equal(detail.reason, 'bad_response', 'a malformed feed is bad_response (upstream contract drift)');
  assert.equal(fake.calls.filter((c) => c.text === 'BEGIN').length, 0, 'no transaction on a bad response');
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
  const promise = syncInjuries({ api: healthyToQuestionableApi });
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
  const promise = syncInjuries({ api: healthyToQuestionableApi });
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
      rows: [{ id: 91, external_id: 'tank-91', injury_status: null, nfl_team: 'SEA' }],
    }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => { throw new Error('relation "data_sync_runs" does not exist'); }],
  ]).install(t);

  const result = await syncInjuries({ api: healthyToQuestionableApi });

  assert.deepEqual(
    result,
    { playersUpdated: 1, irFlags: 0, teamChanges: 0, teamsCleared: 0, teamsDeferred: 0 },
    'the run returns its real result',
  );
  assert.equal(dataSyncRuns(fake.calls).length, 1, 'the record write was attempted once');
  fake.assertClean();
});

test('#929: playersUpdated counts feed matches, not written rows (3 matches, 1 no-op -> 3)', async (t) => {
  // Three feed matches; tank-81 equals its stored row (a no-op the statement
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
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 81, external_id: 'tank-81', injury_status: 'Q' },
        { id: 82, external_id: 'tank-82', injury_status: 'Q' },
        { id: 83, external_id: 'tank-83', injury_status: null },
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
    api: async () => ({
      data: {
        body: [
          { playerID: 'tank-81', injury: { designation: 'Questionable', description: 'Ankle' } },
          { playerID: 'tank-82', injury: { designation: 'Doubtful', description: 'Knee' } },
          { playerID: 'tank-83', injury: { designation: 'Out', description: 'Groin' } },
        ],
      },
    }),
  });

  assert.deepEqual(written, [82, 83], 'the statement writes only the two changed rows');
  assert.equal(result.playersUpdated, 3, 'but playersUpdated counts all three feed matches');
  assert.equal(result.irFlags, 0);
  fake.assertClean();
});

// ---- the same pass keeps players.nfl_team current ------------------------
// getNFLPlayerList carries a current team as well as a designation, and this
// job is the only unattended reader of that feed (syncPlayers is manual). The
// bug: a player traded/signed/elevated mid-season kept the team label frozen at
// the last hand-run sync, so his stat line landed under a team whose game had
// not been played and every schedule join for him — lineup locks, bye
// detection, opponent projection features — read the wrong game.

test('team refresh: a player the feed has moved gets his nfl_team corrected in the same write', async (t) => {
  // The real shape: stored ARI, actually playing for NE. Red-tell: dropping
  // nfl_team from the SET leaves the write carrying only status/detail and the
  // teams array never reaches SQL.
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 1041, external_id: 'tank-1041', injury_status: null, nfl_team: 'ARI' }],
    }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    api: async () => ({ data: { body: [{ playerID: 'tank-1041', team: 'NE', injury: {} }] } }),
  });

  const writes = fake.matching(update('players'));
  assert.equal(writes.length, 1);
  assert.match(writes[0].text, /"nfl_team" = v\."team"/, 'the write sets nfl_team');
  assert.deepEqual(writes[0].params[3], ['NE'], 'the teams array carries the feed team, not the stored one');
  assert.equal(result.teamChanges, 1, 'the correction is counted for the run record');
  // The scan must read nfl_team, or the change can never be detected.
  assert.match(fake.matching(select('players'))[0].text, /"nfl_team"/);
  fake.assertClean();
});

test('team refresh: a feed entry with no team keeps the stored label instead of wiping it, below the floor', async (t) => {
  // #1385: this one-entry feed is far below NFL_PLAYER_LIST_FLOOR, so the
  // floor guard trips and the blank keeps the stored label exactly as before
  // - the same protection this pass has always given a transient blank, now
  // reached via the guard rather than an unconditional "always keep it". The
  // guard-passed case (a real departure clears the label) is covered below.
  // Red-tell: pushing feed.team straight into the array sends [null] and the
  // daily job clears teams league-wide on a bad feed.
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 55, external_id: 'tank-55', injury_status: null, nfl_team: 'GB' }],
    }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    api: async () => ({ data: { body: [{ playerID: 'tank-55', injury: {} }] } }),
  });

  assert.deepEqual(fake.matching(update('players'))[0].params[3], ['GB'], 'the stored label survives');
  assert.equal(result.teamChanges, 0, 'keeping a label is not a change');
  assert.equal(result.teamsCleared, 0, 'below the floor, nothing is cleared either');
  fake.assertClean();
});

// ---- #1385: departure clears nfl_team, gated on the floor -----------------
// A player who leaves the NFL - dropped from Tank01's list entirely, or
// listed with no team - keeps his last label forever under the old behavior:
// he looks startable, has no game in nfl_games to lock against, and scores 0
// with no injury flag. Both writers said so on purpose (syncPlayers never
// runs unattended; the daily pass kept the label rather than risk one
// transient blank stripping 3,000 of them). The floor keeps that same
// protection for a short or truncated feed while letting a real, full feed's
// silence about a player read as what it is.
const PADDED_ENTRY_COUNT = NFL_PLAYER_LIST_FLOOR;

/** `count` filler entries the departure/floor tests pad a feed with, each on
 * its own team and matching no stored player, so they inflate the feed's
 * size without disturbing any assertion below. */
function paddingEntries(count) {
  const entries = [];
  for (let i = 0; i < count; i++) {
    entries.push({ playerID: `pad-${i}`, team: 'SF', injury: {} });
  }
  return entries;
}

test('#1385: at or above the floor, a departed player and a blank-team player both clear, a same-team control does not', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        // Absent from the feed entirely below - departed.
        { id: 201, external_id: 'tank-201', injury_status: null, nfl_team: 'HOU' },
        // Present in the feed with team: '' below - also departed.
        { id: 202, external_id: 'tank-202', injury_status: null, nfl_team: 'MIA' },
        // Present in the feed on his stored team - a control, untouched.
        { id: 203, external_id: 'tank-203', injury_status: null, nfl_team: 'KC' },
      ],
    }), 'client'],
    // No live league at all, so openKickoffTeams answers the empty set from
    // this one query alone - nothing here is deferred (ruling (4')).
    [select('leagues'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    api: async () => ({
      data: {
        body: [
          // tank-201 omitted on purpose - he has left the list.
          { playerID: 'tank-202', team: '', injury: {} },
          { playerID: 'tank-203', team: 'KC', injury: {} },
          ...paddingEntries(PADDED_ENTRY_COUNT),
        ],
      },
    }),
  });

  const mainWrite = fake.matching(update('players')).find((c) => /"injury_status" = v/.test(c.text));
  const [mainIds, , , mainTeams] = mainWrite.params;
  assert.deepEqual(
    Object.fromEntries(mainIds.map((id, i) => [id, mainTeams[i]])),
    { 202: null, 203: 'KC' },
    'the blank-team match clears in the same statement as the control, which keeps his team',
  );
  const departureWrite = fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text));
  assert.deepEqual(departureWrite.params, [[201]], 'the absent player clears in his own statement');
  assert.equal(result.teamsCleared, 2, 'both the absent player and the blank-team player count as cleared');
  assert.equal(result.teamChanges, 0, 'neither clear is a move between two real teams');
  assert.equal(result.teamsDeferred, 0, 'no live league exists to defer anything against');
  fake.assertClean();
});

test('a feed entry flagged isFreeAgent "True" reads as No NFL team: his stored label clears at or above the floor, a "False" control keeps his', async (t) => {
  // Tank01's getNFLPlayerList carries a player who has left the NFL under his
  // LAST team with the flag set (2026-09-15: 1,527 of 3,872 entries, every one
  // with a team label; Joe Mixon "team":"HOU" six months after Houston released
  // him). Reading only `team` kept all of them rostered, projected and
  // ranked as waiver Upgrades.
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 204, external_id: 'tank-204', injury_status: null, nfl_team: 'HOU' },
        { id: 205, external_id: 'tank-205', injury_status: null, nfl_team: 'KC' },
      ],
    }), 'client'],
    [select('leagues'), () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    api: async () => ({
      data: {
        body: [
          { playerID: 'tank-204', team: 'HOU', isFreeAgent: 'True', injury: { designation: '' } },
          { playerID: 'tank-205', team: 'KC', isFreeAgent: 'False', injury: { designation: '' } },
          ...paddingEntries(PADDED_ENTRY_COUNT),
        ],
      },
    }),
  });

  const mainWrite = fake.matching(update('players')).find((c) => /"injury_status" = v/.test(c.text));
  const [mainIds, , , mainTeams] = mainWrite.params;
  assert.deepEqual(
    Object.fromEntries(mainIds.map((id, i) => [id, mainTeams[i]])),
    { 204: null, 205: 'KC' },
    'the flagged player clears in the same statement as the control, which keeps his team',
  );
  assert.equal(result.teamsCleared, 1, 'the flagged player counts as cleared');
  assert.equal(result.teamChanges, 0, 'a clear is not a move between two real teams');
  fake.assertClean();
});

test('#1385: below the floor, neither a departed player nor a blank-team player clears', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 301, external_id: 'tank-301', injury_status: null, nfl_team: 'HOU' },
        { id: 302, external_id: 'tank-302', injury_status: null, nfl_team: 'MIA' },
        { id: 303, external_id: 'tank-303', injury_status: null, nfl_team: 'KC' },
      ],
    }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    api: async () => ({
      data: {
        // tank-301 omitted, tank-302 blank - same shape as the guard-passed
        // test above, but this feed never reaches NFL_PLAYER_LIST_FLOOR.
        body: [
          { playerID: 'tank-302', team: '', injury: {} },
          { playerID: 'tank-303', team: 'KC', injury: {} },
        ],
      },
    }),
  });

  assert.equal(
    fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text)),
    undefined,
    'no departure-clear statement is issued at all below the floor',
  );
  const mainWrite = fake.matching(update('players'))[0];
  const [mainIds, , , mainTeams] = mainWrite.params;
  assert.deepEqual(
    Object.fromEntries(mainIds.map((id, i) => [id, mainTeams[i]])),
    { 302: 'MIA', 303: 'KC' },
    'the blank-team match keeps his stored label; the control is untouched either way',
  );
  assert.equal(result.teamsCleared, 0, 'nothing cleared below the floor');
  assert.equal(result.teamsDeferred, 0, 'below the floor there are no clear candidates to defer either');
  fake.assertClean();
});

// ---- #1385 ruling (4'): a departure defers while its team is mid-lock -----
// Clearing nfl_team for a still-rostered player unlocks him retroactively in
// lineup.service.js's live nfl_team join (risk-001 f1, #627) if his own
// team's current-week game has already kicked off in a live league. The pass
// defers the clear instead - his label stays exactly as stored - and counts
// it in teamsDeferred, distinct from teamsCleared. Ruling's own red-tell.

test("#1385 ruling (4'): a departed player whose team already kicked off in a live league's current week is deferred, not cleared", async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 401, external_id: 'tank-401', injury_status: null, nfl_team: 'HOU' }],
    }), 'client'],
    [select('leagues'), () => ({ rows: [{ current_season: 2026, current_week: 3 }] }), 'client'],
    // #1391: an empty schedule read for the bound is the "unseen" case in
    // deriveNflWeek - it answers N = 1, so W >= N - 1 holds for ANY W >= 0 and
    // this test's calendar bound is a no-op, unrelated to what it covers.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({ rows: [] }), 'client'],
    // HOU's week-3 game kicked off an hour ago - the real query's
    // kickoff_at <= NOW() would include it.
    // risk-001-f2 (fakePool handler-order nit): a specific regex on the real
    // kicked-off-teams query's own leading text (fn_normalize_nfl_team), not
    // the generic select('nfl_games') this file used before #1391 added a
    // SECOND "nfl_games" query for the calendar bound - the generic matcher
    // would answer either query, so which one "wins" was really handler
    // ORDER, silently load-bearing and undocumented as such. This regex and
    // the calendar-bound regex above/below never match the same query text,
    // so which is listed first no longer matters.
    [/^SELECT DISTINCT fn_normalize_nfl_team/, () => ({ rows: [{ team: 'HOU' }] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    // tank-401 omitted - he has left the list - padded past the floor.
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  assert.equal(
    fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text)),
    undefined,
    'no clear statement is issued while his team is mid-lock',
  );
  assert.deepEqual(
    result,
    { playersUpdated: 0, irFlags: 0, teamChanges: 0, teamsCleared: 0, teamsDeferred: 1 },
  );
  fake.assertClean();
});

test("#1385 ruling (4'): the same shape clears once his team's current-week game has not kicked off yet", async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 402, external_id: 'tank-402', injury_status: null, nfl_team: 'HOU' }],
    }), 'client'],
    [select('leagues'), () => ({ rows: [{ current_season: 2026, current_week: 3 }] }), 'client'],
    // #1391: an empty schedule read for the bound answers N = 1, a no-op
    // against W >= N - 1 - unrelated to what this test covers.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({ rows: [] }), 'client'],
    // HOU's week-3 game kicks off an hour from now - the real query's
    // kickoff_at <= NOW() would exclude it.
    [/^SELECT DISTINCT fn_normalize_nfl_team/, () => ({ rows: [] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  const departureWrite = fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text));
  assert.deepEqual(departureWrite.params, [[402]], 'he clears once nothing defers him');
  assert.deepEqual(
    result,
    { playersUpdated: 0, irFlags: 0, teamChanges: 0, teamsCleared: 1, teamsDeferred: 0 },
  );
  fake.assertClean();
});

test("#1385 ruling (4'): the deferral folds Team code aliases (a stored WSH against nfl_games' folded WAS)", async (t) => {
  // WAS is already its own canonical form (normalizeNflTeam('WAS') === 'WAS'
  // is the identity), so storing WAS on both sides would pass even with the
  // JS-side fold deleted. WSH is the alias that actually needs folding: the
  // player is stored raw WSH, and the nfl_games side answers the ALREADY
  // folded code a raw WAS row would produce (the real SQL applies
  // fn_normalize_nfl_team before this code ever sees the row) - so only the
  // fold on the player's own stored team, at the deferral check itself,
  // makes the two sides match. Deleting that fold sends the raw 'WSH' key
  // against a Set holding only 'WAS' and flips the result to teamsCleared: 1.
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 403, external_id: 'tank-403', injury_status: null, nfl_team: 'WSH' }],
    }), 'client'],
    [select('leagues'), () => ({ rows: [{ current_season: 2026, current_week: 3 }] }), 'client'],
    // #1391: an empty schedule read for the bound answers N = 1, a no-op
    // against W >= N - 1 - unrelated to what this test covers.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({ rows: [] }), 'client'],
    [/^SELECT DISTINCT fn_normalize_nfl_team/, () => ({ rows: [{ team: 'WAS' }] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  assert.equal(
    fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text)),
    undefined,
    'the alias still matches, so the deferral holds',
  );
  assert.deepEqual(
    result,
    { playersUpdated: 0, irFlags: 0, teamChanges: 0, teamsCleared: 0, teamsDeferred: 1 },
  );
  fake.assertClean();
});

// ---- #1391 ruling: the (4') deferral is bounded to the NFL calendar -------
// #1385 left "open week" unbounded: a live league's own current_week, with no
// check against the NFL schedule at all. One league whose commissioner never
// advances past week 1 would then pin HOU's departure forever, for every
// league, until that one league's season completed. #1391's ruling bounds it:
// N = deriveNflWeek(getSeasonWeekBounds({season}), now) (pickemSeason.service,
// the same pure function the pick'em lifecycle already uses), and an open
// week (S, W) counts toward the deferral only while W >= N - 1 - the week in
// play and the week just finished, one NFL week of grace. Below that, the
// league holds nobody's label and its clear candidates on that team clear
// normally.
//
// Both tests below share one league (season 2026, current_week 1) and one
// departed player (HOU, already kicked off per the raw nfl_games read) - only
// the schedule-bounds read changes, moving week 2's last kickoff from the
// past to the future so N drops from 3 to 2. That is the whole difference
// between "two weeks behind, cleared" and "one week behind, still deferred".

test("#1391 ruling: a league two or more NFL weeks behind the calendar holds no team's label - the departure clears despite an old kickoff", async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 501, external_id: 'tank-501', injury_status: null, nfl_team: 'HOU' }],
    }), 'client'],
    // The league's own open week is (2026, 1) - far behind the calendar below.
    [select('leagues'), () => ({ rows: [{ current_season: 2026, current_week: 1 }] }), 'client'],
    // deriveNflWeek's schedule read: week 2's last kickoff is 8h in the past
    // (closed, past the 6h grace) and week 3's kicks off a day from now (open) -
    // the smallest still-open week is 3, so N = 3. The league's open week
    // (W = 1) sits below N - 1 = 2: two calendar weeks behind.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: [
        { week: 2, kickoff_at: new Date(Date.now() - 8 * 60 * 60 * 1000) },
        { week: 3, kickoff_at: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      ],
    }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    // tank-501 omitted - he has left the list - padded past the floor.
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  // Bounded out of the deferral set: openKickoffTeams never even reads
  // nfl_games for a kicked-off game, since (2026, 1) failed the bound before
  // that query would run - no handler for that query is registered above, so
  // an unbounded implementation would fail here with "unexpected query".
  const departureWrite = fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text));
  assert.deepEqual(departureWrite.params, [[501]], 'he clears - his league is too far behind the calendar to hold him');
  assert.deepEqual(
    result,
    { playersUpdated: 0, irFlags: 0, teamChanges: 0, teamsCleared: 1, teamsDeferred: 0 },
  );
  fake.assertClean();
});

test('#1391 ruling: one NFL week behind the calendar is still inside the grace - the departure stays deferred', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 502, external_id: 'tank-502', injury_status: null, nfl_team: 'HOU' }],
    }), 'client'],
    // Same league, same open week (2026, 1) as the sibling test above.
    [select('leagues'), () => ({ rows: [{ current_season: 2026, current_week: 1 }] }), 'client'],
    // Only week 2's last kickoff moved: now a day AHEAD of now instead of 8h
    // behind, so week 2 is the smallest still-open week - N = 2. The league's
    // open week (W = 1) sits at N - 1 = 1 exactly: one calendar week behind,
    // still inside the grace.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: [{ week: 2, kickoff_at: new Date(Date.now() + 24 * 60 * 60 * 1000) }],
    }), 'client'],
    // HOU's week-1 game (the league's own open week) already kicked off.
    [/^SELECT DISTINCT fn_normalize_nfl_team/, () => ({ rows: [{ team: 'HOU' }] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  assert.equal(
    fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text)),
    undefined,
    "no clear statement is issued - the bound still holds his league's open week",
  );
  assert.deepEqual(
    result,
    { playersUpdated: 0, irFlags: 0, teamChanges: 0, teamsCleared: 0, teamsDeferred: 1 },
  );
  fake.assertClean();
});

// qa-reviewer (#1391 risk review, formal-001-f1): deriveNflWeek saturates at
// REG_SEASON_WEEKS (18) once a season's own calendar has fully closed - its
// own doc comment says it answers 18 both for "week 18 is being played" and
// "everything is over". `W >= N - 1` alone would then hold forever for a
// league parked at week 17 or 18 of a season that finished seasons ago:
// exactly the unbounded pin #1391 exists to remove, surviving at the tail of
// the season.
//
// #1391's season-tail amendment
// (https://github.com/andydarknessb/Endzone-Empire/issues/1391#issuecomment-5680673660):
// a closed season's own LAST week (L) keeps its one week of grace - the same
// grace every other week gets from the week that follows it - measured
// instead from its own last kickoff (T), since it has no following week:
// `W >= L` AND `now < T + 7 days + WEEK_ROLLOVER_GRACE_HOURS` (174 hours).
// Once that instant passes, or for any week short of L, the season holds
// nobody's label. Three red-tell cases, as the ruling states them.

test('#1391 season-tail amendment: a league still on the closed season\'s LAST week, inside its own 174h tail grace, still defers', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 504, external_id: 'tank-504', injury_status: null, nfl_team: 'HOU' }],
    }), 'client'],
    // The league never advanced past its championship - it sits at (2025, 18),
    // the season's own last week.
    [select('leagues'), () => ({ rows: [{ current_season: 2025, current_week: 18 }] }), 'client'],
    // Week 18's last kickoff is 2 days past - well inside the 174h tail grace
    // (2 days = 48h < 174h) - so the season reads closed AND the tail is open.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: [{ week: 18, kickoff_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }],
    }), 'client'],
    // HOU's own week-18 game (the league's open week) already kicked off.
    [/^SELECT DISTINCT fn_normalize_nfl_team/, () => ({ rows: [{ team: 'HOU' }] }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  assert.equal(
    fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text)),
    undefined,
    'no clear statement is issued - the closed season\'s own last week still holds its tail grace',
  );
  assert.deepEqual(
    result,
    { playersUpdated: 0, irFlags: 0, teamChanges: 0, teamsCleared: 0, teamsDeferred: 1 },
  );
  fake.assertClean();
});

test('#1391 season-tail amendment: once the tail grace has passed (8 days), the same league clears', async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 505, external_id: 'tank-505', injury_status: null, nfl_team: 'HOU' }],
    }), 'client'],
    [select('leagues'), () => ({ rows: [{ current_season: 2025, current_week: 18 }] }), 'client'],
    // Week 18's last kickoff is 8 days past - outside the 174h (7.25-day) tail
    // grace - so even the season's own last week no longer holds anybody.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: [{ week: 18, kickoff_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }],
    }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    // tank-505 omitted - he has left the list - padded past the floor.
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  // No handler above answers a kicked-off-teams read: the tail grace expired,
  // so (2025, 18) never reaches that query.
  const departureWrite = fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text));
  assert.deepEqual(departureWrite.params, [[505]], 'he clears - the season\'s own tail grace has passed');
  assert.deepEqual(
    result,
    { playersUpdated: 0, irFlags: 0, teamChanges: 0, teamsCleared: 1, teamsDeferred: 0 },
  );
  fake.assertClean();
});

test("#1391 season-tail amendment: a league on week 17 once week 18 has closed is two weeks behind and clears, even inside week 18's own tail grace", async (t) => {
  const fake = createFakePool([
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [{ id: 506, external_id: 'tank-506', injury_status: null, nfl_team: 'HOU' }],
    }), 'client'],
    // A commissioner never clicked advance on the championship - the league
    // sits at (2025, 17), one week short of the season's own last week (18).
    [select('leagues'), () => ({ rows: [{ current_season: 2025, current_week: 17 }] }), 'client'],
    // Week 18's last kickoff is 2 days past - inside ITS OWN tail grace - but
    // this league's open week (17) is still short of L (18), so the tail
    // grace never applies to it regardless.
    [/^SELECT DISTINCT "week", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: [{ week: 18, kickoff_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }],
    }), 'client'],
    [update('players'), () => ({ rows: [] }), 'client'],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncInjuries({
    // tank-506 omitted - he has left the list - padded past the floor.
    api: async () => ({ data: { body: paddingEntries(PADDED_ENTRY_COUNT) } }),
  });

  // No handler above answers a kicked-off-teams read: W=17 < L=18 excludes
  // this row before the tail-grace check even matters.
  const departureWrite = fake.matching(update('players')).find((c) => /"nfl_team" = NULL/.test(c.text));
  assert.deepEqual(departureWrite.params, [[506]], 'he clears - his league is a week short of the season\'s own last week');
  assert.deepEqual(
    result,
    { playersUpdated: 0, irFlags: 0, teamChanges: 0, teamsCleared: 1, teamsDeferred: 0 },
  );
  fake.assertClean();
});
