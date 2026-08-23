/**
 * A lineup entry follows the roster (#197), proved at each of the six paths
 * that remove a player from a team.
 *
 * The rule itself - future weeks always, the current week only before his
 * kickoff, past weeks never - is pinned against the real SQL at the module
 * seam in lineup.service.test.js, and against a real Postgres in
 * lineupFollowsRoster.pg.test.js. What this file proves is that every path
 * asks for it, with the right team and player, inside the caller's
 * transaction and after the roster row is gone. That is the part a future
 * removal path gets wrong by omission, so it is asserted path by path rather
 * than centrally.
 *
 * These worlds deliberately do NOT mock the removal operation: the fake pool
 * answers the schedule and finality reads and records the DELETE, so a
 * mutated predicate fails here too rather than passing because a mock
 * accepted any arguments.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');

const CURRENT_SEASON = 2026;
const CURRENT_WEEK = 9;

// The draft-pick undo is a route handler, not a service function, so its
// path is exercised through the router like the other draft route tests.
const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'lineup-follows-roster-test-secret';
test.after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const COMMISSIONER = 7;
const { signToken } = require('../modules/auth');
const authed = () => `Bearer ${signToken({ id: COMMISSIONER, username: 'commish' })}`;

const app = express();
app.use(express.json());
app.use('/api/draft', require('../routes/draft.router'));

/**
 * The reads `removeLineupEntries` makes, as fake-pool handlers. `kickedOff`
 * is the set of NFL teams whose game for the week has started; the departing
 * player is on MIN unless a test says otherwise.
 */
function removalHandlers({ nflTeam = 'MIN', kickedOff = [], removals = [] } = {}) {
  return [
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "players"/, () => ({ rows: [{ nfl_team: nflTeam }] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({
      rows: kickedOff.map((team) => ({ nfl_team: team })),
    })],
    [/^DELETE FROM "lineup_entries"/, (text, params) => {
      removals.push({ text, params });
      return { rows: [], rowCount: 1 };
    }],
  ];
}

/** The one assertion every path shares: this team's rows for this player go. */
function assertRemoval(removal, { teamId, playerId, currentWeekToo, week = CURRENT_WEEK }) {
  assert.deepEqual(
    removal.params,
    [teamId, playerId, CURRENT_SEASON, week, currentWeekToo]
  );
  // Past weeks are out of reach of the statement itself, not merely absent
  // from the fixture: the record of the week as played is never rewritten.
  assert.match(removal.text, /\("week" > \$4 OR \("week" = \$4 AND \$5::boolean\)\)/);
}

// --- 1. the manager drop -----------------------------------------------------

const dropLeague = {
  id: 5,
  waiver_period_hours: 24,
  current_season: CURRENT_SEASON,
  current_week: CURRENT_WEEK,
};

function managerDropWorld({ kickedOff = [], interrupted = null, removals = [], holds = [] } = {}) {
  return createFakePool([
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10, owner_id: 7, locked: false }] })],
    [/^SELECT "id", "waiver_period_hours"/, () => ({ rows: [dropLeague] })],
    [/^DELETE FROM "team_players"/, () => ({ rows: [{ id: 99 }], rowCount: 1 })],
    [/^SELECT "slot", "ir_attested" FROM "lineup_entries"/, () => ({
      rows: interrupted ? [interrupted] : [],
    })],
    ...removalHandlers({ kickedOff, removals }),
    [/^INSERT INTO "waiver_players"/, (text, params) => {
      holds.push({ text, params });
      return { rows: [] };
    }],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
  ]);
}

test('manager drop: a pre-kickoff drop takes the current week and every future week', async (t) => {
  const removals = [];
  const fake = managerDropWorld({ kickedOff: ['KC'], removals }).install(t);
  const { dropPlayer } = require('../services/draft.service');

  const result = await dropPlayer({ leagueId: 5, userId: 7, playerId: 21 });

  assert.equal(result.playerId, 21);
  assert.equal(removals.length, 1);
  assertRemoval(removals[0], { teamId: 10, playerId: 21, currentWeekToo: true });
  // After the roster row is gone, never before: the lineup row is being made
  // to follow the roster, so the roster is what moves first.
  const rosterAt = fake.calls.findIndex((call) => /^DELETE FROM "team_players"/.test(call.text));
  const lineupAt = fake.calls.findIndex((call) => /^DELETE FROM "lineup_entries"/.test(call.text));
  assert.ok(rosterAt >= 0 && lineupAt > rosterAt);
  fake.assertClean();
});

test('manager drop: a starter dropped after his game kicked off keeps his current-week row', async (t) => {
  const removals = [];
  const fake = managerDropWorld({ kickedOff: ['MIN'], removals }).install(t);
  const { dropPlayer } = require('../services/draft.service');

  await dropPlayer({ leagueId: 5, userId: 7, playerId: 21 });

  // His points stay where the live path already counts them; only the weeks
  // he will never play for this team go.
  assertRemoval(removals[0], { teamId: 10, playerId: 21, currentWeekToo: false });
  fake.assertClean();
});

test('manager drop: the waiver hold records the stash the drop interrupted', async (t) => {
  const holds = [];
  const fake = managerDropWorld({
    kickedOff: [],
    interrupted: { slot: 'IR', ir_attested: true },
    holds,
  }).install(t);
  const { dropPlayer } = require('../services/draft.service');

  await dropPlayer({ leagueId: 5, userId: 7, playerId: 21 });

  // The hold already names the dropping team and already gates undo, so it
  // is where what the drop interrupted belongs. Without this the undo would
  // have nothing to replay: the row it used to read has just been deleted.
  assert.equal(holds.length, 1);
  assert.deepEqual(holds[0].params, [5, 21, 24, 10, 'IR', true]);
  fake.assertClean();
});

test('manager drop: nothing is recorded when he held no current-week row', async (t) => {
  const holds = [];
  const fake = managerDropWorld({ kickedOff: [], interrupted: null, holds }).install(t);
  const { dropPlayer } = require('../services/draft.service');

  await dropPlayer({ leagueId: 5, userId: 7, playerId: 21 });

  assert.deepEqual(holds[0].params, [5, 21, 24, 10, null, false]);
  fake.assertClean();
});

test('manager drop: a bench row is a lineup row, best ball included', async (t) => {
  const holds = [];
  const removals = [];
  const fake = managerDropWorld({
    kickedOff: [],
    interrupted: { slot: 'BENCH', ir_attested: false },
    holds,
    removals,
  }).install(t);
  const { dropPlayer } = require('../services/draft.service');

  await dropPlayer({ leagueId: 5, userId: 7, playerId: 21 });

  // Best ball scores the bench, so a stale bench row is exactly as wrong
  // there as a stale starter row is anywhere else. The removal does not ask
  // what slot he was in, and the recorded slot is not an IR stash, so an
  // undo will bench him.
  assertRemoval(removals[0], { teamId: 10, playerId: 21, currentWeekToo: true });
  assert.deepEqual(holds[0].params, [5, 21, 24, 10, 'BENCH', false]);
  fake.assertClean();
});

// --- 2. the waiver-claim drop ------------------------------------------------

const waiverLeague = {
  id: 5,
  roster_limit: 16,
  ir_slots: 1,
  waiver_type: 'priority',
  waiver_period_hours: 24,
  current_season: CURRENT_SEASON,
  current_week: CURRENT_WEEK,
};

function waiverWorld({ kickedOff = [], removals = [] } = {}) {
  return createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [waiverLeague] })],
    [/^SELECT "waiver_claims"\.\*/, () => ({
      rows: [{ id: 71, league_id: 5, team_id: 10, player_id: 30, drop_player_id: 21, bid: 0 }],
    })],
    [/^SELECT "teams"\.\*/, () => ({
      rows: [{ id: 10, league_id: 5, owner_id: 7, user_id: 7, waiver_priority: 1, faab_remaining: 100 }],
    })],
    [/^SELECT 1 FROM "team_players"/, (text, params) => (
      // The claimed player is unrostered; the drop player is on the roster.
      { rows: params[1] === 30 ? [] : [{ 1: 1 }] }
    )],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 10 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [/^DELETE FROM "team_players"/, () => ({ rows: [], rowCount: 1 })],
    ...removalHandlers({ kickedOff, removals }),
    [/^INSERT INTO "waiver_players"/, () => ({ rows: [] })],
    [/^INSERT INTO "team_players"/, () => ({ rows: [], rowCount: 1 })],
    [/^UPDATE "waiver_claims"/, () => ({ rows: [] })],
    [/^UPDATE "teams"/, () => ({ rows: [] })],
    [/^DELETE FROM "waiver_players"/, () => ({ rows: [] })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
    [/^SELECT 1 FROM "matchups"/, () => ({ rows: [] })],
    // The won claim's own benchAcquiredPlayer (#94), unchanged by this work.
    [/^SELECT "team_players"\."player_id"/, () => ({ rows: [] })],
    [/^UPDATE "lineup_entries"/, () => ({ rows: [], rowCount: 0 })],
  ]);
}

test('waiver-claim drop: the dropped player\'s unlocked rows go with his roster row', async (t) => {
  const removals = [];
  const fake = waiverWorld({ kickedOff: ['KC'], removals }).install(t);
  const { processWaivers } = require('../services/waiver.service');

  const outcome = await processWaivers({ leagueId: 5 });

  assert.equal(outcome.results[0].status, 'won');
  assert.equal(removals.length, 1);
  assertRemoval(removals[0], { teamId: 10, playerId: 21, currentWeekToo: true });
  fake.assertClean();
});

test('waiver-claim drop: a dropped player whose game kicked off keeps his current-week row', async (t) => {
  const removals = [];
  const fake = waiverWorld({ kickedOff: ['MIN'], removals }).install(t);
  const { processWaivers } = require('../services/waiver.service');

  await processWaivers({ leagueId: 5 });

  assertRemoval(removals[0], { teamId: 10, playerId: 21, currentWeekToo: false });
  fake.assertClean();
});

// --- 3. the commissioner drop ------------------------------------------------

const commissionerLeague = {
  id: 5,
  is_commissioner: true,
  roster_limit: 16,
  ir_slots: 1,
  waiver_period_hours: 24,
  current_season: CURRENT_SEASON,
  current_week: CURRENT_WEEK,
};

function commissionerDropWorld({ kickedOff = [], interrupted = null, removals = [], holds = [] } = {}) {
  return createFakePool([
    [/^SELECT \*, .* AS "is_commissioner"/, () => ({ rows: [commissionerLeague] })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10, owner_id: 7, league_id: 5 }] })],
    [/^SELECT "id", "name" FROM "players"/, () => ({ rows: [{ id: 21, name: 'Test Runner' }] })],
    [/^DELETE FROM "team_players"/, () => ({ rows: [{ id: 99 }], rowCount: 1 })],
    [/^SELECT "slot", "ir_attested" FROM "lineup_entries"/, () => ({
      rows: interrupted ? [interrupted] : [],
    })],
    ...removalHandlers({ kickedOff, removals }),
    [/^INSERT INTO "waiver_players"/, (text, params) => {
      holds.push({ text, params });
      return { rows: [] };
    }],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
}

test('commissioner drop: takes the unlocked rows and records what it interrupted', async (t) => {
  const removals = [];
  const holds = [];
  const fake = commissionerDropWorld({
    kickedOff: [],
    interrupted: { slot: 'IR', ir_attested: false },
    removals,
    holds,
  }).install(t);
  const { forceTransaction } = require('../services/commissioner.service');

  const result = await forceTransaction({
    leagueId: 5, userId: 7, teamId: 10, action: 'drop', playerId: 21,
  });

  assert.equal(result.action, 'drop');
  assertRemoval(removals[0], { teamId: 10, playerId: 21, currentWeekToo: true });
  // The commissioner drop is undoable on the same waiver hold as a manager
  // drop, so it records the same thing.
  assert.deepEqual(holds[0].params, [5, 21, 24, 10, 'IR', false]);
  fake.assertClean();
});

test('commissioner drop: a post-kickoff drop keeps the current-week row', async (t) => {
  const removals = [];
  const fake = commissionerDropWorld({ kickedOff: ['MIN'], removals }).install(t);
  const { forceTransaction } = require('../services/commissioner.service');

  await forceTransaction({ leagueId: 5, userId: 7, teamId: 10, action: 'drop', playerId: 21 });

  assertRemoval(removals[0], { teamId: 10, playerId: 21, currentWeekToo: false });
  fake.assertClean();
});

// --- 4. the trade, on the giving side ----------------------------------------

const tradeLeague = {
  id: 5,
  roster_limit: 16,
  ir_slots: 1,
  current_season: CURRENT_SEASON,
  current_week: CURRENT_WEEK,
};

function tradeWorld({ kickedOff = [], removals = [] } = {}) {
  return createFakePool([
    [/^SELECT 1 FROM "team_players"/, () => ({ rows: [{ 1: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, () => ({ rows: [{ n: 10 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "lineup_entries"/, () => ({ rows: [{ n: 0 }] })],
    [/^DELETE FROM "team_players"/, () => ({ rows: [], rowCount: 1 })],
    ...removalHandlers({ kickedOff, removals }),
    [/^INSERT INTO "team_players"/, () => ({ rows: [], rowCount: 1 })],
    // benchAcquiredPlayer on the receiving side, unchanged by this work.
    [/^SELECT "team_players"\."player_id"/, () => ({ rows: [] })],
    [/^UPDATE "lineup_entries"/, () => ({ rows: [], rowCount: 0 })],
    [/^UPDATE "trades"/, () => ({ rows: [] })],
    [/^SELECT "id", "name" FROM "players"/, () => ({ rows: [{ id: 21, name: 'Test Runner' }] })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
}

const tradeArgs = {
  trade: { id: 9, proposing_team_id: 41, receiving_team_id: 42 },
  league: tradeLeague,
  items: [{ from_team_id: 41, to_team_id: 42, player_id: 21 }],
  teams: new Map([
    [41, { id: 41, name: 'Sunday Ballers', owner_id: 7 }],
    [42, { id: 42, name: 'Bob Squad', owner_id: 8 }],
  ]),
};

test('trade: the giving team loses the roster row and its unlocked lineup rows', async (t) => {
  const removals = [];
  const fake = tradeWorld({ kickedOff: ['KC'], removals }).install(t);
  const { executeTrade } = require('../services/trade.service');
  const client = await fake.connect();

  await executeTrade(client, tradeArgs);
  client.release();

  // The giving side is the half the trade path never handled: it moved the
  // roster row and benched only the receiver, leaving the giver's lineup
  // row behind untouched.
  assert.equal(removals.length, 1);
  assertRemoval(removals[0], { teamId: 41, playerId: 21, currentWeekToo: true });
  fake.assertClean();
});

test('trade: the roster row is replaced, not moved, so created_at means when THIS team acquired him', async (t) => {
  const fake = tradeWorld({ kickedOff: [] }).install(t);
  const { executeTrade } = require('../services/trade.service');
  const client = await fake.connect();

  await executeTrade(client, tradeArgs);
  client.release();

  // Delete-and-insert rather than UPDATE ... SET team_id. A moved row keeps
  // the giving team's created_at, which is months old and describes an
  // acquisition by a different team; a fresh row dates the acquisition it
  // actually records. Nothing in the trade path updates team_players now.
  assert.equal(fake.matching(/^UPDATE "team_players"/).length, 0);
  const [gone] = fake.matching(/^DELETE FROM "team_players"/);
  const [fresh] = fake.matching(/^INSERT INTO "team_players"/);
  assert.deepEqual(gone.params, [41, 21]);
  assert.deepEqual(fresh.params, [5, 42, 21]);
  assert.ok(
    fake.calls.indexOf(gone) < fake.calls.indexOf(fresh),
    'the giving row goes before the receiving row arrives, so the unique constraint holds'
  );
  fake.assertClean();
});

test('trade: the giving side is settled before the receiving side is benched', async (t) => {
  const fake = tradeWorld({ kickedOff: [] }).install(t);
  const { executeTrade } = require('../services/trade.service');
  const client = await fake.connect();

  await executeTrade(client, tradeArgs);
  client.release();

  // Order matters: benchAcquiredPlayer materializes the receiving team's
  // week, and the giving team's removal must not be racing that.
  const removedAt = fake.calls.findIndex((call) => /^DELETE FROM "lineup_entries"/.test(call.text));
  const benchedAt = fake.calls.findIndex((call) => /^UPDATE "lineup_entries"/.test(call.text));
  assert.ok(removedAt >= 0);
  assert.ok(benchedAt > removedAt);
  fake.assertClean();
});

// --- 5. the undone draft pick ------------------------------------------------

const undoRouteLeague = {
  id: 3,
  draft_status: 'active',
  draft_type: 'online',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  pick_time_seconds: 60,
  autodraft_delay_seconds: 10,
  current_pick: 2,
  current_season: CURRENT_SEASON,
  current_week: CURRENT_WEEK,
};

function undoPickWorld({ kickedOff = [], removals = [] } = {}) {
  return createFakePool([
    [/^SELECT "pickem_only" FROM "leagues"/, () => ({ rows: [{ pickem_only: false }] })],
    [/FROM "leagues" WHERE "id" = \$1 AND .* FOR UPDATE/, () => ({ rows: [undoRouteLeague] })],
    [/^SELECT "pick_number", "team_id", "player_id", "is_keeper" FROM "draft_picks"/, () => ({
      rows: [
        { pick_number: 1, team_id: 10, player_id: 20, is_keeper: false },
        { pick_number: 2, team_id: 11, player_id: 21, is_keeper: false },
      ],
    })],
    [/^DELETE FROM "draft_picks"/, () => ({ rows: [], rowCount: 1 })],
    [/^DELETE FROM "team_players"/, () => ({ rows: [], rowCount: 1 })],
    ...removalHandlers({ kickedOff, removals }),
    [/^SELECT "id", "autodraft" FROM "teams"/, () => ({
      rows: [{ id: 10, autodraft: false }, { id: 11, autodraft: false }],
    })],
    [/^UPDATE "leagues"/, () => ({ rows: [] })],
  ]);
}

test('undone draft pick: the undone player loses the current-week row the pick gave him', async (t) => {
  const removals = [];
  const fake = undoPickWorld({ kickedOff: [], removals }).install(t);

  const response = await request(app)
    .post('/api/draft/league/3/undo')
    .set('Authorization', authed())
    .send({ count: 1 });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.undone, 1);
  // The pick benched him when it was made; undoing it has to take that row
  // back, or the next reader sees a player on a lineup card for a team that
  // never drafted him.
  assert.equal(removals.length, 1);
  assertRemoval(removals[0], { teamId: 11, playerId: 21, currentWeekToo: true });
  fake.assertClean();
});

test('undone draft pick: every undone pick is cleaned up, not just the last', async (t) => {
  const removals = [];
  const fake = undoPickWorld({ kickedOff: [], removals }).install(t);

  const response = await request(app)
    .post('/api/draft/league/3/undo')
    .set('Authorization', authed())
    .send({ count: 2 });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(
    removals.map((removal) => removal.params.slice(0, 2)),
    [[10, 20], [11, 21]]
  );
  fake.assertClean();
});

// --- 6. the keeper-pruning season rollover -----------------------------------

const rolloverLeague = {
  id: 5,
  owner_id: 7,
  is_commissioner: true,
  pickem_only: false,
  season_status: 'complete',
  current_season: CURRENT_SEASON,
  current_week: 18,
  faab_budget: 100,
};

function rolloverWorld({ kickedOff = [], removals = [] } = {}) {
  return createFakePool([
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [rolloverLeague] })],
    [/^SELECT "id", "name", "owner_id" FROM "teams"/, () => ({
      rows: [{ id: 10, name: 'Sunday Ballers', owner_id: 7 }],
    })],
    [/^SELECT \* FROM "matchups"/, () => ({ rows: [] })],
    [/^SELECT "team_players"\."team_id"/, () => ({
      rows: [
        { team_id: 10, player_id: 20, player_name: 'Keeper', position: 'RB', nfl_team: 'KC' },
        { team_id: 10, player_id: 21, player_name: 'Pruned', position: 'WR', nfl_team: 'MIN' },
      ],
    })],
    [/^DELETE FROM "trophies"/, () => ({ rows: [] })],
    [/^INSERT INTO "trophies"/, () => ({ rows: [] })],
    [/^SELECT .* FROM "trophies"/, () => ({ rows: [] })],
    [/^INSERT INTO "league_history"/, () => ({ rows: [] })],
    [/^DELETE FROM "team_players"/, () => ({ rows: [], rowCount: 1 })],
    ...removalHandlers({ kickedOff, removals }),
    [/^DELETE FROM "draft_picks"/, () => ({ rows: [] })],
    [/^DELETE FROM "waiver_players"/, () => ({ rows: [] })],
    [/^UPDATE "waiver_claims"/, () => ({ rows: [] })],
    [/^UPDATE "trades"/, () => ({ rows: [] })],
    [/^UPDATE "teams"/, () => ({ rows: [] })],
    [/^UPDATE "leagues"/, () => ({ rows: [] })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 7 }] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
}

test('keeper-pruning rollover: every pruned player loses his rows, and the keeper keeps his', async (t) => {
  const removals = [];
  const fake = rolloverWorld({ kickedOff: [], removals }).install(t);
  const { rolloverSeason } = require('../services/commissioner.service');

  await rolloverSeason({ leagueId: 5, userId: 7, keepers: [{ teamId: 10, playerIds: [20] }] });

  // This path prunes the roster in ONE bulk statement rather than player by
  // player, so the pairs it removed have to be derived from the roster read
  // taken before it. A future removal path modelled on the other five - one
  // call beside one delete - would miss that.
  assert.equal(removals.length, 1);
  assertRemoval(removals[0], { teamId: 10, playerId: 21, currentWeekToo: true, week: 18 });
  fake.assertClean();
});

test('keeper-pruning rollover: with no keepers the whole roster is cleaned up', async (t) => {
  const removals = [];
  const fake = rolloverWorld({ kickedOff: [], removals }).install(t);
  const { rolloverSeason } = require('../services/commissioner.service');

  await rolloverSeason({ leagueId: 5, userId: 7, keepers: [] });

  assert.deepEqual(removals.map((removal) => removal.params[1]), [20, 21]);
  fake.assertClean();
});

test('keeper-pruning rollover: the archived season is what is cleaned, at its own current week', async (t) => {
  const removals = [];
  const fake = rolloverWorld({ kickedOff: ['MIN'], removals }).install(t);
  const { rolloverSeason } = require('../services/commissioner.service');

  await rolloverSeason({ leagueId: 5, userId: 7, keepers: [] });

  // The rollover advances the season afterwards; the cleanup runs against
  // the season being archived, and its week-18 rows are played rows that a
  // kicked-off game keeps.
  const pruned = removals.find((removal) => removal.params[1] === 21);
  assert.deepEqual(pruned.params, [10, 21, CURRENT_SEASON, 18, false]);
  fake.assertClean();
});

test('trade: a player traded away after his game kicked off keeps his current-week row', async (t) => {
  const removals = [];
  const fake = tradeWorld({ kickedOff: ['MIN'], removals }).install(t);
  const { executeTrade } = require('../services/trade.service');
  const client = await fake.connect();

  await executeTrade(client, tradeArgs);
  client.release();

  assertRemoval(removals[0], { teamId: 41, playerId: 21, currentWeekToo: false });
  fake.assertClean();
});
