const test = require('node:test');
const assert = require('node:assert/strict');
const { byeWeekFromPlayedWeeks, REG_SEASON_WEEKS } = require('../services/bye.service');
const { createFakePool } = require('./helpers/fakePool');
const {
  slotEligible,
  validateLineup,
  parseLineupSettings,
  annotateLineupEntries,
  getLineup,
  setLineup,
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

function installSetLineupWorld(t, injuryDesignation) {
  const entries = [{
    player_id: 1,
    name: 'Test Runner',
    position: 'RB',
    nfl_team: 'MIN',
    injury_status: injuryDesignation,
    slot: 'BENCH',
  }];
  return createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: 5,
        current_season: 2026,
        current_week: 8,
        roster_slots: DEFAULT_ROSTER_SLOTS,
        bench_slots: 5,
        ir_slots: 1,
      }],
    })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10 }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map(({ player_id, position }) => ({ player_id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({ rows: [{ player_id: 1 }] })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: entries.map((entry) => ({ ...entry })) })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
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
