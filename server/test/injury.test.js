const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, select, update } = require('./helpers/fakePool');
const prefs = require('../services/prefs.service');
const push = require('../services/push.service');
const { normalizeInjuryStatus, syncInjuries } = require('../services/scoring.service');

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
