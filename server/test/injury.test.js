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
  assert.equal(fake.matching(update('players')).length, 2);
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
    [/^UPDATE "lineup_entries"/, (text, params) => {
      lineupSlot = params[0];
      signalLineupMoved();
      return { rows: [] };
    }],
    [select('players'), async () => {
      signalSyncAttempted();
      if (lineupReadHasLock) await lineupMoved;
      return { rows: [{ id: 1, external_id: 'tank-1', injury_status: playerDesignation }] };
    }, 'client'],
    [update('players'), (text, params) => {
      playerDesignation = params[0];
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
