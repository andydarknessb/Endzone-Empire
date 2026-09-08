const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');
const { TradeError, executeTrade, cancelTrade } = require('../services/trade.service');
const lineupService = require('../services/lineup.service');

// --- roster capacity at the trade site (#97) --------------------------------
// Thin: proves executeTrade consults the IR policy module's roster capacity
// (with outgoing players excluded from the stash count), not the static
// roster limit. The capacity formula itself is tested at the module seam
// (irPolicy.service.test.js).

const league = { id: 1, roster_limit: 16, ir_slots: 2, current_season: 2026, current_week: 6 };
const trade = { id: 9, proposing_team_id: 41, receiving_team_id: 42 };
const teams = new Map([
  [41, { id: 41, name: 'Sunday Ballers', owner_id: 7 }],
  [42, { id: 42, name: 'Bob Squad', owner_id: 8 }],
]);
// A 1-for-0 trade: team 41 sends player 21 to team 42.
const items = [{ from_team_id: 41, to_team_id: 42, player_id: 21 }];

/**
 * `counts` and `stashes` feed the NET capacity question; `frozen`,
 * `lockedTeams`, `positionCaps` and `positionCounts` feed the per-item write
 * gate (#963).
 *
 * The gate's own League and Team reads get their own handlers, registered
 * FIRST because handlers are tried in order. They are not folded into the
 * reads below on purpose: the gate reads its League row with an explicit
 * column list, and a matcher blind to that select list would hand it a row
 * that cannot answer the freeze, which the gate refuses (500) rather than
 * reading as "not frozen".
 *
 * `positionCounts` is a function, not a map, so a test can make the count grow
 * as inserts land. That is what makes "two incoming players at the same
 * position against a cap of one" a real per-item question: the second call
 * sees the first player's row.
 */
function tradeWorld({
  counts,
  stashes,
  stashQueries,
  frozen = false,
  lockedTeams = [],
  positionCaps = {},
  positionCounts = () => 0,
  players = [{ id: 21, name: 'Test Runner', position: 'RB' }],
  // The fake pool applies no writes, so a test that needs a later read to see
  // an earlier write advances its own state here.
  onRosterWrite = () => {},
}) {
  return createFakePool([
    [/^SELECT "id", "transactions_locked",.* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({
      rows: [{
        id: 1,
        transactions_locked: frozen,
        draft_status: 'complete',
        roster_limit: 16,
        ir_slots: 2,
        position_caps: positionCaps,
        waivers_clear_at: null,
      }],
    })],
    [/^SELECT "id", "locked" FROM "teams" WHERE "id" = \$1 FOR UPDATE/, (text, params) => ({
      rows: [{ id: params[0], locked: lockedTeams.includes(params[0]) }],
    })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players" JOIN "players"/, (text, params) => ({
      rows: [{ n: positionCounts(params[0], params[1]) }],
    })],
    [/^SELECT 1 FROM "waiver_players"/, () => ({ rows: [] })],
    [/^SELECT 1 FROM "team_players"/, () => ({ rows: [{ 1: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, (text, params) => (
      { rows: [{ n: counts.get(params[0]) }] }
    )],
    [select('lineup_entries'), (text, params) => {
      if (stashQueries) stashQueries.push(params);
      return { rows: [{ n: stashes.get(params[0]) }] };
    }],
    // Delete-and-insert, not UPDATE ... SET team_id (#197): the giving
    // team's row is replaced rather than moved, so created_at means "when
    // this team acquired him" on every path.
    [remove('team_players'), (text, params) => {
      onRosterWrite('remove', params);
      return { rows: [], rowCount: 1 };
    }],
    [insert('team_players'), (text, params) => {
      onRosterWrite('insert', params);
      return { rows: [], rowCount: 1 };
    }],
    // The giving side's lineup follows its roster out.
    [/^SELECT 1 FROM "matchups"/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "players"/, () => ({ rows: [{ nfl_team: 'MIN' }] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
    [remove('lineup_entries'), () => ({ rows: [], rowCount: 1 })],
    [update('trades'), () => ({ rows: [], rowCount: 1 })],
    [select('players'), () => ({ rows: players })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
  ]);
}

test('executeTrade: a full receiving team with no stash rejects at the draft roster size', async () => {
  const stashQueries = [];
  const fake = tradeWorld({
    counts: new Map([[41, 14], [42, 14]]),
    stashes: new Map([[41, 0], [42, 0]]),
    stashQueries,
  });
  const client = await fake.connect();

  await assert.rejects(
    executeTrade(client, { trade, league, items, teams }),
    (error) => {
      assert.ok(error instanceof TradeError);
      assert.equal(error.message, 'trade would put Bob Squad over its roster capacity of 14');
      return true;
    }
  );
  client.release();

  // The sending team's capacity was computed with its outgoing player
  // excluded: trading away a stashed player takes his granted spot with him.
  assert.deepEqual(stashQueries[0][0], 41);
  assert.deepEqual(stashQueries[0][2], [21]);
  // The receiving team gets no restored credit for the incoming player: he
  // lands on the bench, so nothing about his history on this team grants
  // anything toward the trade. No restored ids means no fourth parameter.
  assert.deepEqual(stashQueries[1][0], 42);
  assert.equal(stashQueries[1].length, 3);
  fake.assertClean();
});

test('executeTrade: an eligible IR stash on the receiving team grants the extra spot', async (t) => {
  const fake = tradeWorld({
    counts: new Map([[41, 14], [42, 14]]),
    stashes: new Map([[41, 0], [42, 1]]),
  });
  const benched = [];
  t.mock.method(lineupService, 'benchAcquiredPlayer', async (client, args) => {
    benched.push({ ...args, afterRosterWrite: fake.matching(/^INSERT INTO "team_players"/).length > 0 });
  });
  const client = await fake.connect();

  await executeTrade(client, { trade, league, items, teams });
  client.release();

  // The writer count for one traded player, pinned (#197): exactly one
  // delete of the giving team's row and one insert of the receiving team's,
  // and NO update of team_players anywhere in the path. This is the
  // assertion that guards the shape - a reader that dates an acquisition
  // from created_at is only correct while the row is replaced rather than
  // moved, and updated_at is no longer written here at all.
  assert.equal(fake.matching(/^UPDATE "team_players"/).length, 0);
  assert.equal(fake.matching(/^DELETE FROM "team_players"/).length, 1);
  assert.equal(fake.matching(/^INSERT INTO "team_players"/).length, 1);
  assert.equal(fake.matching(/^UPDATE "trades" SET "status" = 'executed'/).length, 1);
  // The acquired player lands on the receiving team's bench (user story 13),
  // never in a stash his old lineup rows there might still describe.
  assert.deepEqual(benched, [{ league, teamId: 42, playerId: 21, afterRosterWrite: true }]);
  fake.assertClean();
});

// --- the #963 write gate: freeze, Team lock and the per-position cap ---------
//
// The gate runs once per player, immediately before that player's own write.
// The proof that it is per item rather than up front is the two-incoming-WRs
// test below: gating once before the loop lets both pass a cap of one, because
// neither row has landed when a single up-front check runs.

const clearBench = (t) => t.mock.method(lineupService, 'benchAcquiredPlayer', async () => {});

test('executeTrade: a frozen league refuses the trade, and not as a TradeError', async () => {
  const fake = tradeWorld({
    counts: new Map([[41, 5], [42, 5]]),
    stashes: new Map([[41, 0], [42, 0]]),
    frozen: true,
  });
  const client = await fake.connect();

  await assert.rejects(
    executeTrade(client, { trade, league, items, teams }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'TRANSACTIONS_LOCKED');
      // Load-bearing: processDueTrades permanently CANCELS a trade when it
      // catches a TradeError. A freeze refusal must fall to the log-and-retry
      // branch instead, so an accepted trade whose review window ends during a
      // freeze survives the freeze.
      assert.ok(!(error instanceof TradeError), 'the gate refusal must not be a TradeError');
      return true;
    }
  );
  client.release();

  assert.equal(fake.matching(remove('team_players')).length, 0, 'no roster row was removed');
  assert.equal(fake.matching(insert('team_players')).length, 0, 'no roster row was written');
  assert.equal(fake.matching(update('trades')).length, 0, 'the trade was not marked executed');
  fake.assertClean();
});

test('executeTrade: a locked receiving team refuses the trade, which is new', async () => {
  const fake = tradeWorld({
    counts: new Map([[41, 5], [42, 5]]),
    stashes: new Map([[41, 0], [42, 0]]),
    lockedTeams: [42],
  });
  const client = await fake.connect();

  await assert.rejects(
    executeTrade(client, { trade, league, items, teams }),
    { statusCode: 409, code: 'TEAM_LOCKED', message: 'your team is locked by the commissioner' }
  );
  client.release();

  assert.equal(fake.matching(insert('team_players')).length, 0, 'no roster row was written');
  fake.assertClean();
});

test('executeTrade: a locked GIVING team refuses the trade too, at the release gate', async () => {
  const fake = tradeWorld({
    counts: new Map([[41, 5], [42, 5]]),
    stashes: new Map([[41, 0], [42, 0]]),
    lockedTeams: [41],
  });
  const client = await fake.connect();

  await assert.rejects(
    executeTrade(client, { trade, league, items, teams }),
    { statusCode: 409, code: 'TEAM_LOCKED' }
  );
  client.release();

  assert.equal(fake.matching(remove('team_players')).length, 0, 'the giving row survived');
  fake.assertClean();
});

test('executeTrade: two incoming players at the same position are refused against a cap of one', async (t) => {
  // Team 41 sends two WRs to team 42, which holds none. A cap of one WR must
  // let the first land and refuse the second. Gating ONCE before the loop
  // instead of per item turns this from red to green: both items would be
  // checked against the same count of zero.
  const twoIn = [
    { from_team_id: 41, to_team_id: 42, player_id: 21 },
    { from_team_id: 41, to_team_id: 42, player_id: 22 },
  ];
  const rosteredWrs = new Map([[41, 2], [42, 0]]);
  const fake = tradeWorld({
    counts: new Map([[41, 5], [42, 5]]),
    stashes: new Map([[41, 0], [42, 0]]),
    positionCaps: { WR: 1 },
    // The count grows as inserts land, the way a real roster does.
    positionCounts: (teamId) => rosteredWrs.get(teamId),
    players: [
      { id: 21, name: 'First WR', position: 'WR' },
      { id: 22, name: 'Second WR', position: 'WR' },
    ],
    // The fake pool never applies a write, so the roster the position-cap
    // count reads is advanced here instead: each landed insert is one more WR
    // on the receiving team and one fewer on the giving team.
    onRosterWrite: (verb, params) => {
      if (verb !== 'insert') return;
      rosteredWrs.set(params[1], rosteredWrs.get(params[1]) + 1);
      rosteredWrs.set(41, rosteredWrs.get(41) - 1);
    },
  });
  clearBench(t);
  const client = await fake.connect();

  await assert.rejects(
    executeTrade(client, { trade, league, items: twoIn, teams }),
    { statusCode: 409, message: 'position cap reached: max 1 WR' }
  );
  client.release();

  // The first player landed before the second was refused: that is the shape
  // only a per-item gate produces. The whole transaction rolls back at the
  // caller, so nothing half-applies in production.
  assert.equal(fake.matching(insert('team_players')).length, 1, 'exactly one insert landed before the refusal');
  assert.equal(fake.matching(update('trades')).length, 0, 'the trade was not marked executed');
  fake.assertClean();
});

test('executeTrade: the net capacity question still governs a swap that transiently exceeds', async (t) => {
  // Team 42 is exactly AT capacity (14) and swaps one for one. A per-player
  // capacity question would refuse its incoming insert, because at the moment
  // that insert runs the count is still 14. The NET question is the one that
  // governs, and it says the swap is legal - which is why CAPACITY is bypassed
  // on the per-item gate rather than the net check being folded into it.
  const swap = [
    { from_team_id: 41, to_team_id: 42, player_id: 21 },
    { from_team_id: 42, to_team_id: 41, player_id: 22 },
  ];
  const fake = tradeWorld({
    counts: new Map([[41, 14], [42, 14]]),
    stashes: new Map([[41, 0], [42, 0]]),
    players: [
      { id: 21, name: 'Out One', position: 'RB' },
      { id: 22, name: 'Out Two', position: 'TE' },
    ],
  });
  clearBench(t);
  const client = await fake.connect();

  await executeTrade(client, { trade, league, items: swap, teams });
  client.release();

  assert.equal(fake.matching(insert('team_players')).length, 2, 'both players moved');
  assert.equal(fake.matching(update('trades')).length, 1, 'the trade executed');
  fake.assertClean();
});

test('executeTrade: the gate runs per item, immediately around each write', async (t) => {
  const swap = [
    { from_team_id: 41, to_team_id: 42, player_id: 21 },
    { from_team_id: 42, to_team_id: 41, player_id: 22 },
  ];
  const fake = tradeWorld({
    counts: new Map([[41, 5], [42, 5]]),
    stashes: new Map([[41, 0], [42, 0]]),
    players: [
      { id: 21, name: 'Out One', position: 'RB' },
      { id: 22, name: 'Out Two', position: 'TE' },
    ],
  });
  clearBench(t);
  const client = await fake.connect();
  await executeTrade(client, { trade, league, items: swap, teams });
  client.release();

  // Two items, each gated twice (release before its delete, acquire before its
  // insert): four gate League reads, not one. A hoisted batch-level call would
  // read the League once.
  const gateReads = fake.calls.filter((c) => /^SELECT "id", "transactions_locked".*FOR UPDATE/.test(c.text));
  assert.equal(gateReads.length, 4, 'four gate calls: one per direction per item');

  // Each gate League read is immediately followed by its Team lock, League then
  // Team, so this path introduces no lock-order inversion.
  for (const read of gateReads) {
    const at = fake.calls.indexOf(read);
    assert.match(fake.calls[at + 1].text, /^SELECT "id", "locked" FROM "teams"/);
  }
  fake.assertClean();
});

// --- withTransaction routing (ADR 0033, #1064 Ruling 5) ---------------------
// The representative pair for this child: cancelTrade is the thinnest of the
// six sites now routed through withTransaction, so it is the one that proves
// the routing itself rather than any of its own business logic. Both cases
// hit the SAME early throw (trade.status !== 'pending', 409) after loadTrade's
// four reads and zero writes, so the only thing that differs between them is
// whether the ROLLBACK that follows succeeds.

const cancelTradeWorldHandlers = () => [
  [/FROM "leagues" WHERE "id" = \(SELECT "league_id"/, () => ({ rows: [{ id: 1 }] })],
  [select('trades'), () => ({ rows: [{ id: 5, status: 'executed', proposing_team_id: 41, league_id: 1 }] })],
  [select('trade_items'), () => ({ rows: [] })],
  [select('teams'), () => ({ rows: [{ id: 41, owner_id: 99 }] })],
];

test('cancelTrade: a rejecting ROLLBACK destroys the connection and the original error survives (#1064 Ruling 5)', async (t) => {
  const world = createFakePool([
    ...cancelTradeWorldHandlers(),
    [/^ROLLBACK$/, () => { throw new Error('rollback rejected'); }, 'client'],
  ]).install(t);

  // Red-tell: reverting cancelTrade to its own bare `client.release()` (rather
  // than routing through withTransaction) makes this reject with "rollback
  // rejected" instead of the original 409, since the unhandled ROLLBACK
  // rejection would replace the TradeError.
  const promise = cancelTrade({ tradeId: 5, userId: 99 });
  await assert.rejects(promise, { statusCode: 409, message: 'trade is executed, not pending' });
  const error = await promise.catch((e) => e);
  assert.equal(error.rollbackError.message, 'rollback rejected',
    'the rollback failure is attached to the original error, not swallowed silently');

  // A rejecting ROLLBACK leaves the transaction open on the socket, so
  // withTransaction's finally releases the client WITH an Error: pg-pool
  // destroys the connection and Postgres frees the session's locks on
  // disconnect. Red-tell: making the release unconditional (or reverting to
  // a bare client.release()) makes this fail.
  world.assertClean();
  assert.ok(world.releaseArgs()[0] instanceof Error, 'a rejecting ROLLBACK destroys the connection');
});

test('cancelTrade: a clean ROLLBACK returns the healthy connection to the pool (control)', async (t) => {
  const world = createFakePool(cancelTradeWorldHandlers()).install(t);

  await assert.rejects(
    cancelTrade({ tradeId: 5, userId: 99 }),
    { statusCode: 409, message: 'trade is executed, not pending' }
  );

  // Complementary control to the test above: the same early throw, but this
  // time the ROLLBACK succeeds cleanly (fakePool's default auto-answer), so
  // the connection is healthy and must be returned to the pool, not
  // destroyed. Red-tell: destroying on every error path (release with an
  // Error unconditionally) makes this fail.
  assert.equal(world.releaseArgs()[0], undefined, 'a clean ROLLBACK keeps the healthy connection');
  world.assertClean();
});
