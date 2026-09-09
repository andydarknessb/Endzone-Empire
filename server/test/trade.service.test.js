const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');
const { TradeError, executeTrade, cancelTrade, proposeTrade, counterTrade, processDueTrades } = require('../services/trade.service');
const lineupService = require('../services/lineup.service');
const { setDraftRoomBroadcast, peekDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');

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

// --- counterTrade: original 'countered' and the replacement in ONE txn (#1077)
//
// The bug: counterTrade committed the original's 'countered' update in one
// transaction and then proposed the replacement in a SECOND, independent one.
// A replacement refused for any reason (here: a player on neither roster) left
// the original consumed as 'countered' with no replacement and no way back to
// 'pending'. The fix routes both through a single withTransaction, so a refused
// replacement rolls the whole counter back. These tests read the statement log
// (the fakePool's `calls`) to prove the transaction boundary, since the fake
// applies no writes of its own.

// The original trade the counter answers: team 42 (owner 8) counters team 41's
// (owner 7) pending offer. The replacement is proposed BY team 42 TO team 41,
// so receivingTeamId = the original proposing team (41).
const originalTrade = { id: 5, status: 'pending', proposing_team_id: 41, receiving_team_id: 42, league_id: 1 };

/**
 * Handlers for the whole counter path in registration order (tried in order,
 * so the specific WHERE-clause matchers precede any generic verb/table one):
 *   - loadTrade's League read locks the League row via the immutable
 *     league_id subquery; proposeTradeWith re-reads the League unlocked by id.
 *     Both would match a generic `select('leagues')`, so the subquery form is
 *     registered first and the plain `= $1` form second (#1077 trap 3).
 *   - loadTrade's `IN ($1, $2)` team read, requireMember's
 *     `league_id/owner_id` read and the propose's `id = $1 AND league_id = $2`
 *     read each get their own matcher (#1077 trap 2 / #1054): requireMember is
 *     destructured into trade.service, so only a fakePool handler answers it.
 *   - `roster` is what the replacement's `team_players` read returns; [] makes
 *     the countered-in player belong to neither roster and refuse the offer.
 */
function counterWorld({ roster }) {
  return [
    [/FROM "leagues" WHERE "id" = \(SELECT "league_id"/, () => ({ rows: [{ id: 1, league_id: 1 }] })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1$/, () => ({
      rows: [{ id: 1, transactions_locked: false, pickem_only: false, trade_deadline_week: null, current_week: 6 }],
    })],
    [select('trades'), () => ({ rows: [{ ...originalTrade }] })],
    [select('trade_items'), () => ({ rows: [] })],
    [/FROM "teams" WHERE "id" IN \(\$1, \$2\)/, () => ({
      rows: [
        { id: 41, name: 'Sunday Ballers', owner_id: 7, locked: false, league_id: 1 },
        { id: 42, name: 'Bob Squad', owner_id: 8, locked: false, league_id: 1 },
      ],
    })],
    [/FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/, () => ({
      rows: [{ id: 42, name: 'Bob Squad', owner_id: 8, locked: false, league_id: 1 }],
    })],
    [/FROM "teams" WHERE "id" = \$1 AND "league_id" = \$2/, () => ({
      rows: [{ id: 41, name: 'Sunday Ballers', owner_id: 7, locked: false, league_id: 1 }],
    })],
    [update('trades'), () => ({ rows: [], rowCount: 1 })],
    [/^SELECT "player_id", "team_id" FROM "team_players"/, () => ({ rows: roster })],
    [insert('trades'), (text, params) => ({
      rows: [{
        id: 99, league_id: params[0], proposing_team_id: params[1],
        receiving_team_id: params[2], counter_of: params[3], status: 'pending',
      }],
    })],
    [insert('trade_items'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
    // Post-commit push read (usersWanting on the ambient pool); nobody wants it.
    [select('notification_prefs'), () => ({ rows: [] })],
  ];
}

const at = (calls, re) => calls.findIndex((c) => re.test(c.text));

test('counterTrade: a refused replacement rolls the whole counter back in one transaction (#1077)', async (t) => {
  // The replacement names a player who is on neither roster (team_players
  // answers with no rows), so the propose throws its 400 roster TradeError.
  const world = createFakePool(counterWorld({ roster: [] })).install(t);

  await assert.rejects(
    counterTrade({ tradeId: 5, userId: 8, playerIds: [55, 66] }),
    { statusCode: 400, message: "player 55 is not on either team's roster" }
  );

  // Red-tell: on integration today the counter runs in TWO transactions -
  // BEGIN, the countered UPDATE, COMMIT, then a second BEGIN, the propose reads,
  // INSERT, ROLLBACK - so the log holds a COMMIT (and two BEGINs). This
  // assertion reddens there. The fix collapses it to one BEGIN and one ROLLBACK
  // with no COMMIT, because the whole counter is one transaction that rolls back.
  assert.equal(world.matching(/^COMMIT$/).length, 0, 'no COMMIT: the refused counter committed nothing');
  assert.equal(world.matching(/^BEGIN$/).length, 1, 'exactly one BEGIN: one transaction for the whole counter');
  assert.equal(world.matching(/^ROLLBACK$/).length, 1, 'exactly one ROLLBACK');

  // The original was marked 'countered' before the rollback, and nothing ever
  // wrote it back to 'pending' (a compensating write was rejected in triage):
  // the rollback is what restores it.
  const counteredAt = at(world.calls, /^UPDATE "trades" SET "status" = 'countered'/);
  const rollbackAt = at(world.calls, /^ROLLBACK$/);
  assert.ok(counteredAt >= 0, 'the original was marked countered');
  assert.ok(counteredAt < rollbackAt, 'the countered UPDATE precedes the ROLLBACK');
  assert.equal(world.matching(/^UPDATE "trades" SET "status" = 'pending'/).length, 0, 'no compensating pending write');

  world.assertClean();
});

test('counterTrade: an accepted replacement commits the countered update and the new offer together (control)', async (t) => {
  // Player 55 is on the counterer's team (42), player 66 on the other (41), so
  // the replacement moves one each way and the propose inserts a trades row.
  const roster = [{ player_id: 55, team_id: 42 }, { player_id: 66, team_id: 41 }];
  const world = createFakePool(counterWorld({ roster })).install(t);

  const result = await counterTrade({ tradeId: 5, userId: 8, playerIds: [55, 66] });

  // One transaction, committed: no rollback anywhere on the happy path.
  assert.equal(world.matching(/^BEGIN$/).length, 1, 'exactly one BEGIN');
  assert.equal(world.matching(/^COMMIT$/).length, 1, 'exactly one COMMIT');
  assert.equal(world.matching(/^ROLLBACK$/).length, 0, 'no ROLLBACK');

  // Both the countered UPDATE and the new INSERT land between BEGIN and COMMIT.
  const beginAt = at(world.calls, /^BEGIN$/);
  const commitAt = at(world.calls, /^COMMIT$/);
  const counteredAt = at(world.calls, /^UPDATE "trades" SET "status" = 'countered'/);
  const insertAt = at(world.calls, /^INSERT INTO "trades"/);
  assert.ok(beginAt < counteredAt && counteredAt < commitAt, 'the countered UPDATE is inside the transaction');
  assert.ok(beginAt < insertAt && insertAt < commitAt, 'the new offer INSERT is inside the transaction');

  // The new offer records its origin and is returned as proposeTrade returns it.
  const insertCall = world.calls.find((c) => /^INSERT INTO "trades"/.test(c.text));
  assert.equal(insertCall.params[3], 5, 'counter_of is the original trade id');
  assert.equal(result.id, 99, 'the inserted new trade row is returned');
  assert.equal(result.counter_of, 5, 'the returned row carries counter_of');

  world.assertClean();
});

// --- proposeTrade: the thin wrapper still refuses and still commits ----------
// The refactor moved the propose body into a client-taking inner function;
// these prove the public wrapper's behaviour, message and status are unchanged.

test('proposeTrade: duplicate player ids are still refused with 400 (unchanged behaviour)', async (t) => {
  createFakePool(counterWorld({ roster: [] })).install(t);
  await assert.rejects(
    proposeTrade({ leagueId: 1, userId: 8, receivingTeamId: 41, playerIds: [55, 55] }),
    { statusCode: 400, message: 'duplicate players in trade' }
  );
});

test('proposeTrade: a valid offer still commits through the wrapper and returns the row (control)', async (t) => {
  // The proposer is team 42 (owner 8) sending to team 41; 55 is his, 66 is
  // theirs, so the offer moves one each way.
  const roster = [{ player_id: 55, team_id: 42 }, { player_id: 66, team_id: 41 }];
  const world = createFakePool(counterWorld({ roster })).install(t);

  const result = await proposeTrade({ leagueId: 1, userId: 8, receivingTeamId: 41, playerIds: [55, 66] });

  assert.equal(world.matching(/^BEGIN$/).length, 1, 'one BEGIN');
  assert.equal(world.matching(/^COMMIT$/).length, 1, 'the wrapper still commits');
  assert.equal(world.matching(/^ROLLBACK$/).length, 0, 'no ROLLBACK on the happy path');
  assert.equal(result.id, 99, 'the inserted trade row is returned');
  world.assertClean();
});

// --- processDueTrades: swallow-at-the-call-site through withTransaction (#1072)
// The representative pair for this child (Ruling 4). Both cases send one due
// trade through the loop and make loadTrade's `SELECT * FROM "trades"` come back
// empty, so `work` throws the SAME early 404 TradeError after two reads and zero
// writes; the only difference between them is whether the ROLLBACK that follows
// rejects. processDueTrades swallows the throw (it returns outcomes, never
// rethrows), so the pair also proves the two behaviours unique to this site: the
// original error survives the wrapper (the outcome reason is the 404 message,
// not the rollback failure) and the cancel runs on the POOL, never on the
// wrapper's client (which is already gone by the time the catch runs).

const dueTradeWorldHandlers = () => [
  [/FROM "trades" WHERE "status" = 'accepted'/, () => ({ rows: [{ id: 5 }] })],
  [/FROM "leagues" WHERE "id" = \(SELECT "league_id"/, () => ({ rows: [{ id: 1 }] })],
  // Empty: the due row is gone by the time loadTrade locks it (the race a dead
  // trade takes), so loadTrade throws TradeError(404, 'trade not found').
  [/^SELECT \* FROM "trades" WHERE "id" = \$1/, () => ({ rows: [] })],
  [update('trades'), () => ({ rows: [], rowCount: 0 })],
];

test('processDueTrades: a rejecting ROLLBACK destroys the connection, the original error survives, and the cancel runs on the pool (#1072)', async (t) => {
  const world = createFakePool([
    ...dueTradeWorldHandlers(),
    [/^ROLLBACK$/, () => { throw new Error('rollback rejected'); }, 'client'],
  ]).install(t);

  // Red-tell: forcing withTransaction's finally to release bare (never destroy)
  // leaves this rejected transaction open on the released client, so
  // assertClean() throws 'transaction left open' and releaseArgs()[0] is no
  // longer an Error. Reverting the site to its own unguarded `client.query(
  // 'ROLLBACK')` + bare release instead makes the whole call reject with
  // 'rollback rejected' rather than resolving to a swallowed outcome.
  const outcomes = await processDueTrades();

  // Swallowed at the call site: the run resolves, and the original 404 message
  // (not 'rollback rejected') is what the outcome carries.
  assert.deepEqual(outcomes, [{ tradeId: 5, status: 'cancelled', reason: 'trade not found' }]);

  // The rejecting ROLLBACK left the transaction open on the socket, so the
  // wrapper released the client WITH an Error (destroy) and nothing was left open.
  assert.ok(world.releaseArgs()[0] instanceof Error, 'a rejecting ROLLBACK destroys the connection');
  world.assertClean();

  // The cancel is issued on the pool, never on the wrapper's client: by the time
  // the catch runs the connection has already been destroyed.
  const cancel = world.calls.find((c) => /^UPDATE "trades" SET "status" = 'cancelled'/.test(c.text));
  assert.ok(cancel, 'the dead trade is cancelled');
  assert.equal(cancel.via, 'pool', 'the cancel runs on the pool, not the client');
});

test('processDueTrades: a clean ROLLBACK returns the healthy connection to the pool (control)', async (t) => {
  const world = createFakePool(dueTradeWorldHandlers()).install(t);

  // Same early 404, but the ROLLBACK succeeds cleanly (fakePool's default
  // auto-answer), so the connection is healthy and must be returned bare, not
  // destroyed. Red-tell: making the wrapper's release unconditional (always
  // release with an Error) reddens the releaseArgs assertion below.
  const outcomes = await processDueTrades();

  assert.deepEqual(outcomes, [{ tradeId: 5, status: 'cancelled', reason: 'trade not found' }]);
  assert.equal(world.releaseArgs()[0], undefined, 'a clean ROLLBACK keeps the healthy connection');
  world.assertClean();
});

test('processDueTrades: a throwing rosterChanged broadcast is contained, the trade still settles, and the sweep resolves (#1072)', async (t) => {
  // A due trade that EXECUTES (empty items + ir_slots 0 keeps executeTrade
  // trivial: no roster writes and no rosterCapacity read). This is the branch
  // the ROLLBACK pair never reaches, and the only one that calls the broadcast.
  const world = createFakePool([
    [/FROM "trades" WHERE "status" = 'accepted' AND "review_ends_at"/, () => ({ rows: [{ id: 9 }] })],
    [/FROM "leagues" WHERE "id" = \(SELECT "league_id"/, () => ({
      rows: [{ id: 1, roster_limit: 16, ir_slots: 0, current_season: 2026, current_week: 6 }],
    })],
    [/^SELECT \* FROM "trades" WHERE "id" = \$1/, () => ({
      rows: [{ id: 9, status: 'accepted', proposing_team_id: 41, receiving_team_id: 42, league_id: 1 }],
    })],
    [select('trade_items'), () => ({ rows: [] })],
    [/FROM "teams" WHERE "id" IN \(\$1, \$2\)/, () => ({
      rows: [{ id: 41, name: 'Sunday Ballers', owner_id: 7 }, { id: 42, name: 'Bob Squad', owner_id: 8 }],
    })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players" WHERE "team_id" = \$1/, () => ({ rows: [{ n: 0 }] })],
    [select('players'), () => ({ rows: [] })],
    [update('trades'), () => ({ rows: [], rowCount: 1 })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), () => ({ rows: [] })],
  ]).install(t);

  // Leave NO broadcast registered so getDraftRoomBroadcast() throws its
  // deliberate "not initialised for this process" error (#745) - the persistent
  // process-config condition, not a transient transport failure. Restore
  // whatever was registered so the module's process-global state does not leak.
  const prior = peekDraftRoomBroadcast();
  setDraftRoomBroadcast(null);
  t.after(() => setDraftRoomBroadcast(prior));

  // Red-tell: without the try/catch around the broadcast, getDraftRoomBroadcast()
  // throws out of processDueTrades (scheduler.js calls it bare), so this line
  // rejects instead of resolving and the settled trade is never reported.
  const outcomes = await processDueTrades();

  // The broadcast threw, but the trade committed and its outcome is recorded
  // (strictly better than base, which dropped the outcome when the broadcast
  // threw), and the sweep resolved so the rest of the scheduler tick still runs.
  assert.deepEqual(outcomes, [{ tradeId: 9, status: 'executed' }]);
  assert.ok(world.matching(/^UPDATE "trades" SET "status" = 'executed'/).length === 1,
    'the trade was executed inside the committed transaction');
  world.assertClean();
});
