const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const client = require('../../scripts/backtest/lib/snapshotClient');
const surface = require('../../scripts/backtest/lib/sqlSurface');
const asOf = require('../../scripts/backtest/lib/asOfView');
const store = require('../../scripts/backtest/lib/snapshotStore');
const { normalizeTeamKey } = require('../services/projectionFeatures');

const { MODES } = client;
const sqlFor = (name) => surface.SQL_BY_NAME.get(name).text;

/**
 * Realistic pg type OIDs, because the whole point of off mode's rehydration is
 * that `kickoff_at` comes back as a Date and `adp` as a string. A fixture with
 * made-up OIDs would test nothing.
 */
const OID = { int4: 23, int8: 20, text: 25, numeric: 1700, jsonb: 3802, timestamptz: 1184, bool: 16 };

function fields(spec) {
  return Object.entries(spec).map(([name, dataTypeID]) => ({ name, dataTypeID }));
}

const PLAYERS = [
  { id: 1, name: 'Aaron QB', position: 'QB', nfl_team: 'KC', injury_status: null, injury_detail: null, adp: '1.5', team_key: 'KC' },
  { id: 2, name: 'Bella RB', position: 'RB', nfl_team: 'WSH', injury_status: 'Q', injury_detail: 'knee', adp: '2.5', team_key: 'WAS' },
  { id: 3, name: 'Cara WR', position: 'WR', nfl_team: 'LAR', injury_status: null, injury_detail: null, adp: null, team_key: 'LAR' },
];

const PLAYER_STATS = [
  { player_id: 1, season: 2025, week: 1, stats: { passingYards: 300, gameTeam: 'KC' } },
  { player_id: 1, season: 2025, week: 2, stats: { passingYards: 250, gameTeam: 'KC' } },
  { player_id: 2, season: 2025, week: 1, stats: { rushingYards: 90, gameTeam: 'WSH' } },
  // Week 2 for player 2 is AFTER a trade: gameTeam says LAR, not his current WSH.
  { player_id: 2, season: 2025, week: 2, stats: { rushingYards: 40, gameTeam: 'LAR' } },
  { player_id: 3, season: 2024, week: 5, stats: { receptions: 6 } }, // prior season, no gameTeam
  // AT the target week (3) and AFTER it (9). Neither may ever be served: the
  // cutoff is strictly-before, and a row at week W is the poisoning case.
  { player_id: 1, season: 2025, week: 3, stats: { passingYards: 888, gameTeam: 'KC' } },
  { player_id: 1, season: 2025, week: 9, stats: { passingYards: 999 } },
];

const PLAYER_SEASON_STATS = [
  { player_id: 1, season: 2024, games_played: 17, stats: { passingYards: 4000 }, fantasy_points: '300.5' },
  { player_id: 1, season: 2025, games_played: 3, stats: {}, fantasy_points: '50.0' },
];

function games(season) {
  const kickoff = (week) => `${season}-09-${String(week).padStart(2, '0')}T17:00:00.000Z`;
  const row = (week, team, opponent, teamKey, opponentKey) => ({
    season, week, nfl_team: team, opponent, kickoff_at: kickoff(week),
    game_key: `${season}-${week}-${team}-${opponent}`,
    // Production's 2024/2025 state: orientation is NULL in the database.
    home_away: null, neutral_site: null,
    venue: null, roof: null, surface: null, latitude: null, longitude: null, rest_days: null,
    team_key: teamKey, opponent_key: opponentKey,
  });
  return [
    row(1, 'KC', 'WSH', 'KC', 'WAS'), row(1, 'WSH', 'KC', 'WAS', 'KC'),
    row(2, 'LAR', 'KC', 'LAR', 'KC'), row(2, 'KC', 'LAR', 'KC', 'LAR'),
    row(2, 'WSH', 'BUF', 'WAS', 'BUF'), row(2, 'BUF', 'WSH', 'BUF', 'WAS'),
    // The TARGET week's own games. They belong in targetWeekSchedule and must
    // be excluded from every prior-weeks read, including the defense-game
    // count, whose `week < $2` is a season-to-date count.
    row(3, 'KC', 'BUF', 'KC', 'BUF'), row(3, 'BUF', 'KC', 'BUF', 'KC'),
  ];
}

const OVERLAY = [
  { season: 2025, week: 1, team_key: 'KC', opponent_key: 'WAS', source_team: 'KC', home_away: 'home', neutral_site: false, game_id: 'g1' },
  { season: 2025, week: 1, team_key: 'WAS', opponent_key: 'KC', source_team: 'WAS', home_away: 'away', neutral_site: false, game_id: 'g1' },
  { season: 2025, week: 2, team_key: 'LAR', opponent_key: 'KC', source_team: 'LA', home_away: 'home', neutral_site: true, game_id: 'g2' },
  { season: 2025, week: 2, team_key: 'KC', opponent_key: 'LAR', source_team: 'KC', home_away: 'away', neutral_site: true, game_id: 'g2' },
  { season: 2025, week: 2, team_key: 'WAS', opponent_key: 'BUF', source_team: 'WAS', home_away: 'home', neutral_site: false, game_id: 'g3' },
  { season: 2025, week: 2, team_key: 'BUF', opponent_key: 'WAS', source_team: 'BUF', home_away: 'away', neutral_site: false, game_id: 'g3' },
  // The TARGET week's teams. 2025 is an evaluated season, so the overlay has to
  // reach them or the client refuses to construct - that refusal is the B1 gate.
  { season: 2025, week: 3, team_key: 'KC', opponent_key: 'BUF', source_team: 'KC', home_away: 'home', neutral_site: false, game_id: 'g4' },
  { season: 2025, week: 3, team_key: 'BUF', opponent_key: 'KC', source_team: 'BUF', home_away: 'away', neutral_site: false, game_id: 'g4' },
];

const MANIFEST = {
  studyId: 'pit-sweep-2024-2025',
  quarantineFromSeason: 2026,
  seasons: [2024, 2025],
  scheduleSeasons: [2023, 2024, 2025],
  schemaFingerprint: {
    players: { fields: fields({ id: OID.int4, name: OID.text, position: OID.text, nfl_team: OID.text, injury_status: OID.text, injury_detail: OID.text, adp: OID.numeric, team_key: OID.text }) },
    player_stats: { fields: fields({ player_id: OID.int4, season: OID.int4, week: OID.int4, stats: OID.jsonb }) },
    player_season_stats: { fields: fields({ player_id: OID.int4, season: OID.int4, games_played: OID.int4, stats: OID.jsonb, fantasy_points: OID.numeric }) },
    nfl_games_2025: { fields: fields({ season: OID.int4, week: OID.int4, nfl_team: OID.text, opponent: OID.text, kickoff_at: OID.timestamptz, game_key: OID.text, home_away: OID.text, neutral_site: OID.bool, venue: OID.text, roof: OID.text, surface: OID.text, latitude: OID.numeric, longitude: OID.numeric, rest_days: OID.int4, team_key: OID.text, opponent_key: OID.text }) },
    player_name_rank: { fields: fields({ id: OID.int4, name: OID.text, rank: OID.int8 }) },
  },
};

function makeSnapshot() {
  const nflGamesBySeason = new Map([[2023, []], [2024, games(2024)], [2025, games(2025)]]);
  return client.assembleSnapshot({
    manifest: MANIFEST,
    players: PLAYERS,
    playerStats: PLAYER_STATS,
    playerSeasonStats: PLAYER_SEASON_STATS,
    nflGamesBySeason,
  });
}

/** The reconstruction a `reconstructed`-mode client needs. */
function makeReconstruction({ policy = asOf.INJURY_POLICIES.PRIMARY } = {}) {
  const rosterIndex = asOf.buildRosterIndex([
    { season: 2025, week: 1, team: 'KC', position: 'QB', status: 'ACT', gsis_id: '00-0000001', full_name: 'Aaron QB', game_type: 'REG' },
    { season: 2025, week: 2, team: 'KC', position: 'QB', status: 'ACT', gsis_id: '00-0000001', full_name: 'Aaron QB', game_type: 'REG' },
    { season: 2025, week: 3, team: 'KC', position: 'QB', status: 'ACT', gsis_id: '00-0000001', full_name: 'Aaron QB', game_type: 'REG' },
    // Player 2 is on WAS in week 1 and LA in week 2: a trade.
    { season: 2025, week: 1, team: 'WAS', position: 'RB', status: 'ACT', gsis_id: '00-0000002', full_name: 'Bella RB', game_type: 'REG' },
    { season: 2025, week: 2, team: 'LA', position: 'RB', status: 'ACT', gsis_id: '00-0000002', full_name: 'Bella RB', game_type: 'REG' },
    { season: 2025, week: 3, team: 'LA', position: 'RB', status: 'ACT', gsis_id: '00-0000002', full_name: 'Bella RB', game_type: 'REG' },
    // Player 3 is on reserve in week 3: excluded from the primary cohort.
    { season: 2025, week: 3, team: 'LA', position: 'WR', status: 'RES', gsis_id: '00-0000003', full_name: 'Cara WR', game_type: 'REG' },
  ]);
  const injuryIndex = asOf.buildInjuryIndex([
    { season: 2025, week: 3, gsis_id: '00-0000001', report_status: 'Doubtful', game_type: 'REG' },
  ], { hasDateModified: false });

  return {
    rosterIndex,
    injuryIndex,
    policy,
    normalizeTeamKey,
    overlayRows: OVERLAY,
    gsisByPlayerId: new Map([[1, '00-0000001'], [2, '00-0000002'], [3, '00-0000003']]),
    viewFor: ({ season, week, gsisId }) => asOf.reconstructPlayerWeek({
      rosterIndex, injuryIndex, policy, season, week, gsisId, normalizeTeamKey,
    }),
  };
}

function offClient({ season = 2025, week = 3 } = {}) {
  return client.createSnapshotClient({ snapshot: makeSnapshot(), season, week, mode: MODES.OFF });
}

function reconstructedClient({ season = 2025, week = 3, policy } = {}) {
  return client.createSnapshotClient({
    snapshot: makeSnapshot(), season, week, mode: MODES.RECONSTRUCTED,
    reconstruction: makeReconstruction({ policy }),
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

test('the client answers exactly the 8 production queries and throws on a ninth', async () => {
  const c = offClient();
  for (const entry of surface.SQL_SURFACE) {
    const params = {
      playersById: [[1, 2, 3]],
      priorPlayerStats: [[1, 2, 3], 2023, 2025, 3],
      priorPlayerSeasonStats: [[1, 2, 3], 2025],
      targetWeekSchedule: [2025, 3],
      historyWindowSchedule: [2023, 2025, 3],
      leagueScan: [2025, 3, ['QB', 'RB', 'WR'], 60000],
      defenseGameCount: [2025, 3],
      byeWeeks: [2025, ['KC'], 18],
    }[entry.name];
    const result = await c.query(entry.text, params);
    assert.ok(Array.isArray(result.rows), `${entry.name} returned rows`);
  }
  assert.equal(c.counters.queries, 8);

  await assert.rejects(
    () => c.query('SELECT * FROM "projection_runs"', []),
    /unknown SQL.*will not guess at a ninth/s
  );
  // Whitespace-only differences are the SAME query: re-indenting production is
  // not a behaviour change.
  const reindented = sqlFor('defenseGameCount').replace(/\s+/g, '\n   ');
  await c.query(reindented, [2025, 3]);
  // A real edit is a different query.
  await assert.rejects(
    () => c.query(sqlFor('defenseGameCount').replace('COUNT(*)', 'COUNT(1)'), [2025, 3]),
    /unknown SQL/
  );
});

// ---------------------------------------------------------------------------
// {season, week, mode} binding
// ---------------------------------------------------------------------------

test('a client bound to one week refuses a query parameterized for another', async () => {
  const c = offClient({ season: 2025, week: 3 });
  await assert.rejects(() => c.query(sqlFor('targetWeekSchedule'), [2025, 9]),
    /bound to week 3 but the query asks for 9/);
  await assert.rejects(() => c.query(sqlFor('targetWeekSchedule'), [2024, 3]),
    /bound to season 2025 but the query asks for 2024/);
  await assert.rejects(() => c.query(sqlFor('priorPlayerStats'), [[1], 2023, 2025, 4]),
    /bound to week 3 but the query asks for 4/);
  // The history window's own lower bound is checked too: a wrong firstSeason
  // would silently widen or narrow the history the model sees.
  await assert.rejects(() => c.query(sqlFor('historyWindowSchedule'), [2020, 2025, 3]),
    /history window starts at 2020, expected 2023/);
  await assert.rejects(() => c.query(sqlFor('priorPlayerSeasonStats'), [[1], 2024]),
    /bound to season 2025 but the query asks for 2024/);
});

test('byeWeeks is season-bound but deliberately NOT week-bound', async () => {
  // A bye is a gap in the schedule, not a result, so reading week 18 while
  // projecting week 3 leaks nothing - and computeByeWeeks always reads 1..18.
  const c = offClient({ season: 2025, week: 3 });
  const result = await c.query(sqlFor('byeWeeks'), [2025, ['KC'], 18]);
  assert.ok(result.rows.length > 0);
  assert.equal(surface.SQL_BY_NAME.get('byeWeeks').binding.week, undefined);
  await assert.rejects(() => c.query(sqlFor('byeWeeks'), [2024, ['KC'], 18]),
    /bound to season 2025 but the query asks for 2024/);
});

test('the mode is a closed set and reconstructed mode demands EVERY input, by name', () => {
  const snapshot = makeSnapshot();
  assert.throws(() => client.createSnapshotClient({ snapshot, season: 2025, week: 3, mode: 'live' }),
    /unknown snapshot mode "live"/);
  assert.throws(() => client.createSnapshotClient({
    snapshot, season: 2025, week: 3, mode: MODES.RECONSTRUCTED,
  }), /reconstructed mode requires a reconstruction/);
  assert.throws(() => client.createSnapshotClient({ snapshot, season: 2025.5, week: 3, mode: MODES.OFF }),
    /requires an integer season and week/);

  // EVERY required key, checked one at a time by removing it from a complete
  // reconstruction. `overlayRows` and `viewFor` are the two that matter most:
  // a missing overlayRows used to construct happily and serve zero orientation,
  // turning the whole homeAway factor off with no error and no counter.
  const complete = makeReconstruction();
  for (const key of ['rosterIndex', 'normalizeTeamKey', 'gsisByPlayerId', 'policy',
    'overlayRows', 'viewFor']) {
    const { [key]: removed, ...missing } = complete;
    assert.throws(() => client.createSnapshotClient({
      snapshot, season: 2025, week: 3, mode: MODES.RECONSTRUCTED, reconstruction: missing,
    }), new RegExp(`requires reconstruction\\.${key}`), `omitting ${key} must throw by name`);
  }
});

test('an EXPLICIT empty overlay is legal, but not for an evaluated season', () => {
  // `[]` is truthy, so deliberately declaring "this fixture has no orientation"
  // still constructs - the PG contract fixtures rely on that. What the gate
  // catches is an evaluated season whose overlay does not reach the target week.
  const outsideStudy = client.assembleSnapshot({
    manifest: { ...MANIFEST, seasons: [] }, // no evaluated seasons: a pure SQL fixture
    players: PLAYERS,
    playerStats: PLAYER_STATS,
    playerSeasonStats: PLAYER_SEASON_STATS,
    nflGamesBySeason: new Map([[2023, []], [2024, games(2024)], [2025, games(2025)]]),
  });
  const permitted = client.createSnapshotClient({
    snapshot: outsideStudy,
    season: 2025,
    week: 3,
    mode: MODES.RECONSTRUCTED,
    reconstruction: { ...makeReconstruction(), overlayRows: [] },
  });
  assert.equal(permitted.mode, MODES.RECONSTRUCTED);

  // The same empty overlay against an EVALUATED season is refused.
  assert.throws(() => client.createSnapshotClient({
    snapshot: makeSnapshot(), // manifest.seasons includes 2025
    season: 2025,
    week: 3,
    mode: MODES.RECONSTRUCTED,
    reconstruction: { ...makeReconstruction(), overlayRows: [] },
  }), /does not cover 2 of 2 scheduled team\(s\) \(KC, BUF\).*homeAway factor off for this week/s);

  // So is a PARTIAL overlay that covers other weeks but not the target one -
  // the realistic version of the mistake.
  assert.throws(() => client.createSnapshotClient({
    snapshot: makeSnapshot(),
    season: 2025,
    week: 3,
    mode: MODES.RECONSTRUCTED,
    reconstruction: {
      ...makeReconstruction(),
      overlayRows: OVERLAY.filter((r) => r.week !== 3),
    },
  }), /does not cover 2 of 2 scheduled team\(s\)/);

  // And one that covers only half the week's teams.
  assert.throws(() => client.createSnapshotClient({
    snapshot: makeSnapshot(),
    season: 2025,
    week: 3,
    mode: MODES.RECONSTRUCTED,
    reconstruction: {
      ...makeReconstruction(),
      overlayRows: OVERLAY.filter((r) => !(r.week === 3 && r.team_key === 'BUF')),
    },
  }), /does not cover 1 of 2 scheduled team\(s\) \(BUF\)/);
});

test('omissions are counted PER CAUSE, with DEF given its own expected-by-design reason', async () => {
  // Four different situations hide behind "excluded", and the report has to
  // tell them apart (prereg 4.1). A DEF unit has no GSIS id because it is not a
  // person; ~32 of those a week must not look like a roster-coverage problem.
  const withDef = client.assembleSnapshot({
    manifest: MANIFEST,
    players: [
      ...PLAYERS,
      { id: 4, name: 'Kansas City Chiefs', position: 'DEF', nfl_team: 'Kansas City Chiefs', injury_status: null, injury_detail: null, adp: null, team_key: 'KC' },
      { id: 5, name: 'Unmapped Guy', position: 'WR', nfl_team: 'KC', injury_status: null, injury_detail: null, adp: null, team_key: 'KC' },
      { id: 6, name: 'No Roster Row', position: 'TE', nfl_team: 'KC', injury_status: null, injury_detail: null, adp: null, team_key: 'KC' },
    ],
    playerStats: PLAYER_STATS,
    playerSeasonStats: PLAYER_SEASON_STATS,
    nflGamesBySeason: new Map([[2023, []], [2024, games(2024)], [2025, games(2025)]]),
  });
  const base = makeReconstruction();
  const c = client.createSnapshotClient({
    snapshot: withDef,
    season: 2025,
    week: 3,
    mode: MODES.RECONSTRUCTED,
    reconstruction: {
      ...base,
      // id 6 maps to a gsis id with no week-3 roster row; id 5 maps to nothing.
      gsisByPlayerId: new Map([...base.gsisByPlayerId, [6, '00-0000006']]),
    },
  });
  const players = await c.query(sqlFor('playersById'), [[1, 2, 3, 4, 5, 6]]);

  assert.deepEqual(players.rows.map((r) => r.id).sort(), [1, 2], 'only the two cohort members');
  assert.deepEqual(c.counters.playersOmittedByReason, {
    'status-class-reserve': 1, // player 3, on reserve in week 3
    'def-synthesized-in-phase-3': 1, // player 4, a defence
    'no-gsis-mapping': 1, // player 5, genuinely unmapped
    'no-roster-row': 1, // player 6, mapped but absent that week
  });
  // The scalar total is kept for compatibility and still agrees.
  assert.equal(c.counters.playersOmittedNoReconstruction, 4);
});

// ---------------------------------------------------------------------------
// The input cutoff
// ---------------------------------------------------------------------------

test('no query can reach the target week or beyond', async () => {
  const c = offClient({ season: 2025, week: 3 });
  const stats = await c.query(sqlFor('priorPlayerStats'), [[1, 2, 3], 2023, 2025, 3]);
  for (const row of stats.rows) {
    assert.ok(row.season < 2025 || row.week < 3,
      `row ${row.season} w${row.week} is not strictly before the target`);
  }
  // The week-3 (target) and week-9 (future) rows exist in the snapshot and
  // must never be served for a week-3 target.
  assert.equal(stats.rows.some((r) => r.season === 2025 && r.week === 3), false);
  assert.equal(stats.rows.some((r) => r.week === 9), false);
  // ORDER BY season DESC, week DESC.
  const keys = stats.rows.map((r) => `${r.season}:${String(r.week).padStart(2, '0')}`);
  assert.deepEqual(keys, [...keys].sort().reverse());

  const history = await c.query(sqlFor('historyWindowSchedule'), [2023, 2025, 3]);
  for (const row of history.rows) {
    assert.ok(row.season < 2025 || row.week < 3);
  }
  const seasonStats = await c.query(sqlFor('priorPlayerSeasonStats'), [[1], 2025]);
  assert.deepEqual(seasonStats.rows.map((r) => r.season), [2024], 'season < target only');
});

test('the tie order in priorPlayerStats is immaterial to what a consumer sees', async () => {
  // PostgreSQL leaves rows tied on (season, week) unordered, so the emulation
  // picks a deterministic tiebreak. This proves no consumer can observe it:
  // grouping by player and sorting by (season, week) is identical either way.
  const forward = client.orderSeasonWeekDesc(PLAYER_STATS);
  const shuffled = client.orderSeasonWeekDesc([...PLAYER_STATS].reverse());
  const groupByPlayer = (rows) => {
    const byPlayer = new Map();
    for (const row of rows) {
      if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, []);
      byPlayer.get(row.player_id).push(`${row.season}:${row.week}`);
    }
    return [...byPlayer.entries()].sort((a, b) => a[0] - b[0]);
  };
  assert.deepEqual(groupByPlayer(forward), groupByPlayer(shuffled));
});

// ---------------------------------------------------------------------------
// Type rehydration
// ---------------------------------------------------------------------------

test('off mode rehydrates every column to the JS type the pg driver produced', async () => {
  const c = offClient();
  const schedule = await c.query(sqlFor('targetWeekSchedule'), [2025, 3]);
  const players = await c.query(sqlFor('playersById'), [[1, 2, 3]]);
  const stats = await c.query(sqlFor('priorPlayerStats'), [[1], 2023, 2025, 3]);

  // The one that matters most: a timestamptz must be a Date, not the ISO string
  // the snapshot stores. `inputCutoff` is built from these.
  const withKickoff = (await offClient({ week: 2 }).query(sqlFor('targetWeekSchedule'), [2025, 2])).rows[0];
  assert.ok(withKickoff.kickoff_at instanceof Date, 'kickoff_at is a Date');
  assert.equal(withKickoff.kickoff_at.toISOString(), '2025-09-02T17:00:00.000Z');

  // numeric comes back as a STRING (pg's default), int4 as a number.
  const aaron = players.rows.find((r) => r.id === 1);
  assert.equal(typeof aaron.adp, 'string');
  assert.equal(aaron.adp, '1.5');
  assert.equal(typeof aaron.id, 'number');
  assert.equal(players.rows.find((r) => r.id === 3).adp, null, 'null stays null');

  // jsonb stays an object; bool stays a boolean or null.
  assert.equal(typeof stats.rows[0].stats, 'object');
  // The target week's own schedule IS served - that is what targetWeekSchedule
  // is for; only the prior-weeks reads exclude it.
  assert.equal(schedule.rows.length, 2);
  assert.equal(schedule.rows.every((r) => r.kickoff_at instanceof Date), true);
});

test('an unrecorded column or an unknown pg type fails closed', () => {
  const types = client.buildColumnTypes(MANIFEST);
  assert.equal(types.get('kickoff_at'), OID.timestamptz);
  assert.equal(types.get('games'), 23, 'COUNT(*)::int is a computed int4');
  assert.throws(() => client.rehydrateRow({ mystery: 1 }, types), /no recorded pg type for column "mystery"/);
  assert.throws(() => client.rehydrateValue('x', 99999, { column: 'weird' }),
    /has pg type OID 99999, which has no rehydration rule/);
  // A relation disagreeing with another about a column's type is a schema move.
  assert.throws(() => client.buildColumnTypes({
    schemaFingerprint: {
      a: { fields: [{ name: 'season', dataTypeID: 23 }] },
      b: { fields: [{ name: 'season', dataTypeID: 25 }] },
    },
  }), /column "season" is type 23 in a but 25 in b/);
});

test('rehydration converts, rather than passing through, whatever the JSON held', () => {
  assert.equal(client.rehydrateValue('2025-01-02T03:04:05.000Z', 1184).toISOString(),
    '2025-01-02T03:04:05.000Z');
  assert.equal(client.rehydrateValue(12, 20), '12', 'int8 is a string in pg');
  assert.equal(client.rehydrateValue('12', 23), 12, 'int4 is a number');
  assert.equal(client.rehydrateValue('t', 16), true);
  assert.equal(client.rehydrateValue(null, 1184), null);
  assert.deepEqual(client.rehydrateValue({ a: 1 }, 3802), { a: 1 });
  assert.throws(() => client.rehydrateValue('abc', 23, { column: 'week' }), /holds "abc", not a number/);
});

// ---------------------------------------------------------------------------
// off vs reconstructed
// ---------------------------------------------------------------------------

test('off mode serves the captured rows untouched, including production null orientation', async () => {
  const c = offClient({ week: 3 });
  const history = await c.query(sqlFor('historyWindowSchedule'), [2023, 2025, 3]);
  assert.ok(history.rows.length > 0);
  for (const row of history.rows) {
    assert.equal(row.home_away, null, 'off mode must reproduce the database\'s null orientation');
    assert.equal(row.neutral_site, null);
  }
  const players = await c.query(sqlFor('playersById'), [[1, 2, 3]]);
  assert.equal(players.rows.length, 3);
  assert.equal(players.rows.find((r) => r.id === 2).injury_status, 'Q', 'today\'s stored status');
  assert.equal(players.rows.find((r) => r.id === 2).team_key, 'WAS', 'today\'s team');
});

test('reconstructed mode patches orientation, per-week team and the injury policy', async () => {
  const c = reconstructedClient({ week: 3 });
  const history = await c.query(sqlFor('historyWindowSchedule'), [2023, 2025, 3]);
  const week2Lar = history.rows.find((r) => r.season === 2025 && r.week === 2 && r.team_key === 'LAR');
  assert.equal(week2Lar.home_away, 'home', 'the overlay supplied an orientation the DB lacks');
  assert.equal(week2Lar.neutral_site, true, 'and the neutral flag that removes it from the factor');
  const week1Kc = history.rows.find((r) => r.season === 2025 && r.week === 1 && r.team_key === 'KC');
  assert.equal(week1Kc.home_away, 'home');
  assert.equal(week1Kc.neutral_site, false);

  const players = await c.query(sqlFor('playersById'), [[1, 2, 3]]);
  const bella = players.rows.find((r) => r.id === 2);
  // The roster file is the authority: in week 3 he is on LA, not today's WSH.
  assert.equal(bella.team_key, 'LAR');
  assert.equal(bella.nfl_team, 'LA');
  // Primary injury policy: null for everyone, whatever the stored column says.
  assert.equal(bella.injury_status, null);
  assert.equal(players.rows.find((r) => r.id === 1).injury_status, null);
  // Player 3 is on reserve in week 3, so he is not in the cohort and the client
  // omits him exactly as if the database had no row - counted, never guessed.
  assert.equal(players.rows.some((r) => r.id === 3), false);
  assert.equal(c.counters.playersOmittedNoReconstruction, 1);
});

test('the injury policy the client serves is the one it was constructed with', async () => {
  const c = reconstructedClient({ week: 3, policy: asOf.INJURY_POLICIES.S2_FINAL_2025 });
  const players = await c.query(sqlFor('playersById'), [[1]]);
  assert.equal(players.rows[0].injury_status, 'D', 'the S2 sensitivity serves the final report status');
});

test('the reconstructed league scan attributes rows by gameTeam and roster position', async () => {
  const c = reconstructedClient({ week: 3 });
  const scan = await c.query(sqlFor('leagueScan'), [2025, 3, ['QB', 'RB'], 60000]);

  // Player 2's week-2 row was earned for LAR (gameTeam), not for the WSH he is
  // on in today's players table. Off mode joins through today's team and gets
  // his WAS game; reconstructed mode joins through gameTeam and gets the LAR
  // one. That difference is the entire point of the reconstruction.
  const bellaWeek2 = scan.rows.find((r) => r.player_id === 2 && r.week === 2);
  assert.equal(bellaWeek2.defense, 'KC', 'LAR played KC in week 2');
  assert.equal(bellaWeek2.neutral_site, true, 'and the overlay says that game was neutral');

  const offScan = await offClient({ week: 3 }).query(sqlFor('leagueScan'), [2025, 3, ['QB', 'RB'], 60000]);
  const offBellaWeek2 = offScan.rows.find((r) => r.player_id === 2 && r.week === 2);
  assert.equal(offBellaWeek2.defense, 'BUF', 'off mode resolves through today\'s team, WAS, who played BUF');

  // ORDER BY player_id, week holds in both modes.
  for (const rows of [scan.rows, offScan.rows]) {
    const keys = rows.map((r) => `${r.player_id}:${r.week}`);
    assert.deepEqual(keys, [...keys].sort());
  }
});

test('a scan row with no gameTeam keeps the LEFT JOIN nulls and is counted', async () => {
  const c = client.createSnapshotClient({
    snapshot: client.assembleSnapshot({
      manifest: MANIFEST,
      players: PLAYERS,
      playerStats: [{ player_id: 1, season: 2025, week: 1, stats: { passingYards: 10 } }],
      playerSeasonStats: [],
      nflGamesBySeason: new Map([[2023, []], [2024, []], [2025, games(2025)]]),
    }),
    season: 2025, week: 3, mode: MODES.RECONSTRUCTED, reconstruction: makeReconstruction(),
  });
  const scan = await c.query(sqlFor('leagueScan'), [2025, 3, ['QB'], 60000]);
  assert.equal(scan.rows.length, 1);
  assert.equal(scan.rows[0].defense, null, 'unattributable, so no defense');
  assert.equal(scan.rows[0].home_away, null);
  assert.equal(c.counters.scanRowsUnattributed, 1, 'and it is counted, not hidden');
});

test('the scan never reaches the target week, in either mode', async () => {
  // `ps.week < $2`, not `<=`. The fixture holds a week-3 stat row precisely so
  // that a relaxed comparison would show up here rather than in production.
  for (const c of [offClient({ week: 3 }), reconstructedClient({ week: 3 })]) {
    const scan = await c.query(sqlFor('leagueScan'), [2025, 3, ['QB', 'RB', 'WR'], 60000]);
    assert.ok(scan.rows.length > 0, 'the scan returned something to be wrong about');
    assert.equal(scan.rows.some((r) => r.week >= 3), false,
      `${c.mode} mode served a row at or after the target week`);
  }
});

test('reconstructed mode takes the position from the ROSTER, not from today\'s players row', async () => {
  // Today's `players.position` says QB for player 1. The roster file says he
  // was an RB that week. The reconstruction must believe the roster: using
  // today's position is precisely the poisoning this study exists to remove,
  // and it is invisible unless the two disagree.
  const rosterIndex = asOf.buildRosterIndex([
    { season: 2025, week: 1, team: 'KC', position: 'RB', status: 'ACT', gsis_id: '00-0000001', full_name: 'Aaron QB', game_type: 'REG' },
    { season: 2025, week: 2, team: 'KC', position: 'RB', status: 'ACT', gsis_id: '00-0000001', full_name: 'Aaron QB', game_type: 'REG' },
    { season: 2025, week: 3, team: 'KC', position: 'RB', status: 'ACT', gsis_id: '00-0000001', full_name: 'Aaron QB', game_type: 'REG' },
  ]);
  const c = client.createSnapshotClient({
    snapshot: makeSnapshot(),
    season: 2025,
    week: 3,
    mode: MODES.RECONSTRUCTED,
    reconstruction: {
      rosterIndex,
      policy: asOf.INJURY_POLICIES.PRIMARY,
      normalizeTeamKey,
      overlayRows: OVERLAY,
      gsisByPlayerId: new Map([[1, '00-0000001']]),
      viewFor: ({ season, week, gsisId }) => asOf.reconstructPlayerWeek({
        rosterIndex, season, week, gsisId, normalizeTeamKey,
      }),
    },
  });

  // Scanning for QB finds nothing: he was not a QB those weeks.
  const asQb = await c.query(sqlFor('leagueScan'), [2025, 3, ['QB'], 60000]);
  assert.deepEqual(asQb.rows, [], 'today\'s QB must not answer a QB scan when the roster says RB');
  // Scanning for RB finds him, labelled RB.
  const asRb = await c.query(sqlFor('leagueScan'), [2025, 3, ['RB'], 60000]);
  assert.ok(asRb.rows.length > 0);
  assert.equal(asRb.rows.every((r) => r.position === 'RB'), true);
  assert.equal(asRb.rows.every((r) => r.player_id === 1), true);

  // The players row he is served under says RB too.
  const players = await c.query(sqlFor('playersById'), [[1]]);
  assert.equal(players.rows[0].position, 'RB');

  // Off mode, on the same snapshot, still says QB - so the difference is the
  // reconstruction's doing and not the fixture's.
  const off = await offClient({ week: 3 }).query(sqlFor('leagueScan'), [2025, 3, ['QB'], 60000]);
  assert.ok(off.rows.length > 0);
  assert.equal(off.rows.every((r) => r.position === 'QB'), true);
});

test('the scan honours the position filter and the LIMIT', async () => {
  const c = offClient({ week: 3 });
  const qbOnly = await c.query(sqlFor('leagueScan'), [2025, 3, ['QB'], 60000]);
  assert.equal(qbOnly.rows.every((r) => r.position === 'QB'), true);
  const limited = await c.query(sqlFor('leagueScan'), [2025, 3, ['QB', 'RB', 'WR'], 1]);
  assert.equal(limited.rows.length, 1, 'LIMIT truncates');
  // The truncation is a whole-player prefix because of ORDER BY player_id, week.
  assert.equal(limited.rows[0].player_id, 1);
});

test('the defense-game count and bye query read the schedule the same way SQL does', async () => {
  const c = offClient({ season: 2025, week: 3 });
  const counts = await c.query(sqlFor('defenseGameCount'), [2025, 3]);
  const byTeam = Object.fromEntries(counts.rows.map((r) => [r.team, r.games]));
  // Weeks 1 and 2 only: KC played both, BUF only week 2. The week-3 games in
  // the fixture are the TARGET week and are excluded by `week < $2` - counting
  // them would let the target week's own schedule into a season-to-date figure.
  assert.equal(byTeam.KC, 2);
  assert.equal(byTeam.BUF, 1);
  assert.equal(typeof counts.rows[0].games, 'number', 'COUNT(*)::int is an int4');

  const byes = await c.query(sqlFor('byeWeeks'), [2025, ['KC'], 18]);
  // byeWeeks reads the WHOLE regular season, target week included: a bye is a
  // gap in the schedule, not a result.
  assert.deepEqual(byes.rows.map((r) => r.week).sort(), [1, 2, 3]);

  // DEF units are stored under a FULL TEAM NAME, and `computeByeWeeks` is
  // called with `players.nfl_team` values - so the full name has to fold to the
  // same key the abbreviation does. Off mode does that by LOOKUP of the
  // database's own `team_key`, never by recomputing the normalization: that
  // value IS what fn_normalize_nfl_team returned during the oracle run.
  const withDef = client.createSnapshotClient({
    snapshot: client.assembleSnapshot({
      manifest: MANIFEST,
      players: [...PLAYERS, {
        id: 4, name: 'Kansas City Chiefs', position: 'DEF', nfl_team: 'Kansas City Chiefs',
        injury_status: null, injury_detail: null, adp: null, team_key: 'KC',
      }],
      playerStats: PLAYER_STATS,
      playerSeasonStats: PLAYER_SEASON_STATS,
      nflGamesBySeason: new Map([[2023, []], [2024, games(2024)], [2025, games(2025)]]),
    }),
    season: 2025, week: 3, mode: MODES.OFF,
  });
  const defByes = await withDef.query(sqlFor('byeWeeks'), [2025, ['Kansas City Chiefs'], 18]);
  assert.deepEqual(defByes.rows.map((r) => r.week).sort(), [1, 2, 3],
    'the full team name resolves to the same schedule rows the abbreviation does');
  assert.equal(defByes.rows[0].nfl_team, 'Kansas City Chiefs',
    'and the result is keyed by the CALLER\'s vocabulary, as the SQL returns t.nfl_team');

  // A spelling the database never produced is a hard error: off mode cannot
  // invent a normalization it did not record.
  await assert.rejects(() => c.query(sqlFor('byeWeeks'), [2025, ['Nowhere FC'], 18]),
    /no captured row spells team "Nowhere FC"/);
});

test('a degenerate team string yields no bye rows rather than throwing', async () => {
  // `fn_normalize_nfl_team` is `upper(trim(x))` with a lookup on top, so an
  // empty or blank team normalizes to a key that matches no schedule row and
  // the SQL join simply returns nothing. The emulation must do the same. It
  // previously consulted the captured-normalization lookup first, which
  // fail-closed THROWS for a string no captured row spells - exploding exactly
  // where Postgres stays quiet.
  //
  // Production cannot reach this: `computeByeWeeks` drops falsy teams with
  // `filter(Boolean)` before querying. The emulation should still not be the
  // fragile one.
  const c = offClient({ season: 2025, week: 3 });
  for (const raw of ['', '   ', '\t', '\n  \t ', null, undefined]) {
    const result = await c.query(sqlFor('byeWeeks'), [2025, [raw], 18]);
    assert.deepEqual(result.rows, [],
      `a team of ${JSON.stringify(raw)} must yield no rows, not an error`);
  }
  // A blank team mixed in with a real one does not suppress the real one.
  const mixed = await c.query(sqlFor('byeWeeks'), [2025, ['', 'KC', '   '], 18]);
  assert.deepEqual(mixed.rows.map((r) => r.week).sort(), [1, 2, 3]);
  assert.equal(mixed.rows.every((r) => r.nfl_team === 'KC'), true);

  // A genuinely unknown spelling still fails closed. That behaviour is
  // deliberate and is NOT what the blank-input guard relaxed.
  await assert.rejects(() => c.query(sqlFor('byeWeeks'), [2025, ['Nowhere FC'], 18]),
    /no captured row spells team "Nowhere FC"/);
});

test('the JS twin nulls every string it considers blank, which SQL does not', () => {
  // Pinned here as well as in the PG contract, so the JS half of the
  // divergence is visible without a database. PostgreSQL's `trim()` strips
  // SPACES only, so it does not even agree with JS about which strings are
  // blank - `'\t'` is blank to JS and not to Postgres.
  for (const blank of ['', '   ', '\t', '\n  \t ']) {
    assert.equal(normalizeTeamKey(blank), null,
      `normalizeTeamKey(${JSON.stringify(blank)}) is null`);
  }
  assert.equal(normalizeTeamKey(null), null);
  // Everything in the real domain is non-null on this side, which is what
  // confines the divergence to blanks.
  for (const real of ['KC', 'kc', '  kc  ', 'WSH', 'WAS', 'LA', 'LAR',
    'Washington Commanders', 'Nowhere FC']) {
    assert.ok(normalizeTeamKey(real), `${real} normalizes to a usable key`);
  }
});

// ---------------------------------------------------------------------------
// The loader, over a snapshot written by the REAL store write path
// ---------------------------------------------------------------------------

test('loadSnapshot reads a real store layout and verifies every digest', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-client-load-'));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const written = [];
  const save = (dataset, rows, seasonScoped, pathKind = store.PATHS.FEATURE) => {
    written.push(store.saveDataset({
      root, store: store.STORES.EVALUATION, path: pathKind, dataset, rows, seasonScoped,
    }));
  };
  save('players', PLAYERS, false);
  save('player_stats', PLAYER_STATS, true);
  save('player_season_stats', PLAYER_SEASON_STATS, true);
  save('nfl_games_2023', [], true);
  save('nfl_games_2024', games(2024), true);
  save('nfl_games_2025', games(2025), true);
  save('orientation_overlay', OVERLAY, true);
  save('position_rank', [{ code: 'QB', rank: 1 }], false);
  save('player_name_rank', PLAYERS.map((p, i) => ({ id: p.id, name: p.name, rank: i + 1 })), false);
  save('oracle_2025_w3', [{ season: 2025, week: 3, player_id: 1, projection: { median: 1 } }], true,
    store.PATHS.OUTCOME);
  store.saveManifest(root, { ...MANIFEST, datasets: written });

  const snapshot = client.loadSnapshot({ root });
  assert.equal(snapshot.players.length, 3);
  assert.equal(snapshot.nflGamesBySeason.get(2025).length, 8);
  assert.equal(snapshot.nflGamesBySeason.get(2023).length, 0);
  assert.equal(snapshot.orientationOverlay.length, OVERLAY.length);

  const oracle = client.loadOracle({ root, season: 2025, week: 3, manifest: store.loadManifest(root) });
  assert.equal(oracle.length, 1);
  assert.throws(() => client.loadOracle({
    root, season: 2025, week: 9, manifest: store.loadManifest(root),
  }), /no oracle dataset oracle_2025_w9/);

  // A tampered dataset refuses to load, through the store's own digest check.
  fs.writeFileSync(
    store.datasetFile(root, store.STORES.EVALUATION, store.PATHS.FEATURE, 'players'),
    '{"id":99}\n'
  );
  assert.throws(() => client.loadSnapshot({ root }), /digest mismatch|does not match the pinned/);
});

test('assembleSnapshot refuses a malformed snapshot rather than half-working', () => {
  assert.throws(() => client.assembleSnapshot({}), /requires the manifest/);
  assert.throws(() => client.assembleSnapshot({ manifest: {}, players: null }),
    /requires players as an array/);
  assert.throws(() => client.assembleSnapshot({
    manifest: {}, players: [], playerStats: [], playerSeasonStats: [], nflGamesBySeason: {},
  }), /requires nflGamesBySeason as a Map/);
});

// ---------------------------------------------------------------------------
// Structural
// ---------------------------------------------------------------------------

test('the Phase-2 modules construct no filesystem paths of their own', () => {
  // Every path in the tree is built by snapshotStore's reviewed, suppressed
  // helpers. Keeping the new modules free of path construction means the
  // path-safety argument lives in one place instead of seven - and it is the
  // reason none of these files needed a Semgrep suppression.
  const targets = [
    ...['sqlSurface.js', 'asOfView.js', 'snapshotClient.js', 'guards.js',
      'priorGamesGate.js', 'fidelity.js']
      .map((f) => path.join(__dirname, '..', '..', 'scripts', 'backtest', 'lib', f)),
    // The canary runner lives outside the guarded tree but is still Phase-2
    // code, and it takes no path input at all.
    path.join(__dirname, '..', 'scripts', 'run-backtest-canaries.js'),
  ];
  for (const file of targets) {
    const text = fs.readFileSync(file, 'utf8');
    const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.equal((code.match(/path\.(join|resolve)\(/g) || []).length, 0,
      `${path.basename(file)} builds a path; route it through snapshotStore instead`);
  }
});

test('two queries that normalize alike are refused, because dispatch is BY signature', () => {
  // A collision would make one of the two unreachable: the map would keep
  // whichever entry was built last and the other query would silently be
  // answered with the wrong handler. The real table has none, so the guard is
  // exercised directly rather than waiting for a codebase that is already broken.
  assert.throws(() => surface.assertUniqueSignatures([
    { name: 'first', text: 'SELECT 1' },
    { name: 'second', text: 'SELECT    1' }, // same query, different whitespace
  ]), /SQL surface collision: "second" and "first" normalize to the same signature/);

  // Genuinely different texts are fine, and the real surface passes.
  const ok = surface.assertUniqueSignatures([
    { name: 'a', text: 'SELECT 1' }, { name: 'b', text: 'SELECT 2' },
  ]);
  assert.equal(ok.size, 2);
  assert.equal(surface.assertUniqueSignatures(surface.SQL_SURFACE).size, 8);
});

test('the shared SQL surface is the single definition both phases use', () => {
  const extract = require('../../scripts/backtest/extract-snapshot');
  // Same object, not a copy: a drifting duplicate is exactly what this prevents.
  assert.equal(extract.SQL_SURFACE, surface.SQL_SURFACE);
  assert.equal(extract.normalizeSql, surface.normalizeSql);
  assert.equal(surface.SQL_SURFACE.length, 8);
  for (const entry of surface.SQL_SURFACE) {
    assert.ok(entry.binding, `${entry.name} declares a parameter binding`);
  }
});
