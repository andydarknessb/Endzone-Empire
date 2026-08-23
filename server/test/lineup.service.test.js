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
  removeLineupEntries,
  currentWeekEntry,
  restoreInterruptedStash,
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
    { id: 1, name: 'Projected Player', position: 'RB', nfl_team: null, injury_status: null, slot: 'RB', ir_attested: false },
    { id: 2, name: 'Small Sample', position: 'WR', nfl_team: null, injury_status: null, slot: 'WR', ir_attested: false },
    { id: 3, name: 'No History', position: 'TE', nfl_team: null, injury_status: 'Q', slot: 'IR', ir_attested: true },
  ];
  const seasonQueries = [];
  const fake = createFakePool([
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
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
  // The attestation rides along so the client can tell an attested stash
  // from an invalid one (#100).
  assert.equal(lineup.entries[0].ir_attested, false);
  assert.equal(lineup.entries[2].ir_attested, true);
  assert.equal(lineup.entries[0].valid_stash, false);
  assert.equal(lineup.entries[2].valid_stash, true);
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
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
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

test('setLineup lets a locked stale stash leave IR when the league has no bench slots', async (t) => {
  const fake = installSetLineupWorld(t, 'Q', {
    slot: 'IR',
    lockedTeams: ['MIN'],
    leagueOverrides: { bench_slots: 0 },
  });

  const result = await setLineup({
    leagueId: 5,
    userId: 7,
    week: 8,
    moves: [{ playerId: 1, slot: 'BENCH' }],
  });

  assert.equal(result.updated, 1);
  fake.assertClean();
});

test('setLineup cannot launder zero-bench recovery into an ordinary bench slot', async (t) => {
  const fake = installSetLineupWorld(t, 'Q', {
    slot: 'IR',
    leagueOverrides: { bench_slots: 0 },
    extraEntries: [{
      player_id: 2,
      name: 'Starting Runner',
      position: 'RB',
      nfl_team: 'KC',
      injury_status: null,
      slot: 'RB',
      ir_attested: false,
    }],
  });

  await assert.rejects(
    setLineup({
      leagueId: 5,
      userId: 7,
      week: 8,
      moves: [
        { playerId: 1, slot: 'BENCH' },
        { playerId: 1, slot: 'RB' },
        { playerId: 2, slot: 'BENCH' },
      ],
    }),
    (error) => error.statusCode === 400 && /too many players at BENCH \(1\/0\)/.test(error.message)
  );

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

test('setLineup keeps the lock for an attested stash after kickoff', async (t) => {
  const fake = installSetLineupWorld(t, 'Q', {
    slot: 'IR',
    lockedTeams: ['MIN'],
    irAttested: true,
  });

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
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
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
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10, locked: false }] })],
    [/^DELETE FROM "team_players"/, (text, params) => {
      const deleted = rosteredPlayerIds.delete(params[1]);
      // created_at rides out with the row: the departing tenure's start is
      // what decides whether its current-week lineup row survives (#190).
      return {
        rows: deleted ? [{ id: 99, created_at: new Date('2026-09-01T00:00:00Z') }] : [],
        rowCount: deleted ? 1 : 0,
      };
    }],
    [/^SELECT "id", "waiver_period_hours"/, () => ({
      rows: [{ id: 5, waiver_period_hours: 24, current_season: 2026, current_week: 8 }],
    })],
    // The dropped player's lineup rows follow his roster row out (#197): he
    // is a KC bench player and only MIN has kicked off, so the current week
    // goes too. Nothing here depends on which rows went - the drop is a
    // fixture for the stash activation that follows it.
    [/^SELECT "slot", "ir_attested" FROM "lineup_entries"/, () => ({
      rows: [{ slot: 'BENCH', ir_attested: false }],
    })],
    [/^SELECT "nfl_team" FROM "players"/, () => ({ rows: [{ nfl_team: 'KC' }] })],
    [/^DELETE FROM "lineup_entries"/, () => ({ rows: [], rowCount: 1 })],
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
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
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
    // #106: every world here is a LIVE week, so nothing is frozen.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
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

// --- a lineup entry follows the roster (#197) --------------------------------
// Six paths remove a player from a team and none of them used to touch
// lineup_entries, so a lineup row outlived the roster relationship it
// describes. `removeLineupEntries` is the one operation all six now call.
//
// The rule it implements: future weeks always go, the current week goes only
// if the player's NFL game for that week has NOT kicked off, and past weeks
// are never touched. A row that survives therefore means "he was on this
// roster at kickoff", which is what every reader of the week as played
// assumes.

/**
 * A removal world. `nflTeam` is the departing player's team, `kickedOff` the
 * NFL teams whose game for the week has started, `final` whether the team's
 * own matchup for the week is already final (#106).
 *
 * The schedule is asked TWO different questions and they must not be
 * conflated (#190): "has his game started by now" (inclusive, the lock), and
 * "had it already started when the departing tenure began" (strict).
 * `kickedOffBeforeTenure` answers the second, and defaults to empty - the
 * ordinary case of a player held since before anything kicked off.
 */
function removalWorld({
  nflTeam = 'MIN', kickedOff = [], kickedOffBeforeTenure = [], final = false,
} = {}) {
  return createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: final ? [{ 1: 1 }] : [] })],
    [/^SELECT "nfl_team" FROM "players"/, () => ({ rows: [{ nfl_team: nflTeam }] })],
    // Must precede the inclusive matcher below, which would otherwise catch it.
    [/^SELECT "nfl_team" FROM "nfl_games".*"kickoff_at" < \$3/, () => ({
      rows: kickedOffBeforeTenure.map((nfl_team) => ({ nfl_team })),
    })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({
      rows: kickedOff.map((nfl_team) => ({ nfl_team })),
    })],
    [/^DELETE FROM "lineup_entries"/, () => ({ rows: [], rowCount: 1 })],
  ]);
}

const removalLeague = { id: 5, current_season: 2026, current_week: 9 };

// Held since long before the week: the ordinary tenure, so a test that does
// not care about #190's second condition reads exactly as it did before.
const HELD_ALL_ALONG = new Date('2026-09-01T00:00:00Z');

const removeFor = (client, overrides = {}) => removeLineupEntries(client, {
  league: removalLeague,
  teamId: 10,
  playerId: 21,
  tenureStartedAt: HELD_ALL_ALONG,
  ...overrides,
});

test('removeLineupEntries: a pre-kickoff departure takes the current week and every future week', async () => {
  const fake = removalWorld({ nflTeam: 'MIN', kickedOff: ['KC'] });
  const client = await fake.connect();

  const result = await removeFor(client);
  client.release();

  assert.equal(result.removedCurrentWeek, true);
  const [remove] = fake.matching(/^DELETE FROM "lineup_entries"/);
  // Scoped to THIS team's rows for THIS player in the current season, and
  // bounded below by the current week: past weeks are the record of the week
  // as played and are never touched (#106).
  assert.deepEqual(remove.params, [10, 21, 2026, 9, true]);
  assert.match(remove.text, /"team_id" = \$1 AND "player_id" = \$2 AND "season" = \$3/);
  assert.match(remove.text, /\("week" > \$4 OR \("week" = \$4 AND \$5::boolean\)\)/);
  fake.assertClean();
});

test('removeLineupEntries: a post-kickoff departure keeps the current week and still takes the future', async () => {
  const fake = removalWorld({ nflTeam: 'MIN', kickedOff: ['MIN', 'KC'] });
  const client = await fake.connect();

  const result = await removeFor(client);
  client.release();

  assert.equal(result.removedCurrentWeek, false);
  // Same statement either way; the current week is spared by the bound
  // parameter, not by a different query. A starter dropped after his game
  // played keeps his row and therefore his points.
  const [remove] = fake.matching(/^DELETE FROM "lineup_entries"/);
  assert.deepEqual(remove.params, [10, 21, 2026, 9, false]);
  fake.assertClean();
});

test('removeLineupEntries: a tenure that BEGAN after kickoff leaves no row behind (#190)', async () => {
  // The tightening. Sparing on kickoff alone let a player picked up after
  // his game, then dropped, leave a current-week row standing - and a later
  // re-add would inherit it and be paid for a game that tenure never saw.
  // His game HAS kicked off, which is what used to be enough on its own.
  const fake = removalWorld({
    nflTeam: 'MIN',
    kickedOff: ['MIN', 'KC'],
    kickedOffBeforeTenure: ['MIN'], // his game had already started when he arrived
  });
  const client = await fake.connect();

  const result = await removeFor(client, { tenureStartedAt: new Date('2026-11-01T20:00:00Z') });
  client.release();

  assert.equal(result.removedCurrentWeek, true,
    'no row survives a tenure that never saw the game, so none can be inherited');
  fake.assertClean();
});

test('removeLineupEntries: an unknown tenure start drops the row rather than guessing', async () => {
  const fake = removalWorld({ nflTeam: 'MIN', kickedOff: ['MIN'] });
  const client = await fake.connect();

  const result = await removeFor(client, { tenureStartedAt: null });
  client.release();

  assert.equal(result.removedCurrentWeek, true);
  // A null means the caller genuinely could not read the departing row. The
  // schedule is then not consulted for the tenure question at all: there is
  // nothing to compare it against.
  assert.equal(fake.matching(/"kickoff_at" < \$3/).length, 0);
  fake.assertClean();
});

test('removeLineupEntries: omitting the tenure start is an error, not a default', async () => {
  // A seventh removal path that forgets to pass it must fail in its own
  // test rather than silently mis-score a settled week months later.
  const fake = removalWorld({ nflTeam: 'MIN', kickedOff: ['MIN'] });
  const client = await fake.connect();

  await assert.rejects(
    () => removeLineupEntries(client, { league: removalLeague, teamId: 10, playerId: 21 }),
    /requires tenureStartedAt/
  );
  client.release();
  fake.assertClean();
});

test('removeLineupEntries: the kickoff question is asked of the schedule, not of the caller', async () => {
  const fake = removalWorld({ nflTeam: 'MIN', kickedOff: [] });
  const client = await fake.connect();

  const now = new Date('2026-11-01T17:00:00Z');
  await removeFor(client, { now });
  client.release();

  // Pinned to the statement text, not merely to the shape the fake returns:
  // this is the SAME predicate the lineup lock uses (lockedNflTeams), so a
  // mutation of it has to fail here rather than pass because a fake answered
  // from its parameters. `kickoff_at <= now` and nothing looser.
  const [locked] = fake.matching(/FROM "nfl_games"/);
  assert.match(locked.text, /SELECT "nfl_team" FROM "nfl_games"/);
  assert.match(locked.text, /"season" = \$1 AND "week" = \$2 AND "kickoff_at" <= \$3/);
  assert.deepEqual(locked.params, [2026, 9, now]);
  fake.assertClean();
});

test('removeLineupEntries: a player with no game that week is not kicked off (bye and no-schedule control)', async () => {
  // The schedule has other teams playing and nothing for MIN: a bye, or a
  // week whose schedule has not been synced. Absence of a game row is
  // absence of a kickoff, exactly as the lineup lock reads it.
  const fake = removalWorld({ nflTeam: 'MIN', kickedOff: ['KC', 'BUF'] });
  const client = await fake.connect();

  const result = await removeFor(client);
  client.release();

  assert.equal(result.removedCurrentWeek, true);
  assert.equal(fake.matching(/^DELETE FROM "lineup_entries"/)[0].params[4], true);
  fake.assertClean();
});

test('removeLineupEntries: an empty schedule locks nothing at all', async () => {
  const fake = removalWorld({ nflTeam: 'MIN', kickedOff: [] });
  const client = await fake.connect();

  const result = await removeFor(client);
  client.release();

  assert.equal(result.removedCurrentWeek, true);
  fake.assertClean();
});

test('removeLineupEntries: a final week keeps its rows even for a player with no game (#106)', async () => {
  // The one case the kickoff question alone would get wrong: the team's
  // matchup is already final and the departing player had no game row that
  // week. #106 froze a final week as the record of the week as played, and a
  // DELETE is a write into it like any other. An incomplete schedule is the
  // real exposure here, not a true bye: a bye scores nothing either way.
  const fake = removalWorld({ nflTeam: 'MIN', kickedOff: [], final: true });
  const client = await fake.connect();

  const result = await removeFor(client);
  client.release();

  assert.equal(result.removedCurrentWeek, false);
  assert.deepEqual(fake.matching(/^DELETE FROM "lineup_entries"/)[0].params, [10, 21, 2026, 9, false]);
  fake.assertClean();
});

test('removeLineupEntries: a player with no players row is simply not locked', async () => {
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "players"/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [{ nfl_team: 'MIN' }] })],
    [/^DELETE FROM "lineup_entries"/, () => ({ rows: [], rowCount: 0 })],
  ]);
  const client = await fake.connect();

  const result = await removeFor(client);
  client.release();

  assert.equal(result.removedCurrentWeek, true);
  fake.assertClean();
});

// --- what the drop interrupted, recorded at drop time ------------------------

test('currentWeekEntry reads the slot and attestation the player holds right now', async () => {
  const fake = createFakePool([
    [/^SELECT "slot", "ir_attested" FROM "lineup_entries"/, () => ({
      rows: [{ slot: 'IR', ir_attested: true }],
    })],
  ]);
  const client = await fake.connect();

  const entry = await currentWeekEntry(client, { league: removalLeague, teamId: 10, playerId: 21 });
  client.release();

  assert.deepEqual(entry, { slot: 'IR', ir_attested: true });
  assert.deepEqual(fake.calls[0].params, [10, 21, 2026, 9]);
  fake.assertClean();
});

test('currentWeekEntry answers null when he has no current-week row', async () => {
  const fake = createFakePool([
    [/^SELECT "slot", "ir_attested" FROM "lineup_entries"/, () => ({ rows: [] })],
  ]);
  const client = await fake.connect();

  const entry = await currentWeekEntry(client, { league: removalLeague, teamId: 10, playerId: 21 });
  client.release();

  assert.equal(entry, null);
  fake.assertClean();
});

// --- undoing a drop replays what it interrupted ------------------------------

test('restoreInterruptedStash materializes the week, then puts him back in the recorded slot', async () => {
  const inserts = [];
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT "team_players"\."player_id"/, () => ({ rows: [{ player_id: 21, position: 'RB' }] })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({ rows: [] })],
    [/^SELECT "player_id", "slot"/, () => ({ rows: [] })],
    [/^INSERT INTO "lineup_entries"/, (text, params) => {
      inserts.push({ text, params });
      return { rows: [] };
    }],
  ]);
  const client = await fake.connect();

  await restoreInterruptedStash(client, {
    league: removalLeague, teamId: 10, playerId: 21, slot: 'IR', irAttested: true,
  });
  client.release();

  // Materialization first (a complete week, never a lone row the next
  // copy-forward would read as its source), then the recorded slot written
  // over whatever it left him in.
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts[0].params, [5, 10, 21, 2026, 9, 'BENCH', false]);
  assert.deepEqual(inserts[1].params, [5, 10, 21, 2026, 9, 'IR', true]);
  assert.match(
    inserts[1].text,
    /ON CONFLICT \("team_id", "season", "week", "player_id"\) DO UPDATE SET "slot" = EXCLUDED\."slot", "ir_attested" = EXCLUDED\."ir_attested"/
  );
  fake.assertClean();
});

test('restoreInterruptedStash still writes the row when the week has gone final', async () => {
  // The one write a final week does not refuse (#106). Capacity has already
  // been credited for this stash by the time the restore runs, so declining
  // to write it would leave the player on a roster that is only legal
  // because of a stash that does not exist - reachable when a matchup is
  // finalized between the drop and the undo. It cannot change a settled
  // score: the restored slot is always IR, and IR never scores.
  const inserts = [];
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [{ 1: 1 }] })],
    [/^INSERT INTO "lineup_entries"/, (text, params) => {
      inserts.push(params);
      return { rows: [] };
    }],
  ]);
  const client = await fake.connect();

  await restoreInterruptedStash(client, {
    league: removalLeague, teamId: 10, playerId: 21, slot: 'IR', irAttested: true,
  });
  client.release();

  // materializeLineup still refuses the frozen week, so the only write is
  // the restore itself.
  assert.deepEqual(inserts, [[5, 10, 21, 2026, 9, 'IR', true]]);
  fake.assertClean();
});
