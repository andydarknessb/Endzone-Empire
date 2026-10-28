const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');
const { TradeError, executeTrade, cancelTrade, proposeTrade, respondToTrade, counterTrade, vetoTrade, commissionerDecide, processDueTrades, readTradeItems } = require('../services/trade.service');
const lineupService = require('../services/lineup.service');
const { setDraftRoomBroadcast, peekDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');

// --- roster capacity at the trade site (#97) --------------------------------
// Thin: proves executeTrade consults the IR policy module's roster capacity
// (with outgoing players excluded from the stash count), not the static
// roster limit. The capacity formula itself is tested at the module seam
// (irPolicy.service.test.js).

const league = { id: 1, draft_status: 'complete', roster_limit: 16, ir_slots: 2, current_season: 2026, current_week: 6 };
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
function tradeWorldHandlers({
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
  waiversClearAt = null,
  // The league-wide "is this player rostered?" read the on-waivers check makes
  // (isOnWaivers): by default always yes, a test overrides it to track deletes.
  rosteredNow = () => true,
}) {
  return [
    [/^SELECT "id", "transactions_locked",.* FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({
      rows: [{
        id: 1,
        transactions_locked: frozen,
        draft_status: 'complete',
        roster_limit: 16,
        ir_slots: 2,
        position_caps: positionCaps,
        waivers_clear_at: waiversClearAt,
      }],
    })],
    [/^SELECT 1 FROM "team_players" WHERE "league_id" = \$1 AND "player_id" = \$2/, (text, params) => ({
      rows: rosteredNow(params[1]) ? [{ 1: 1 }] : [],
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
  ];
}

const tradeWorld = (opts) => createFakePool(tradeWorldHandlers(opts));

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
  // Team 41 sends two WRs to team 42, which holds none. A cap of one WR is
  // refused by the NET position-cap question, up front (#2274), as a
  // TradeError so a due trade is cancelled rather than retried forever.
  const twoIn = [
    { from_team_id: 41, to_team_id: 42, player_id: 21 },
    { from_team_id: 41, to_team_id: 42, player_id: 22 },
  ];
  const rosteredWrs = new Map([[41, 2], [42, 0]]);
  const fake = tradeWorld({
    counts: new Map([[41, 5], [42, 5]]),
    stashes: new Map([[41, 0], [42, 0]]),
    positionCaps: { WR: 1 },
    positionCounts: (teamId) => rosteredWrs.get(teamId),
    players: [
      { id: 21, name: 'First WR', position: 'WR' },
      { id: 22, name: 'Second WR', position: 'WR' },
    ],
  });
  clearBench(t);
  const client = await fake.connect();

  await assert.rejects(
    executeTrade(client, { trade, league: { ...league, position_caps: { WR: 1 } }, items: twoIn, teams }),
    (error) => {
      assert.ok(error instanceof TradeError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, 'position cap reached: max 1 WR');
      return true;
    }
  );
  client.release();

  assert.equal(fake.matching(insert('team_players')).length, 0, 'refused before any write');
  assert.equal(fake.matching(update('trades')).length, 0, 'the trade was not marked executed');
  fake.assertClean();
});

test('executeTrade: a like-for-like swap at the position cap executes in either item order (#2274)', async (t) => {
  // Both teams hold two WRs against a cap of two and trade one WR each. Net
  // change is zero for both, so the swap is legal; a per-item cap check would
  // refuse whichever item's insert runs before the other's delete.
  const forward = [
    { from_team_id: 41, to_team_id: 42, player_id: 21 },
    { from_team_id: 42, to_team_id: 41, player_id: 22 },
  ];
  for (const swap of [forward, [...forward].reverse()]) {
    const fake = tradeWorld({
      counts: new Map([[41, 5], [42, 5]]),
      stashes: new Map([[41, 0], [42, 0]]),
      positionCaps: { WR: 2 },
      positionCounts: () => 2,
      players: [
        { id: 21, name: 'First WR', position: 'WR' },
        { id: 22, name: 'Second WR', position: 'WR' },
      ],
    });
    clearBench(t);
    const client = await fake.connect();

    await executeTrade(client, { trade, league: { ...league, position_caps: { WR: 2 } }, items: swap, teams });
    client.release();

    assert.equal(fake.matching(insert('team_players')).length, 2, 'both players moved');
    assert.equal(fake.matching(update('trades')).length, 1, 'the trade executed');
    fake.assertClean();
  }
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

  // Per item the order is release gate, acquire gate, DELETE, INSERT: the
  // acquire gate runs before the give-side delete (#2274), so a rostered
  // player is never judged as an unrostered one.
  const steps = fake.calls
    .map((c) => (/^SELECT "id", "transactions_locked"/.test(c.text) ? 'gate'
      : /^DELETE FROM "team_players"/.test(c.text) ? 'delete'
        : /^INSERT INTO "team_players"/.test(c.text) ? 'insert' : null))
    .filter(Boolean);
  assert.deepEqual(steps, ['gate', 'gate', 'delete', 'insert', 'gate', 'gate', 'delete', 'insert']);
  fake.assertClean();
});

test('executeTrade: a rostered player trades during the post-draft blanket waiver window (#2274)', async (t) => {
  const rostered = new Set([21]);
  const fake = tradeWorld({
    counts: new Map([[41, 5], [42, 5]]),
    stashes: new Map([[41, 0], [42, 0]]),
    waiversClearAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    rosteredNow: (playerId) => rostered.has(playerId),
    onRosterWrite: (kind, params) => { if (kind === 'remove') rostered.delete(params[1]); },
  });
  clearBench(t);
  const client = await fake.connect();

  await executeTrade(client, { trade, league, items, teams });
  client.release();

  assert.equal(fake.matching(insert('team_players')).length, 1, 'the player moved');
  assert.equal(fake.matching(update('trades')).length, 1, 'the trade executed');
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
function counterWorld({ roster, draftStatus = 'complete' }) {
  return [
    [/FROM "leagues" WHERE "id" = \(SELECT "league_id"/, () => ({ rows: [{ id: 1, league_id: 1 }] })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1$/, () => ({
      rows: [{
        id: 1, draft_status: draftStatus, transactions_locked: false, pickem_only: false,
        trade_deadline_week: null, current_week: 6,
      }],
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

test('counterTrade: a non-participant with an empty playerIds is refused with 400 before any database read (#1091)', async (t) => {
  // User 9 owns neither team 41 nor 42 in counterWorld, so this pins the
  // ORDER, not just the outcome: if validatePlayerIds moved off the top of
  // counterTrade and back into proposeTradeWith (where it lived before
  // #1084), this same call would instead reach loadTrade's ownership check
  // first and answer 403 'only the receiving owner can counter' -- after a
  // SELECT ... FROM "trades" had already run. The response alone cannot see
  // that difference; asserting only the 400 and its message would stay green
  // on both guard positions. The no-read assertions below are what would go
  // red if the guard moved.
  const world = createFakePool(counterWorld({ roster: [] })).install(t);

  await assert.rejects(
    counterTrade({ tradeId: 5, userId: 9, playerIds: [] }),
    { statusCode: 400, message: 'playerIds must be a non-empty array' }
  );

  assert.equal(world.matching(select('trades')).length, 0, 'no trade row was read');
  assert.equal(world.matching(/^BEGIN$/).length, 0, 'no transaction was opened');
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

// Honours the ids it is given, so a lookup with the wrong ids finds no owner.
const ownerLookup = (text, params) => ({
  rows: [{ id: 41, name: 'Sunday Ballers', owner_id: 7 }, { id: 42, name: 'Bob Squad', owner_id: 8 }]
    .filter((team) => params.includes(team.id)),
});

const dueTradeWorldHandlers = () => [
  [/FROM "trades" WHERE "status" = 'accepted'/, () => ({ rows: [{ id: 5 }] })],
  [/FROM "leagues" WHERE "id" = \(SELECT "league_id"/, () => ({ rows: [{ id: 1 }] })],
  // Empty on the first read: the due row is gone by the time loadTrade locks it
  // (the race a dead trade takes), so loadTrade throws TradeError(404, 'trade
  // not found'). The cancel then reloads the trade in its own transaction (#2295),
  // where it is back and still accepted.
  [/^SELECT \* FROM "trades" WHERE "id" = \$1/, (() => {
    let reads = 0;
    return () => ({
      rows: reads++ === 0 ? [] : [{ id: 5, status: 'accepted', proposing_team_id: 41, receiving_team_id: 42, league_id: 1 }],
    });
  })()],
  [select('trade_items'), () => ({ rows: [] })],
  [/FROM "teams" WHERE "id" IN \(\$1, \$2\)/, ownerLookup],
  [update('trades'), () => ({ rows: [], rowCount: 1 })],
  [insert('notifications'), () => ({ rows: [] })],
];

test('processDueTrades: a rejecting ROLLBACK destroys the connection, the original error survives, and the cancel takes a fresh connection (#1072)', async (t) => {
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

  // The cancel is issued on a fresh connection, never the wrapper's destroyed
  // one (#2295 moved it from the pool into its own transaction).
  const cancel = world.calls.find((c) => /^UPDATE "trades" SET "status" = 'cancelled'/.test(c.text));
  assert.ok(cancel, 'the dead trade is cancelled');
  assert.equal(world.releaseArgs().length, 2, 'the cancel took a second connection');
  assert.equal(world.releaseArgs()[1], undefined, 'and returned it healthy');
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
      rows: [{ id: 1, draft_status: 'complete', roster_limit: 16, ir_slots: 0, current_season: 2026, current_week: 6 }],
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
  // Only the two executed notifications (#2295): no cancel notice on this path.
  const notices = world.matching(insert('notifications'));
  assert.deepEqual(notices.map((n) => [n.params[0], n.params[3]]), [
    [7, 'Your trade has been executed'],
    [8, 'Your trade has been executed'],
  ]);
  world.assertClean();
});

// A due trade that really executes one item (team 41 sends player 21 to team
// 42), so executeTrade's per-item gate is what refuses it. The gate handlers
// come from tradeWorld; only the due-trade loading around them is added here.
function dueExecutingTradeWorld(opts, extraHandlers = []) {
  const gateHandlers = tradeWorldHandlers({
    counts: new Map([[41, 5], [42, 5]]),
    stashes: new Map([[41, 0], [42, 0]]),
    ...opts,
  });
  return createFakePool([
    ...extraHandlers,
    [/FROM "trades" WHERE "status" = 'accepted' AND "review_ends_at"/, () => ({ rows: [{ id: 9 }] })],
    [/FROM "leagues" WHERE "id" = \(SELECT "league_id"/, () => ({
      rows: [{
        id: 1, draft_status: opts.draftStatus || 'complete', roster_limit: 16, ir_slots: 2,
        current_season: 2026, current_week: 6, position_caps: opts.positionCaps || {},
      }],
    })],
    [/^SELECT \* FROM "trades" WHERE "id" = \$1/, () => ({
      rows: [{ id: 9, status: 'accepted', proposing_team_id: 41, receiving_team_id: 42, league_id: 1 }],
    })],
    [select('trade_items'), () => ({ rows: [{ trade_id: 9, from_team_id: 41, to_team_id: 42, player_id: 21 }] })],
    [/FROM "teams" WHERE "id" IN \(\$1, \$2\)/, ownerLookup],
    ...gateHandlers,
  ]);
}

test('processDueTrades: an accepted trade that nets the receiving team over the position cap is cancelled (#2274)', async (t) => {
  const world = dueExecutingTradeWorld({
    positionCaps: { RB: 1 },
    positionCounts: () => 1,
  }).install(t);
  t.mock.method(console, 'error', () => {});

  const outcomes = await processDueTrades();

  assert.deepEqual(outcomes, [{ tradeId: 9, status: 'cancelled', reason: 'position cap reached: max 1 RB' }]);
  const cancels = world.matching(/^UPDATE "trades" SET "status" = 'cancelled'/);
  assert.equal(cancels.length, 1);
  // A trade vetoed concurrently (no longer accepted) is not overwritten to cancelled.
  assert.match(cancels[0].text, /AND "status" = 'accepted'$/);
  assert.equal(world.matching(remove('team_players')).length, 0, 'nothing was written');
});

// The cancel UPDATE hands back the trade's teams (RETURNING) so the notification
// writes need no second read of a trade that is no longer accepted.
const cancelHandlers = [
  [/^UPDATE "trades" SET "status" = 'cancelled'/, () => ({
    rows: [{ id: 9, league_id: 1, proposing_team_id: 41, receiving_team_id: 42 }],
    rowCount: 1,
  })],
  [insert('notifications'), () => ({ rows: [] })],
];

test('processDueTrades: a TradeError cancel notifies both owners with the reason in the same transaction (#2295)', async (t) => {
  const world = dueExecutingTradeWorld({
    positionCaps: { RB: 1 },
    positionCounts: () => 1,
  }, cancelHandlers).install(t);
  t.mock.method(console, 'error', () => {});

  await processDueTrades();

  const notices = world.matching(insert('notifications'));
  assert.equal(notices.length, 2, 'one notification per owner');
  assert.deepEqual(notices.map((n) => n.params[0]).sort(), [7, 8]);
  for (const n of notices) {
    assert.equal(n.params[1], 1, 'league id');
    assert.equal(n.params[2], 'trade_result');
    assert.match(n.params[3], /cancelled/);
    assert.match(n.params[3], /position cap reached: max 1 RB/);
    assert.equal(JSON.parse(n.params[4]).tradeId, 9);
    assert.equal(n.via, 'client', 'written on the cancel transaction, not the pool');
  }
  world.assertClean();
});

test('processDueTrades: a trade already settled elsewhere is not cancelled and notifies no one (#2295)', async (t) => {
  const world = dueExecutingTradeWorld({
    positionCaps: { RB: 1 },
    positionCounts: () => 1,
  }, [[/^SELECT \* FROM "trades" WHERE "id" = \$1/, (() => {
    // Accepted for the execute attempt, vetoed by the time the cancel reloads it.
    let reads = 0;
    return () => ({
      rows: [{ id: 9, status: reads++ === 0 ? 'accepted' : 'vetoed', proposing_team_id: 41, receiving_team_id: 42, league_id: 1 }],
    });
  })()]]).install(t);
  t.mock.method(console, 'error', () => {});

  await processDueTrades();

  assert.equal(world.matching(insert('notifications')).length, 0);
  assert.equal(world.matching(/^UPDATE "trades" SET "status" = 'cancelled'/).length, 0);
});

test('processDueTrades: a cancel whose transaction throws is contained and a later due trade still executes (#2295)', async (t) => {
  const world = createFakePool([
    [/FROM "trades" WHERE "status" = 'accepted' AND "review_ends_at"/, () => ({ rows: [{ id: 5 }, { id: 6 }] })],
    [/FROM "leagues" WHERE "id" = \(SELECT "league_id"/, () => ({
      rows: [{ id: 1, draft_status: 'complete', roster_limit: 16, ir_slots: 0, current_season: 2026, current_week: 6 }],
    })],
    // Trade 5 is missing on its execute read (a TradeError) and back for the cancel's reload.
    [/^SELECT \* FROM "trades" WHERE "id" = \$1/, (() => {
      let reads5 = 0;
      return (text, params) => ({
        rows: params[0] === 5 && reads5++ === 0
          ? []
          : [{ id: params[0], status: 'accepted', proposing_team_id: 41, receiving_team_id: 42, league_id: 1 }],
      });
    })()],
    [select('trade_items'), () => ({ rows: [] })],
    [/FROM "teams" WHERE "id" IN \(\$1, \$2\)/, ownerLookup],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players" WHERE "team_id" = \$1/, () => ({ rows: [{ n: 0 }] })],
    [select('players'), () => ({ rows: [] })],
    [update('trades'), () => ({ rows: [], rowCount: 1 })],
    [insert('transactions'), () => ({ rows: [] })],
    [insert('notifications'), (text, params) => {
      if (/cancelled/.test(params[3])) throw new Error('notifications write failed');
      return { rows: [] };
    }],
  ]).install(t);
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args); });
  const prior = peekDraftRoomBroadcast();
  setDraftRoomBroadcast(null);
  t.after(() => setDraftRoomBroadcast(prior));

  const outcomes = await processDueTrades();

  // No cancelled outcome for trade 5 (its cancel rolled back); trade 6 still settled.
  assert.deepEqual(outcomes, [{ tradeId: 6, status: 'executed' }]);
  assert.ok(logged.some((args) => /trade cancel failed for trade %s/.test(args[0]) && args[1] === 5));
  assert.equal(world.matching(/^UPDATE "trades" SET "status" = 'executed'/).length, 1);
  world.assertClean();
});

test('processDueTrades: a freeze refusal stays accepted and keeps waiting (#2274)', async (t) => {
  const world = dueExecutingTradeWorld({ frozen: true }).install(t);
  const logged = [];
  t.mock.method(console, 'error', (...args) => { logged.push(args); });

  const outcomes = await processDueTrades();

  assert.deepEqual(outcomes, []);
  assert.equal(world.matching(/^UPDATE "trades" SET "status" = 'cancelled'/).length, 0);
  assert.equal(logged.length, 1, 'logged and left for the next tick');
  assert.equal(world.matching(insert('notifications')).length, 0, 'a held trade notifies no one (#2295)');
});

// --- the week's NFL opponent on every trade item (#1585) --------------------

test('readTradeItems attaches nfl_opponent to every item: Team code, or present-and-null on a bye', async () => {
  const fake = createFakePool([
    [/FROM "leagues"/, () => ({ rows: [{ id: 1, current_season: 2026, current_week: 6 }] })],
    [/FROM "trade_items"/, () => ({
      rows: [
        { id: 1, trade_id: 9, player_id: 21, name: 'Kicker One', position: 'K', nfl_team: 'KC' },
        { id: 2, trade_id: 9, player_id: 22, name: 'Back Two', position: 'RB', nfl_team: 'MIA' },
      ],
    })],
    [/FROM "nfl_games"/, (text, params) => {
      assert.deepEqual(params, [2026, 6]);
      return { rows: [{ nfl_team: 'KC', opponent: 'BUF' }, { nfl_team: 'BUF', opponent: 'KC' }] };
    }],
  ]);
  const items = await readTradeItems({ leagueId: 1, tradeIds: [9] }, { client: fake });
  const kc = items.find((i) => i.player_id === 21);
  const mia = items.find((i) => i.player_id === 22);
  assert.equal(kc.nfl_opponent, 'BUF');
  assert.ok(Object.hasOwn(mia, 'nfl_opponent'), 'present, never absent (#1132)');
  assert.equal(mia.nfl_opponent, null);
  assert.equal(fake.calls.filter((c) => /FROM "nfl_games"/.test(c.text)).length, 1, 'one schedule read');
});

test('readTradeItems with no current_week gives every item a null nfl_opponent and skips the schedule read', async () => {
  const fake = createFakePool([
    [/FROM "leagues"/, () => ({ rows: [{ id: 1, current_season: 2026, current_week: null }] })],
    [/FROM "trade_items"/, () => ({ rows: [{ id: 1, trade_id: 9, player_id: 21, nfl_team: 'KC' }] })],
  ]);
  const items = await readTradeItems({ leagueId: 1, tradeIds: [9] }, { client: fake });
  assert.ok(Object.hasOwn(items[0], 'nfl_opponent'));
  assert.equal(items[0].nfl_opponent, null);
});

test('readTradeItems with no trades reads nothing', async () => {
  const fake = createFakePool([]);
  assert.deepEqual(await readTradeItems({ leagueId: 1, tradeIds: [] }, { client: fake }), []);
  assert.equal(fake.calls.length, 0);
});

test('proposeTrade: an offer to a CPU-managed team (owner_id NULL) is refused 409 and inserts nothing', async (t) => {
  const roster = [{ player_id: 55, team_id: 42 }, { player_id: 66, team_id: 41 }];
  const world = createFakePool([
    [/FROM "teams" WHERE "id" = \$1 AND "league_id" = \$2/, () => ({
      rows: [{ id: 41, name: 'Sunday Ballers', owner_id: null, locked: false, league_id: 1 }],
    })],
    ...counterWorld({ roster }),
  ]).install(t);

  await assert.rejects(
    proposeTrade({ leagueId: 1, userId: 8, receivingTeamId: 41, playerIds: [55, 66] }),
    { statusCode: 409, message: "that team is managed by the CPU and doesn't trade" }
  );
  assert.equal(world.matching(insert('trades')).length, 0, 'no trade row');
  assert.equal(world.matching(insert('notifications')).length, 0, 'nobody notified');
  world.assertClean();
});

// --- commissionerDecide: a commissioner cannot decide their own trade (wave 3, ruling 6)

const commissionerDecideWorld = () => [
  [/FROM "leagues" WHERE "id" = \(SELECT "league_id"/, () => ({ rows: [{ id: 1 }] })],
  [select('trades'), () => ({ rows: [{ id: 9, league_id: 1, status: 'pending', proposing_team_id: 41, receiving_team_id: 42 }] })],
  [select('trade_items'), () => ({ rows: [] })],
  [select('teams'), () => ({ rows: [{ id: 41, owner_id: 7 }, { id: 42, owner_id: 8 }] })],
  // Whoever asks is the commissioner: the gate under test comes after this one.
  [/^SELECT 1 FROM "leagues" WHERE "id" = \$1 AND/, () => ({ rows: [{ 1: 1 }] })],
  [update('trades'), () => ({ rows: [], rowCount: 1 })],
  [insert('notifications'), () => ({ rows: [] })],
];

for (const [side, userId] of [['proposing', 7], ['receiving', 8]]) {
  for (const approve of [true, false]) {
    test(`commissionerDecide: ${approve ? 'force approve' : 'veto'} by the ${side} team's own commissioner is a 403 and the trade is unchanged`, async (t) => {
      const world = createFakePool(commissionerDecideWorld()).install(t);
      await assert.rejects(
        commissionerDecide({ tradeId: 9, userId, approve }),
        { statusCode: 403, message: "a commissioner can't decide a trade their own team is in" }
      );
      assert.equal(world.matching(update('trades')).length, 0, 'the trade row was not written');
      assert.equal(world.matching(insert('notifications')).length, 0, 'nobody was notified');
      world.assertClean();
    });
  }
}

test('commissionerDecide: a commissioner outside the trade still vetoes it (control)', async (t) => {
  const world = createFakePool(commissionerDecideWorld()).install(t);
  const outcome = await commissionerDecide({ tradeId: 9, userId: 99, approve: false });
  assert.deepEqual(outcome, { tradeId: 9, status: 'vetoed' });
  assert.equal(world.matching(update('trades')).length, 1);
  world.assertClean();
});

// --- vetoTrade: the review window closes even before the trade executes (spec #2540, 4/22)
// A vote is only worth accepting inside the window. Between an accepted
// trade's review_ends_at and the next processDueTrades tick - and for much
// longer while a frozen League keeps the trade waiting - the trade is still
// 'accepted' but its review is over.

/**
 * The veto vote's world: an accepted trade in review whose window ends at
 * `reviewEndsAt`, and a voter holding Team 43, in neither side of the trade.
 * `trade_veto_votes: 2` keeps one vote short of the veto so the control
 * exercises the acceptance path rather than the veto write.
 */
function vetoWorld(reviewEndsAt) {
  return createFakePool([
    [/FROM "leagues" WHERE "id" = \(SELECT "league_id"/, () => ({ rows: [{ id: 1, trade_veto_votes: 2 }] })],
    [select('trades'), () => ({
      rows: [{
        id: 9,
        league_id: 1,
        status: 'accepted',
        proposing_team_id: 41,
        receiving_team_id: 42,
        review_ends_at: reviewEndsAt,
      }],
    })],
    [select('trade_items'), () => ({ rows: [] })],
    // The voter's own Team: 43, in neither side of the trade. Registered before
    // the general teams matcher, which also matches this query's shape.
    [/^SELECT \* FROM "teams" WHERE "league_id" = \$1 AND "owner_id" = \$2/, () => ({
      rows: [{ id: 43, league_id: 1, owner_id: 99 }],
    })],
    [select('teams'), () => ({ rows: [{ id: 41, owner_id: 7 }, { id: 42, owner_id: 8 }] })],
    [insert('trade_votes'), () => ({ rows: [], rowCount: 1 })],
    [select('trade_votes'), () => ({ rows: [{ n: 1 }] })],
  ]);
}

test('vetoTrade: a vote after review_ends_at is refused 409 "the review window has closed" and records no vote', async (t) => {
  const world = vetoWorld(new Date(Date.now() - 60_000)).install(t);

  await assert.rejects(vetoTrade({ tradeId: 9, userId: 99 }), {
    statusCode: 409,
    message: 'the review window has closed',
  });
  assert.equal(world.matching(insert('trade_votes')).length, 0, 'no vote was recorded');
  world.assertClean();
});

test('vetoTrade: a vote before review_ends_at still counts (control)', async (t) => {
  const world = vetoWorld(new Date(Date.now() + 60_000)).install(t);

  const outcome = await vetoTrade({ tradeId: 9, userId: 99 });

  assert.deepEqual(outcome, { tradeId: 9, votes: 1, votesNeeded: 2, status: 'accepted' });
  assert.equal(world.matching(insert('trade_votes')).length, 1, 'the vote was recorded');
  world.assertClean();
});

// --- trades open once the draft is complete (spec #2540, 8/22) ---------------
// A trade before the draft completes fills a roster that is still being
// picked: a 2-for-1 accepted mid-draft leaves every Autopick candidate on the
// team's last pick refused as "roster full" and pauses the draft, and a Keeper
// traded before the draft lands on one roster while the other team's keeper
// pick still owes him. Propose, accept and execute each refuse; the refusal is
// a TradeError, so a due trade found in the window is cancelled, not retried.

const DRAFT_NOT_COMPLETE = 'trades open once the draft is complete';

function acceptWorld({ draftStatus }) {
  return [
    [/FROM "leagues" WHERE "id" = \(SELECT "league_id"/, () => ({
      rows: [{
        id: 1, draft_status: draftStatus, transactions_locked: false, pickem_only: false,
        trade_deadline_week: null, current_week: 6, trade_veto_votes: 0, trade_review_hours: 0,
      }],
    })],
    [select('trades'), () => ({
      rows: [{ id: 5, status: 'pending', proposing_team_id: 41, receiving_team_id: 42, league_id: 1 }],
    })],
    [select('trade_items'), () => ({ rows: [] })],
    [/FROM "teams" WHERE "id" IN \(\$1, \$2\)/, () => ({
      rows: [
        { id: 41, name: 'Sunday Ballers', owner_id: 7 },
        { id: 42, name: 'Bob Squad', owner_id: 8 },
      ],
    })],
    [update('trades'), () => ({ rows: [], rowCount: 1 })],
    [insert('notifications'), () => ({ rows: [] })],
  ];
}

const draftRefusal = (error) => {
  assert.ok(error instanceof TradeError, 'a Trade error, so a due trade is cancelled');
  assert.equal(error.statusCode, 409);
  assert.equal(error.message, DRAFT_NOT_COMPLETE);
  return true;
};

for (const draftStatus of ['pending', 'active']) {
  test(`proposeTrade: a league whose draft is ${draftStatus} refuses the offer 409`, async (t) => {
    const world = createFakePool(counterWorld({ roster: [], draftStatus })).install(t);

    await assert.rejects(
      proposeTrade({ leagueId: 1, userId: 8, receivingTeamId: 41, playerIds: [55, 66] }),
      draftRefusal
    );
    assert.equal(world.matching(insert('trades')).length, 0, 'no trade row');
    assert.equal(world.matching(insert('notifications')).length, 0, 'nobody was notified');
    world.assertClean();
  });

  test(`respondToTrade: accepting while the draft is ${draftStatus} is refused 409`, async (t) => {
    const world = createFakePool(acceptWorld({ draftStatus })).install(t);

    await assert.rejects(
      respondToTrade({ tradeId: 5, userId: 8, action: 'accept' }),
      draftRefusal
    );
    assert.equal(world.matching(update('trades')).length, 0, 'the trade was not accepted');
    assert.equal(world.matching(insert('notifications')).length, 0, 'nobody was notified');
    world.assertClean();
  });

  test(`executeTrade: a league whose draft is ${draftStatus} refuses the swap 409`, async () => {
    const fake = tradeWorld({
      counts: new Map([[41, 5], [42, 5]]),
      stashes: new Map([[41, 0], [42, 0]]),
    });
    const client = await fake.connect();

    await assert.rejects(
      executeTrade(client, { trade, league: { ...league, draft_status: draftStatus }, items, teams }),
      draftRefusal
    );
    client.release();

    assert.equal(fake.matching(remove('team_players')).length, 0, 'no roster row was removed');
    assert.equal(fake.matching(insert('team_players')).length, 0, 'no roster row was written');
    fake.assertClean();
  });
}

test('processDueTrades: a due trade found before the draft completes is cancelled, not retried', async (t) => {
  const world = dueExecutingTradeWorld({ draftStatus: 'active' }).install(t);
  t.mock.method(console, 'error', () => {});

  const outcomes = await processDueTrades();

  assert.deepEqual(outcomes, [{ tradeId: 9, status: 'cancelled', reason: DRAFT_NOT_COMPLETE }]);
  assert.equal(world.matching(/^UPDATE "trades" SET "status" = 'cancelled'/).length, 1);
  assert.equal(world.matching(remove('team_players')).length, 0, 'nothing was written');
});
