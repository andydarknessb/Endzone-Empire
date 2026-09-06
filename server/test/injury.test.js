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
        { id: 21, external_id: 'tank-21', injury_status: 'O' },
        { id: 22, external_id: 'tank-22', injury_status: 'Q' },
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
            { playerID: 'tank-21', injury: { designation: 'Questionable', description: 'Ankle' } },
            { playerID: 'tank-22', injury: { designation: 'Active' } },
          ],
        },
      };
    },
  });

  assert.deepEqual(result, { playersUpdated: 2, irFlags: 1 });
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
    [61, { injury_status: 'Q', injury_detail: 'Ankle' }],
    [62, { injury_status: 'D', injury_detail: 'Knee' }],
  ]);
  const written = [];
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [{}] }), 'client'],
    [select('players'), () => ({
      rows: [
        { id: 61, external_id: 'tank-61', injury_status: 'Q' },
        { id: 62, external_id: 'tank-62', injury_status: 'D' },
      ],
    }), 'client'],
    [update('players'), (text, params) => {
      const hasNoOpPredicate = /IS DISTINCT FROM/.test(text);
      const [ids, statuses, details] = params;
      for (let i = 0; i < ids.length; i++) {
        const row = stored.get(ids[i]);
        const distinct = row.injury_status !== statuses[i] || row.injury_detail !== details[i];
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
          { playerID: 'tank-61', injury: { designation: 'Questionable', description: 'Ankle' } },
          { playerID: 'tank-62', injury: { designation: 'Out', description: 'Hamstring' } },
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
  ]);
  // The predicate compares BOTH columns against the target row p.
  assert.match(
    injuryWrites[0].text,
    /"injury_status" IS DISTINCT FROM v\."status"[\s\S]*OR[\s\S]*"injury_detail" IS DISTINCT FROM v\."detail"/,
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
