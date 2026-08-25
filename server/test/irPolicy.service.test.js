const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, select } = require('./helpers/fakePool');
const prefs = require('../services/prefs.service');
const push = require('../services/push.service');
const {
  flagRecoveredIrStashes,
  interruptedStash,
  isIrEligible,
  isValidStash,
  rosterCapacity,
  sendIrFlagPushes,
  undoRestoresStash,
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
      // An attested stash is never scanned, flagged, or notified (#100).
      assert.match(text, /NOT "lineup_entries"\."ir_attested"/);
      assert.doesNotMatch(text, /"latest"\."player_id"/);
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

test('a stash is valid when its occupant is IR-eligible or commissioner-attested', () => {
  const cases = [
    [{ injury_status: 'O', ir_attested: false }, true],
    [{ injury_status: 'IR', ir_attested: false }, true],
    [{ injury_status: 'Q', ir_attested: false }, false],
    [{ injury_status: null, ir_attested: false }, false],
    [{ injury_status: 'Q', ir_attested: true }, true],
    [{ injury_status: null, ir_attested: true }, true],
    // eligible AND attested: still simply valid
    [{ injury_status: 'O', ir_attested: true }, true],
  ];

  for (const [entry, expected] of cases) {
    assert.equal(isValidStash(entry), expected, JSON.stringify(entry));
  }
});

// --- roster capacity --------------------------------------------------------

/**
 * A stash-count world: answers the eligible-IR-stash count with `stashed`.
 * `extra` handlers go first, for the interrupted-stash record a restored
 * player's credit is re-derived from (#197).
 */
function capacityPool({ stashed, onQuery, extra = [] } = {}) {
  return createFakePool([
    ...extra,
    [select('lineup_entries'), (text, params) => {
      if (onQuery) onQuery(text, params);
      return { rows: [{ n: stashed }] };
    }],
  ]);
}

/** The waiver hold's interrupted-stash record, as a fake-pool handler. */
const interruptedRecord = (record, log = []) => [
  /^SELECT "waiver_players"\."interrupted_slot"/,
  (text, params) => {
    log.push({ text, params });
    return { rows: record ? [record] : [] };
  },
];

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
  // the qualifying designations, so an ineligible occupant grants nothing -
  // unless the commissioner attested the stash, which grants like eligible.
  assert.deepEqual(seen.params, [31, ['O', 'IR'], []]);
  assert.match(seen.text, /\("players"\."injury_status" = ANY\(\$2::text\[\]\) OR "lineup_entries"\."ir_attested"\)/);
  assert.match(seen.text, /"lineup_entries"\."slot" = 'IR'/);
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

test('rosterCapacity: a restored player counts through the stash his drop interrupted', async () => {
  let seen;
  // The record the drop left on his waiver hold, which is what an undo
  // returns him to now that no stale lineup row survives (#197).
  const holds = [];
  const fake = capacityPool({
    stashed: 1,
    onQuery: (text, params) => { seen = { text, params }; },
    extra: [interruptedRecord(
      { interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'O' },
      holds
    )],
  });
  const client = await fake.connect();

  const capacity = await rosterCapacity(client, {
    league: { id: 5, roster_limit: 16, ir_slots: 1 },
    teamId: 31,
    restoredPlayerIds: [21],
  });
  client.release();

  assert.equal(capacity, 16);
  // The lineup-entry count itself no longer knows anything about restored
  // players: the credit is a separate read of the interrupted-stash record,
  // scoped to the league, the player and the team that holds the undo.
  assert.deepEqual(seen.params, [31, ['O', 'IR'], []]);
  assert.deepEqual(holds[0].params, [5, 21, 31]);
  fake.assertClean();
});

test('rosterCapacity: the stash count is strictly still-on-the-roster, with no relaxation arm left', async () => {
  let seen;
  const fake = capacityPool({ stashed: 0, onQuery: (text, params) => { seen = { text, params }; } });
  const client = await fake.connect();

  await rosterCapacity(client, { league: { id: 5, roster_limit: 16, ir_slots: 1 }, teamId: 31 });
  client.release();

  // The old relaxation arm revived a stash from the copy-forward SOURCE week
  // when the current week had no row. A lineup entry now follows the roster,
  // so a missing current-week row means he is not stashed - not that an
  // older week should speak for him. The arm is gone, join and all.
  assert.match(seen.text, /JOIN "team_players" ON "team_players"\."team_id" = "teams"\."id"/);
  assert.doesNotMatch(seen.text, /LEFT JOIN "team_players"/);
  assert.doesNotMatch(seen.text, /"restore"\./);
  assert.doesNotMatch(seen.text, /"source"\./);
  assert.equal(seen.params.length, 3);
  // And with no restored ids there is no record read at all.
  assert.equal(fake.matching(/FROM "waiver_players"/).length, 0);
  fake.assertClean();
});

test('rosterCapacity: a restored player whose recorded stash went invalid earns nothing', async () => {
  const fake = capacityPool({
    stashed: 0,
    // He recovered while on waivers: the slot is recorded, the designation
    // no longer qualifies, and nothing attested it.
    extra: [interruptedRecord({
      interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'Q',
    })],
  });
  const client = await fake.connect();

  const capacity = await rosterCapacity(client, {
    league: { id: 5, roster_limit: 16, ir_slots: 1 },
    teamId: 31,
    restoredPlayerIds: [21],
  });
  client.release();

  // Re-derived here rather than trusted from the caller: passing the id is
  // not what earns the spot, the record still being a valid stash is.
  assert.equal(capacity, 15);
  fake.assertClean();
});

test('rosterCapacity: a player both excluded and restored earns no restored credit', async () => {
  const holds = [];
  const fake = capacityPool({
    // The lineup-entry arm already skips him: he is in excludePlayerIds.
    stashed: 0,
    // ...and the stash his drop interrupted is a perfectly valid one.
    // Validity is not the question here, the exclusion is.
    extra: [interruptedRecord(
      { interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'O' },
      holds
    )],
  });
  const client = await fake.connect();

  const capacity = await rosterCapacity(client, {
    league: { id: 5, roster_limit: 16, ir_slots: 1 },
    teamId: 31,
    excludePlayerIds: [21],
    restoredPlayerIds: [21],
  });
  client.release();

  // Excluded wins over restored: the transaction that would put his stash
  // back is the same one taking it away, so the two arms of the count would
  // otherwise credit one spot twice.
  assert.equal(capacity, 15);
  // The exclusion is settled before the record is read, not after, so the
  // read never happens at all.
  assert.equal(holds.length, 0);
  assert.equal(fake.matching(/FROM "waiver_players"/).length, 0);
  fake.assertClean();
});

// --- both lists say the same thing about the same player (#277) --------------

test('rosterCapacity: a repeated restored id earns one credit and costs one record read', async () => {
  const holds = [];
  const fake = capacityPool({
    stashed: 0,
    extra: [interruptedRecord(
      { interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'O' },
      holds
    )],
  });
  const client = await fake.connect();

  const capacity = await rosterCapacity(client, {
    // Two IR slots, so a second credit would show as 16 rather than being
    // swallowed by the cap. A one-slot league cannot tell the two apart.
    league: { id: 5, roster_limit: 16, ir_slots: 2 },
    teamId: 31,
    restoredPlayerIds: [21, 21, 21],
  });
  client.release();

  // One player, one interrupted stash, one spot - however often he is named.
  assert.equal(capacity, 15);
  // De-duplicated before the reads, not after, so the repeats cost nothing
  // either: naming him three times asks the database once.
  assert.equal(holds.length, 1);
  assert.deepEqual(holds[0].params, [5, 21, 31]);
  fake.assertClean();
});

test('rosterCapacity: the numeric and string forms of an id are the same player', async () => {
  const holds = [];
  const fake = capacityPool({
    stashed: 0,
    extra: [interruptedRecord(
      { interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'O' },
      holds
    )],
  });
  const client = await fake.connect();

  const capacity = await rosterCapacity(client, {
    league: { id: 5, roster_limit: 16, ir_slots: 2 },
    teamId: 31,
    restoredPlayerIds: [21, '21'],
  });
  client.release();

  assert.equal(capacity, 15);
  assert.equal(holds.length, 1);
  // Canonicalised to the number, so the read is the one the int column
  // answers - a string id would deep-strict-compare unequal here.
  assert.deepEqual(holds[0].params, [5, 21, 31]);
  fake.assertClean();
});

test('rosterCapacity: an exclusion beats a restore in either representation', async () => {
  const pairs = [
    { excludePlayerIds: [21], restoredPlayerIds: ['21'] },
    { excludePlayerIds: ['21'], restoredPlayerIds: [21] },
  ];

  for (const pair of pairs) {
    const label = JSON.stringify(pair);
    const holds = [];
    let seen;
    const fake = capacityPool({
      stashed: 0,
      onQuery: (text, params) => { seen = { text, params }; },
      // A perfectly valid interrupted stash: validity is not the question
      // here, whether the two lists agree he is one player is.
      extra: [interruptedRecord(
        { interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'O' },
        holds
      )],
    });
    const client = await fake.connect();

    const capacity = await rosterCapacity(client, {
      league: { id: 5, roster_limit: 16, ir_slots: 2 },
      teamId: 31,
      ...pair,
    });
    client.release();

    assert.equal(capacity, 14, label);
    // Settled before the record is read, so the read never happens.
    assert.equal(holds.length, 0, label);
    assert.equal(fake.matching(/FROM "waiver_players"/).length, 0, label);
    // And the SQL arm is handed the same canonical number the filter used.
    assert.deepEqual(seen.params, [31, ['O', 'IR'], [21]], label);
    fake.assertClean();
  }
});

test('rosterCapacity: duplicate exclusions reach SQL once', async () => {
  let seen;
  const fake = capacityPool({ stashed: 0, onQuery: (text, params) => { seen = { text, params }; } });
  const client = await fake.connect();

  await rosterCapacity(client, {
    league: { id: 5, roster_limit: 16, ir_slots: 2 },
    teamId: 31,
    excludePlayerIds: [21, '21', 22, 22],
  });
  client.release();

  // Exact, not a containment match: the whole parameter list is the claim.
  assert.deepEqual(seen.params, [31, ['O', 'IR'], [21, 22]]);
  fake.assertClean();
});

test('rosterCapacity: an unusable player id is refused before any query', async () => {
  const unusable = [
    0, -1, 1.5, -0, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 2,
    null, undefined, true, false, {}, [21],
    '', '   ', 'abc', '21px', '1.5', '-1', '0', '+21', ' 21', '0x15', '1e3',
  ];

  for (const value of unusable) {
    for (const key of ['excludePlayerIds', 'restoredPlayerIds']) {
      const label = `${key}: ${typeof value} ${String(value)}`;
      const fake = createFakePool();
      const client = await fake.connect();

      await assert.rejects(
        () => rosterCapacity(client, {
          league: { id: 5, roster_limit: 16, ir_slots: 2 },
          teamId: 31,
          [key]: [value],
        }),
        (error) => error instanceof TypeError && new RegExp(`^${key} `).test(error.message),
        label
      );
      client.release();

      // A validation boundary, not a filter: nothing is dropped and carried
      // on with, and nothing is left for the ::int[] cast to decide.
      assert.equal(fake.calls.length, 0, label);
      fake.assertClean();
    }
  }
});

test('rosterCapacity: a zero-IR league refuses an unusable id just the same', async () => {
  const fake = createFakePool();
  const client = await fake.connect();

  // The contract belongs to the parameter, not to the league. Whether
  // ir_slots happens to short-circuit the count must not decide whether a
  // caller hears about an id the function cannot use.
  await assert.rejects(
    () => rosterCapacity(client, {
      league: { id: 5, roster_limit: 15, ir_slots: 0 },
      teamId: 31,
      excludePlayerIds: ['nope'],
    }),
    TypeError
  );
  client.release();

  assert.equal(fake.calls.length, 0);
  fake.assertClean();
});

test('rosterCapacity: a list that is not a list is refused', async () => {
  for (const key of ['excludePlayerIds', 'restoredPlayerIds']) {
    const fake = createFakePool();
    const client = await fake.connect();

    await assert.rejects(
      () => rosterCapacity(client, {
        league: { id: 5, roster_limit: 16, ir_slots: 2 },
        teamId: 31,
        [key]: 21,
      }),
      (error) => error instanceof TypeError && new RegExp(`^${key} `).test(error.message),
      key
    );
    client.release();

    assert.equal(fake.calls.length, 0, key);
    fake.assertClean();
  }
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

// --- undo restores only a still-valid stash ----------------------------------

test('undoRestoresStash reads the record the drop left, not a lineup entry', async () => {
  const log = [];
  const fake = createFakePool([
    interruptedRecord(
      { interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'O' },
      log
    ),
  ]);
  const client = await fake.connect();

  const restores = await undoRestoresStash(client, { leagueId: 5, teamId: 31, playerId: 21 });
  client.release();

  assert.equal(restores, true);
  // Scoped to the league, the player, and the team the hold names as the
  // dropper: only the team that can undo the drop is credited for it.
  assert.deepEqual(log[0].params, [5, 21, 31]);
  assert.match(log[0].text, /"waiver_players"\."dropped_by_team_id" = \$3/);
  assert.match(log[0].text, /JOIN "players" ON "players"\."id" = "waiver_players"\."player_id"/);
  // No lineup row is consulted at all: the row the undo used to read is the
  // one the drop now deletes (#197).
  assert.equal(fake.matching(/"lineup_entries"/).length, 0);
  fake.assertClean();
});

test('undoRestoresStash: the recorded slot and the live designation both have to qualify', async () => {
  const cases = [
    [{ interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'O' }, true,
      'out, so still IR-eligible'],
    [{ interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'IR' }, true,
      'on injured reserve'],
    [{ interrupted_slot: 'IR', interrupted_ir_attested: true, injury_status: 'Q' }, true,
      'the commissioner attested it (#100), which stands in for eligibility'],
    [{ interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: 'Q' }, false,
      'he recovered while on waivers'],
    [{ interrupted_slot: 'IR', interrupted_ir_attested: false, injury_status: null }, false,
      'healthy'],
    [{ interrupted_slot: 'BENCH', interrupted_ir_attested: false, injury_status: 'O' }, false,
      'the drop interrupted a bench row, not a stash'],
    [{ interrupted_slot: 'RB', interrupted_ir_attested: false, injury_status: 'O' }, false,
      'the drop interrupted a starting slot; only a stash is restored'],
    [{ interrupted_slot: null, interrupted_ir_attested: false, injury_status: 'O' }, false,
      'he had no current-week row when he was dropped'],
    [null, false, 'no waiver hold names this team as the dropper'],
  ];

  for (const [record, expected, why] of cases) {
    const fake = createFakePool([interruptedRecord(record)]);
    const client = await fake.connect();

    const restores = await undoRestoresStash(client, { leagueId: 5, teamId: 31, playerId: 21 });
    client.release();

    assert.equal(restores, expected, why);
    fake.assertClean();
  }
});

test('interruptedStash hands back the attestation, so the undo can carry it', async () => {
  const fake = createFakePool([interruptedRecord({
    interrupted_slot: 'IR', interrupted_ir_attested: true, injury_status: 'Q',
  })]);
  const client = await fake.connect();

  const stash = await interruptedStash(client, { leagueId: 5, teamId: 31, playerId: 21 });
  client.release();

  // A drop is not the manager slot move that ends an attestation, so undoing
  // it restores the commissioner's standing override with the slot.
  assert.deepEqual(stash, { slot: 'IR', irAttested: true });
  fake.assertClean();
});
