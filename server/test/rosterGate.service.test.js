const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertRosterWriteAllowed,
  ROSTER_GATE,
  COMMISSIONER_OVERRIDE,
} = require('../services/rosterGate.service');
const { createFakePool } = require('./helpers/fakePool');

/**
 * The relocated acquire gate, grown (#944) into one write-time assertion that
 * takes the League id, the Team id, a direction (acquire | release) and an
 * exact-set bypass list. The two rules that are the whole design:
 *
 *  1. The gate reads the freeze off the League row IT takes FOR UPDATE. It
 *     never trusts a caller-supplied league object, so a caller cannot starve
 *     it of the fact it exists to check (#940 stories 15-16).
 *  2. The gate fails closed on a gate-input column the row cannot answer. The
 *     fake pool's matcher is blind to select lists, so an existing handler can
 *     answer the gate's new query with a row that lacks the column; undefined
 *     is falsy and would pass the freeze silently. The two-part red-tell below
 *     is the crux: (a) freeze column present and true refuses; (b) delete the
 *     column and the gate STILL refuses, with a DISTINCT fail-closed error.
 *
 * Direction is the axis the gate set varies over: the freeze and the Team lock
 * apply to BOTH directions; capacity, the position cap and the waiver hold are
 * acquire-only.
 */

// A league that passes every gate: not frozen, complete draft, capacity 5
// (roster_limit 5, ir_slots 0 short-circuits rosterCapacity to the draft
// roster size with no stash read), no position caps, no waiver window.
const clearLeague = () => ({
  id: 1,
  transactions_locked: false,
  draft_status: 'complete',
  roster_limit: 5,
  ir_slots: 0,
  position_caps: {},
  waivers_clear_at: null,
  current_season: 2026,
  current_week: 4,
});
const clearTeam = () => ({ id: 11, locked: false });

/**
 * A gate world. Overrides merge onto a league/team that pass everything, and
 * the acquire-bundle reads (roster count, position-cap count, on-waivers, the
 * player's own NFL team, and which teams have kicked off) are stubbed to
 * "not full / not capped / not on waivers / no team / nobody kicked off yet"
 * unless overridden.
 */
function gateWorld({
  league = {},
  team = {},
  rosterCount = 0,
  positionCount = 0,
  onWaivers = false,
  playerTeam = null,
  kickedOffTeams = [],
} = {}) {
  const leagueRow = { ...clearLeague(), ...league };
  const teamRow = { ...clearTeam(), ...team };
  return createFakePool([
    [/^SELECT .* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: leagueRow ? [leagueRow] : [] })],
    [/^SELECT .* FROM "teams" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: teamRow ? [teamRow] : [] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players" WHERE "team_id"/, () => ({ rows: [{ n: rosterCount }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players" JOIN "players"/, () => ({ rows: [{ n: positionCount }] })],
    [/^SELECT 1 FROM "waiver_players"/, () => ({ rows: onWaivers ? [{ 1: 1 }] : [] })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "players" WHERE "id" = \$1/, () => ({ rows: [{ nfl_team: playerTeam }] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: kickedOffTeams.map((nflTeam) => ({ nfl_team: nflTeam })) })],
  ]);
}

const ACQUIRE = { leagueId: 1, teamId: 11, direction: 'acquire', playerId: 500, position: 'RB' };
const RELEASE = { leagueId: 1, teamId: 11, direction: 'release', playerId: 500, position: 'RB' };

// --- the gate passes when nothing stops it ----------------------------------

test('acquire passes a clear league and team', async () => {
  const client = await gateWorld().connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE }));
});

test('release passes a clear league and team', async () => {
  const client = await gateWorld().connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...RELEASE }));
});

// --- freeze and team lock apply to BOTH directions --------------------------

for (const { name, args } of [{ name: 'acquire', args: ACQUIRE }, { name: 'release', args: RELEASE }]) {
  test(`${name}: a frozen league is refused (409 TRANSACTIONS_LOCKED)`, async () => {
    const client = await gateWorld({ league: { transactions_locked: true } }).connect();
    await assert.rejects(
      assertRosterWriteAllowed(client, { ...args }),
      { statusCode: 409, code: 'TRANSACTIONS_LOCKED', message: 'transactions are locked by the commissioner' }
    );
  });

  test(`${name}: a locked team is refused (409 TEAM_LOCKED)`, async () => {
    const client = await gateWorld({ team: { locked: true } }).connect();
    await assert.rejects(
      assertRosterWriteAllowed(client, { ...args }),
      { statusCode: 409, code: 'TEAM_LOCKED', message: 'your team is locked by the commissioner' }
    );
  });
}

// --- capacity, position cap and waiver hold are acquire-only ----------------

test('acquire: a full roster is refused; release ignores capacity', async () => {
  await assert.rejects(
    assertRosterWriteAllowed(await gateWorld({ rosterCount: 5 }).connect(), { ...ACQUIRE }),
    { statusCode: 409, message: 'roster capacity of 5 reached' }
  );
  await assert.doesNotReject(
    assertRosterWriteAllowed(await gateWorld({ rosterCount: 5 }).connect(), { ...RELEASE })
  );
});

test('acquire: a met position cap is refused; release ignores it', async () => {
  const capped = { league: { position_caps: { RB: 1 } }, positionCount: 1 };
  await assert.rejects(
    assertRosterWriteAllowed(await gateWorld(capped).connect(), { ...ACQUIRE }),
    { statusCode: 409, message: 'position cap reached: max 1 RB' }
  );
  await assert.doesNotReject(
    assertRosterWriteAllowed(await gateWorld(capped).connect(), { ...RELEASE })
  );
});

test('acquire: a player on waivers is refused; release ignores the hold', async () => {
  await assert.rejects(
    assertRosterWriteAllowed(await gateWorld({ onWaivers: true }).connect(), { ...ACQUIRE }),
    { statusCode: 409, message: 'player is on waivers; submit a waiver claim instead' }
  );
  await assert.doesNotReject(
    assertRosterWriteAllowed(await gateWorld({ onWaivers: true }).connect(), { ...RELEASE })
  );
});

// --- the kicked-off hold (#1376, ADR 0043) ----------------------------------
// Kickoff puts an unrostered player on waivers the same way a drop does, so
// the acquire bundle refuses him even before the scheduler tick has written
// the waiver_players row. The gate reads the player's OWN team from the
// `players` table, never from the call arguments.

test('acquire: a player whose team has kicked off is refused, with no waiver hold row', async () => {
  const client = await gateWorld({ playerTeam: 'KC', kickedOffTeams: ['KC'] }).connect();
  await assert.rejects(
    assertRosterWriteAllowed(client, { ...ACQUIRE }),
    { statusCode: 409, message: 'player is on waivers; submit a waiver claim instead' }
  );
});

test('release passes for the same kicked-off player', async () => {
  const client = await gateWorld({ playerTeam: 'KC', kickedOffTeams: ['KC'] }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...RELEASE }));
});

test('acquire: a player whose team has not kicked off passes', async () => {
  const client = await gateWorld({ playerTeam: 'KC', kickedOffTeams: ['SF'] }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE }));
});

test('acquire: a player on a bye team passes (no game of his to kick off)', async () => {
  const client = await gateWorld({ playerTeam: 'MIA', kickedOffTeams: ['KC', 'SF'] }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE }));
});

test('acquire: a player with no NFL team passes', async () => {
  const client = await gateWorld({ playerTeam: null, kickedOffTeams: ['KC'] }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE }));
});

test('acquire: a league whose draft is not complete passes a kicked-off player (the draft-status gate applies)', async () => {
  const client = await gateWorld({
    league: { draft_status: 'active' },
    playerTeam: 'KC',
    kickedOffTeams: ['KC'],
  }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE }));
});

test('acquire: the gate decides by the row, not by a team the caller hands it', async () => {
  // The row says KC (kicked off); a bogus caller-supplied team is ignored.
  const refused = await gateWorld({ playerTeam: 'KC', kickedOffTeams: ['KC'] }).connect();
  await assert.rejects(
    assertRosterWriteAllowed(refused, { ...ACQUIRE, nflTeam: 'SF' }),
    { statusCode: 409, message: 'player is on waivers; submit a waiver claim instead' }
  );
  // The inverse: claiming the kicked-off team via the call arguments cannot
  // manufacture a refusal when the row itself says a different, clear team.
  const passed = await gateWorld({ playerTeam: 'SF', kickedOffTeams: ['KC'] }).connect();
  await assert.doesNotReject(
    assertRosterWriteAllowed(passed, { ...ACQUIRE, nflTeam: 'KC' })
  );
});

// KICKOFF_HOLD is its own token, distinct from WAIVER_HOLD (lead ruling on
// issue #1376): a trade moves an already-rostered player, never a Free
// agent, so trade.service.js bypasses KICKOFF_HOLD alone and must keep the
// existing waiver-row check. The kickoff check itself runs only when NEITHER
// token is bypassed.

test('the KICKOFF_HOLD token disables the kicked-off check, with no waiver row', async () => {
  const client = await gateWorld({ playerTeam: 'KC', kickedOffTeams: ['KC'] }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: [ROSTER_GATE.KICKOFF_HOLD] }));
});

test('the KICKOFF_HOLD token does not skip the existing waiver-row check', async () => {
  // A real waiver_players row still refuses, even with KICKOFF_HOLD bypassed:
  // the new bypass exempts the schedule question alone, not the on-waivers one.
  const client = await gateWorld({ onWaivers: true, playerTeam: 'KC', kickedOffTeams: ['KC'] }).connect();
  await assert.rejects(
    assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: [ROSTER_GATE.KICKOFF_HOLD] }),
    { statusCode: 409, message: 'player is on waivers; submit a waiver claim instead' }
  );
});

test('the WAIVER_HOLD token alone also disables the kicked-off check (claim-award and force paths, unchanged)', async () => {
  const client = await gateWorld({ playerTeam: 'KC', kickedOffTeams: ['KC'] }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: [ROSTER_GATE.WAIVER_HOLD] }));
});

test('override bypasses the kicked-off check', async () => {
  const client = await gateWorld({ playerTeam: 'KC', kickedOffTeams: ['KC'] }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: COMMISSIONER_OVERRIDE }));
});

// --- the two-part red-tell (the crux) ---------------------------------------

test('red-tell (a): a frozen league with the freeze column present refuses', async () => {
  const client = await gateWorld({ league: { transactions_locked: true } }).connect();
  await assert.rejects(
    assertRosterWriteAllowed(client, { ...ACQUIRE }),
    { statusCode: 409, code: 'TRANSACTIONS_LOCKED' }
  );
});

test('red-tell (b): with the freeze column deleted the gate fails closed, distinctly', async () => {
  // The League row cannot answer the freeze question. A gate that read the
  // column from a caller-supplied object would see undefined -> falsy -> pass;
  // a gate that reads its own row and checks presence refuses. The error is
  // DISTINCT from the freeze refusal: 500 / ROSTER_GATE_INDETERMINATE, not
  // 409 / TRANSACTIONS_LOCKED.
  const leagueRow = clearLeague();
  delete leagueRow.transactions_locked;
  const fake = createFakePool([
    [/^SELECT .* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [leagueRow] })],
    [/^SELECT .* FROM "teams" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [clearTeam()] })],
  ]);
  await assert.rejects(
    assertRosterWriteAllowed(await fake.connect(), { ...ACQUIRE }),
    (err) => {
      assert.equal(err.statusCode, 500);
      assert.equal(err.code, 'ROSTER_GATE_INDETERMINATE');
      assert.notEqual(err.code, 'TRANSACTIONS_LOCKED', 'must be distinct from the freeze refusal');
      return true;
    }
  );
});

test('fails closed when the team row cannot answer the lock question', async () => {
  const teamRow = clearTeam();
  delete teamRow.locked;
  const fake = createFakePool([
    [/^SELECT .* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [clearLeague()] })],
    [/^SELECT .* FROM "teams" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [teamRow] })],
  ]);
  await assert.rejects(
    assertRosterWriteAllowed(await fake.connect(), { ...ACQUIRE }),
    { statusCode: 500, code: 'ROSTER_GATE_INDETERMINATE' }
  );
});

test('a missing league row is a 404, not a silent pass', async () => {
  const fake = createFakePool([
    [/^SELECT .* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [] })],
  ]);
  await assert.rejects(
    assertRosterWriteAllowed(await fake.connect(), { ...ACQUIRE }),
    { statusCode: 404, message: 'league not found' }
  );
});

// --- the bypass set: exactly today's commissioner override ------------------
// forceTransaction bypasses the freeze, per-team locks and waiver holds, and
// does not enforce the position cap; roster capacity STILL binds. One
// assertion per override entry, plus the proof that capacity is not in the set.

test('COMMISSIONER_OVERRIDE is exactly {freeze, team lock, waiver hold, position cap}', () => {
  assert.deepEqual(
    [...COMMISSIONER_OVERRIDE].sort(),
    [ROSTER_GATE.FREEZE, ROSTER_GATE.POSITION_CAP, ROSTER_GATE.TEAM_LOCK, ROSTER_GATE.WAIVER_HOLD].sort()
  );
  assert.ok(!COMMISSIONER_OVERRIDE.includes(ROSTER_GATE.CAPACITY), 'capacity is never overridden');
});

test('override bypasses the freeze', async () => {
  const client = await gateWorld({ league: { transactions_locked: true } }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: COMMISSIONER_OVERRIDE }));
});

test('override bypasses the team lock', async () => {
  const client = await gateWorld({ team: { locked: true } }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: COMMISSIONER_OVERRIDE }));
});

test('override bypasses the waiver hold', async () => {
  const client = await gateWorld({ onWaivers: true }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: COMMISSIONER_OVERRIDE }));
});

test('override bypasses the position cap', async () => {
  const client = await gateWorld({ league: { position_caps: { RB: 1 } }, positionCount: 1 }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: COMMISSIONER_OVERRIDE }));
});

test('override does NOT bypass roster capacity (it still binds)', async () => {
  const client = await gateWorld({ rosterCount: 5 }).connect();
  await assert.rejects(
    assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: COMMISSIONER_OVERRIDE }),
    { statusCode: 409, message: 'roster capacity of 5 reached' }
  );
});

// --- each bypass token disables exactly its own gate ------------------------

test('the FREEZE token alone disables only the freeze', async () => {
  const client = await gateWorld({ league: { transactions_locked: true } }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: [ROSTER_GATE.FREEZE] }));
});

test('the CAPACITY token disables the capacity check', async () => {
  const client = await gateWorld({ rosterCount: 5 }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: [ROSTER_GATE.CAPACITY] }));
});

test('the WAIVER_HOLD token disables the on-waivers check', async () => {
  const client = await gateWorld({ onWaivers: true }).connect();
  await assert.doesNotReject(assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: [ROSTER_GATE.WAIVER_HOLD] }));
});

test('an unknown direction fails closed', async () => {
  const client = await gateWorld().connect();
  await assert.rejects(
    assertRosterWriteAllowed(client, { ...ACQUIRE, direction: 'sideways' }),
    { statusCode: 500, code: 'ROSTER_GATE_INDETERMINATE' }
  );
});

// --- an unknown bypass name fails closed (#964) ------------------------------

test('an unknown bypass name throws rather than being ignored', async () => {
  // Silently ignoring it would leave a caller believing it had overridden a
  // gate it had not - or, after a token rename, believing it had NOT overridden
  // one it now does. Neither is discoverable at the call site, so the set fails
  // closed on anything it does not recognise.
  const client = await gateWorld().connect();
  await assert.rejects(
    assertRosterWriteAllowed(client, { ...ACQUIRE, bypass: ['freze'] }),
    { statusCode: 500, code: 'ROSTER_GATE_INDETERMINATE', message: 'roster gate: unknown bypass "freze"; refusing' }
  );
});

test('an unknown bypass name throws even alongside valid ones, and before any read', async () => {
  // No handlers at all: if the gate reached its League read this would die with
  // the fake pool's "unexpected query" instead of the refusal below, so this
  // also pins that the validation happens before the gate touches the database.
  const fake = createFakePool([]);
  await assert.rejects(
    assertRosterWriteAllowed(await fake.connect(), {
      ...ACQUIRE,
      bypass: [ROSTER_GATE.FREEZE, 'positionCaps'],
    }),
    { statusCode: 500, code: 'ROSTER_GATE_INDETERMINATE', message: 'roster gate: unknown bypass "positionCaps"; refusing' }
  );
});

test('an empty bypass list and no bypass at all are both accepted', async () => {
  await assert.doesNotReject(assertRosterWriteAllowed(await gateWorld().connect(), { ...ACQUIRE, bypass: [] }));
  await assert.doesNotReject(assertRosterWriteAllowed(await gateWorld().connect(), { ...ACQUIRE, bypass: undefined }));
});
