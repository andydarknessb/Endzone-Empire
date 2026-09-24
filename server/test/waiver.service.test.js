const test = require('node:test');
const assert = require('node:assert/strict');
// processWaivers and the drop path refresh league availability through the one
// Draft room adapter (#745), which throws with no transport; register a
// recording broadcast per test.
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
const recordingBroadcast = registerRecordingBroadcast();
const {
  claimFailureReason, claimTarget, orderClaims, processWaivers, submitClaim,
  placeOnWaivers, holdKickedOffPlayers, editClaim,
} = require('../services/waiver.service');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');
const lineupService = require('../services/lineup.service');
const pool = require('../modules/pool');

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
  const [, droppedPlayerId, , , droppedByTeamId, interruptedSlot, interruptedIrAttested] = holdParams;
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
    [insert('notifications'), () => ({ rows: [] })], // an invalid claim now tells its manager
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
    [insert('notifications'), () => ({ rows: [] })], // an invalid claim now tells its manager
    [remove('waiver_players'), () => ({ rows: [], rowCount: 0 })],
    [update('leagues'), () => ({ rows: [], rowCount: 0 })],
  ]).install(t);

  const result = await processWaivers({ leagueId: 1 });

  assert.deepEqual(result.results.map((r) => r.status), ['invalid', 'invalid']);
  assert.equal(fake.matching(update('waiver_claims')).length, 2, 'both claims were finished');
  fake.assertClean();
});

// --- withTransaction routing (ADR 0033, #1066 Ruling 5) ---------------------
// The representative pair for this child: submitClaim is the thinnest of the
// nine sites now routed through withTransaction. Both cases hit the SAME early
// throw (league not found, 404) after ONE read and ZERO writes, so the only
// thing that differs between them is whether the ROLLBACK that follows
// succeeds. That is what proves the site routes through the wrapper rather than
// any of its own business logic; the wrapper's own tests carry the rest.
const submitClaimEarlyThrowHandlers = () => [
  [/^SELECT \* FROM "leagues"/, () => ({ rows: [] })],
];

test('submitClaim: a rejecting ROLLBACK destroys the connection and the original error survives (#1066 Ruling 5)', async (t) => {
  const world = createFakePool([
    ...submitClaimEarlyThrowHandlers(),
    [/^ROLLBACK$/, () => { throw new Error('rollback rejected'); }, 'client'],
  ]).install(t);

  // Red-tell: reverting submitClaim to its own bare `client.release()` (rather
  // than routing through withTransaction) makes this reject with "rollback
  // rejected" instead of the original 404, since the unhandled ROLLBACK
  // rejection would replace the WaiverError.
  const promise = submitClaim({ leagueId: 1, userId: 8, playerId: 500, dropPlayerId: null, bid: 0 });
  await assert.rejects(promise, { statusCode: 404, message: 'league not found' });
  const error = await promise.catch((e) => e);
  assert.equal(error.rollbackError.message, 'rollback rejected',
    'the rollback failure is attached to the original error, not swallowed silently');

  // A rejecting ROLLBACK leaves the transaction open on the socket, so
  // withTransaction's finally releases the client WITH an Error: pg-pool
  // destroys the connection and Postgres frees the session's locks on
  // disconnect. Red-tell: making the release unconditional reddens this.
  world.assertClean();
  assert.ok(world.releaseArgs()[0] instanceof Error, 'a rejecting ROLLBACK destroys the connection');
});

test('submitClaim: a clean ROLLBACK returns the healthy connection to the pool (control)', async (t) => {
  const world = createFakePool(submitClaimEarlyThrowHandlers()).install(t);

  await assert.rejects(
    submitClaim({ leagueId: 1, userId: 8, playerId: 500, dropPlayerId: null, bid: 0 }),
    { statusCode: 404, message: 'league not found' }
  );

  // Complementary control: the same early throw, but this time the ROLLBACK
  // succeeds cleanly (fakePool's default auto-answer), so the connection is
  // healthy and must be returned to the pool, not destroyed. Red-tell:
  // destroying on every error path (release with an Error unconditionally)
  // reddens this.
  assert.equal(world.releaseArgs()[0], undefined, 'a clean ROLLBACK keeps the healthy connection');
  world.assertClean();
});

// ---- kickoff waiver hold (#1375, ADR 0043) ---------------------------------

// A tiny stateful `waiver_players` table, shared by the tests below, that
// implements the exact rule `placeOnWaivers`' SQL encodes: on conflict the
// clear time moves to the greater of existing and new, and the dropping
// team / interrupted-stash columns are never part of the write. Written once
// here so every test below proves the same rule against a real call rather
// than restating it with a canned response.
function waiverPlayersTable(seed = []) {
  const rows = seed.map((r) => ({ ...r }));
  return {
    rows,
    insertHandler: (text, params) => {
      const [leagueId, playerId, availableAt, waiverPeriodHours, droppedByTeamId, interruptedSlot, interruptedIrAttested] = params;
      const resolved = availableAt
        ? new Date(availableAt).toISOString()
        : new Date(Date.now() + Number(waiverPeriodHours) * 60 * 60 * 1000).toISOString();
      const existing = rows.find((r) => r.league_id === leagueId && r.player_id === playerId);
      if (existing) {
        if (new Date(resolved) > new Date(existing.available_at)) existing.available_at = resolved;
      } else {
        rows.push({
          league_id: leagueId, player_id: playerId, available_at: resolved,
          dropped_by_team_id: droppedByTeamId, interrupted_slot: interruptedSlot,
          interrupted_ir_attested: interruptedIrAttested,
        });
      }
      return { rows: [] };
    },
    // isOnWaivers' read: an unexpired row for (league, player).
    isOnWaiversHandler: (nowRef) => (text, params) => {
      const [leagueId, playerId] = params;
      const row = rows.find((r) => r.league_id === leagueId && r.player_id === playerId
        && new Date(r.available_at) > nowRef.current);
      return { rows: row ? [{ '?column?': 1 }] : [] };
    },
    // processWaivers' cleanup DELETE: every row past its clear, for a league.
    removeExpiredHandler: (nowRef) => (text, params) => {
      const [leagueId] = params;
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].league_id === leagueId && new Date(rows[i].available_at) <= nowRef.current) rows.splice(i, 1);
      }
      return { rows: [], rowCount: before - rows.length };
    },
  };
}

// The three queries `holdKickedOffPlayersForLeague` issues, wired to plain
// JS arrays rather than canned per-call responses, so a test can assert on
// the WEEK'S SCHEDULE producing the right write rather than on a query
// having been called. `league: null` simulates a drafting or pick'em-only
// league: `fantasySeasonLiveWhereSql` already filters both out of the
// leagues read itself, so an empty leagues result is the correct fake for
// either case.
function kickoffHoldPool({ league, nflGames = [], players = [], waiverTable }) {
  return createFakePool([
    [/^SELECT "id", "current_season", "current_week", "waiver_period_hours"\s+FROM "leagues"/,
      () => ({ rows: league ? [league] : [] })],
    [/^SELECT "nfl_team" FROM "nfl_games" WHERE "season" = \$1 AND "week" = \$2 AND "kickoff_at" <= \$3/,
      (text, params) => {
        const [season, week, now] = params;
        return { rows: nflGames
          .filter((g) => g.season === season && g.week === week && new Date(g.kickoff_at) <= new Date(now))
          .map((g) => ({ nfl_team: g.nfl_team })) };
      }],
    [/^SELECT "nfl_team", "kickoff_at" FROM "nfl_games"/,
      (text, params) => {
        const [season, week] = params;
        return { rows: nflGames
          .filter((g) => g.season === season && g.week === week)
          .map((g) => ({ nfl_team: g.nfl_team, kickoff_at: g.kickoff_at })) };
      }],
    // Mirrors the production WHERE clause's second NOT EXISTS (#1375 review
    // f2): a player already held at or past the instant this call is asking
    // about is excluded from the candidate list, exactly as the real SQL
    // excludes him, so a test that asserts on the call log (not just row
    // state) proves the skip and not merely the upsert's own idempotency.
    [/^SELECT "players"\."id", "players"\."nfl_team"/,
      (text, params) => {
        const [leagueId, minAvailableAt] = params;
        const alreadyHeld = new Set(
          waiverTable.rows
            .filter((r) => r.league_id === leagueId && new Date(r.available_at) >= new Date(minAvailableAt))
            .map((r) => r.player_id)
        );
        return { rows: players.filter((p) => !alreadyHeld.has(p.id)).map((p) => ({ id: p.id, nfl_team: p.nfl_team })) };
      }],
    [insert('waiver_players'), waiverTable.insertHandler],
  ]);
}

test('holdKickedOffPlayers: an unrostered player on a kicked-off team is held until the week clear (48h league)', async (t) => {
  const league = { id: 1, current_season: 2026, current_week: 2, waiver_period_hours: 48 };
  const nflGames = [
    { season: 2026, week: 2, nfl_team: 'KC', kickoff_at: '2026-09-14T17:00:00.000Z' }, // kicked off
    { season: 2026, week: 2, nfl_team: 'DAL', kickoff_at: '2026-09-15T23:15:00.000Z' }, // the week's LAST kickoff
  ];
  const players = [{ id: 500, nfl_team: 'KC' }]; // unrostered, per kickoffHoldPool having no team_players row
  const table = waiverPlayersTable();
  kickoffHoldPool({ league, nflGames, players, waiverTable: table }).install(t);

  const held = await holdKickedOffPlayers({ now: new Date('2026-09-14T18:00:00.000Z') });

  assert.equal(held, 1);
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0].player_id, 500);
  assert.equal(table.rows[0].dropped_by_team_id, null, 'the hold names no dropping team');
  assert.equal(table.rows[0].available_at, '2026-09-17T23:15:00.000Z', "the week's last kickoff plus 48 hours");
});

test('holdKickedOffPlayers: a player whose team has not kicked off, or has no game this week, is left alone', async (t) => {
  const league = { id: 1, current_season: 2026, current_week: 2, waiver_period_hours: 24 };
  const nflGames = [
    { season: 2026, week: 2, nfl_team: 'KC', kickoff_at: '2026-09-14T17:00:00.000Z' }, // kicked off
    { season: 2026, week: 2, nfl_team: 'DAL', kickoff_at: '2026-09-15T23:15:00.000Z' }, // not yet
  ];
  const players = [
    { id: 500, nfl_team: 'KC' }, // kicked off: held
    { id: 501, nfl_team: 'DAL' }, // not yet kicked off: a Free agent still
    { id: 502, nfl_team: 'MIA' }, // no schedule row this week (a bye): a Free agent
  ];
  const table = waiverPlayersTable();
  kickoffHoldPool({ league, nflGames, players, waiverTable: table }).install(t);

  const held = await holdKickedOffPlayers({ now: new Date('2026-09-14T18:00:00.000Z') });

  assert.equal(held, 1);
  assert.deepEqual(table.rows.map((r) => r.player_id), [500]);
});

test('holdKickedOffPlayers: a variant team code (the WSH/WAS class) still matches the player', async (t) => {
  const league = { id: 1, current_season: 2026, current_week: 2, waiver_period_hours: 24 };
  const nflGames = [{ season: 2026, week: 2, nfl_team: 'WSH', kickoff_at: '2026-09-14T17:00:00.000Z' }];
  const players = [{ id: 500, nfl_team: 'WAS' }]; // schedule row spells it WSH, the player row spells it WAS
  const table = waiverPlayersTable();
  kickoffHoldPool({ league, nflGames, players, waiverTable: table }).install(t);

  const held = await holdKickedOffPlayers({ now: new Date('2026-09-14T18:00:00.000Z') });

  assert.equal(held, 1);
  assert.equal(table.rows[0].player_id, 500);
});

test("holdKickedOffPlayers: a drafting league or a pick'em-only league writes nothing", async (t) => {
  // Both are excluded by `fantasySeasonLiveWhereSql` at the leagues read
  // itself (draft_status <> 'complete', or no fantasy side at all), so an
  // empty leagues result is the correct fake for either case: this function
  // never reaches its own team/player logic for a league that never comes
  // back from that read.
  const table = waiverPlayersTable();
  kickoffHoldPool({ league: null, waiverTable: table }).install(t);

  const held = await holdKickedOffPlayers({ now: new Date('2026-09-14T18:00:00.000Z') });

  assert.equal(held, 0);
  assert.equal(table.rows.length, 0);
});

test('holdKickedOffPlayers: a week with no schedule rows writes nothing', async (t) => {
  const league = { id: 1, current_season: 2026, current_week: 2, waiver_period_hours: 24 };
  const table = waiverPlayersTable();
  kickoffHoldPool({ league, nflGames: [], players: [{ id: 500, nfl_team: 'KC' }], waiverTable: table }).install(t);

  const held = await holdKickedOffPlayers({ now: new Date('2026-09-14T18:00:00.000Z') });

  assert.equal(held, 0);
  assert.equal(table.rows.length, 0);
});

test('holdKickedOffPlayers: a second tick in the same week writes no new row and changes no clear time', async (t) => {
  const league = { id: 1, current_season: 2026, current_week: 2, waiver_period_hours: 24 };
  const nflGames = [
    { season: 2026, week: 2, nfl_team: 'KC', kickoff_at: '2026-09-14T17:00:00.000Z' },
    { season: 2026, week: 2, nfl_team: 'DAL', kickoff_at: '2026-09-15T23:15:00.000Z' },
  ];
  const players = [{ id: 500, nfl_team: 'KC' }];
  const table = waiverPlayersTable();
  const fake = kickoffHoldPool({ league, nflGames, players, waiverTable: table });
  fake.install(t);

  await holdKickedOffPlayers({ now: new Date('2026-09-14T18:00:00.000Z') });
  const afterFirstTick = table.rows.map((r) => ({ ...r }));
  const insertsAfterFirstTick = fake.matching(insert('waiver_players')).length;
  await holdKickedOffPlayers({ now: new Date('2026-09-14T20:00:00.000Z') }); // a later tick, same week

  assert.equal(table.rows.length, 1, 'no new row');
  assert.deepEqual(table.rows, afterFirstTick, 'the clear time did not change');
  // #1375 review f2: the already-held candidate filter must keep the second
  // tick from calling placeOnWaivers at all for this player, not merely from
  // changing anything once it does - asserted on the call log, not row state.
  assert.equal(
    fake.matching(insert('waiver_players')).length,
    insertsAfterFirstTick,
    'a second tick in the same week issues zero additional writes for an already-held player'
  );
});

test('holdKickedOffPlayers: a row a drop wrote with a later clear is skipped outright, not merely unchanged by a no-op write', async (t) => {
  const league = { id: 1, current_season: 2026, current_week: 2, waiver_period_hours: 24 };
  const nflGames = [
    { season: 2026, week: 2, nfl_team: 'KC', kickoff_at: '2026-09-14T17:00:00.000Z' },
    { season: 2026, week: 2, nfl_team: 'DAL', kickoff_at: '2026-09-15T23:15:00.000Z' }, // week clear: 2026-09-16T23:15:00Z
  ];
  const players = [{ id: 500, nfl_team: 'KC' }];
  // A drop before kickoff already holds him, with a clear LATER than the week
  // clear the tick would otherwise write - so the candidate filter (#1375
  // review f2) excludes him before any placeOnWaivers call, the same as the
  // "second tick" case above. `placeOnWaivers`'s own never-touched-on-
  // conflict rule (a real conflict, not a skip) is proven on real Postgres in
  // placeOnWaivers.pg.test.js, which this fake cannot demonstrate (its
  // insertHandler re-implements the rule rather than running the SQL).
  const table = waiverPlayersTable([{
    league_id: 1, player_id: 500, available_at: '2026-09-20T00:00:00.000Z',
    dropped_by_team_id: 7, interrupted_slot: 'BENCH', interrupted_ir_attested: false,
  }]);
  const fake = kickoffHoldPool({ league, nflGames, players, waiverTable: table });
  fake.install(t);

  const held = await holdKickedOffPlayers({ now: new Date('2026-09-14T18:00:00.000Z') });

  assert.equal(held, 0, 'the already-held-past-clear candidate is filtered out, not upserted');
  assert.equal(fake.matching(insert('waiver_players')).length, 0, 'no write was attempted at all');
  assert.deepEqual(table.rows[0], {
    league_id: 1, player_id: 500, available_at: '2026-09-20T00:00:00.000Z',
    dropped_by_team_id: 7, interrupted_slot: 'BENCH', interrupted_ir_attested: false,
  }, 'the drop clear and its own record both survive the tick untouched');
});

test('holdKickedOffPlayers: keeps the week clear when it is later than a drop clear already on the row', async (t) => {
  const league = { id: 1, current_season: 2026, current_week: 2, waiver_period_hours: 24 };
  const nflGames = [
    { season: 2026, week: 2, nfl_team: 'KC', kickoff_at: '2026-09-14T17:00:00.000Z' },
    { season: 2026, week: 2, nfl_team: 'DAL', kickoff_at: '2026-09-15T23:15:00.000Z' }, // week clear: 2026-09-16T23:15:00Z
  ];
  const players = [{ id: 500, nfl_team: 'KC' }];
  // A drop after his own kickoff already holds him, with a clear EARLIER
  // than the week clear (every other game that week has not kicked off yet).
  const table = waiverPlayersTable([{
    league_id: 1, player_id: 500, available_at: '2026-09-14T20:00:00.000Z',
    dropped_by_team_id: 7, interrupted_slot: null, interrupted_ir_attested: false,
  }]);
  kickoffHoldPool({ league, nflGames, players, waiverTable: table }).install(t);

  await holdKickedOffPlayers({ now: new Date('2026-09-14T18:00:00.000Z') });

  assert.equal(table.rows[0].available_at, '2026-09-16T23:15:00.000Z', 'the later week clear wins');
  assert.equal(table.rows[0].dropped_by_team_id, 7, 'the dropping team is never touched by the tick');
});

test('placeOnWaivers on conflict: the clear time moves to the greater of existing and new, either direction', async (t) => {
  const table = waiverPlayersTable();
  const fake = createFakePool([[insert('waiver_players'), table.insertHandler]]).install(t);
  const client = await fake.connect();

  await placeOnWaivers(client, {
    leagueId: 1, playerId: 500, waiverPeriodHours: 24, availableAt: new Date('2026-09-16T23:15:00.000Z'),
  });
  await placeOnWaivers(client, {
    leagueId: 1, playerId: 500, waiverPeriodHours: 24, availableAt: new Date('2026-09-14T18:00:00.000Z'),
  });
  assert.equal(table.rows[0].available_at, '2026-09-16T23:15:00.000Z', 'an earlier write never moves the clear back');

  await placeOnWaivers(client, {
    leagueId: 1, playerId: 500, waiverPeriodHours: 24, availableAt: new Date('2026-09-18T00:00:00.000Z'),
  });
  assert.equal(table.rows[0].available_at, '2026-09-18T00:00:00.000Z', 'a later write moves the clear forward');
});

test('placeOnWaivers on conflict: never touches the dropping team or interrupted-stash columns', async (t) => {
  const table = waiverPlayersTable();
  const fake = createFakePool([[insert('waiver_players'), table.insertHandler]]).install(t);
  const client = await fake.connect();

  await placeOnWaivers(client, {
    leagueId: 1, playerId: 500, waiverPeriodHours: 24, availableAt: new Date('2026-09-14T18:00:00.000Z'),
    droppedByTeamId: 7, interruptedSlot: 'IR', interruptedIrAttested: true,
  });
  await placeOnWaivers(client, {
    // A kickoff hold's own call: no dropping team, no interrupted stash.
    leagueId: 1, playerId: 500, waiverPeriodHours: 24, availableAt: new Date('2026-09-16T23:15:00.000Z'),
  });

  assert.deepEqual(table.rows[0], {
    league_id: 1, player_id: 500, available_at: '2026-09-16T23:15:00.000Z',
    dropped_by_team_id: 7, interrupted_slot: 'IR', interrupted_ir_attested: true,
  }, 'the clear time moved; the drop record did not');
});

test('kickoff hold, then claim-target, submit-claim and processing, all through one stateful world (#1375)', async (t) => {
  const league = {
    id: 1, waiver_type: 'priority', transactions_locked: false, roster_limit: 16, ir_slots: 0,
    current_season: 2026, current_week: 2, waiver_period_hours: 24, waivers_clear_at: null,
  };
  const nflGames = [
    { season: 2026, week: 2, nfl_team: 'KC', kickoff_at: '2026-09-14T17:00:00.000Z' },
    { season: 2026, week: 2, nfl_team: 'DAL', kickoff_at: '2026-09-15T23:15:00.000Z' }, // week clear: 2026-09-16T23:15:00Z
  ];
  const player = { id: 500, name: 'Kickoff Player', position: 'TE', nfl_team: 'KC' };
  const team = { id: 31, league_id: 1, owner_id: 8, user_id: 8, waiver_priority: 1, faab_remaining: 100, locked: false };
  const table = waiverPlayersTable();
  const nowRef = { current: new Date('2026-09-14T18:00:00.000Z') };
  const claimRow = {
    id: 9, league_id: 1, team_id: 31, player_id: 500, drop_player_id: null, bid: 0,
    status: 'pending', created_at: '2026-09-14T19:00:00.000Z',
  };

  createFakePool([
    // holdKickedOffPlayers' own leagues read, ahead of the blind one below.
    [/^SELECT "id", "current_season", "current_week", "waiver_period_hours"\s+FROM "leagues"/,
      () => ({ rows: [league] })],
    [/^SELECT "nfl_team" FROM "nfl_games" WHERE "season" = \$1 AND "week" = \$2 AND "kickoff_at" <= \$3/,
      (text, params) => {
        const [season, week, now] = params;
        return { rows: nflGames
          .filter((g) => g.season === season && g.week === week && new Date(g.kickoff_at) <= new Date(now))
          .map((g) => ({ nfl_team: g.nfl_team })) };
      }],
    [/^SELECT "nfl_team", "kickoff_at" FROM "nfl_games"/,
      (text, params) => {
        const [season, week] = params;
        return { rows: nflGames
          .filter((g) => g.season === season && g.week === week)
          .map((g) => ({ nfl_team: g.nfl_team, kickoff_at: g.kickoff_at })) };
      }],
    [/^SELECT "players"\."id", "players"\."nfl_team"/, () => ({ rows: [{ id: player.id, nfl_team: player.nfl_team }] })],
    [insert('waiver_players'), table.insertHandler],

    // claimTarget / submitClaim / processWaivers, sharing the same world.
    [select('leagues'), () => ({ rows: [league] })],
    [select('teams'), () => ({ rows: [team] })],
    [/^SELECT "id", "name", "position", "nfl_team" FROM "players"/, () => ({ rows: [player] })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })], // never rostered before the award
    [/^SELECT 1 FROM "waiver_players"/, table.isOnWaiversHandler(nowRef)],
    [/^SELECT 1 FROM "waiver_claims" WHERE "team_id"/, () => ({ rows: [] })], // no pending duplicate
    [/MAX\("claim_order"\)/,() => ({ rows: [{ next: 1 }] })], // the new claim joins the Claim order last
    [insert('waiver_claims'), () => ({ rows: [claimRow] })],
    [/^SELECT "waiver_claims"\.\* FROM "waiver_claims"/, () => ({ rows: [claimRow] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 5 }] })],
    [select('lineup_entries'), () => ({ rows: [{ n: 0 }] })],
    [insert('team_players'), () => ({ rows: [], rowCount: 1 })],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
    [update('waiver_claims'), () => ({ rows: [], rowCount: 1 })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
    [update('leagues'), () => ({ rows: [], rowCount: 0 })],
    [remove('waiver_players'), table.removeExpiredHandler(nowRef)],
    // The Waiver Wire list route's own query (waivers.router.js GET /),
    // wired to the same table so its "kicked-off player, week clear" claim
    // is proven against the real route SQL, not inferred from the service
    // layer alone.
    [/^SELECT "players"\.\*, "waiver_players"\."available_at" FROM "waiver_players" JOIN "players"/, () => ({
      rows: table.rows
        .filter((r) => new Date(r.available_at) > nowRef.current)
        .map((r) => ({ ...player, available_at: r.available_at })),
    })],
  ]).install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

  // 1. The tick's kickoff hold puts the kicked-off, unrostered player on
  // waivers at the week clear.
  const held = await holdKickedOffPlayers({ now: nowRef.current });
  assert.equal(held, 1);
  assert.equal(table.rows[0].available_at, '2026-09-16T23:15:00.000Z');

  // The Waiver Wire list route returns him at the week clear (the route's
  // own query text, read against the same world the tick just wrote).
  const wire = await pool.query(
    `SELECT "players".*, "waiver_players"."available_at"
     FROM "waiver_players" JOIN "players" ON "players"."id" = "waiver_players"."player_id"
     WHERE "waiver_players"."league_id" = $1 AND "waiver_players"."available_at" > now()
     ORDER BY "waiver_players"."available_at", "players"."name"`,
    [1]
  );
  assert.deepEqual(
    wire.rows.map((r) => ({ id: r.id, available_at: r.available_at })),
    [{ id: 500, available_at: '2026-09-16T23:15:00.000Z' }]
  );

  // 2. Still before the clear: the claim-target and submit-claim paths
  // accept him, reading the very row the tick just wrote.
  const targeted = await claimTarget({ leagueId: 1, userId: 8, playerId: 500 });
  assert.equal(targeted.id, 500);
  const claimed = await submitClaim({ leagueId: 1, userId: 8, playerId: 500, dropPlayerId: null, bid: 0 });
  assert.equal(claimed.status, 'pending');

  // 3. Past the clear: processing awards the claim and deletes the hold row -
  // existing behaviour, asserted once through this same world.
  nowRef.current = new Date('2026-09-17T00:00:00.000Z');
  const processed = await processWaivers({ leagueId: 1 });
  assert.deepEqual(processed.results, [{ claimId: 9, playerId: 500, status: 'won', teamId: 31 }]);
  assert.equal(table.rows.length, 0, 'the clear DELETE removed the row');
});

test('submitClaim refuses a no-drop claim when the roster is already at capacity', async (t) => {
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: 1, pickem_only: false, waiver_type: 'priority', transactions_locked: false,
        waivers_clear_at: null, roster_limit: 14, ir_slots: 0,
      }],
    })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, locked: false }] })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })],
    [select('waiver_players'), () => ({ rows: [{ 1: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 14 }] })],
    [select('waiver_claims'), () => ({ rows: [] })],
  ]).install(t);

  await assert.rejects(
    () => submitClaim({ leagueId: 1, userId: 8, playerId: 500, dropPlayerId: null, bid: 0 }),
    { statusCode: 409, message: 'roster capacity of 14 reached; choose a player to drop' }
  );
  assert.equal(fake.matching(insert('waiver_claims')).length, 0);
  fake.assertClean();
});

// #1580: edit a pending claim's bid and drop player in place.
const editWorld = ({ waiverType = 'faab', faab = 50, claimRow, dropOnRoster = true, rosterCount = 10 } = {}) => {
  const row = claimRow || {
    id: 900, league_id: 1, team_id: 31, player_id: 500, drop_player_id: null, bid: 10,
    claim_order: 2, status: 'pending', created_at: '2026-07-11T00:00:00Z',
  };
  return createFakePool([
    [/^SELECT "waiver_claims"."league_id" FROM "waiver_claims"/, () => ({ rows: [{ league_id: 1 }] })],
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: 1, pickem_only: false, waiver_type: waiverType, transactions_locked: false,
        waivers_clear_at: null, roster_limit: 16, ir_slots: 0,
      }],
    })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: rosterCount }] })],
    [/^SELECT \* FROM "teams"/, () => ({
      rows: [{ id: 31, league_id: 1, owner_id: 8, locked: false, faab_remaining: faab }],
    })],
    [/^SELECT \* FROM "waiver_claims"/, () => ({ rows: [row] })],
    [/^SELECT 1 FROM "team_players" WHERE "team_id"/, () => ({ rows: dropOnRoster ? [{}] : [] })],
    [/^UPDATE "waiver_claims"/, (text, params) => ({
      rows: [{ ...row, bid: params[0], drop_player_id: params[1] }],
    })],
  ]);
};

test('editClaim refuses a bid over the FAAB budget with a coded refusal', async (t) => {
  const fake = editWorld({ faab: 50 }).install(t);
  await assert.rejects(
    () => editClaim({ userId: 8, claimId: 900, bid: 51 }),
    { statusCode: 409, code: 'BID_OVER_BUDGET' }
  );
  assert.equal(fake.matching(update('waiver_claims')).length, 0);
  fake.assertClean();
});

test('editClaim refuses a drop player who is not on the caller roster', async (t) => {
  const fake = editWorld({ dropOnRoster: false }).install(t);
  await assert.rejects(
    () => editClaim({ userId: 8, claimId: 900, dropPlayerId: 77 }),
    { code: 'DROP_NOT_ON_ROSTER' }
  );
  assert.equal(fake.matching(update('waiver_claims')).length, 0);
  fake.assertClean();
});

test('editClaim refuses a bid in a priority league', async (t) => {
  editWorld({ waiverType: 'priority' }).install(t);
  await assert.rejects(
    () => editClaim({ userId: 8, claimId: 900, bid: 5 }),
    { statusCode: 409, code: 'BID_NOT_ALLOWED' }
  );
});

test('editClaim: a non-owner claim id is a 404 from the owner-joined first read, before any league lock', async (t) => {
  const fake = createFakePool([
    [/^SELECT "waiver_claims"."league_id" FROM "waiver_claims"/, () => ({ rows: [] })],
  ]).install(t);
  await assert.rejects(
    () => editClaim({ userId: 99, claimId: 900, bid: 5 }),
    { statusCode: 404, message: 'pending claim not found' }
  );
  const [first] = fake.matching(/waiver_claims/);
  assert.match(first.text, /JOIN "teams".*"owner_id" = \$2/);
  assert.deepEqual(first.params, [900, 99]);
  assert.equal(fake.matching(/FROM "leagues"/).length, 0);
  assert.equal(fake.matching(update('waiver_claims')).length, 0);
  fake.assertClean();
});

test('editClaim refuses a drop change that leaves a full roster over capacity', async (t) => {
  const fake = editWorld({
    rosterCount: 16,
    claimRow: {
      id: 900, league_id: 1, team_id: 31, player_id: 500, drop_player_id: 77, bid: 10,
      claim_order: 2, status: 'pending', created_at: '2026-07-11T00:00:00Z',
    },
  }).install(t);
  await assert.rejects(
    () => editClaim({ userId: 8, claimId: 900, dropPlayerId: null }),
    { statusCode: 409, message: /roster capacity of 16 reached/ }
  );
  assert.equal(fake.matching(update('waiver_claims')).length, 0);
  fake.assertClean();
});

test('editClaim updates bid and drop without touching claim_order or created_at', async (t) => {
  const fake = editWorld({ faab: 50 }).install(t);
  const result = await editClaim({ userId: 8, claimId: 900, bid: 25, dropPlayerId: 77 });
  assert.equal(result.bid, 25);
  assert.equal(result.drop_player_id, 77);
  assert.equal(result.claim_order, 2);
  const [write] = fake.matching(update('waiver_claims'));
  assert.doesNotMatch(write.text, /claim_order|created_at/);
  fake.assertClean();
});

// --- the Winning bid on every resolved claim of a player (#1611, ADR 0049) ---
// The UPDATE that finishes a claim is read back as { id, status, winner, bid }
// so each test states the stored outcome, not the SQL spelling.
const resolvedClaims = (fake) => fake.matching(update('waiver_claims')).map(({ text, params }) => {
  const set = (column) => {
    const at = new RegExp(`"${column}" = \\$(\\d+)`).exec(text);
    return at ? params[Number(at[1]) - 1] : undefined; // undefined: the UPDATE never sets it
  };
  return {
    id: set('id'),
    status: set('status'),
    winner: set('winning_team_id'),
    bid: set('winning_bid'),
  };
});

const contestedWorld = (t, { waiverType, claims, faabRemaining = 100 }) => {
  const league = {
    id: 1, transactions_locked: false, waiver_type: waiverType, roster_limit: 16, ir_slots: 2,
    current_season: 2026, current_week: 6, waiver_period_hours: 24,
  };
  const rows = claims.map((c, i) => ({
    league_id: 1, player_id: 500, drop_player_id: null, status: 'pending',
    created_at: `2026-07-11T00:0${i}:00Z`, ...c,
  }));
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [league] })],
    [update('leagues'), () => ({ rows: [], rowCount: 0 })],
    [select('waiver_claims'), () => ({ rows })],
    [select('teams'), () => ({ rows: [31, 32, 33].map((id, i) => ({
      id, league_id: 1, owner_id: id, user_id: id, waiver_priority: i + 1, faab_remaining: faabRemaining,
    })) })],
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
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});
  return fake;
};

test('processWaivers (FAAB): the winner and Winning bid land on the won claim and every lost one (#1611)', async (t) => {
  const fake = contestedWorld(t, {
    waiverType: 'faab',
    claims: [
      { id: 1, team_id: 31, bid: 10 },
      { id: 2, team_id: 32, bid: 23 },
      { id: 3, team_id: 33, bid: 5 },
    ],
  });

  await processWaivers({ leagueId: 1 });

  const byId = new Map(resolvedClaims(fake).map((r) => [r.id, r]));
  assert.deepEqual(byId.get(2), { id: 2, status: 'won', winner: 32, bid: 23 });
  assert.deepEqual(byId.get(1), { id: 1, status: 'lost', winner: 32, bid: 23 });
  assert.deepEqual(byId.get(3), { id: 3, status: 'lost', winner: 32, bid: 23 });
});

test('processWaivers (priority league): the winner is recorded, the Winning bid stays null (#1611)', async (t) => {
  const fake = contestedWorld(t, {
    waiverType: 'priority',
    claims: [
      { id: 1, team_id: 32, bid: 0 },
      { id: 2, team_id: 31, bid: 0 },
    ],
  });

  await processWaivers({ leagueId: 1 });

  const byId = new Map(resolvedClaims(fake).map((r) => [r.id, r]));
  assert.deepEqual(byId.get(2), { id: 2, status: 'won', winner: 31, bid: null });
  assert.deepEqual(byId.get(1), { id: 1, status: 'lost', winner: 31, bid: null });
});

test('processWaivers: an invalid claim keeps its reason and names no winner (#1611)', async (t) => {
  // Team 31 bids higher than it can pay, so its claim goes invalid; team 32
  // then wins. The invalid claim is not a loss to anyone.
  const fake = contestedWorld(t, {
    waiverType: 'faab',
    faabRemaining: 15,
    claims: [
      { id: 1, team_id: 31, bid: 40 },
      { id: 2, team_id: 32, bid: 12 },
    ],
  });

  await processWaivers({ leagueId: 1 });

  const byId = new Map(resolvedClaims(fake).map((r) => [r.id, r]));
  assert.deepEqual(byId.get(1), { id: 1, status: 'invalid', winner: null, bid: null });
  assert.deepEqual(byId.get(2), { id: 2, status: 'won', winner: 32, bid: 12 });
  const invalidUpdate = fake.matching(update('waiver_claims')).find((c) => c.params.includes(1) && c.params.includes('invalid'));
  assert.match(invalidUpdate.params[1], /bid exceeds remaining FAAB budget/);
});
