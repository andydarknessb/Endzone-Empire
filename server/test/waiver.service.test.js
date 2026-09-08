const test = require('node:test');
const assert = require('node:assert/strict');
// processWaivers and the drop path refresh league availability through the one
// Draft room adapter (#745), which throws with no transport; register a
// recording broadcast per test.
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
const recordingBroadcast = registerRecordingBroadcast();
const { claimFailureReason, claimTarget, orderClaims, processWaivers, submitClaim } = require('../services/waiver.service');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');
const lineupService = require('../services/lineup.service');

const claim = (id, teamId, bid = 0, createdAt = '2026-07-11T00:00:00Z') => ({
  id,
  team_id: teamId,
  bid,
  created_at: createdAt,
});

test('orderClaims priority mode: lower waiver_priority number claims first', () => {
  const priorities = new Map([[10, 3], [20, 1], [30, 2]]);
  const ordered = orderClaims([claim(1, 10), claim(2, 20), claim(3, 30)], priorities, 'priority');
  assert.deepEqual(ordered.map((c) => c.team_id), [20, 30, 10]);
});

test('orderClaims priority mode: ties broken by earliest claim', () => {
  const priorities = new Map([[10, 1], [20, 1]]);
  const ordered = orderClaims(
    [claim(2, 20, 0, '2026-07-11T01:00:00Z'), claim(1, 10, 0, '2026-07-11T00:00:00Z')],
    priorities,
    'priority'
  );
  assert.deepEqual(ordered.map((c) => c.id), [1, 2]);
});

test('orderClaims faab mode: highest bid wins', () => {
  const priorities = new Map([[10, 1], [20, 2], [30, 3]]);
  const ordered = orderClaims(
    [claim(1, 10, 5), claim(2, 20, 25), claim(3, 30, 10)],
    priorities,
    'faab'
  );
  assert.deepEqual(ordered.map((c) => c.bid), [25, 10, 5]);
});

test('orderClaims faab mode: bid ties fall back to waiver priority', () => {
  const priorities = new Map([[10, 2], [20, 1]]);
  const ordered = orderClaims([claim(1, 10, 15), claim(2, 20, 15)], priorities, 'faab');
  assert.deepEqual(ordered.map((c) => c.team_id), [20, 10]);
});

test('orderClaims faab mode: zero bids still resolve by priority', () => {
  const priorities = new Map([[10, 3], [20, 1]]);
  const ordered = orderClaims([claim(1, 10, 0), claim(2, 20, 0)], priorities, 'faab');
  assert.deepEqual(ordered.map((c) => c.team_id), [20, 10]);
});

test('orderClaims: teams missing a priority sort last', () => {
  const priorities = new Map([[10, 1]]);
  const ordered = orderClaims([claim(1, 99), claim(2, 10)], priorities, 'priority');
  assert.deepEqual(ordered.map((c) => c.team_id), [10, 99]);
});

test('orderClaims does not mutate its input', () => {
  const priorities = new Map([[10, 2], [20, 1]]);
  const input = [claim(1, 10), claim(2, 20)];
  orderClaims(input, priorities, 'priority');
  assert.deepEqual(input.map((c) => c.id), [1, 2]);
});

test('submitClaim refuses a player who is already a free agent', async (t) => {
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{ id: 1, pickem_only: false, waiver_type: 'priority', transactions_locked: false, waivers_clear_at: null }],
    })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, locked: false }] })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })],
    [select('waiver_players'), () => ({ rows: [] })],
  ]).install(t);

  await assert.rejects(
    () => submitClaim({ leagueId: 1, userId: 8, playerId: 500, dropPlayerId: null, bid: 0 }),
    { message: 'player is not on waivers' }
  );
  assert.equal(fake.matching(insert('waiver_claims')).length, 0);
  fake.assertClean();
});

test('claimTarget admits an unrostered player during the blanket waiver window', async (t) => {
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{ id: 1, pickem_only: false, waiver_type: 'priority', transactions_locked: false, waivers_clear_at: '2099-07-12T15:00:00.000Z' }],
    })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, locked: false }] })],
    [/^SELECT "id", "name", "position", "nfl_team" FROM "players"/, () => ({
      rows: [{ id: 500, name: 'Blanket Waiver Player', position: 'WR', nfl_team: 'DAL' }],
    })],
    [/^SELECT 1 FROM "team_players"/, () => ({ rows: [] })],
    [select('waiver_players'), () => ({ rows: [] })],
  ]).install(t);

  const player = await claimTarget({ leagueId: 1, userId: 8, playerId: 500 });

  assert.deepEqual(player, { id: 500, name: 'Blanket Waiver Player', position: 'WR', nfl_team: 'DAL' });
  fake.assertClean();
});

test('claimTarget refuses a frozen league (entry gate)', async (t) => {
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{ id: 1, pickem_only: false, waiver_type: 'priority', transactions_locked: true, waivers_clear_at: null }],
    })],
  ]).install(t);

  await assert.rejects(
    () => claimTarget({ leagueId: 1, userId: 8, playerId: 500 }),
    { statusCode: 409, message: 'transactions are locked by the commissioner' }
  );
  fake.assertClean();
});

// The entry gate (claimTarget, above) and the write-time gate (processWaivers,
// #944 above) must agree on the SAME frozen league row: a claim submitted
// before a freeze cannot be told "you may try" at the door and then refused
// only once it is too late to matter, and the reverse (told "no" at the door
// but the write-time gate somehow admits it) is the drift #966 exists to rule
// out. Both read the freeze through rosterGate.service's isLeagueFrozen, so
// this is a seam test on that agreement, not a coincidence of two hand-rolled
// checks that happen to match today.
test('claimTarget and processWaivers agree on the same frozen league row (#966)', async (t) => {
  const frozenLeague = {
    id: 1, pickem_only: false, waiver_type: 'priority', roster_limit: 16, ir_slots: 2,
    current_season: 2026, current_week: 6, waiver_period_hours: 24,
    transactions_locked: true, waivers_clear_at: null,
  };

  const entryFake = createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [frozenLeague] })],
  ]).install(t);
  let entryRejection;
  try {
    await claimTarget({ leagueId: 1, userId: 8, playerId: 500 });
    assert.fail('claimTarget should have refused a frozen league');
  } catch (err) {
    entryRejection = err;
  }
  entryFake.assertClean();

  const writeFake = createFakePool([
    [select('leagues'), () => ({ rows: [frozenLeague] })],
    [select('waiver_claims'), () => ({ rows: [
      { id: 9, league_id: 1, team_id: 31, player_id: 500, drop_player_id: null, bid: 0, status: 'pending', created_at: '2026-07-11T00:00:00Z' },
    ] })],
    [select('teams'), () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, user_id: 8, waiver_priority: 1, locked: false }] })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 10 }] })],
    [select('lineup_entries'), () => ({ rows: [{ n: 0 }] })],
  ]).install(t);
  let writeRejection;
  try {
    await processWaivers({ leagueId: 1 });
    assert.fail('processWaivers should have refused a frozen league');
  } catch (err) {
    writeRejection = err;
  }
  writeFake.assertClean();

  assert.equal(entryRejection.statusCode, writeRejection.statusCode);
  assert.equal(entryRejection.message, writeRejection.message);
  assert.equal(entryRejection.statusCode, 409);
  assert.equal(entryRejection.message, 'transactions are locked by the commissioner');
});

// --- roster capacity at the claim site (#97) --------------------------------
// Thin: proves the site consults the IR policy module's roster capacity, not
// the static roster limit. The capacity formula itself is tested at the
// module seam (irPolicy.service.test.js).

const capacityLeague = { id: 1, waiver_type: 'priority', roster_limit: 16, ir_slots: 2 };

function claimWorld({ rostered, stashed, onStashQuery }) {
  return createFakePool([
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })],
    [/^SELECT 1 FROM "team_players" WHERE "team_id"/, () => ({ rows: [{ 1: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: rostered }] })],
    [select('lineup_entries'), (text, params) => {
      if (onStashQuery) onStashQuery(text, params);
      return { rows: [{ n: stashed }] };
    }],
  ]);
}

test('claimFailureReason: a full team with no stash is rejected at the draft roster size', async () => {
  let stashParams;
  const fake = claimWorld({ rostered: 14, stashed: 0, onStashQuery: (text, params) => { stashParams = params; } });
  const client = await fake.connect();

  const reason = await claimFailureReason(client, {
    league: capacityLeague,
    team: { id: 31 },
    claim: { player_id: 500, drop_player_id: null, bid: 0 },
  });
  client.release();

  assert.equal(reason, 'roster capacity of 14 reached');
  // The claimed player earns no restored credit: a won claim lands him on
  // the bench, so nothing about his history on this team grants anything to
  // the claim. No restored ids means no fourth parameter (#197).
  assert.equal(stashParams.length, 3);
  fake.assertClean();
});

test('claimFailureReason: an eligible IR stash grants the extra spot', async () => {
  const fake = claimWorld({ rostered: 14, stashed: 1 });
  const client = await fake.connect();

  const reason = await claimFailureReason(client, {
    league: capacityLeague,
    team: { id: 31 },
    claim: { player_id: 500, drop_player_id: null, bid: 0 },
  });
  client.release();

  assert.equal(reason, null);
  fake.assertClean();
});

test('claimFailureReason: dropping the stashed player takes his granted spot with him', async () => {
  let stashParams;
  const fake = claimWorld({ rostered: 15, stashed: 0, onStashQuery: (text, params) => { stashParams = params; } });
  const client = await fake.connect();

  const reason = await claimFailureReason(client, {
    league: capacityLeague,
    team: { id: 31 },
    claim: { player_id: 500, drop_player_id: 77, bid: 0 },
  });
  client.release();

  // The to-be-dropped player is excluded from the stash count, so his own
  // stash grants nothing toward the claim that removes him.
  assert.deepEqual(stashParams[2], [77]);
  assert.equal(reason, 'roster capacity of 14 reached');
  fake.assertClean();
});

test('claimFailureReason: a team over capacity (stash occupant recovered) is rejected until resolved', async () => {
  // 15 rostered because a stash once granted the spot; the occupant recovered,
  // so the stash count is 0 and the team sits over its capacity of 14.
  const fake = claimWorld({ rostered: 15, stashed: 0 });
  const client = await fake.connect();

  const reason = await claimFailureReason(client, {
    league: capacityLeague,
    team: { id: 31 },
    claim: { player_id: 500, drop_player_id: null, bid: 0 },
  });
  client.release();

  assert.equal(reason, 'roster capacity of 14 reached');
  fake.assertClean();
});

// --- a won claim lands the player on the bench (#94 user story 13) ----------
// Thin: proves the execution site benches the acquired player after the roster
// insert. The bench step itself is tested at the lineup seam.

test('processWaivers: the winning claim benches the acquired player', async (t) => {
  const league = {
    id: 1, transactions_locked: false, waiver_type: 'priority', roster_limit: 16, ir_slots: 2,
    current_season: 2026, current_week: 6, waiver_period_hours: 24,
  };
  const fake = createFakePool([
    // Shape matcher (blind to the select list) so it answers both processWaivers'
    // own SELECT * and the roster gate's explicit-column read (#944).
    [select('leagues'), () => ({ rows: [league] })],
    [update('leagues'), () => ({ rows: [], rowCount: 0 })],
    [select('waiver_claims'), () => ({ rows: [
      { id: 9, league_id: 1, team_id: 31, player_id: 500, drop_player_id: null, bid: 0, status: 'pending', created_at: '2026-07-11T00:00:00Z' },
    ] })],
    [select('teams'), () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, user_id: 8, waiver_priority: 1 }] })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 10 }] })],
    [select('lineup_entries'), () => ({ rows: [{ n: 0 }] })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
    [update('waiver_claims'), () => ({ rows: [], rowCount: 1 })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
    [remove('waiver_players'), () => ({ rows: [] })],
  ]).install(t);
  const benched = [];
  t.mock.method(lineupService, 'benchAcquiredPlayer', async (client, args) => {
    benched.push({ ...args, afterRosterWrite: fake.matching(/^INSERT INTO "team_players"/).length > 0 });
  });

  const result = await processWaivers({ leagueId: 1 });

  assert.deepEqual(result.results, [{ claimId: 9, playerId: 500, status: 'won', teamId: 31 }]);
  assert.deepEqual(benched, [{ league, teamId: 31, playerId: 500, afterRosterWrite: true }]);
  fake.assertClean();
});

test('processWaivers: a frozen league awards nothing; the claims stay pending (#944)', async (t) => {
  // A claim submitted before a freeze must not land during it (#940 story 4).
  // The gate reads the freeze off the League row and throws; the whole batch
  // rolls back, so no roster write lands AND no claim is finished - the claims
  // are simply left pending for a tick after the freeze lifts, never awarded or
  // permanently invalidated.
  const league = {
    id: 1, transactions_locked: true, waiver_type: 'priority', roster_limit: 16, ir_slots: 2,
    current_season: 2026, current_week: 6, waiver_period_hours: 24,
  };
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [league] })],
    [select('waiver_claims'), () => ({ rows: [
      { id: 9, league_id: 1, team_id: 31, player_id: 500, drop_player_id: null, bid: 0, status: 'pending', created_at: '2026-07-11T00:00:00Z' },
    ] })],
    [select('teams'), () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, user_id: 8, waiver_priority: 1, locked: false }] })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 10 }] })],
    [select('lineup_entries'), () => ({ rows: [{ n: 0 }] })],
  ]).install(t);

  await assert.rejects(
    processWaivers({ leagueId: 1 }),
    { statusCode: 409, code: 'TRANSACTIONS_LOCKED', message: 'transactions are locked by the commissioner' }
  );
  assert.equal(fake.matching(insert('team_players')).length, 0, 'no award landed');
  assert.equal(fake.matching(update('waiver_claims')).length, 0, 'no claim was finished');
  fake.assertClean();
});

test('processWaivers clears an expired empty waiver window and refreshes league availability', async (t) => {
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: 1, waiver_type: 'priority' }] })],
    [select('waiver_claims'), () => ({ rows: [] })],
    [remove('waiver_players'), () => ({ rows: [], rowCount: 1 })],
    [update('leagues'), () => ({ rows: [], rowCount: 1 })],
  ]).install(t);
  const result = await processWaivers({ leagueId: 1 });

  assert.deepEqual(result, { processed: 0, results: [] });
  // The empty-window path refreshes league availability through the one Draft
  // room adapter (#745): exactly one rosterChanged for this league.
  assert.deepEqual(recordingBroadcast().calls, [
    { method: 'rosterChanged', leagueId: 1, payload: undefined },
  ]);
  // The expired blanket window is spent inside the same transaction, guarded
  // so an open window survives a manual commissioner trigger. Without this the
  // league is "due" on every tick and the digest re-runs each time.
  const spent = fake.matching(/^UPDATE "leagues" SET "waivers_clear_at" = NULL WHERE "id" = \$1 AND "waivers_clear_at" <= now\(\)/);
  assert.equal(spent.length, 1, 'expired blanket window is NULLed once');
  assert.equal(spent[0].via, 'client');
  fake.assertClean();
});

// --- the claim's own drop is NOT undoable (#222) ----------------------------
// The manager drop and the forced drop share `placeOnWaiversUndoable`, which
// records what the drop interrupted so an undo can replay it. This drop
// deliberately does not: no route offers an undo of a waiver-claim swap, so
// a hold advertising one would be a lie. That difference used to live only
// in a comment; this pins it, so routing this path through the shared helper
// fails here rather than passing silently.

test('processWaivers: the claim drop records no undo, unlike the two undoable drops', async (t) => {
  const league = {
    id: 1, transactions_locked: false, waiver_type: 'priority', roster_limit: 16, ir_slots: 2,
    current_season: 2026, current_week: 6, waiver_period_hours: 24,
  };
  let holdParams;
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [league] })],
    [update('leagues'), () => ({ rows: [], rowCount: 0 })],
    [select('waiver_claims'), () => ({ rows: [
      { id: 9, league_id: 1, team_id: 31, player_id: 500, drop_player_id: 77, bid: 0, status: 'pending', created_at: '2026-07-11T00:00:00Z' },
    ] })],
    [select('teams'), () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, user_id: 8, waiver_priority: 1 }] })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })],
    [/^SELECT 1 FROM "team_players" WHERE "team_id"/, () => ({ rows: [{ 1: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 10 }] })],
    [select('lineup_entries'), () => ({ rows: [{ n: 0 }] })],
    [remove('team_players'), () => ({ rows: [], rowCount: 1 })],
    [insert('waiver_players'), (text, params) => { holdParams = params; return { rows: [] }; }],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
    [update('waiver_claims'), () => ({ rows: [], rowCount: 1 })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
    [remove('waiver_players'), () => ({ rows: [] })],
  ]).install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});
  const entryReads = [];
  t.mock.method(lineupService, 'currentWeekEntry', async (client, args) => {
    entryReads.push(args);
    return { slot: 'IR', ir_attested: true };
  });
  t.mock.method(lineupService, 'removeLineupEntries', async () => ({ removed: 1 }));

  await processWaivers({ leagueId: 1 });

  // The hold names no dropping team and carries no interrupted stash, so
  // undoDrop's `dropped_by_team_id` check finds nothing to undo. Asserted on
  // the three undo-carrying fields alone rather than the whole parameter
  // list, so this test does not also pin placeOnWaivers' unrelated defaults.
  const [, droppedPlayerId, , droppedByTeamId, interruptedSlot, interruptedIrAttested] = holdParams;
  assert.deepEqual(
    { droppedPlayerId, droppedByTeamId, interruptedSlot, interruptedIrAttested },
    { droppedPlayerId: 77, droppedByTeamId: null, interruptedSlot: null, interruptedIrAttested: false },
    'claim drop must write a bare hold: no dropper, no interrupted slot, not attested'
  );
  // And it never even asks what the row held - that read only exists to feed
  // a record this path does not write.
  assert.deepEqual(entryReads, []);
  fake.assertClean();
});

// --- a freeze stops every terminal claim status, not just the award (#990) --
// The batch this covers has nothing awardable in it: every due claim fails
// `claimFailureReason` first, so before #990 the pre-existing award-site gate
// call was never reached and the claims committed as `invalid` - terminal, and
// unrevivable - inside the window the league was supposed to be standing still.
// Routing the local `finish` helper through the same gate makes the refusal
// cover every terminal transition.

const frozenAllInvalidClaims = [
  { id: 9, league_id: 1, team_id: 31, player_id: 500, drop_player_id: null, bid: 0, status: 'pending', created_at: '2026-07-11T00:00:00Z' },
  { id: 10, league_id: 1, team_id: 32, player_id: 501, drop_player_id: null, bid: 0, status: 'pending', created_at: '2026-07-11T00:00:00Z' },
];
const frozenAllInvalidTeams = [
  { id: 31, league_id: 1, owner_id: 8, user_id: 8, waiver_priority: 1, locked: false },
  { id: 32, league_id: 1, owner_id: 9, user_id: 9, waiver_priority: 2, locked: false },
];
const allInvalidLeague = (transactionsLocked) => ({
  id: 1, transactions_locked: transactionsLocked, waiver_type: 'priority', roster_limit: 16, ir_slots: 2,
  current_season: 2026, current_week: 6, waiver_period_hours: 24,
});

test('processWaivers: a frozen league finishes nothing invalid either (#990)', async (t) => {
  const fake = createFakePool([
    // Shape matcher (blind to the select list) so it answers both processWaivers'
    // own SELECT * and the gate's explicit-column read.
    [select('leagues'), () => ({ rows: [allInvalidLeague(true)] })],
    [select('waiver_claims'), () => ({ rows: frozenAllInvalidClaims })],
    [select('teams'), () => ({ rows: frozenAllInvalidTeams })],
    // Both claimed players are already rostered, so every claim fails
    // claimFailureReason on "player is no longer available" and the award-site
    // gate call is never reached: the only gate call in play is the new one.
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [{ '?column?': 1 }] })],
    // Seeded so the pre-fix control and the red-tell resolve cleanly instead of
    // dying on an unmatched statement.
    [update('waiver_claims'), () => ({ rows: [], rowCount: 1 })],
    [remove('waiver_players'), () => ({ rows: [], rowCount: 0 })],
    [update('leagues'), () => ({ rows: [], rowCount: 0 })],
  ]).install(t);

  await assert.rejects(
    processWaivers({ leagueId: 1 }),
    { statusCode: 409, code: 'TRANSACTIONS_LOCKED', message: 'transactions are locked by the commissioner' }
  );
  assert.equal(fake.matching(update('waiver_claims')).length, 0, 'no claim was finished invalid');
  fake.assertClean();
});

test('processWaivers: the freeze refusal is the gate\'s own read, not a second one (#990)', async (t) => {
  // Seeded exactly like the test above, then the `leagues` handlers branch on
  // the select list: processWaivers' own read still says frozen, while the
  // gate's explicit-column read gets a row with no `transactions_locked` key at
  // all. A waiver-service-local freeze read would answer 409/TRANSACTIONS_LOCKED
  // off the first row; only the gate's own read can reach the fail-closed 500.
  // The gate matcher is registered FIRST because handlers are tried in order,
  // and neither may be a select('leagues') shape matcher: that is blind to
  // select lists and would hand both reads the same row.
  const fake = createFakePool([
    [/^SELECT "id", "transactions_locked"/, () => ({ rows: [{ id: 1, waiver_type: 'priority' }] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [allInvalidLeague(true)] })],
    [select('waiver_claims'), () => ({ rows: frozenAllInvalidClaims })],
    [select('teams'), () => ({ rows: frozenAllInvalidTeams })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [{ '?column?': 1 }] })],
    [update('waiver_claims'), () => ({ rows: [], rowCount: 1 })],
    [remove('waiver_players'), () => ({ rows: [], rowCount: 0 })],
    [update('leagues'), () => ({ rows: [], rowCount: 0 })],
  ]).install(t);

  await assert.rejects(
    processWaivers({ leagueId: 1 }),
    { statusCode: 500, code: 'ROSTER_GATE_INDETERMINATE' }
  );
  assert.equal(fake.matching(update('waiver_claims')).length, 0, 'no claim was finished invalid');
  fake.assertClean();
});

test('processWaivers: an unfrozen league still finishes an unawardable batch invalid (#990 control)', async (t) => {
  // The control against over-refusing: same batch, freeze off, both claims
  // still finish `invalid` exactly as before. Deleting `transactions_locked`
  // from this league row turns it red with 500/ROSTER_GATE_INDETERMINATE,
  // which is the proof that the gate is genuinely reached on the all-invalid
  // path rather than skipped.
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [allInvalidLeague(false)] })],
    [select('waiver_claims'), () => ({ rows: frozenAllInvalidClaims })],
    [select('teams'), () => ({ rows: frozenAllInvalidTeams })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [{ '?column?': 1 }] })],
    [update('waiver_claims'), () => ({ rows: [], rowCount: 1 })],
    [remove('waiver_players'), () => ({ rows: [], rowCount: 0 })],
    [update('leagues'), () => ({ rows: [], rowCount: 0 })],
  ]).install(t);

  const result = await processWaivers({ leagueId: 1 });

  assert.deepEqual(result.results.map((r) => r.status), ['invalid', 'invalid']);
  assert.equal(fake.matching(update('waiver_claims')).length, 2, 'both claims were finished');
  fake.assertClean();
});
