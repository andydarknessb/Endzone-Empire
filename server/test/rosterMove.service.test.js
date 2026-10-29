/**
 * The one Roster move module (#2535, spec #2532): `add` and `drop`, the two
 * things every single-player roster write does. A Lineup entry follows the
 * roster by construction because the module is the only place a single-player
 * `team_players` row is written or deleted beside the lineup step, and because
 * it runs the write gate itself.
 *
 * What is asserted here is the module's own contract: the gate runs in both
 * directions, the lineup step follows the delete, and the stash a drop
 * interrupted is read BEFORE the entries go so an undo can replay it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { tenureHandlers } = require('./helpers/tenureFakes');

const CURRENT_SEASON = 2026;
const CURRENT_WEEK = 9;
const KICKED_OFF_AT = new Date(Date.now() - 3 * 60 * 60 * 1000);
const NOT_YET_AT = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
const HELD_SINCE = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

/** The league row every caller of the module holds. */
const league = (overrides = {}) => ({
  id: 5,
  current_season: CURRENT_SEASON,
  current_week: CURRENT_WEEK,
  waiver_period_hours: 24,
  ...overrides,
});

/**
 * A fake world for the module: the gate's own League and Team re-locks, the
 * acquire bundle stubbed to "not full / not capped / not on waivers", and the
 * lineup reads `removeLineupEntries` and `benchAcquiredPlayer` make.
 *
 * `kickedOff` names the NFL teams whose game this week has started; the player
 * is on MIN unless a case says otherwise.
 */
function moveWorld({
  frozen = false,
  teamLocked = false,
  rosterCount = 0,
  nflTeam = 'MIN',
  kickedOff = [],
  currentEntry = null,
  writes = [],
} = {}) {
  const schedule = Object.fromEntries(kickedOff.map((team) => [team, KICKED_OFF_AT]));
  if (!schedule[nflTeam]) schedule[nflTeam] = NOT_YET_AT;
  return createFakePool([
    [/^SELECT "id", "transactions_locked",.* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/,
      () => ({
        rows: [{
          id: 5,
          transactions_locked: frozen,
          draft_status: 'complete',
          roster_limit: 5,
          ir_slots: 0,
          position_caps: {},
          waivers_clear_at: null,
          current_season: CURRENT_SEASON,
          current_week: CURRENT_WEEK,
        }],
      })],
    [/^SELECT "id", "locked" FROM "teams" WHERE "id" = \$1 FOR UPDATE/,
      () => ({ rows: [{ id: 10, locked: teamLocked }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players" WHERE "team_id"/,
      () => ({ rows: [{ n: rosterCount }] })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })],
    [/^SELECT 1 FROM "waiver_players"/, () => ({ rows: [] })],
    [/^SELECT 1 FROM "matchups"/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "players"/, () => ({ rows: [{ nfl_team: nflTeam }] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({
      rows: kickedOff.map((team) => ({ nfl_team: team })),
    })],
    ...tenureHandlers({ schedule, heldSince: HELD_SINCE }),
    [/^SELECT "slot", "ir_attested" FROM "lineup_entries"/, () => ({
      rows: currentEntry ? [currentEntry] : [],
    })],
    [/^DELETE FROM "lineup_entries"/, (text, params) => {
      writes.push({ kind: 'removeLineupEntries', text, params });
      return { rows: [], rowCount: 1 };
    }],
    [/^DELETE FROM "team_players"/, (text, params) => {
      writes.push({ kind: 'deleteRosterRow', text, params });
      return { rows: [{ id: 99 }], rowCount: 1 };
    }],
    [/^INSERT INTO "team_players"/, (text, params) => {
      writes.push({ kind: 'insertRosterRow', text, params });
      return { rows: [] };
    }],
    [/^UPDATE "lineup_entries" SET "slot"/, (text, params) => {
      writes.push({ kind: 'bench', text, params });
      return { rows: [] };
    }],
    [/^INSERT INTO "lineup_entries"/, (text, params) => {
      writes.push({ kind: 'restoreStash', text, params });
      return { rows: [] };
    }],
    // materializeLineup's roster read: an empty roster stops it before any
    // seeding, which is what keeps this suite about the roster move itself.
    [/^SELECT "team_players"."player_id"/, () => ({ rows: [] })],
  ]);
}

// A module that does not exist yet cannot refuse anything: this is the first
// red slice (#2535).
test('add: a frozen roster is refused with the gate error', async () => {
  const { add } = require('../services/rosterMove.service');
  const fake = moveWorld({ frozen: true });
  const client = await fake.connect();
  await assert.rejects(
    add(client, { league: league(), teamId: 10, playerId: 21, position: 'RB' }),
    { statusCode: 409, code: 'TRANSACTIONS_LOCKED' }
  );
  assert.equal(fake.matching(/^INSERT INTO "team_players"/).length, 0);
});

test('drop: a frozen roster is refused with the gate error', async () => {
  const { drop } = require('../services/rosterMove.service');
  const fake = moveWorld({ frozen: true });
  const client = await fake.connect();
  await assert.rejects(
    drop(client, { league: league(), teamId: 10, playerId: 21, undoable: true }),
    { statusCode: 409, code: 'TRANSACTIONS_LOCKED' }
  );
  assert.equal(fake.matching(/^DELETE FROM "team_players"/).length, 0);
});

test('COMMISSIONER_OVERRIDE lets a frozen roster take both directions', async () => {
  const { add, drop } = require('../services/rosterMove.service');
  const { COMMISSIONER_OVERRIDE } = require('../services/rosterGate.service');
  const fake = moveWorld({ frozen: true, teamLocked: true });
  const client = await fake.connect();

  await add(client, {
    league: league(), teamId: 10, playerId: 21, position: 'RB', bypass: COMMISSIONER_OVERRIDE,
  });
  await drop(client, {
    league: league(), teamId: 10, playerId: 22, undoable: false, bypass: COMMISSIONER_OVERRIDE,
  });

  assert.equal(fake.matching(/^INSERT INTO "team_players"/).length, 1);
  assert.equal(fake.matching(/^DELETE FROM "team_players"/).length, 1);
});

test('drop: before kickoff his current-week entry goes with every future week', async () => {
  const { drop } = require('../services/rosterMove.service');
  const writes = [];
  const fake = moveWorld({ kickedOff: ['KC'], writes });
  const client = await fake.connect();

  await drop(client, { league: league(), teamId: 10, playerId: 21, undoable: true });

  const removal = writes.find((w) => w.kind === 'removeLineupEntries');
  assert.ok(removal, 'the lineup follows the roster');
  assert.deepEqual(removal.params, [10, 21, CURRENT_SEASON, CURRENT_WEEK, true]);
  // After the roster row is gone, never before.
  const order = writes.map((w) => w.kind);
  assert.ok(order.indexOf('deleteRosterRow') < order.indexOf('removeLineupEntries'));
});

test('drop: after kickoff his current-week entry stays as the week as played', async () => {
  const { drop } = require('../services/rosterMove.service');
  const writes = [];
  const fake = moveWorld({ kickedOff: ['MIN'], writes });
  const client = await fake.connect();

  await drop(client, { league: league(), teamId: 10, playerId: 21, undoable: true });

  const removal = writes.find((w) => w.kind === 'removeLineupEntries');
  assert.deepEqual(removal.params, [10, 21, CURRENT_SEASON, CURRENT_WEEK, false]);
});

test('drop: undoable returns the stash the drop interrupted, read before the entries go', async () => {
  const { drop } = require('../services/rosterMove.service');
  const fake = moveWorld({ currentEntry: { slot: 'IR', ir_attested: true } });
  const client = await fake.connect();

  const { stash, removed } = await drop(client, {
    league: league(), teamId: 10, playerId: 21, undoable: true,
  });

  assert.deepEqual(stash, { slot: 'IR', irAttested: true });
  assert.equal(removed, 1);
  const readAt = fake.calls.findIndex((c) => /^SELECT "slot", "ir_attested"/.test(c.text));
  const removedAt = fake.calls.findIndex((c) => /^DELETE FROM "lineup_entries"/.test(c.text));
  assert.ok(readAt >= 0 && readAt < removedAt, 'the row cannot be read after it is deleted');
});

test('drop: a non-undoable drop records no stash', async () => {
  const { drop } = require('../services/rosterMove.service');
  const fake = moveWorld({ currentEntry: { slot: 'IR', ir_attested: true } });
  const client = await fake.connect();

  const { stash } = await drop(client, {
    league: league(), teamId: 10, playerId: 21, undoable: false,
  });

  assert.equal(stash, null);
  assert.equal(fake.matching(/^SELECT "slot", "ir_attested"/).length, 0);
});

test('add: a valid stash puts him back in IR', async () => {
  const { add } = require('../services/rosterMove.service');
  const writes = [];
  const fake = moveWorld({ writes });
  const client = await fake.connect();

  await add(client, {
    league: league(), teamId: 10, playerId: 21, position: 'RB',
    stash: { slot: 'IR', irAttested: true },
  });

  const restore = writes.find((w) => w.kind === 'restoreStash');
  assert.ok(restore, 'the undo replays the stash the drop interrupted');
  assert.deepEqual(restore.params, [5, 10, 21, CURRENT_SEASON, CURRENT_WEEK, 'IR', true]);
  assert.equal(writes.filter((w) => w.kind === 'bench').length, 0);
});

test('add: no stash benches him like any other acquisition', async () => {
  const { add } = require('../services/rosterMove.service');
  const writes = [];
  const fake = moveWorld({ writes });
  const client = await fake.connect();

  await add(client, { league: league(), teamId: 10, playerId: 21, position: 'RB' });

  assert.equal(writes.filter((w) => w.kind === 'restoreStash').length, 0);
  const bench = writes.find((w) => w.kind === 'bench');
  assert.ok(bench, 'every acquisition lands on the bench');
  assert.equal(bench.params[4], 'BENCH');
});
