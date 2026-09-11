const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, select, update } = require('./helpers/fakePool');
const prefs = require('../services/prefs.service');
const push = require('../services/push.service');
const { normalizeInjuryStatus, syncInjuries } = require('../services/scoring.service');
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

  assert.deepEqual(result, { playersUpdated: 2, irFlags: 1, teamChanges: 0 });
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

  assert.deepEqual(result, { playersUpdated: 1, irFlags: 0, teamChanges: 0 });
  const records = dataSyncRuns(fake.calls);
  // Red-tell for criterion 2: deleting the ok=true record call empties this.
  assert.equal(records.length, 1, 'exactly one data_sync_runs row is appended');
  assert.equal(records[0].via, 'pool', 'the record is written on the pool, outside the transaction');
  assert.equal(records[0].params[0], 'injuries', 'the job is the literal "injuries"');
  assert.equal(records[0].params[2], true, 'ok is true');
  assert.deepEqual(JSON.parse(records[0].params[3]), { playersUpdated: 1, irFlags: 0, teamChanges: 0 },
    'detail carries the run counts');
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
  await assert.rejects(syncInjuries({ api: healthyToQuestionableApi }), /scan blew up/);

  const records = dataSyncRuns(fake.calls);
  // Red-tell for the record half of criterion 3: deleting the failure record
  // call empties this.
  assert.equal(records.length, 1, 'exactly one data_sync_runs row is appended on failure');
  assert.equal(records[0].params[0], 'injuries');
  assert.equal(records[0].params[2], false, 'ok is false');
  const detail = JSON.parse(records[0].params[3]);
  // A throw from inside the transaction is the database side. Red-tell:
  // dropping the write_failed tag in runSyncJob's per-unit catch drops this to
  // undefined. Control: 'write_failed' here, 'fetch_failed'/'bad_response' in
  // the two pre-transaction tests below.
  assert.equal(detail.reason, 'write_failed', 'a scan failure is the database side');
  // ADR 0036: a failed unit is recorded in detail.failed[], one entry per unit
  // that threw (injuries has exactly one unit, so exactly one entry here).
  assert.equal(detail.failed[0].message, 'scan blew up', 'the error message is in detail.failed[]');
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
  // Red-tell: dropping the fetch_failed tag in runInjurySync's api() catch drops
  // this to sync_failed. Control: reason is 'fetch_failed' here, 'bad_response'
  // in the shape-guard test, 'write_failed' in the in-transaction test.
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(
    syncInjuries({ api: async () => { throw new Error('Tank01 timed out'); } }),
    /Tank01 timed out/,
  );

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

test('#1041 connect failure: pool.connect() rejecting records ok=false with reason "write_failed", not "sync_failed"', async (t) => {
  // The #839 shape: pool exhaustion or refusal makes pool.connect() itself
  // throw, above the transaction try/catch/finally (no client exists yet to
  // ROLLBACK or release). Before this fix that throw carried no
  // syncFailureReason and fell through to the sync_failed fallback, even
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
  await assert.rejects(
    syncInjuries({ api: healthyToQuestionableApi }),
    /connection refused by pooler/,
  );

  const records = dataSyncRuns(fake.calls);
  assert.equal(records.length, 1, 'exactly one data_sync_runs row on a connect failure');
  assert.equal(records[0].via, 'pool');
  assert.equal(records[0].params[0], 'injuries');
  assert.equal(records[0].params[2], false, 'ok is false');
  const detail = JSON.parse(records[0].params[3]);
  // Red-tell: dropping the default tag in runSyncJob's per-unit catch drops
  // this to undefined.
  assert.equal(detail.reason, 'write_failed', 'a connect failure is the database side, not unclassified');
  assert.equal(detail.failed[0].message, 'connection refused by pooler', 'the connect error message is in detail.failed[]');
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

  assert.deepEqual(result, { playersUpdated: 1, irFlags: 0, teamChanges: 0 }, 'the run returns its real result');
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

test('team refresh: a feed entry with no team keeps the stored label instead of wiping it', async (t) => {
  // This pass runs unattended every day, so a blank team in the feed must never
  // be able to strip a label (syncPlayers, hand-run, still writes the null
  // through on purpose). Red-tell: pushing feed.team straight into the array
  // sends [null] and the daily job clears teams league-wide on a bad feed.
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
  fake.assertClean();
});
