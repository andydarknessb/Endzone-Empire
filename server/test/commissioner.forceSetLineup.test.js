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

function forceSetWorld(t, { entries, spentRows = [], leagueOverrides = {} }) {
  const updates = [];
  const fake = createFakePool([
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
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
    // Surviving as-played rows of dropped players, which the roster-joined
    // entries query above cannot return (#627).
    [/^SELECT "players"\."position"/, () => ({ rows: spentRows.map((row) => ({ ...row })) })],
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

// --- a spent starting slot stays spent on the force path too (#627) ---------
// The dense statement of the rule lives at the manager seam
// (lineup.service.test.js); this pins that the commissioner's validation
// counts the same surviving as-played rows, since a force-set that seated a
// replacement beside one would double-score the slot just the same.

test('force-set also refuses to fill a starting slot spent by a surviving as-played row (#627)', async (t) => {
  const { fake, updates } = forceSetWorld(t, {
    entries: [
      { player_id: 1, slot: 'BENCH', ir_attested: false, position: 'RB', injury_status: null },
    ],
    spentRows: [{ position: 'RB', slot: 'RB' }],
  });

  await assert.rejects(
    forceSetLineup({
      leagueId: 5, userId: 100, teamId: 10, week: 8,
      moves: [{ playerId: 1, slot: 'RB' }],
    }),
    (error) => error.statusCode === 400 && /too many players at RB \(2\/1\)/.test(error.message)
  );

  assert.equal(updates.length, 0, 'the refused force-set moved no slot');
  fake.assertClean();
});

test('force-set can still repair around a spent slot by moving players out of it', async (t) => {
  // The repair power the force validation exists to preserve: benching the
  // replacement only lowers the spent slot count, so it stays legal.
  const { fake, updates } = forceSetWorld(t, {
    entries: [
      { player_id: 1, slot: 'RB', ir_attested: false, position: 'RB', injury_status: null },
    ],
    spentRows: [{ position: 'RB', slot: 'RB' }],
  });

  const result = await forceSetLineup({
    leagueId: 5, userId: 100, teamId: 10, week: 8,
    moves: [{ playerId: 1, slot: 'BENCH' }],
  });

  assert.equal(result.updated, 1);
  assert.equal(updates[0].params[0], 'BENCH');
  fake.assertClean();
});

// --- past-week / settled-week guard (#191) ----------------------------------
// Since #189 froze materialization on a final week, a force-set targeting a
// settled week finds no lineup_entries rows: the entries map is empty, so
// every move used to throw a 404 claiming the player was not on the roster.
// That reason was false - the roster fixture below proves it by registering
// a team_players row for the very player the "not on roster" 404 blamed. The
// guard must refuse the week outright, before that lie can ever be told.

function settledWeekWorld(t, { currentWeek = 9 } = {}) {
  const updates = [];
  const inserts = [];
  const fake = createFakePool([
    [/FROM "leagues" WHERE "id" = \$1/, () => ({
      rows: [{
        id: 5,
        is_commissioner: true,
        current_season: 2026,
        current_week: currentWeek,
        roster_slots: DEFAULT_ROSTER_SLOTS,
        bench_slots: 5,
        ir_slots: 1,
      }],
    })],
    [select('teams'), () => ({ rows: [{ id: 10, league_id: 5 }] })],
    // The player really is on the roster: registered so a materialization
    // attempt, if the guard failed to run first, would find him rather than
    // fabricate the #191 false 404.
    [/^SELECT "team_players"\."player_id"/, () => ({ rows: [{ player_id: 1, position: 'RB' }] })],
    // #106/#189: the team's own matchup for this week is final, so
    // materializeLineup freezes rather than copying rows forward.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [{ exists: 1 }] })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({ rows: [] })],
    // A settled week has no rows: this emptiness is what forced the false
    // 404 before the guard existed.
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: [] })],
    [insert('lineup_entries'), (text, params) => { inserts.push({ text, params }); return { rows: [] }; }],
    [update('lineup_entries'), (text, params) => { updates.push({ text, params }); return { rows: [] }; }],
    [insert('transactions'), () => ({ rows: [] })],
  ]).install(t);
  return { fake, updates, inserts };
}

test('force-set refuses a settled week with a 409 naming the real reason', async (t) => {
  const { fake, updates, inserts } = settledWeekWorld(t);

  await assert.rejects(
    forceSetLineup({
      leagueId: 5, userId: 100, teamId: 10, week: 8,
      moves: [{ playerId: 1, slot: 'BENCH' }],
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      // Pin the message, not just the status: the pre-fix failure was a 404
      // that (falsely) blamed the roster, so a status-only assertion cannot
      // tell this correct refusal apart from that differently-wrong one.
      assert.equal(error.message, 'cannot edit a settled week');
      return true;
    }
  );

  // #274. The test below already counts these, so between the two the site is
  // covered - but only between the two: this one pinned the status and message
  // and nothing else, and that one asserts no status at all. Neither was
  // self-sufficient, and a split like that is easy to break by deleting either
  // half. Both halves now stand alone.
  assert.equal(inserts.length, 0, 'nothing was materialized into the settled week');
  assert.equal(updates.length, 0, 'no move was persisted against it');
  fake.assertClean();
});

test('force-set refusing a settled week never materializes or writes it', async (t) => {
  const { fake, updates, inserts } = settledWeekWorld(t);

  await assert.rejects(forceSetLineup({
    leagueId: 5, userId: 100, teamId: 10, week: 8,
    moves: [{ playerId: 1, slot: 'BENCH' }],
  }));

  // A guard that threw after materializing would produce the same 409 and
  // the same message while still having written to a settled week (#106) -
  // count the statements rather than trusting the error alone.
  const touchedSettledWeek = fake.calls.some(
    (c) => /"matchups"|"lineup_entries"|"team_players"/.test(c.text)
  );
  assert.equal(touchedSettledWeek, false, 'the guard must run before any read or write past the team lookup');
  assert.equal(inserts.length, 0, 'materializeLineup must never copy-forward rows into a settled week');
  assert.equal(updates.length, 0, 'no move may be persisted against a settled week');
  fake.assertClean();
});
