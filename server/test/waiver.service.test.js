const test = require('node:test');
const assert = require('node:assert/strict');
const { claimFailureReason, orderClaims, processWaivers } = require('../services/waiver.service');
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
    id: 1, waiver_type: 'priority', roster_limit: 16, ir_slots: 2,
    current_season: 2026, current_week: 6, waiver_period_hours: 24,
  };
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [league] })],
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

// --- the claim's own drop is NOT undoable (#222) ----------------------------
// The manager drop and the forced drop share `dropToWaiversUndoable`, which
// records what the drop interrupted so an undo can replay it. This drop
// deliberately does not: no route offers an undo of a waiver-claim swap, so
// a hold advertising one would be a lie. That difference used to live only
// in a comment; this pins it, so routing this path through the shared helper
// fails here rather than passing silently.

test('processWaivers: the claim drop records no undo, unlike the two undoable drops', async (t) => {
  const league = {
    id: 1, waiver_type: 'priority', roster_limit: 16, ir_slots: 2,
    current_season: 2026, current_week: 6, waiver_period_hours: 24,
  };
  let holdParams;
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [league] })],
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
  // undoDrop's `dropped_by_team_id` check finds nothing to undo.
  assert.deepEqual(
    holdParams,
    [1, 77, 24, null, null, false],
    'claim drop must write a bare hold: no dropper, no interrupted slot, not attested'
  );
  // And it never even asks what the row held - that read only exists to feed
  // a record this path does not write.
  assert.deepEqual(entryReads, []);
  fake.assertClean();
});
