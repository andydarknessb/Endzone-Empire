const test = require('node:test');
const assert = require('node:assert/strict');
const { byeWeekFromPlayedWeeks, REG_SEASON_WEEKS } = require('../services/bye.service');
const { dropPlayer } = require('../services/draft.service');
const { createFakePool } = require('./helpers/fakePool');
const {
  slotEligible,
  validateLineup,
  parseLineupSettings,
  annotateLineupEntries,
  getLineup,
  setLineup,
  benchAcquiredPlayer,
  DEFAULT_ROSTER_SLOTS,
} = require('../services/lineup.service');

test('annotateLineupEntries derives onBye only from the canonical bye week', () => {
  const selectedWeek = 6;
  const entries = annotateLineupEntries(
    [
      { id: 1, name: 'Justin Jefferson', nfl_team: 'MIN' },
      { id: 2, name: 'Josh Allen', nfl_team: 'BUF' },
      { id: 3, name: 'Patrick Mahomes', nfl_team: 'KC' },
    ],
    {
      locked: new Set(['BUF']),
      byeByTeam: new Map([['MIN', 6], ['BUF', 7], ['KC', null]]),
      selectedWeek,
    }
  );

  assert.equal(entries[0].bye_week, selectedWeek);
  assert.equal(entries[0].onBye, true);
  assert.equal(entries[1].bye_week, 7);
  assert.equal(entries[1].onBye, false);
  assert.equal(entries[1].locked, true);
  assert.equal(entries[2].bye_week, null);
  assert.equal(entries[2].onBye, false);
  assert.equal(entries[0].name, 'Justin Jefferson');
  for (const entry of entries.filter((row) => row.onBye)) {
    assert.equal(entry.bye_week, selectedWeek);
  }
});

test('annotateLineupEntries does not treat an incomplete schedule gap as a bye', () => {
  const playedWeeks = new Set(Array.from({ length: REG_SEASON_WEEKS }, (_, index) => index + 1));
  playedWeeks.delete(6); // actual bye
  playedWeeks.delete(10); // missing game row, not a bye
  const byeWeek = byeWeekFromPlayedWeeks(playedWeeks);

  const [entry] = annotateLineupEntries(
    [{ id: 1, nfl_team: 'MIN' }],
    { locked: new Set(), byeByTeam: new Map([['MIN', byeWeek]]), selectedWeek: 10 }
  );

  assert.equal(entry.bye_week, null);
  assert.equal(entry.onBye, false);
});

test('getLineup batches completed-season projections and preserves weekly null semantics', async (t) => {
  const entries = [
    { id: 1, name: 'Projected Player', position: 'RB', nfl_team: null, injury_status: null, slot: 'RB' },
    { id: 2, name: 'Small Sample', position: 'WR', nfl_team: null, injury_status: null, slot: 'WR' },
    { id: 3, name: 'No History', position: 'TE', nfl_team: null, injury_status: null, slot: 'TE' },
  ];
  const seasonQueries = [];
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: 5, current_season: 2026, current_week: 8 }] })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10 }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map(({ id, position }) => ({ player_id: id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: entries.map(({ id }) => ({ player_id: id })),
    })],
    [/^SELECT "players"\."id"/, () => ({ rows: entries })],
    [/FROM "player_season_stats"/, (text, params) => {
        seasonQueries.push({ text, params });
        return {
          rows: [
            {
              player_id: 1,
              season: 2025,
              games_played: 10,
              stats: { rushingYards: 1000, rushingTDs: 10 },
            },
            {
              player_id: 2,
              season: 2025,
              games_played: 3,
              stats: { receivingYards: 300, receivingTDs: 3 },
            },
          ],
        };
    }],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
  ]).install(t);

  const lineup = await getLineup({ leagueId: 5, userId: 7, week: 8 });

  assert.equal(seasonQueries.length, 1);
  assert.deepEqual(seasonQueries[0].params, [[1, 2, 3]]);
  assert.equal(lineup.entries[0].projected_points, 16);
  assert.equal(lineup.entries[1].projected_points, null);
  assert.equal(lineup.entries[2].projected_points, null);
  fake.assertClean();
});

function installSetLineupWorld(t, injuryDesignation, {
  slot = 'BENCH',
  extraEntries = [],
  lockedTeams = [],
  irAttested = false,
  leagueOverrides = {},
} = {}) {
  const entries = [{
    player_id: 1,
    name: 'Test Runner',
    position: 'RB',
    nfl_team: 'MIN',
    injury_status: injuryDesignation,
    slot,
    ir_attested: irAttested,
  }, ...extraEntries];
  return createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: 5,
        current_season: 2026,
        current_week: 8,
        roster_slots: DEFAULT_ROSTER_SLOTS,
        bench_slots: 5,
        ir_slots: 1,
        ...leagueOverrides,
      }],
    })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10 }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map(({ player_id, position }) => ({ player_id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: entries.map(({ player_id }) => ({ player_id })),
    })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: entries.map((entry) => ({ ...entry })) })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({
      rows: lockedTeams.map((nfl_team) => ({ nfl_team })),
    })],
    [/^UPDATE "lineup_entries"/, () => ({ rows: [] })],
  ]).install(t);
}

test('setLineup rejects placing a healthy player in IR and names the designation', async (t) => {
  const fake = installSetLineupWorld(t, null);

  await assert.rejects(
    setLineup({ leagueId: 5, userId: 7, week: 8, moves: [{ playerId: 1, slot: 'IR' }] }),
    (error) => error.statusCode === 400 && /current injury designation: healthy/.test(error.message)
  );

  fake.assertClean();
});

test('setLineup accepts placing an IR-eligible player in an available IR slot', async (t) => {
  const fake = installSetLineupWorld(t, 'IR');

  const result = await setLineup({
    leagueId: 5,
    userId: 7,
    week: 8,
    moves: [{ playerId: 1, slot: 'IR' }],
  });

  assert.equal(result.updated, 1);
  fake.assertClean();
});

test('setLineup lets a best-ball manager move an IR-eligible bench player to IR', async (t) => {
  const fake = installSetLineupWorld(t, 'O', {
    leagueOverrides: { best_ball: true },
  });

  const result = await setLineup({
    leagueId: 5,
    userId: 7,
    week: 8,
    moves: [{ playerId: 1, slot: 'IR' }],
  });

  assert.equal(result.updated, 1);
  fake.assertClean();
});

test('setLineup keeps starting slots automatic in best-ball leagues', async (t) => {
  const fake = installSetLineupWorld(t, null, {
    leagueOverrides: { best_ball: true },
  });

  await assert.rejects(
    setLineup({ leagueId: 5, userId: 7, week: 8, moves: [{ playerId: 1, slot: 'RB' }] }),
    (error) => error.statusCode === 409 && /only between BENCH and IR/.test(error.message)
  );

  fake.assertClean();
});

test('setLineup does not cap the best-ball player pool at the bench slot count', async (t) => {
  const extraEntries = Array.from({ length: 6 }, (_, index) => ({
    player_id: index + 2,
    name: `Best Ball Player ${index + 2}`,
    position: 'RB',
    nfl_team: `TEAM-${index + 2}`,
    injury_status: null,
    slot: 'BENCH',
  }));
  const fake = installSetLineupWorld(t, 'IR', {
    extraEntries,
    leagueOverrides: { best_ball: true },
  });

  const result = await setLineup({
    leagueId: 5,
    userId: 7,
    week: 8,
    moves: [{ playerId: 1, slot: 'IR' }],
  });

  assert.equal(result.updated, 1);
  fake.assertClean();
});

test('setLineup keeps a recovered best-ball stash locked after kickoff', async (t) => {
  const fake = installSetLineupWorld(t, 'Q', {
    slot: 'IR',
    lockedTeams: ['MIN'],
    leagueOverrides: { best_ball: true },
  });

  await assert.rejects(
    setLineup({ leagueId: 5, userId: 7, week: 8, moves: [{ playerId: 1, slot: 'BENCH' }] }),
    { statusCode: 409, code: 'LINEUP_LOCKED' }
  );

  fake.assertClean();
});

test('setLineup rejects a save that leaves a non-IR-eligible player stashed', async (t) => {
  const fake = installSetLineupWorld(t, 'Q', {
    slot: 'IR',
    extraEntries: [{
      player_id: 2,
      name: 'Other Quarterback',
      position: 'QB',
      nfl_team: 'KC',
      injury_status: null,
      slot: 'BENCH',
    }],
  });

  await assert.rejects(
    setLineup({ leagueId: 5, userId: 7, week: 8, moves: [{ playerId: 2, slot: 'QB' }] }),
    (error) => error.statusCode === 400
      && /Test Runner/.test(error.message)
      && /current injury designation: questionable/.test(error.message)
  );

  fake.assertClean();
});

test('setLineup lets a locked player resolve a stale stash by moving from IR to the bench', async (t) => {
  const fake = installSetLineupWorld(t, 'Q', { slot: 'IR', lockedTeams: ['MIN'] });

  const result = await setLineup({
    leagueId: 5,
    userId: 7,
    week: 8,
    moves: [{ playerId: 1, slot: 'BENCH' }],
  });

  assert.equal(result.updated, 1);
  fake.assertClean();
});

test('setLineup keeps the lock for an IR-eligible player stashed in IR', async (t) => {
  const fake = installSetLineupWorld(t, 'O', { slot: 'IR', lockedTeams: ['MIN'] });

  await assert.rejects(
    setLineup({ leagueId: 5, userId: 7, week: 8, moves: [{ playerId: 1, slot: 'BENCH' }] }),
    { statusCode: 409, code: 'LINEUP_LOCKED' }
  );

  fake.assertClean();
});

test('setLineup keeps the lineup lock for a player outside IR', async (t) => {
  const fake = installSetLineupWorld(t, null, { lockedTeams: ['MIN'] });

  await assert.rejects(
    setLineup({ leagueId: 5, userId: 7, week: 8, moves: [{ playerId: 1, slot: 'RB' }] }),
    { statusCode: 409, code: 'LINEUP_LOCKED' }
  );

  fake.assertClean();
});

test('setLineup keeps the lock when a recovered stash targets a starting slot', async (t) => {
  const fake = installSetLineupWorld(t, 'Q', { slot: 'IR', lockedTeams: ['MIN'] });

  await assert.rejects(
    setLineup({ leagueId: 5, userId: 7, week: 8, moves: [{ playerId: 1, slot: 'RB' }] }),
    { statusCode: 409, code: 'LINEUP_LOCKED' }
  );
  fake.assertClean();
});

test('setLineup derives a stale stash after weekly slot carry-forward', async (t) => {
  const entries = [
    {
      player_id: 1,
      name: 'Recovered Runner',
      position: 'RB',
      nfl_team: 'MIN',
      injury_status: 'Q',
      previousSlot: 'IR',
    },
    {
      player_id: 2,
      name: 'Other Quarterback',
      position: 'QB',
      nfl_team: 'KC',
      injury_status: null,
      previousSlot: 'BENCH',
    },
  ];
  const currentSlots = new Map();
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: 5,
        current_season: 2026,
        current_week: 9,
        roster_slots: DEFAULT_ROSTER_SLOTS,
        bench_slots: 5,
        ir_slots: 1,
      }],
    })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10 }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map(({ player_id, position }) => ({ player_id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({ rows: [] })],
    [/^SELECT "player_id", "slot", "ir_attested" FROM "lineup_entries"/, () => ({
      rows: entries.map(({ player_id, previousSlot }) => ({ player_id, slot: previousSlot, ir_attested: false })),
    })],
    [/^INSERT INTO "lineup_entries"/, (text, params) => {
      currentSlots.set(params[2], params[5]);
      return { rows: [] };
    }],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({
      rows: entries.map(({ previousSlot, ...entry }) => ({
        ...entry,
        slot: currentSlots.get(entry.player_id),
      })),
    })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
    [/^UPDATE "lineup_entries"/, () => ({ rows: [] })],
  ]).install(t);

  await assert.rejects(
    setLineup({ leagueId: 5, userId: 7, week: 9, moves: [{ playerId: 2, slot: 'QB' }] }),
    (error) => error.statusCode === 400
      && /Recovered Runner/.test(error.message)
      && /current injury designation: questionable/.test(error.message)
  );

  fake.assertClean();
});

test('a full roster resolves by dropping a bench player before activating the stale stash', async (t) => {
  const entries = [
    {
      player_id: 1,
      name: 'Recovered Runner',
      position: 'RB',
      nfl_team: 'MIN',
      injury_status: 'Q',
      slot: 'IR',
    },
    {
      player_id: 2,
      name: 'Bench Receiver',
      position: 'WR',
      nfl_team: 'KC',
      injury_status: null,
      slot: 'BENCH',
    },
  ];
  const rosteredPlayerIds = new Set(entries.map(({ player_id }) => player_id));
  const fake = createFakePool([
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10, locked: false }] })],
    [/^DELETE FROM "team_players"/, (text, params) => {
      const deleted = rosteredPlayerIds.delete(params[1]);
      return { rows: deleted ? [{ id: 99 }] : [], rowCount: deleted ? 1 : 0 };
    }],
    [/^SELECT "waiver_period_hours" FROM "leagues"/, () => ({
      rows: [{ waiver_period_hours: 24 }],
    })],
    [/^INSERT INTO "waiver_players"/, () => ({ rows: [] })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: 5,
        current_season: 2026,
        current_week: 8,
        roster_slots: [],
        bench_slots: 1,
        ir_slots: 1,
      }],
    })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries
        .filter(({ player_id }) => rosteredPlayerIds.has(player_id))
        .map(({ player_id, position }) => ({ player_id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: entries.map(({ player_id }) => ({ player_id })),
    })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({
      rows: entries
        .filter(({ player_id }) => rosteredPlayerIds.has(player_id))
        .map((entry) => ({ ...entry })),
    })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [{ nfl_team: 'MIN' }] })],
    [/^UPDATE "lineup_entries"/, () => ({ rows: [] })],
  ]).install(t);

  const drop = await dropPlayer({ leagueId: 5, userId: 7, playerId: 2 });
  const activation = await setLineup({
    leagueId: 5,
    userId: 7,
    week: 8,
    moves: [{ playerId: 1, slot: 'BENCH' }],
  });

  assert.equal(drop.playerId, 2);
  assert.equal(activation.updated, 1);
  fake.assertClean();
});

test('slotEligible: exact-position slots take only that position', () => {
  assert.equal(slotEligible('QB', 'QB'), true);
  assert.equal(slotEligible('QB', 'RB'), false);
  assert.equal(slotEligible('RB', 'RB'), true);
  assert.equal(slotEligible('WR', 'TE'), false);
  assert.equal(slotEligible('K', 'K'), true);
  assert.equal(slotEligible('DEF', 'DEF'), true);
  assert.equal(slotEligible('DEF', 'K'), false);
});

test('slotEligible: FLEX takes RB, WR, or TE but not QB/K/DEF', () => {
  assert.equal(slotEligible('FLEX', 'RB'), true);
  assert.equal(slotEligible('FLEX', 'WR'), true);
  assert.equal(slotEligible('FLEX', 'TE'), true);
  assert.equal(slotEligible('FLEX', 'QB'), false);
  assert.equal(slotEligible('FLEX', 'K'), false);
  assert.equal(slotEligible('FLEX', 'DEF'), false);
});

test('slotEligible: BENCH and IR take any position', () => {
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    assert.equal(slotEligible('BENCH', position), true);
    assert.equal(slotEligible('IR', position), true);
  }
});

test('slotEligible: a custom SUPERFLEX slot also takes QB', () => {
  const superflexSlots = [
    ...DEFAULT_ROSTER_SLOTS,
    { key: 'SUPERFLEX', count: 1, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] },
  ];
  assert.equal(slotEligible('SUPERFLEX', 'QB', superflexSlots), true);
  assert.equal(slotEligible('SUPERFLEX', 'RB', superflexSlots), true);
  assert.equal(slotEligible('SUPERFLEX', 'K', superflexSlots), false);
  // The default (no third arg) shape has no SUPERFLEX slot at all.
  assert.equal(slotEligible('SUPERFLEX', 'QB'), false);
});

test('slotEligible: a DP slot expands DL/LB/DB group keys to specific positions', () => {
  const dpSlots = [
    ...DEFAULT_ROSTER_SLOTS,
    { key: 'DP', count: 1, eligiblePositions: ['DL', 'LB', 'DB'] },
  ];
  for (const position of ['DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'CB', 'S', 'FS', 'SS']) {
    assert.equal(slotEligible('DP', position, dpSlots), true);
  }
  assert.equal(slotEligible('DP', 'QB', dpSlots), false);
});

const entry = (position, slot, playerId = 1) => ({ playerId, position, slot });

test('validateLineup: a legal default lineup passes', () => {
  const entries = [
    entry('QB', 'QB'),
    entry('RB', 'RB'), entry('RB', 'RB'),
    entry('WR', 'WR'), entry('WR', 'WR'),
    entry('TE', 'TE'),
    entry('WR', 'FLEX'),
    entry('K', 'K'),
    entry('DEF', 'DEF'),
    entry('RB', 'BENCH'), entry('WR', 'BENCH'), entry('QB', 'BENCH'),
  ];
  assert.deepEqual(validateLineup(entries, { rosterSlots: DEFAULT_ROSTER_SLOTS, benchSlots: 5, irSlots: 1 }), []);
});

test('validateLineup: overfilling a slot is rejected', () => {
  const entries = [entry('QB', 'QB', 1), entry('QB', 'QB', 2)];
  const errors = validateLineup(entries, { rosterSlots: DEFAULT_ROSTER_SLOTS, benchSlots: 5, irSlots: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /too many players at QB \(2\/1\)/);
});

test('validateLineup: wrong position in a slot is rejected', () => {
  const errors = validateLineup([entry('QB', 'FLEX')], { rosterSlots: DEFAULT_ROSTER_SLOTS, benchSlots: 5, irSlots: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /a QB cannot start at FLEX/);
});

test('validateLineup: unknown slot names are rejected', () => {
  const errors = validateLineup([entry('RB', 'SUPERFLEX')], { rosterSlots: DEFAULT_ROSTER_SLOTS, benchSlots: 5, irSlots: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /unknown slot "SUPERFLEX"/);
});

test('validateLineup: BENCH is capped at benchSlots', () => {
  const entries = Array.from({ length: 5 }, (_, i) => entry('RB', 'BENCH', i + 1));
  assert.deepEqual(validateLineup(entries, { rosterSlots: DEFAULT_ROSTER_SLOTS, benchSlots: 5, irSlots: 1 }), []);

  const tooMany = Array.from({ length: 6 }, (_, i) => entry('RB', 'BENCH', i + 1));
  const errors = validateLineup(tooMany, { rosterSlots: DEFAULT_ROSTER_SLOTS, benchSlots: 5, irSlots: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /too many players at BENCH \(6\/5\)/);
});

test('validateLineup: IR is capped at irSlots', () => {
  const entries = [entry('RB', 'IR', 1), entry('WR', 'IR', 2)];
  assert.deepEqual(validateLineup(entries, { rosterSlots: DEFAULT_ROSTER_SLOTS, benchSlots: 5, irSlots: 2 }), []);
  const errors = validateLineup(entries, { rosterSlots: DEFAULT_ROSTER_SLOTS, benchSlots: 5, irSlots: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /too many players at IR \(2\/1\)/);
});

test('validateLineup: custom slot counts are honored', () => {
  const twoQb = DEFAULT_ROSTER_SLOTS.map((s) => (s.key === 'QB' ? { ...s, count: 2 } : s));
  const entries = [entry('QB', 'QB', 1), entry('QB', 'QB', 2)];
  assert.deepEqual(validateLineup(entries, { rosterSlots: twoQb, benchSlots: 5, irSlots: 1 }), []);
});

test('validateLineup: a slot configured to 0 rejects any starter there', () => {
  const noTe = DEFAULT_ROSTER_SLOTS.map((s) => (s.key === 'TE' ? { ...s, count: 0 } : s));
  const errors = validateLineup([entry('TE', 'TE')], { rosterSlots: noTe, benchSlots: 5, irSlots: 1 });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /too many players at TE \(1\/0\)/);
});

test('parseLineupSettings: defaults when columns are null', () => {
  const settings = parseLineupSettings({ roster_slots: null, position_caps: null, bench_slots: null, ir_slots: null });
  assert.deepEqual(settings.rosterSlots, DEFAULT_ROSTER_SLOTS);
  assert.deepEqual(settings.positionCaps, {});
  assert.equal(settings.benchSlots, 5);
  assert.equal(settings.irSlots, 1);
});

test('parseLineupSettings: accepts jsonb objects and JSON strings', () => {
  const customSlots = [{ key: 'QB', count: 2, eligiblePositions: ['QB'] }];
  const asObject = parseLineupSettings({
    roster_slots: customSlots, position_caps: { RB: 4 }, bench_slots: 3, ir_slots: 2,
  });
  assert.deepEqual(asObject.rosterSlots, customSlots);
  assert.deepEqual(asObject.positionCaps, { RB: 4 });
  assert.equal(asObject.benchSlots, 3);
  assert.equal(asObject.irSlots, 2);

  const asString = parseLineupSettings({
    roster_slots: JSON.stringify(customSlots), position_caps: '{"RB":4}', bench_slots: 3, ir_slots: 2,
  });
  assert.deepEqual(asString.rosterSlots, customSlots);
  assert.deepEqual(asString.positionCaps, { RB: 4 });
});

// --- commissioner IR attestation (#100), thin at the lineup seam ------------
// Attestation semantics (grant, exemption, clearing shape) are dense at the
// IR policy module seam; here we prove the lineup service consults them.

test('setLineup accepts a save that keeps an attested ineligible player stashed', async (t) => {
  const fake = installSetLineupWorld(t, 'Q', {
    slot: 'IR',
    irAttested: true,
    extraEntries: [{
      player_id: 2,
      name: 'Other Quarterback',
      position: 'QB',
      nfl_team: 'KC',
      injury_status: null,
      slot: 'BENCH',
      ir_attested: false,
    }],
  });

  const result = await setLineup({ leagueId: 5, userId: 7, week: 8, moves: [{ playerId: 2, slot: 'QB' }] });

  assert.equal(result.updated, 1);
  fake.assertClean();
});

test('setLineup clears the attestation on any manager-initiated slot move', async (t) => {
  const fake = installSetLineupWorld(t, 'Q', { slot: 'IR', irAttested: true });

  const result = await setLineup({ leagueId: 5, userId: 7, week: 8, moves: [{ playerId: 1, slot: 'BENCH' }] });

  assert.equal(result.updated, 1);
  const update = fake.matching(/^UPDATE "lineup_entries"/)[0];
  assert.match(update.text, /"ir_attested" = false/);
  fake.assertClean();
});

test('weekly materialization carries the attestation forward with the slot', async (t) => {
  // Week 9 has no entries yet; week 8 stashed player 1 with an attestation.
  // The copy-forward must write slot IR AND ir_attested true, and the save
  // must then accept the still-attested stash without a flag.
  const entries = [
    {
      player_id: 1,
      name: 'Attested Runner',
      position: 'RB',
      nfl_team: 'MIN',
      injury_status: 'Q',
      previousSlot: 'IR',
      previousAttested: true,
    },
    {
      player_id: 2,
      name: 'Other Quarterback',
      position: 'QB',
      nfl_team: 'KC',
      injury_status: null,
      previousSlot: 'BENCH',
      previousAttested: false,
    },
  ];
  const materialized = new Map();
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: 5,
        current_season: 2026,
        current_week: 9,
        roster_slots: DEFAULT_ROSTER_SLOTS,
        bench_slots: 5,
        ir_slots: 1,
      }],
    })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10 }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map(({ player_id, position }) => ({ player_id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({ rows: [] })],
    [/^SELECT "player_id", "slot", "ir_attested" FROM "lineup_entries"/, () => ({
      rows: entries.map(({ player_id, previousSlot, previousAttested }) => (
        { player_id, slot: previousSlot, ir_attested: previousAttested }
      )),
    })],
    [/^INSERT INTO "lineup_entries"/, (text, params) => {
      materialized.set(params[2], { slot: params[5], ir_attested: params[6] });
      return { rows: [] };
    }],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({
      rows: entries.map(({ previousSlot, previousAttested, ...entry }) => ({
        ...entry,
        slot: materialized.get(entry.player_id).slot,
        ir_attested: materialized.get(entry.player_id).ir_attested,
      })),
    })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
    [/^UPDATE "lineup_entries"/, () => ({ rows: [] })],
  ]).install(t);

  const result = await setLineup({ leagueId: 5, userId: 7, week: 9, moves: [{ playerId: 2, slot: 'QB' }] });

  assert.equal(result.updated, 1);
  assert.deepEqual(materialized.get(1), { slot: 'IR', ir_attested: true });
  assert.deepEqual(materialized.get(2), { slot: 'BENCH', ir_attested: false });
  fake.assertClean();
});

test('setLineup cannot relaunder an attestation by moving the player out and back in one save', async (t) => {
  // The gate judges the post-move stash: the manager's own move ends the
  // attestation first, so re-stashing the still-ineligible player in the
  // same save hits the normal eligibility gate.
  const fake = installSetLineupWorld(t, 'Q', { slot: 'IR', irAttested: true });

  await assert.rejects(
    setLineup({
      leagueId: 5, userId: 7, week: 8,
      moves: [{ playerId: 1, slot: 'BENCH' }, { playerId: 1, slot: 'IR' }],
    }),
    (error) => error.statusCode === 400
      && /current injury designation: questionable/.test(error.message)
  );

  fake.assertClean();
});

test('a manager move also clears the attestation from already-materialized later weeks', async (t) => {
  const fake = installSetLineupWorld(t, 'Q', { slot: 'IR', irAttested: true });

  await setLineup({ leagueId: 5, userId: 7, week: 8, moves: [{ playerId: 1, slot: 'BENCH' }] });

  const updates = fake.matching(/^UPDATE "lineup_entries"/);
  assert.equal(updates.length, 2);
  const sweep = updates[1];
  assert.match(sweep.text, /"week" > \$3/);
  assert.match(sweep.text, /AND "ir_attested"/);
  assert.deepEqual(sweep.params, [10, 2026, 8, [1]]);
  fake.assertClean();
});

// --- acquisitions land on the bench (#94 user story 13) ---------------------
// A dropped player's lineup rows survive the drop, so a re-add would otherwise
// sit straight back in his old IR stash (same week) or have it revived by the
// copy-forward (later week). Every acquisition site calls this after its
// roster insert; undoDrop alone does not, because an undo restores the stash.

/**
 * A lineup world for benchAcquiredPlayer: `roster` is what team_players holds
 * now, `currentSlots` the current week's existing rows, `previousSlots` the
 * copy-forward source week. Tracks the current week's slots through the
 * materialize inserts and the bench update so a test can read its end state.
 */
function acquisitionWorld({ roster, currentSlots, previousSlots }) {
  const slots = new Map(currentSlots);
  const fake = createFakePool([
    [/^SELECT "team_players"\."player_id"/, () => ({ rows: roster })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: [...slots.keys()].map((player_id) => ({ player_id })),
    })],
    [/^SELECT "player_id", "slot"/, () => ({
      rows: [...previousSlots].map(([player_id, slot]) => ({ player_id, slot })),
    })],
    [/^INSERT INTO "lineup_entries"/, (text, params) => {
      if (!slots.has(params[2])) slots.set(params[2], params[5]);
      return { rows: [] };
    }],
    [/^UPDATE "lineup_entries"/, (text, params) => {
      // The update names the slot it moves from: only that slot is touched.
      const hit = slots.get(params[1]) === params[5];
      if (hit) slots.set(params[1], params[4]);
      return { rows: [], rowCount: hit ? 1 : 0 };
    }],
  ]);
  return { fake, slots };
}

const acquire = (fake, playerId) => benchAcquiredPlayer(fake, {
  league: { id: 5, current_season: 2026, current_week: 9 },
  teamId: 10,
  playerId,
});

test('benchAcquiredPlayer moves the acquired player out of a surviving stash, current week onward', async () => {
  // Player 21 was dropped and re-acquired within week 9: his IR row survived.
  const { fake, slots } = acquisitionWorld({
    roster: [{ player_id: 1, position: 'QB' }, { player_id: 21, position: 'RB' }],
    currentSlots: [[1, 'QB'], [21, 'IR']],
    previousSlots: [],
  });
  const client = await fake.connect();
  await acquire(client, 21);
  client.release();

  assert.deepEqual([...slots], [[1, 'QB'], [21, 'BENCH']]);
  const [bench] = fake.matching(/^UPDATE "lineup_entries"/);
  assert.deepEqual(bench.params, [10, 21, 2026, 9, 'BENCH', 'IR']);
  // Benching also ends any standing attestation (#100): only an undone drop
  // restores one, and this is not an undo.
  assert.match(bench.text, /SET "slot" = \$5, "ir_attested" = false/);
  // Current week and any pre-materialized later week; earlier weeks are
  // history and stay as they were played.
  assert.match(bench.text, /"week" >= \$4 AND "slot" = \$6/);
  assert.equal(fake.matching(/^INSERT INTO "lineup_entries"/).length, 0, 'week was complete');
  fake.assertClean();
});

test('benchAcquiredPlayer materializes an untouched week first, so no lone row can poison the next copy-forward', async () => {
  // Nobody has opened week 9 yet. Materializing first carries every slot
  // into week 9 - including the stale IR of the re-acquired player 21, which
  // is then reset - so week 10's copy-forward reads a complete week 9.
  const { fake, slots } = acquisitionWorld({
    roster: [
      { player_id: 1, position: 'QB' },
      { player_id: 2, position: 'RB' },
      { player_id: 21, position: 'RB' },
    ],
    currentSlots: [],
    previousSlots: [[1, 'QB'], [2, 'IR'], [21, 'IR']],
  });
  const client = await fake.connect();
  await acquire(client, 21);
  client.release();

  assert.deepEqual([...slots].sort(), [[1, 'QB'], [2, 'IR'], [21, 'BENCH']]);
  const inserts = fake.calls.filter((c) => /^INSERT INTO "lineup_entries"/.test(c.text));
  const bench = fake.calls.findIndex((c) => /^UPDATE "lineup_entries"/.test(c.text));
  assert.equal(inserts.length, 3, 'the whole roster is materialized');
  assert.ok(bench > fake.calls.indexOf(inserts[2]), 'and only then is the stash reset');
  fake.assertClean();
});

test('benchAcquiredPlayer leaves a surviving starter row as played', async () => {
  // Week 9 is finished but not yet advanced; player 21 started at RB, scored,
  // was dropped and re-acquired. Only a stash is reset - his RB row (and its
  // points) stays, since the lock would forbid putting him back.
  const { fake, slots } = acquisitionWorld({
    roster: [{ player_id: 21, position: 'RB' }],
    currentSlots: [[21, 'RB']],
    previousSlots: [],
  });
  const client = await fake.connect();
  await acquire(client, 21);
  client.release();

  assert.deepEqual([...slots], [[21, 'RB']]);
  fake.assertClean();
});
