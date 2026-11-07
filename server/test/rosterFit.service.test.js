const test = require('node:test');
const assert = require('node:assert/strict');
const { rosterFit } = require('../services/rosterFit.service');
const { createFakePool, select } = require('./helpers/fakePool');

/**
 * Roster fit (spec #2681, 7/16): one answer to "does this Team stay within its
 * Roster capacity and every Position cap after these adds and drops?" The
 * drops are netted first; only a move that GAINS players in a group or on the
 * roster is refused, so a like-for-like swap at a full roster or a capped
 * position fits.
 */

// roster_limit 5, ir_slots 0: capacity is the draft roster size, no stash read.
const L5 = { id: 1, roster_limit: 5, ir_slots: 0, position_caps: {} };
const CAPPED_RB = { id: 1, roster_limit: 16, ir_slots: 0, position_caps: { RB: 1 } };

function fitWorld({ rosterCount = 0, stashed = 0, atPosition = 0, positions = [] } = {}) {
  return createFakePool([
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players" JOIN "players"/, () => ({ rows: [{ n: atPosition }] })],
    [/^SELECT COUNT\(\*\)::int AS n FROM "team_players" WHERE "team_id"/, () => ({ rows: [{ n: rosterCount }] })],
    [select('players'), () => ({ rows: positions })],
    [select('lineup_entries'), () => ({ rows: [{ n: stashed }] })],
  ]);
}

const cases = [
  {
    name: 'a full roster with no drop is refused for capacity',
    league: L5, world: { rosterCount: 5 }, adds: [500], drops: [],
    expect: 'roster capacity of 5 reached',
  },
  {
    name: 'the same roster with one drop fits',
    league: L5, world: { rosterCount: 5 }, adds: [500], drops: [600],
    expect: null,
  },
  {
    name: 'an IR stash seat counts toward capacity, as it does today',
    league: { id: 1, roster_limit: 6, ir_slots: 1, position_caps: {} },
    world: { rosterCount: 6, stashed: 1 }, adds: [500], drops: [],
    expect: 'roster capacity of 6 reached',
  },
  {
    name: 'without the stash the same roster is at the draft roster size',
    league: { id: 1, roster_limit: 6, ir_slots: 1, position_caps: {} },
    world: { rosterCount: 6, stashed: 0 }, adds: [500], drops: [],
    expect: 'roster capacity of 5 reached',
  },
  {
    name: 'a gain at a capped position is refused',
    league: CAPPED_RB, world: { atPosition: 1, positions: [{ id: 500, position: 'RB' }] }, adds: [500], drops: [],
    expect: 'position cap reached: max 1 RB',
  },
  {
    name: 'a same-group swap at a capped position fits',
    league: CAPPED_RB,
    world: { atPosition: 1, positions: [{ id: 500, position: 'RB' }, { id: 600, position: 'RB' }] },
    adds: [500], drops: [600],
    expect: null,
  },
  {
    name: 'a gain in an uncapped group fits',
    league: CAPPED_RB, world: { atPosition: 1, positions: [{ id: 700, position: 'WR' }] }, adds: [700], drops: [],
    expect: null,
  },
  {
    name: 'a Team receiving two and sending one, at capacity, is refused',
    league: L5,
    world: { rosterCount: 5, positions: [{ id: 500, position: 'WR' }, { id: 501, position: 'WR' }, { id: 600, position: 'WR' }] },
    adds: [500, 501], drops: [600],
    expect: 'roster capacity of 5 reached',
  },
  {
    name: 'a Team receiving two and sending two, at capacity, fits',
    league: L5,
    world: { rosterCount: 5, positions: [500, 501, 600, 601].map((id) => ({ id, position: 'WR' })) },
    adds: [500, 501], drops: [600, 601],
    expect: null,
  },
];

for (const { name, league, world, adds, drops, expect } of cases) {
  test(`rosterFit: ${name}`, async () => {
    const fake = fitWorld(world);
    const client = await fake.connect();
    const reason = await rosterFit(client, { league, teamId: 11, adds, drops });
    client.release();
    assert.equal(reason, expect);
    fake.assertClean();
  });
}

test('rosterFit: a position cap is checked before capacity, so both-failing claims name the cap', async () => {
  const fake = fitWorld({
    rosterCount: 16, atPosition: 1, positions: [{ id: 500, position: 'RB' }],
  });
  const client = await fake.connect();
  const reason = await rosterFit(client, { league: CAPPED_RB, teamId: 11, adds: [500], drops: [] });
  client.release();
  assert.equal(reason, 'position cap reached: max 1 RB');
});

test('rosterFit: checkPositionCap false lets a gain at a capped position through (a commissioner override)', async () => {
  const fake = fitWorld({ atPosition: 1, positions: [{ id: 500, position: 'RB' }] });
  const client = await fake.connect();
  const reason = await rosterFit(client, {
    league: CAPPED_RB, teamId: 11, adds: [500], drops: [], checkPositionCap: false,
  });
  client.release();
  assert.equal(reason, null);
});

test('rosterFit: checkCapacity false lets a gain on a full roster through (an undo-drop owns its stash capacity)', async () => {
  const fake = fitWorld({ rosterCount: 5 });
  const client = await fake.connect();
  const reason = await rosterFit(client, { league: L5, teamId: 11, adds: [500], drops: [], checkCapacity: false });
  client.release();
  assert.equal(reason, null);
});
