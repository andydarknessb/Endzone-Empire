const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, select } = require('./helpers/fakePool');
const prefs = require('../services/prefs.service');
const push = require('../services/push.service');
const {
  flagRecoveredIrStashes,
  isIrEligible,
  rosterCapacity,
  sendIrFlagPushes,
} = require('../services/irPolicy.service');

test('IR eligibility follows the qualifying injury designations', () => {
  const cases = [
    ['O', true],
    ['IR', true],
    ['Q', false],
    ['D', false],
    [null, false],
  ];

  for (const [injuryDesignation, expected] of cases) {
    assert.equal(isIrEligible(injuryDesignation), expected, String(injuryDesignation));
  }
});

test('every eligible-to-ineligible edge flags each affected manager once', async () => {
  const transitions = [
    { playerId: 21, previousDesignation: 'O', currentDesignation: 'Q', currentName: 'questionable' },
    { playerId: 22, previousDesignation: 'O', currentDesignation: 'D', currentName: 'doubtful' },
    { playerId: 23, previousDesignation: 'O', currentDesignation: null, currentName: 'healthy' },
    { playerId: 24, previousDesignation: 'IR', currentDesignation: 'Q', currentName: 'questionable' },
    { playerId: 25, previousDesignation: 'IR', currentDesignation: 'D', currentName: 'doubtful' },
    { playerId: 26, previousDesignation: 'IR', currentDesignation: null, currentName: 'healthy' },
  ];
  const unstashed = { playerId: 27, previousDesignation: 'O', currentDesignation: 'Q' };
  const notifications = [];
  const fake = createFakePool([
    [/FROM "lineup_entries"/, (text, params) => {
      assert.deepEqual(params, [[21, 22, 23, 24, 25, 26, 27]]);
      assert.match(text, /SELECT MAX\("latest"\."week"\)/);
      assert.match(text, /"latest"\."week" <= "leagues"\."current_week"/);
      return {
        rows: transitions.map((transition, index) => ({
          player_id: transition.playerId,
          player_name: `Test Player ${transition.playerId}`,
          injury_status: transition.currentDesignation,
          team_id: 31 + index,
          owner_id: 41 + index,
          league_id: 51 + index,
        })),
      };
    }],
    [insert('notifications'), (text, params) => {
      notifications.push({
        userId: params[0],
        leagueId: params[1],
        type: params[2],
        message: params[3],
        data: JSON.parse(params[4]),
      });
      return { rows: [] };
    }],
  ]);
  const client = await fake.connect();

  const irFlags = await flagRecoveredIrStashes(client, [
    ...transitions,
    unstashed,
    transitions[0],
  ]);
  client.release();

  assert.equal(notifications.length, transitions.length);
  assert.equal(irFlags.length, transitions.length);
  transitions.forEach((transition, index) => {
    const message = `Test Player ${transition.playerId} is no longer IR-eligible (${transition.currentName}). Move him out of IR before saving your lineup.`;
    assert.deepEqual(notifications[index], {
      userId: 41 + index,
      leagueId: 51 + index,
      type: 'ir_flag',
      message,
      data: { playerId: transition.playerId, teamId: 31 + index },
    });
    assert.equal(irFlags[index].message, message);
  });
  fake.assertClean();
});

test('transitions that do not leave IR eligibility produce no scan or repeat notification', async () => {
  const fake = createFakePool();
  const client = await fake.connect();

  assert.deepEqual(await flagRecoveredIrStashes(client, [
    { playerId: 21, previousDesignation: 'Q', currentDesignation: null },
    { playerId: 22, previousDesignation: 'O', currentDesignation: 'IR' },
    { playerId: 23, previousDesignation: 'Q', currentDesignation: 'Q' },
  ]), []);
  client.release();

  assert.equal(fake.calls.length, 0);
  fake.assertClean();
});

// --- roster capacity --------------------------------------------------------

/** A stash-count world: answers the eligible-IR-stash count with `stashed`. */
function capacityPool({ stashed, onQuery } = {}) {
  return createFakePool([
    [select('lineup_entries'), (text, params) => {
      if (onQuery) onQuery(text, params);
      return { rows: [{ n: stashed }] };
    }],
  ]);
}

test('rosterCapacity: an empty stash leaves capacity at the draft roster size', async () => {
  const fake = capacityPool({ stashed: 0 });
  const client = await fake.connect();

  const capacity = await rosterCapacity(client, {
    league: { roster_limit: 16, ir_slots: 2 },
    teamId: 31,
  });
  client.release();

  assert.equal(capacity, 14);
  fake.assertClean();
});

test('rosterCapacity: each eligible stash grants one spot, and only eligible occupants count', async () => {
  let seen;
  const fake = capacityPool({ stashed: 1, onQuery: (text, params) => { seen = { text, params }; } });
  const client = await fake.connect();

  const capacity = await rosterCapacity(client, {
    league: { roster_limit: 16, ir_slots: 2 },
    teamId: 31,
  });
  client.release();

  assert.equal(capacity, 15);
  // The count is scoped to this team's current-week IR slots and filtered to
  // the qualifying designations, so an ineligible occupant grants nothing.
  assert.deepEqual(seen.params, [31, ['O', 'IR'], []]);
  assert.match(seen.text, /"lineup_entries"\."slot" = 'IR'/);
  assert.match(seen.text, /"players"\."injury_status" = ANY\(\$2::text\[\]\)/);
  assert.match(seen.text, /SELECT MAX\("latest"\."week"\)/);
  assert.match(seen.text, /"latest"\."week" <= "leagues"\."current_week"/);
  assert.match(seen.text, /JOIN "team_players"/);
  fake.assertClean();
});

test('rosterCapacity: stash grants cap at the league IR slot count', async () => {
  const fake = capacityPool({ stashed: 5 });
  const client = await fake.connect();

  const capacity = await rosterCapacity(client, {
    league: { roster_limit: 16, ir_slots: 2 },
    teamId: 31,
  });
  client.release();

  assert.equal(capacity, 14 + 2);
  fake.assertClean();
});

test('rosterCapacity: a zero-IR league never queries the stash', async () => {
  const fake = createFakePool();
  const client = await fake.connect();

  const capacity = await rosterCapacity(client, {
    league: { roster_limit: 15, ir_slots: 0 },
    teamId: 31,
  });
  client.release();

  assert.equal(capacity, 15);
  assert.equal(fake.calls.length, 0);
  fake.assertClean();
});

test('rosterCapacity: excluded players (leaving in this transaction) grant nothing', async () => {
  let seen;
  const fake = capacityPool({ stashed: 0, onQuery: (text, params) => { seen = { text, params }; } });
  const client = await fake.connect();

  await rosterCapacity(client, {
    league: { roster_limit: 16, ir_slots: 1 },
    teamId: 31,
    excludePlayerIds: [21, 22],
  });
  client.release();

  assert.deepEqual(seen.params[2], [21, 22]);
  assert.match(seen.text, /NOT \("lineup_entries"\."player_id" = ANY\(\$3::int\[\]\)\)/);
  fake.assertClean();
});

test('IR flag push reaches only managers who keep irAlerts enabled', async (t) => {
  const sends = [];
  t.mock.method(prefs, 'usersWanting', async (userIds, key) => {
    assert.deepEqual(userIds, [41, 42]);
    assert.equal(key, 'irAlerts');
    return [41];
  });
  t.mock.method(push, 'sendPushToUsers', async (userIds, payload) => {
    sends.push({ userIds, payload });
    return { sent: userIds.length };
  });

  await sendIrFlagPushes([
    {
      userId: 41,
      leagueId: 51,
      playerId: 21,
      playerName: 'Test Runner',
      message: 'Test Runner must leave IR.',
    },
    {
      userId: 42,
      leagueId: 52,
      playerId: 22,
      playerName: 'Other Runner',
      message: 'Other Runner must leave IR.',
    },
  ]);

  assert.deepEqual(sends, [{
    userIds: [41],
    payload: {
      title: 'IR roster action required',
      body: 'Test Runner must leave IR.',
      url: '/#/league/51/lineup',
    },
  }]);
});
