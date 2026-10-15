const test = require('node:test');
const assert = require('node:assert/strict');
const { planLineupSave, parseLineupSettings, DEFAULT_ROSTER_SLOTS } = require('../services/lineup.service');

// planLineupSave is pure (spec #2042): rows in, a plan out, no pool, no fake.
const settings = parseLineupSettings({ roster_slots: DEFAULT_ROSTER_SLOTS, bench_slots: 5, ir_slots: 1 });
const row = (player_id, position, slot, extra = {}) => ({
  player_id, position, slot, name: `P${player_id}`, injury_status: null, ir_attested: false, ...extra,
});
const plan = (over) => planLineupSave({
  rows: [], moves: [], locked: new Set(), spent: [], attested: new Set(), settings, bestBall: false, calledShot: null,
  ...over,
});

// A starting RB (1) over a benched RB (3), and a called shot keeping 1 over 3.
const shotRows = () => [row(1, 'RB', 'RB'), row(3, 'RB', 'BENCH'), row(4, 'WR', 'BENCH')];
const shot = (over = {}) => ({ id: 9, starterId: 1, benchedId: 3, locked: false, ...over });

const table = [
  {
    name: 'a move on a locked player is refused with the lock code',
    input: { rows: shotRows(), moves: [{ playerId: 4, slot: 'WR' }], locked: new Set([4]) },
    error: { statusCode: 409, code: 'LINEUP_LOCKED' },
  },
  {
    name: 'a locked player stays put without error when his move is a no-op',
    input: { rows: shotRows(), moves: [{ playerId: 4, slot: 'BENCH' }], locked: new Set([4]) },
    changed: [],
  },
  {
    name: 'a move for a player not on the roster is a 404',
    input: { rows: shotRows(), moves: [{ playerId: 99, slot: 'BENCH' }] },
    error: { statusCode: 404 },
  },
  {
    name: 'a stale stash may leave IR for the bench while locked',
    input: {
      rows: [row(1, 'RB', 'IR', { injury_status: null })],
      moves: [{ playerId: 1, slot: 'BENCH' }],
      locked: new Set([1]),
    },
    changed: [1],
  },
  {
    name: 'a locked stale stash may not go to a starting slot',
    input: {
      rows: [row(1, 'RB', 'IR', { injury_status: null })],
      moves: [{ playerId: 1, slot: 'RB' }],
      locked: new Set([1]),
    },
    error: { statusCode: 409, code: 'LINEUP_LOCKED' },
  },
  {
    name: 'a locked valid stash is not the stale exception',
    input: {
      rows: [row(1, 'RB', 'IR', { injury_status: 'O' })],
      moves: [{ playerId: 1, slot: 'BENCH' }],
      locked: new Set([1]),
    },
    error: { statusCode: 409, code: 'LINEUP_LOCKED' },
  },
  {
    name: 'best ball refuses a move into a starting slot',
    input: { rows: [row(1, 'RB', 'BENCH')], moves: [{ playerId: 1, slot: 'RB' }], bestBall: true },
    error: { statusCode: 409 },
  },
  {
    name: 'best ball allows BENCH to IR',
    input: { rows: [row(1, 'RB', 'BENCH', { injury_status: 'O' })], moves: [{ playerId: 1, slot: 'IR' }], bestBall: true },
    changed: [1],
  },
  {
    name: 'a spent starting slot refuses a filler for the seat it holds',
    input: {
      rows: [row(1, 'QB', 'BENCH')],
      moves: [{ playerId: 1, slot: 'QB' }],
      spent: [{ slot: 'QB' }],
    },
    error: { statusCode: 400 },
  },
  {
    name: 'a spent slot with seats left still takes a starter',
    input: { rows: [row(1, 'RB', 'BENCH')], moves: [{ playerId: 1, slot: 'RB' }], spent: [{ slot: 'RB' }] },
    changed: [1],
  },
  {
    name: 'an ineligible position for a slot is refused',
    input: { rows: [row(1, 'RB', 'BENCH')], moves: [{ playerId: 1, slot: 'QB' }] },
    error: { statusCode: 400 },
  },
  {
    name: 'a healthy player cannot be stashed in IR',
    input: { rows: [row(1, 'RB', 'BENCH')], moves: [{ playerId: 1, slot: 'IR' }] },
    error: { statusCode: 400 },
  },
  {
    name: 'forgiveness: a stale stash resolves onto a full bench',
    input: {
      rows: [
        row(1, 'RB', 'IR', { injury_status: null }),
        ...[2, 3, 4, 5, 6].map((id) => row(id, 'WR', 'BENCH')),
      ],
      moves: [{ playerId: 1, slot: 'BENCH' }],
      settings: { ...settings, benchSlots: 5 },
    },
    changed: [1],
  },
  {
    name: 'forgiveness covers the occupant only, not a second bench arrival',
    input: {
      rows: [
        row(1, 'RB', 'IR', { injury_status: null }),
        row(7, 'WR', 'WR'),
        ...[2, 3, 4, 5, 6].map((id) => row(id, 'WR', 'BENCH')),
      ],
      moves: [{ playerId: 1, slot: 'BENCH' }, { playerId: 7, slot: 'BENCH' }],
    },
    error: { statusCode: 400 },
  },
  {
    name: 'an all-bench overflow is repaired before the moves, locked players left alone',
    input: {
      rows: [row(1, 'QB', 'BENCH'), row(2, 'RB', 'BENCH'), row(3, 'RB', 'BENCH'),
        row(4, 'WR', 'BENCH'), row(5, 'WR', 'BENCH'), row(6, 'TE', 'BENCH'), row(7, 'DEF', 'BENCH')],
      moves: [{ playerId: 1, slot: 'BENCH' }],
      locked: new Set([1]),
      settings: { ...settings, benchSlots: 2 },
    },
    check: (p) => {
      assert.equal(p.error, undefined);
      assert.ok(p.changed.length > 0);
      assert.ok(!p.changed.some((e) => e.player_id === 1), 'the locked player is never started');
    },
  },
  {
    name: 'a move on an attested stash names whose attestation it cleared, and is irreversible',
    input: {
      rows: [row(1, 'RB', 'IR', { injury_status: null, ir_attested: true })],
      moves: [{ playerId: 1, slot: 'BENCH' }],
      attested: new Set([1]),
    },
    changed: [1],
    check: (p) => {
      assert.deepEqual(p.attestationCleared, [1]);
      assert.deepEqual(p.irreversible, ['ir_override']);
      assert.equal(p.undoable, false);
    },
  },
  {
    name: 'a move that voids nothing and clears nothing is undoable',
    input: { rows: [row(1, 'RB', 'BENCH')], moves: [{ playerId: 1, slot: 'RB' }] },
    changed: [1],
    check: (p) => {
      assert.deepEqual(p.attestationCleared, []);
      assert.deepEqual(p.irreversible, []);
      assert.equal(p.undoable, true);
    },
  },
  {
    name: 'benching the shot starter voids the open shot, irreversibly',
    input: { rows: shotRows(), moves: [{ playerId: 1, slot: 'BENCH' }], calledShot: shot() },
    changed: [1],
    check: (p) => {
      assert.equal(p.voidCalledShot, true);
      assert.deepEqual(p.irreversible, ['called_shot']);
      assert.equal(p.undoable, false);
    },
  },
  {
    name: 'starting the shot\'s benched player voids it',
    input: { rows: shotRows(), moves: [{ playerId: 3, slot: 'FLEX' }], calledShot: shot() },
    changed: [3],
    check: (p) => assert.equal(p.voidCalledShot, true),
  },
  {
    name: 'a save that keeps the shot\'s pair as called leaves it open',
    input: { rows: shotRows(), moves: [{ playerId: 4, slot: 'WR' }], calledShot: shot() },
    changed: [4],
    check: (p) => assert.equal(p.voidCalledShot, false),
  },
  {
    name: 'no void once either shot player has locked',
    input: {
      rows: shotRows(),
      moves: [{ playerId: 4, slot: 'WR' }, { playerId: 1, slot: 'BENCH' }],
      calledShot: shot({ locked: true }),
    },
    check: (p) => {
      // player 1 locked too in a real week; here only the shot says so
      assert.equal(p.voidCalledShot, false);
    },
  },
  {
    name: 'no open shot, nothing to void',
    input: { rows: shotRows(), moves: [{ playerId: 1, slot: 'BENCH' }], calledShot: null },
    check: (p) => assert.equal(p.voidCalledShot, false),
  },
  {
    name: 'a refused save voids nothing',
    input: { rows: shotRows(), moves: [{ playerId: 1, slot: 'QB' }], calledShot: shot() },
    error: { statusCode: 400 },
    check: (p) => {
      assert.equal(p.voidCalledShot, false);
      assert.deepEqual(p.changed, []);
    },
  },
];

for (const c of table) {
  test(`planLineupSave: ${c.name}`, () => {
    const input = c.input;
    const rowsBefore = JSON.stringify(input.rows);
    const p = plan(input);
    assert.equal(JSON.stringify(input.rows), rowsBefore, 'the plan never mutates its rows');
    if (c.error) {
      assert.ok(p.error, 'expected a refusal');
      assert.equal(p.error.statusCode, c.error.statusCode);
      if (c.error.code) assert.equal(p.error.code, c.error.code);
    } else {
      assert.equal(p.error, undefined, p.error && p.error.message);
    }
    if (c.changed) assert.deepEqual(p.changed.map((e) => e.player_id).sort((a, b) => a - b), c.changed);
    if (c.check) c.check(p);
    // The invariant the wire promises: irreversible work makes the save not undoable.
    assert.equal(p.undoable, p.irreversible.length === 0);
  });
}
