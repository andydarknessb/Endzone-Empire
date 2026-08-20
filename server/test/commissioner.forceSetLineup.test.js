const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, insert, select, update } = require('./helpers/fakePool');
const { forceSetLineup } = require('../services/commissioner.service');

// --- commissioner IR attestation (#100), thin at the force-set seam ---------
// The force path bypasses the eligibility gate and is the one writer of the
// attestation. Attestation semantics themselves are dense at the IR policy
// module seam (irPolicy.service.test.js).

const DEFAULT_ROSTER_SLOTS = [
  { key: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', count: 1, eligiblePositions: ['RB'] },
];

function forceSetWorld(t, { entries, leagueOverrides = {} }) {
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
        ...leagueOverrides,
      }],
    })],
    [select('teams'), () => ({ rows: [{ id: 10, league_id: 5 }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map(({ player_id, position }) => ({ player_id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: entries.map(({ player_id }) => ({ player_id })),
    })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: entries.map((entry) => ({ ...entry })) })],
    [update('lineup_entries'), (text, params) => {
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
  assert.match(updates[0].text, /"ir_attested" = \$2/);
  assert.equal(updates[0].params[0], 'IR');
  assert.equal(updates[0].params[1], true);
  fake.assertClean();
});

test('force-set can attest a player from the full best-ball bench pool', async (t) => {
  const { fake, updates } = forceSetWorld(t, {
    leagueOverrides: { best_ball: true, bench_slots: 1 },
    entries: [
      { player_id: 1, slot: 'BENCH', ir_attested: false, position: 'RB', injury_status: null },
      { player_id: 2, slot: 'BENCH', ir_attested: false, position: 'RB', injury_status: null },
      { player_id: 3, slot: 'BENCH', ir_attested: false, position: 'RB', injury_status: null },
    ],
  });

  const result = await forceSetLineup({
    leagueId: 5, userId: 100, teamId: 10, week: 8,
    moves: [{ playerId: 1, slot: 'IR' }],
  });

  assert.equal(result.updated, 1);
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

test('force-set attests a player ALREADY in the IR slot (the headline feed-is-wrong case)', async (t) => {
  // A legitimately stashed O player whose feed designation wrongly flips to Q:
  // he is already in IR, so the attesting move is IR -> IR. The same-slot
  // short-circuit must not swallow the attestation write.
  const { fake, updates } = forceSetWorld(t, {
    entries: [
      { player_id: 1, slot: 'IR', ir_attested: false, position: 'RB', injury_status: 'Q' },
    ],
  });

  const result = await forceSetLineup({
    leagueId: 5, userId: 100, teamId: 10, week: 8,
    moves: [{ playerId: 1, slot: 'IR' }],
  });

  assert.equal(result.updated, 1);
  assert.equal(updates[0].params[0], 'IR');
  assert.equal(updates[0].params[1], true);
  fake.assertClean();
});

test('force-set governs this week forward: an ended attestation is swept from later weeks', async (t) => {
  const { fake, updates } = forceSetWorld(t, {
    entries: [
      { player_id: 1, slot: 'IR', ir_attested: true, position: 'RB', injury_status: null },
    ],
  });

  await forceSetLineup({
    leagueId: 5, userId: 100, teamId: 10, week: 8,
    moves: [{ playerId: 1, slot: 'BENCH' }],
  });

  const sweep = updates.find((u) => /"week" > \$3/.test(u.text) && /"ir_attested" = false/.test(u.text));
  assert.ok(sweep, 'expected a later-weeks clearing sweep');
  assert.deepEqual(sweep.params, [10, 2026, 8, [1]]);
  fake.assertClean();
});

test('force-set attestation is planted into later weeks already materialized with the stash', async (t) => {
  const { fake, updates } = forceSetWorld(t, {
    entries: [
      { player_id: 1, slot: 'IR', ir_attested: false, position: 'RB', injury_status: 'Q' },
    ],
  });

  await forceSetLineup({
    leagueId: 5, userId: 100, teamId: 10, week: 8,
    moves: [{ playerId: 1, slot: 'IR' }],
  });

  const plant = updates.find((u) => /"week" > \$3/.test(u.text) && /"ir_attested" = true/.test(u.text));
  assert.ok(plant, 'expected a later-weeks attestation plant');
  assert.match(plant.text, /"slot" = 'IR'/);
  assert.deepEqual(plant.params, [10, 2026, 8, [1]]);
  fake.assertClean();
});
