const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update } = require('./helpers/fakePool');
const { TradeError, executeTrade } = require('../services/trade.service');

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

function tradeWorld({ counts, stashes, stashQueries }) {
  return createFakePool([
    [/^SELECT 1 FROM "team_players"/, () => ({ rows: [{ 1: 1 }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players"/, (text, params) => (
      { rows: [{ n: counts.get(params[0]) }] }
    )],
    [select('lineup_entries'), (text, params) => {
      if (stashQueries) stashQueries.push(params);
      return { rows: [{ n: stashes.get(params[0]) }] };
    }],
    [update('team_players'), () => ({ rows: [], rowCount: 1 })],
    [insert('lineup_entries'), () => ({ rows: [] })],
    [update('lineup_entries'), () => ({ rows: [], rowCount: 0 })],
    [update('trades'), () => ({ rows: [], rowCount: 1 })],
    [select('players'), () => ({ rows: [{ id: 21, name: 'Test Runner' }] })],
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
  // lands on the bench, so even a stale stash of his on this team grants
  // nothing toward the trade.
  assert.deepEqual(stashQueries[1][0], 42);
  assert.deepEqual(stashQueries[1][3], []);
  fake.assertClean();
});

test('executeTrade: an eligible IR stash on the receiving team grants the extra spot', async () => {
  const fake = tradeWorld({
    counts: new Map([[41, 14], [42, 14]]),
    stashes: new Map([[41, 0], [42, 1]]),
  });
  const client = await fake.connect();

  await executeTrade(client, { trade, league, items, teams });
  client.release();

  assert.equal(fake.matching(/^UPDATE "team_players"/).length, 1);
  assert.equal(fake.matching(/^UPDATE "trades" SET "status" = 'executed'/).length, 1);
  // The acquired player lands on the receiving team's bench (user story 13),
  // never in a stash his old lineup rows there might still describe.
  const benched = fake.matching(/^INSERT INTO "lineup_entries"/);
  assert.deepEqual(benched.map((call) => call.params), [[1, 42, 21, 2026, 6]]);
  fake.assertClean();
});
