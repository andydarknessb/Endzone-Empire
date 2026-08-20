const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert } = require('./helpers/fakePool');
const { forceSetLineup } = require('../services/commissioner.service');

// --- commissioner IR attestation (#100), thin at the force-set seam ---------
// The force path bypasses the eligibility gate and is the one writer of the
// attestation. Attestation semantics themselves are dense at the IR policy
// module seam (irPolicy.service.test.js).

const DEFAULT_ROSTER_SLOTS = [
  { key: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', count: 1, eligiblePositions: ['RB'] },
];

function forceSetWorld(t, { entries }) {
  const updates = [];
  const fake = createFakePool([
    [/FROM "leagues" WHERE "id" = \$1/, () => ({
      rows: [{
        id: 5,
        is_commissioner: true,
        current_season: 2026,
        current_week: 8,
        roster_slots: DEFAULT_ROSTER_SLOTS,
        bench_slots: 5,
        ir_slots: 1,
      }],
    })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10, league_id: 5 }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map(({ player_id, position }) => ({ player_id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: entries.map(({ player_id }) => ({ player_id })),
    })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: entries.map((entry) => ({ ...entry })) })],
    [/^UPDATE "lineup_entries"/, (text, params) => {
      updates.push({ text, params });
      return { rows: [] };
    }],
    [insert('transactions'), () => ({ rows: [] })],
  ]).install(t);
  return { fake, updates };
}

test('force-set placing a non-IR-eligible player into IR succeeds and persists the attestation', async (t) => {
  const { fake, updates } = forceSetWorld(t, {
    entries: [
      { player_id: 1, slot: 'BENCH', ir_attested: false, position: 'RB', injury_status: null },
    ],
  });

  const result = await forceSetLineup({
    leagueId: 5, userId: 100, teamId: 10, week: 8,
    moves: [{ playerId: 1, slot: 'IR' }],
  });

  assert.equal(result.updated, 1);
  assert.equal(updates.length, 1);
  assert.match(updates[0].text, /"ir_attested" = \$2/);
  assert.equal(updates[0].params[0], 'IR');
  assert.equal(updates[0].params[1], true);
  fake.assertClean();
});

test('force-set of an IR-eligible player into IR is a normal stash, not an attestation', async (t) => {
  const { fake, updates } = forceSetWorld(t, {
    entries: [
      { player_id: 1, slot: 'BENCH', ir_attested: false, position: 'RB', injury_status: 'O' },
    ],
  });

  await forceSetLineup({
    leagueId: 5, userId: 100, teamId: 10, week: 8,
    moves: [{ playerId: 1, slot: 'IR' }],
  });

  assert.equal(updates[0].params[1], false);
  fake.assertClean();
});

test('force-set moving the attested player out of IR ends the attestation', async (t) => {
  const { fake, updates } = forceSetWorld(t, {
    entries: [
      { player_id: 1, slot: 'IR', ir_attested: true, position: 'RB', injury_status: null },
    ],
  });

  await forceSetLineup({
    leagueId: 5, userId: 100, teamId: 10, week: 8,
    moves: [{ playerId: 1, slot: 'BENCH' }],
  });

  assert.equal(updates[0].params[0], 'BENCH');
  assert.equal(updates[0].params[1], false);
  fake.assertClean();
});
