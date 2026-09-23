// Claim order: one global sort, the reorder endpoint's service, and the insert
// position (#1578, ADR 0048). Pure: a fake pool, no database, no clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
registerRecordingBroadcast();
const { orderClaims, processWaivers, submitClaim, reorderClaims } = require('../services/waiver.service');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');
const lineupService = require('../services/lineup.service');

const claim = (id, teamId, bid = 0, createdAt = '2026-07-11T00:00:00Z') => ({
  id,
  team_id: teamId,
  bid,
  created_at: createdAt,
});

test('orderClaims: claim_order breaks a Waiver priority tie within one team, before created_at', () => {
  const priorities = new Map([[10, 1]]);
  const ordered = orderClaims(
    [
      { ...claim(1, 10, 0, '2026-07-11T00:00:00Z'), claim_order: 2 },
      { ...claim(2, 10, 0, '2026-07-11T01:00:00Z'), claim_order: 1 },
    ],
    priorities,
    'priority'
  );
  assert.deepEqual(ordered.map((c) => c.id), [2, 1]);
});

test('orderClaims: a bid outranks claim_order in a FAAB league', () => {
  const priorities = new Map([[10, 1]]);
  const ordered = orderClaims(
    [{ ...claim(1, 10, 5), claim_order: 1 }, { ...claim(2, 10, 20), claim_order: 2 }],
    priorities,
    'faab'
  );
  assert.deepEqual(ordered.map((c) => c.id), [2, 1]);
});

test('orderClaims: Waiver priority outranks claim_order across teams', () => {
  const priorities = new Map([[10, 2], [20, 1]]);
  const ordered = orderClaims(
    [{ ...claim(1, 10), claim_order: 1 }, { ...claim(2, 20), claim_order: 9 }],
    priorities,
    'priority'
  );
  assert.deepEqual(ordered.map((c) => c.team_id), [20, 10]);
});

// A small stateful world: rosters, budgets and claim outcomes move as the
// processor writes, so a later claim sees what an earlier one did.
function processWorld(t, { league, teams, rosters, claims, pending = claims, names = {} }) {
  const state = {
    rosters: new Map(Object.entries(rosters).map(([id, ids]) => [Number(id), new Set(ids)])),
    faab: new Map(teams.map((tm) => [tm.id, tm.faab_remaining])),
    outcomes: new Map(),
  };
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [league] })],
    [update('leagues'), () => ({ rows: [], rowCount: 0 })],
    // The league's pending claims, due or not (ranks in notes); the due read has a LEFT JOIN.
    [/^SELECT "waiver_claims".* FROM "waiver_claims" WHERE/, () => ({ rows: pending })],
    [select('waiver_claims'), () => ({ rows: claims })],
    [/^SELECT "faab_remaining" FROM "teams"/, (text, [id]) => ({ rows: [{ faab_remaining: state.faab.get(id) }] })],
    [select('teams'), () => ({ rows: teams })],
    [/^SELECT "name" FROM "players"/, (text, [id]) => ({ rows: [{ name: names[id] || `Player ${id}` }] })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, (text, [, pid]) => ({
      rows: [...state.rosters.values()].some((s) => s.has(pid)) ? [{ 1: 1 }] : [],
    })],
    [/^SELECT 1 FROM "team_players" WHERE "team_id"/, (text, [tid, pid]) => ({
      rows: state.rosters.get(tid).has(pid) ? [{ 1: 1 }] : [],
    })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, (text, [tid]) => ({ rows: [{ n: state.rosters.get(tid).size }] })],
    [select('lineup_entries'), () => ({ rows: [{ n: 0 }] })],
    [remove('team_players'), (text, [tid, pid]) => { state.rosters.get(tid).delete(pid); return { rows: [], rowCount: 1 }; }],
    [insert('team_players'), (text, [, tid, pid]) => { state.rosters.get(tid).add(pid); return { rows: [], rowCount: 1 }; }],
    [insert('waiver_players'), () => ({ rows: [] })],
    [/^UPDATE "teams" SET "faab_remaining"/, (text, [bid, tid]) => {
      state.faab.set(tid, state.faab.get(tid) - bid);
      return { rows: [], rowCount: 1 };
    }],
    [update('teams'), () => ({ rows: [], rowCount: 1 })],
    [update('waiver_claims'), (text, [status, note, id]) => {
      state.outcomes.set(id, { status, note });
      return { rows: [], rowCount: 1 };
    }],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
    [remove('waiver_players'), () => ({ rows: [] })],
  ]).install(t);
  t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});
  t.mock.method(lineupService, 'removeLineupEntries', async () => ({ removed: 0 }));
  return { fake, state };
}

const worldLeague = (waiverType) => ({
  id: 1, transactions_locked: false, waiver_type: waiverType, roster_limit: 16, ir_slots: 2,
  current_season: 2026, current_week: 6, waiver_period_hours: 24,
});
// Capacity is 14 (roster_limit 16 less 2 IR slots): 13 fillers plus the drop player is full.
const fullRoster = (extra) => [...Array.from({ length: 13 }, (_, i) => 1000 + i), ...extra];
const dueClaim = (id, teamId, playerId, extra = {}) => ({
  id, league_id: 1, team_id: teamId, player_id: playerId, drop_player_id: null, bid: 0,
  status: 'pending', created_at: `2026-07-11T00:00:0${id}Z`, claim_order: id, ...extra,
});

test('processWaivers: one team, two claims dropping the same player: rank 1 wins, rank 2 is invalid with the sibling note', async (t) => {
  const { fake, state } = processWorld(t, {
    league: worldLeague('priority'),
    teams: [{ id: 31, owner_id: 8, user_id: 8, waiver_priority: 1, faab_remaining: 0 }],
    rosters: { 31: fullRoster([77]) },
    claims: [dueClaim(1, 31, 500, { drop_player_id: 77 }), dueClaim(2, 31, 501, { drop_player_id: 77 })],
    names: { 77: 'Dropped Guy' },
  });
  const result = await processWaivers({ leagueId: 1 });

  assert.equal(state.outcomes.get(1).status, 'won');
  assert.equal(state.outcomes.get(2).status, 'invalid');
  assert.match(state.outcomes.get(2).note, /your #1 claim already dropped Dropped Guy/);
  assert.deepEqual(result.results.map((r) => [r.claimId, r.status]), [[1, 'won'], [2, 'invalid']]);
  fake.assertClean();
});

test('processWaivers: swapping the ranks makes the other claim win', async (t) => {
  const { fake, state } = processWorld(t, {
    league: worldLeague('priority'),
    teams: [{ id: 31, owner_id: 8, user_id: 8, waiver_priority: 1, faab_remaining: 0 }],
    rosters: { 31: fullRoster([77]) },
    claims: [
      dueClaim(1, 31, 500, { drop_player_id: 77, claim_order: 2 }),
      dueClaim(2, 31, 501, { drop_player_id: 77, claim_order: 1 }),
    ],
  });
  await processWaivers({ leagueId: 1 });

  assert.equal(state.outcomes.get(2).status, 'won');
  assert.equal(state.outcomes.get(1).status, 'invalid');
  assert.match(state.outcomes.get(1).note, /your #1 claim already dropped/);
  fake.assertClean();
});

test('processWaivers: FAAB, the higher bid on the lower rank wins and the higher rank is invalid (ADR 0048 trade-off)', async (t) => {
  const { fake, state } = processWorld(t, {
    league: worldLeague('faab'),
    teams: [{ id: 31, owner_id: 8, user_id: 8, waiver_priority: 1, faab_remaining: 100 }],
    rosters: { 31: fullRoster([77]) },
    claims: [
      dueClaim(1, 31, 500, { drop_player_id: 77, bid: 5, claim_order: 1 }),
      dueClaim(2, 31, 501, { drop_player_id: 77, bid: 20, claim_order: 2 }),
    ],
  });
  await processWaivers({ leagueId: 1 });

  assert.equal(state.outcomes.get(2).status, 'won');
  assert.equal(state.outcomes.get(1).status, 'invalid');
  assert.match(state.outcomes.get(1).note, /your #2 claim already dropped/);
  fake.assertClean();
});

test('processWaivers: a better Waiver priority on the same player beats a lower rank', async (t) => {
  const { fake, state } = processWorld(t, {
    league: worldLeague('priority'),
    teams: [
      { id: 31, owner_id: 8, user_id: 8, waiver_priority: 2, faab_remaining: 0 },
      { id: 32, owner_id: 9, user_id: 9, waiver_priority: 1, faab_remaining: 0 },
    ],
    rosters: { 31: [1, 2], 32: [3, 4] },
    claims: [dueClaim(1, 31, 500, { claim_order: 1 }), dueClaim(2, 32, 500, { claim_order: 5 })],
  });
  await processWaivers({ leagueId: 1 });

  assert.equal(state.outcomes.get(2).status, 'won');
  assert.deepEqual(state.outcomes.get(1), { status: 'lost', note: 'a higher claim won this player' });
  fake.assertClean();
});

test('processWaivers: roster full after an earlier claim of the same team names that claim', async (t) => {
  const { fake, state } = processWorld(t, {
    league: worldLeague('priority'),
    teams: [{ id: 31, owner_id: 8, user_id: 8, waiver_priority: 1, faab_remaining: 0 }],
    rosters: { 31: Array.from({ length: 13 }, (_, i) => 1000 + i) },
    claims: [dueClaim(1, 31, 500), dueClaim(2, 31, 501)],
  });
  await processWaivers({ leagueId: 1 });

  assert.equal(state.outcomes.get(1).status, 'won');
  assert.equal(state.outcomes.get(2).status, 'invalid');
  assert.match(state.outcomes.get(2).note, /roster full after your #1 claim/);
  fake.assertClean();
});

test('processWaivers: budget spent by an earlier claim of the same team names that claim', async (t) => {
  const { fake, state } = processWorld(t, {
    league: worldLeague('faab'),
    teams: [{ id: 31, owner_id: 8, user_id: 8, waiver_priority: 1, faab_remaining: 10 }],
    rosters: { 31: [1, 2] },
    claims: [dueClaim(1, 31, 500, { bid: 8 }), dueClaim(2, 31, 501, { bid: 5 })],
  });
  await processWaivers({ leagueId: 1 });

  assert.equal(state.outcomes.get(1).status, 'won');
  assert.equal(state.outcomes.get(2).status, 'invalid');
  assert.match(state.outcomes.get(2).note, /budget spent by your #1 claim/);
  fake.assertClean();
});

function reorderWorld(t, { pending, teamId = 31 }) {
  const written = [];
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [{ id: 1, pickem_only: false }] })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: teamId, league_id: 1, owner_id: 8 }] })],
    [/^SELECT "id" FROM "waiver_claims"/, () => ({ rows: pending.map((id) => ({ id })) })],
    [update('waiver_claims'), (text, params) => { written.push(params); return { rows: [], rowCount: 1 }; }],
  ]).install(t);
  return { fake, written };
}

test('reorderClaims refuses a list missing a pending claim id, with a coded refusal', async (t) => {
  const { fake, written } = reorderWorld(t, { pending: [1, 2, 3] });
  await assert.rejects(
    () => reorderClaims({ leagueId: 1, userId: 8, claimIds: [1, 2] }),
    { statusCode: 409, code: 'CLAIM_ORDER_MISMATCH' }
  );
  assert.equal(written.length, 0);
  fake.assertClean();
});

test('reorderClaims refuses another team claim id', async (t) => {
  const { fake, written } = reorderWorld(t, { pending: [1, 2] });
  await assert.rejects(
    () => reorderClaims({ leagueId: 1, userId: 8, claimIds: [1, 99] }),
    { statusCode: 409, code: 'CLAIM_ORDER_MISMATCH' }
  );
  assert.equal(written.length, 0);
  fake.assertClean();
});

test('reorderClaims refuses a duplicated id', async (t) => {
  const { fake, written } = reorderWorld(t, { pending: [1, 2] });
  await assert.rejects(
    () => reorderClaims({ leagueId: 1, userId: 8, claimIds: [1, 1] }),
    { code: 'CLAIM_ORDER_MISMATCH' }
  );
  assert.equal(written.length, 0);
  fake.assertClean();
});

test('reorderClaims accepts a permutation and writes 1..N in the given sequence', async (t) => {
  const { fake, written } = reorderWorld(t, { pending: [1, 2, 3] });
  const result = await reorderClaims({ leagueId: 1, userId: 8, claimIds: [3, 1, 2] });
  assert.deepEqual(written, [[[3, 1, 2], [1, 2, 3]]]);
  assert.deepEqual(result, { claimIds: [3, 1, 2] });
  fake.assertClean();
});

test('submitClaim locks the league row and takes max(claim_order)+1 for the team', async (t) => {
  let insertParams;
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({
      rows: [{ id: 1, pickem_only: false, waiver_type: 'priority', transactions_locked: false, waivers_clear_at: null, roster_limit: 16, ir_slots: 2 }],
    })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 31, league_id: 1, owner_id: 8, locked: false }] })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })],
    [select('waiver_players'), () => ({ rows: [{ 1: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 5 }] })],
    [select('lineup_entries'), () => ({ rows: [{ n: 0 }] })],
    [/^SELECT 1 FROM "waiver_claims"/, () => ({ rows: [] })],
    [/MAX\("claim_order"\)/, () => ({ rows: [{ next: 4 }] })],
    [insert('waiver_claims'), (text, params) => { insertParams = params; return { rows: [{ id: 5 }] }; }],
  ]).install(t);
  await submitClaim({ leagueId: 1, userId: 8, playerId: 500, dropPlayerId: null, bid: 0 });
  assert.equal(insertParams[insertParams.length - 1], 4);
  fake.assertClean();
});

test('processWaivers: a winner goes to the back of the priority order for the rest of the run', async (t) => {
  const { fake, state } = processWorld(t, {
    league: worldLeague('priority'),
    teams: [
      { id: 31, owner_id: 8, user_id: 8, waiver_priority: 1, faab_remaining: 0 },
      { id: 32, owner_id: 9, user_id: 9, waiver_priority: 2, faab_remaining: 0 },
    ],
    rosters: { 31: [1, 2], 32: [3, 4] },
    claims: [
      dueClaim(1, 31, 500, { claim_order: 1 }),
      dueClaim(2, 31, 501, { claim_order: 2 }),
      dueClaim(3, 32, 501, { claim_order: 1 }),
    ],
  });
  await processWaivers({ leagueId: 1 });

  assert.equal(state.outcomes.get(1).status, 'won');
  assert.equal(state.outcomes.get(3).status, 'won');
  assert.deepEqual(state.outcomes.get(2), { status: 'lost', note: 'a higher claim won this player' });
  fake.assertClean();
});

test('processWaivers: a sibling note names the claim by position, not by a stored claim_order with gaps', async (t) => {
  const { fake, state } = processWorld(t, {
    league: worldLeague('priority'),
    teams: [{ id: 31, owner_id: 8, user_id: 8, waiver_priority: 1, faab_remaining: 0 }],
    rosters: { 31: fullRoster([77]) },
    claims: [
      dueClaim(2, 31, 500, { drop_player_id: 77, claim_order: 2 }),
      dueClaim(3, 31, 501, { drop_player_id: 77, claim_order: 3 }),
    ],
  });
  await processWaivers({ leagueId: 1 });

  assert.match(state.outcomes.get(3).note, /your #1 claim already dropped/);
  fake.assertClean();
});

test('processWaivers: a sibling note ranks over all of the team pending claims, due or not', async (t) => {
  const notDue = dueClaim(1, 31, 900, { claim_order: 1 });
  const { fake, state } = processWorld(t, {
    league: worldLeague('priority'),
    teams: [{ id: 31, owner_id: 8, user_id: 8, waiver_priority: 1, faab_remaining: 0 }],
    rosters: { 31: fullRoster([77]) },
    claims: [
      dueClaim(2, 31, 500, { drop_player_id: 77, claim_order: 2 }),
      dueClaim(3, 31, 501, { drop_player_id: 77, claim_order: 3 }),
    ],
    pending: [notDue, dueClaim(2, 31, 500, { drop_player_id: 77, claim_order: 2 }), dueClaim(3, 31, 501, { drop_player_id: 77, claim_order: 3 })],
  });
  await processWaivers({ leagueId: 1 });

  assert.match(state.outcomes.get(3).note, /your #2 claim already dropped/);
  fake.assertClean();
});

test('processWaivers: a swap on an already-full roster keeps the plain capacity reason', async (t) => {
  const { fake, state } = processWorld(t, {
    league: worldLeague('priority'),
    teams: [{ id: 31, owner_id: 8, user_id: 8, waiver_priority: 1, faab_remaining: 0 }],
    rosters: { 31: fullRoster([77]) },
    claims: [
      dueClaim(1, 31, 500, { drop_player_id: 77 }),
      dueClaim(2, 31, 501),
    ],
  });
  await processWaivers({ leagueId: 1 });

  assert.equal(state.outcomes.get(1).status, 'won');
  assert.equal(state.outcomes.get(2).status, 'invalid');
  assert.equal(state.outcomes.get(2).note, 'roster capacity of 14 reached');
  fake.assertClean();
});
