const test = require('node:test');
const assert = require('node:assert/strict');

const cohort = require('../../scripts/backtest/lib/cohort');
const asOf = require('../../scripts/backtest/lib/asOfView');
const { normalizeTeamKey } = require('../services/projectionFeatures');

function roster({ season = 2025, week = 3, team = 'KC', position = 'QB', status = 'ACT', gsis = '00-0000001', gameType = 'REG' } = {}) {
  return { season, week, team, position, status, gsis_id: gsis, full_name: `P ${gsis}`, game_type: gameType };
}

const CROSSWALK_ROWS = [
  { gsis_id: '00-0000001', espn_id: '3001' },
  { gsis_id: '00-0000002', espn_id: '3002' },
  { gsis_id: '00-0000003', espn_id: '3003' },
  { gsis_id: '00-0000004', espn_id: '3004' },
  { gsis_id: 'ABB498348', espn_id: '9999' }, // legacy pre-GSIS shape
  { gsis_id: '00-0000009', espn_id: '' }, // no espn id: unmappable
];

const DB_PLAYERS = [
  { id: 1, external_id: 3001, name: 'Aaron QB', position: 'QB', nfl_team: 'KC', team_key: 'KC' },
  { id: 2, external_id: '3002', name: 'Bella RB', position: 'RB', nfl_team: 'WSH', team_key: 'WAS' },
  { id: 3, external_id: 3003, name: 'Cara WR', position: 'WR', nfl_team: 'LAR', team_key: 'LAR' },
  // 3004 is in the crosswalk but NOT in the players table: the "cannot re-enter" case.
  { id: 5, external_id: null, name: 'No External', position: 'TE', nfl_team: 'BUF', team_key: 'BUF' },
];

// ---------------------------------------------------------------------------
// The crosswalk and the link to database players
// ---------------------------------------------------------------------------

test('the crosswalk keeps well-formed pairs and drops legacy shapes by shape', () => {
  const built = cohort.buildCrosswalk(CROSSWALK_ROWS);
  assert.equal(built.mappable, 4);
  assert.equal(built.legacyShape, 1, 'the pre-GSIS identifier is excluded by shape, never used as a key');
  assert.equal(built.espnByGsis.get('00-0000001'), '3001');
  assert.equal(built.gsisByEspn.get('3001'), '00-0000001');
  assert.equal(built.espnByGsis.has('ABB498348'), false);
  assert.equal(built.espnByGsis.has('00-0000009'), false, 'a blank espn id is not a mapping');
});

test('a one-to-many crosswalk is a hard error in either direction', () => {
  assert.throws(() => cohort.buildCrosswalk([
    { gsis_id: '00-0000001', espn_id: '1' }, { gsis_id: '00-0000001', espn_id: '2' },
  ]), /gsis 00-0000001 maps to two espn ids/);
  assert.throws(() => cohort.buildCrosswalk([
    { gsis_id: '00-0000001', espn_id: '1' }, { gsis_id: '00-0000002', espn_id: '1' },
  ]), /espn 1 maps to two gsis ids/);
});

test('gsisByPlayerId reproduces production\'s String(external_id) join exactly', () => {
  const crosswalk = cohort.buildCrosswalk(CROSSWALK_ROWS);
  const built = cohort.buildGsisByPlayerId({ dbPlayers: DB_PLAYERS, crosswalk });
  // Production does `idByExternal.get(String(espnId))` against a map keyed by
  // `String(external_id)` (nflverseSync.service.js:224/:177). An integer
  // external_id and a text espn_id must therefore still join - this is the
  // case a numeric comparison would silently miss.
  assert.equal(built.gsisByPlayerId.get(1), '00-0000001', 'integer external_id joins to text espn_id');
  assert.equal(built.gsisByPlayerId.get(2), '00-0000002', 'string external_id joins too');
  assert.equal(built.playerIdByGsis.get('00-0000003'), 3);
  // A player with no external_id cannot be linked, and is counted.
  assert.equal(built.gsisByPlayerId.has(5), false);
  assert.equal(built.unlinked, 1);
  // 3004 exists in the crosswalk but has no players row, so it maps to nothing.
  assert.equal(built.playerIdByGsis.has('00-0000004'), false);
});

test('two database players claiming one gsis id is a hard error', () => {
  const crosswalk = cohort.buildCrosswalk(CROSSWALK_ROWS);
  assert.throws(() => cohort.buildGsisByPlayerId({
    dbPlayers: [...DB_PLAYERS, { id: 9, external_id: '3001', name: 'Dup', position: 'QB' }],
    crosswalk,
  }), /gsis 00-0000001 resolves to two database players/);
});

// ---------------------------------------------------------------------------
// The cohort
// ---------------------------------------------------------------------------

/** The three inputs that are required BY NAME because their defaults would be inert. */
const REQUIRED_INPUTS = {
  statsGameTeamFor: () => null,
  byeTeamKeys: new Set(),
  defenseTeamKeys: [],
};

function buildFor(rosterRows, extra = {}) {
  const crosswalk = cohort.buildCrosswalk(CROSSWALK_ROWS);
  const { playerIdByGsis } = cohort.buildGsisByPlayerId({ dbPlayers: DB_PLAYERS, crosswalk });
  const rosterIndex = asOf.buildRosterIndex(rosterRows);
  return cohort.buildCohort({
    season: 2025,
    week: 3,
    rosterIndex,
    crosswalk,
    playerIdByGsis,
    normalizeTeamKey,
    ...REQUIRED_INPUTS,
    ...extra,
  });
}

test('the three silently-inert inputs are REQUIRED by name, and an explicit empty stays legal', () => {
  // Each of these has a plausible default that does not throw and quietly
  // changes what the cohort MEANS - the same hazard shape as a missing
  // orientation overlay, and the same remedy.
  const crosswalk = cohort.buildCrosswalk(CROSSWALK_ROWS);
  const { playerIdByGsis } = cohort.buildGsisByPlayerId({ dbPlayers: DB_PLAYERS, crosswalk });
  const rosterIndex = asOf.buildRosterIndex([roster()]);
  const base = {
    season: 2025, week: 3, rosterIndex, crosswalk, playerIdByGsis, normalizeTeamKey,
    ...REQUIRED_INPUTS,
  };
  for (const key of ['statsGameTeamFor', 'byeTeamKeys', 'defenseTeamKeys']) {
    const { [key]: removed, ...missing } = base;
    assert.throws(() => cohort.buildCohort(missing),
      new RegExp(`requires ${key}\\.`), `omitting ${key} must throw by name`);
  }
  // Wrong TYPES are refused too - a bare object would silently answer `false`
  // to every `.has()`.
  assert.throws(() => cohort.buildCohort({ ...base, byeTeamKeys: {} }), /requires byeTeamKeys/);
  assert.throws(() => cohort.buildCohort({ ...base, statsGameTeamFor: 'nope' }),
    /requires statsGameTeamFor/);
  // An explicit empty value is exactly what a caller who means it passes.
  assert.doesNotThrow(() => cohort.buildCohort(base));
  // And an array is accepted for byeTeamKeys, normalized internally.
  assert.equal(cohort.buildCohort({ ...base, byeTeamKeys: ['KC'] }).members[0].onBye, true);
});

test('an exclusion reason outside the closed set is a drift error, not re-bucketed', () => {
  // Re-bucketing an unknown reason as 'no-fantasy-position' would silently
  // mis-attribute a whole class of exclusion in the published counts.
  const crosswalk = cohort.buildCrosswalk(CROSSWALK_ROWS);
  const { playerIdByGsis } = cohort.buildGsisByPlayerId({ dbPlayers: DB_PLAYERS, crosswalk });
  const rosterIndex = asOf.buildRosterIndex([roster()]);
  const original = asOf.reconstructPlayerWeek;
  asOf.reconstructPlayerWeek = () => ({ inCohort: false, reason: 'something-new' });
  try {
    assert.throws(() => cohort.buildCohort({
      season: 2025, week: 3, rosterIndex, crosswalk, playerIdByGsis, normalizeTeamKey,
      ...REQUIRED_INPUTS,
    }), /returned exclusion reason "something-new", which is not in the closed set.*drifted/s);
  } finally {
    asOf.reconstructPlayerWeek = original;
  }
});

test('the cohort is roster rows that are REG, active-class, mapped, and fantasy-positioned', () => {
  const result = buildFor([
    roster({ gsis: '00-0000001', position: 'QB', status: 'ACT' }),
    roster({ gsis: '00-0000002', position: 'RB', status: 'INA', team: 'WAS' }),
    roster({ gsis: '00-0000003', position: 'WR', status: 'ACT', team: 'LA' }),
  ]);
  assert.equal(result.counts.members, 3);
  // INA is IN: dropping game-day inactives would be the survivorship cohort
  // this rebuild exists to eliminate.
  assert.ok(result.members.some((m) => m.gsisId === '00-0000002'));
  // The roster file is the authority for team: LA folds to LAR, WAS to WAS.
  assert.equal(result.members.find((m) => m.gsisId === '00-0000003').teamKey, 'LAR');
  assert.equal(result.members.find((m) => m.gsisId === '00-0000002').teamKey, 'WAS');
  assert.equal(result.counts.excludedTotal, 0);
});

test('every exclusion is counted under its own cause, and nothing falls through', () => {
  const result = buildFor([
    roster({ gsis: '00-0000001', position: 'QB', status: 'ACT' }), // member
    roster({ gsis: '00-0000002', position: 'RB', status: 'RES' }), // reserve
    roster({ gsis: '00-0000003', position: 'WR', status: 'CUT' }), // off roster
    roster({ gsis: '00-0000004', position: 'LB', status: 'ACT' }), // not a fantasy position
    roster({ gsis: 'ABB498348', position: 'QB', status: 'ACT' }), // legacy id shape
    roster({ gsis: '00-0000009', position: 'TE', status: 'ACT' }), // unmapped in crosswalk
    roster({ gsis: '00-0000004', position: 'TE', status: 'ACT', week: 3, team: 'BUF' }),
  ].filter((r, i, all) => all.findIndex((o) => o.gsis_id === r.gsis_id && o.week === r.week) === i));

  assert.equal(result.counts.members, 1);
  const ex = result.counts.excluded;
  assert.equal(ex['status-class-reserve'], 1);
  assert.equal(ex['status-class-off_roster'], 1);
  assert.equal(ex['no-fantasy-position'], 1, 'LB is not one of the five fantasy roster positions');
  assert.equal(ex['malformed-gsis-id'], 1);
  assert.equal(ex['unmapped-gsis-id'], 1);
  // Every roster row is accounted for exactly once.
  assert.equal(result.counts.members + result.counts.excludedTotal, 6);
});

test('a player absent from today\'s players table is counted, never silently dropped', () => {
  // 00-0000004 maps to espn 3004, which no players row carries. The
  // preregistration calls this a NAMED LIMITATION counted per week.
  const result = buildFor([roster({ gsis: '00-0000004', position: 'RB', status: 'ACT' })]);
  assert.equal(result.counts.members, 0);
  assert.equal(result.counts.excluded['absent-from-players-table'], 1);
  assert.deepEqual(result.excludedIds.absentFromPlayers, ['00-0000004']);
});

test('a gameTeam contradiction is REPORTED and the player stays in the cohort', () => {
  const result = buildFor(
    [roster({ gsis: '00-0000002', position: 'RB', status: 'ACT', team: 'WAS' })],
    { statsGameTeamFor: (gsis) => (gsis === '00-0000002' ? 'BUF' : null) }
  );
  assert.equal(result.counts.members, 1, 'a contradiction never excludes');
  assert.equal(result.counts.contradictions, 1, 'but it is counted for the report');
  const member = result.members[0];
  assert.equal(member.teamKey, 'WAS', 'the roster file remains the authority');
  assert.equal(member.contradiction.contradicted, true);
});

test('bye players are IN the cohort and flagged, not filtered out', () => {
  // Prereg 4.1: excluded from point-accuracy scoring, INCLUDED in rosters -
  // which is what exercises the wrapper's bye handling instead of hiding it.
  const result = buildFor(
    [roster({ gsis: '00-0000001', position: 'QB', team: 'KC' }),
      roster({ gsis: '00-0000002', position: 'RB', team: 'WAS' })],
    { byeTeamKeys: new Set(['KC']) }
  );
  assert.equal(result.counts.members, 2);
  assert.equal(result.members.find((m) => m.gsisId === '00-0000001').onBye, true);
  assert.equal(result.members.find((m) => m.gsisId === '00-0000002').onBye, false);
  assert.equal(result.counts.onBye, 1);
});

test('one DEF pseudo-player is synthesized per team-week, in deterministic order', () => {
  const result = buildFor(
    [roster({ gsis: '00-0000001', position: 'QB' })],
    { defenseTeamKeys: ['WAS', 'KC', 'LAR', 'KC'] }
  );
  const defenses = result.members.filter((m) => m.isDefense);
  assert.equal(defenses.length, 3, 'one per distinct team, duplicates collapsed');
  assert.deepEqual(defenses.map((d) => d.teamKey), ['KC', 'LAR', 'WAS']);
  assert.equal(defenses.every((d) => d.position === 'DEF' && d.playerId === null), true);
  assert.equal(result.counts.defenses, 3);

  // The accounting identity still holds once DEF is in play: synthesized
  // defences are ADDED to the cohort and were never roster rows, so they must
  // be subtracted before the totals are compared to what the roster offered.
  assert.equal(result.counts.members - result.counts.defenses + result.counts.excludedTotal, 1,
    'one roster row in, one accounted for - the three defences are synthesized, not offered');
});

test('the cohort refuses to build for a quarantined season', () => {
  assert.throws(() => buildFor([roster({ season: 2026 })], { season: 2026 }),
    /season 2026 is at or after the quarantine boundary 2026/);
});

// ---------------------------------------------------------------------------
// DEF synthesis and the aggregate trap
// ---------------------------------------------------------------------------

const GAME = {
  game_id: '2025_03_WAS_KC', season: 2025, week: 3, game_type: 'REG',
  home_team: 'KC', away_team: 'WAS', home_score: 27, away_score: 20,
};

test('DEF stats are per-game: pointsAllowed is the OPPONENT\'s score in that game', () => {
  const kc = cohort.synthesizeDefenseStats({
    teamWeekRow: { def_sacks: 3, def_interceptions: 1 }, game: GAME, teamKey: 'KC', normalizeTeamKey,
  });
  assert.equal(kc.pointsAllowed, 20, 'KC allowed what WAS scored');
  assert.equal(kc.defSacks, 3);
  const was = cohort.synthesizeDefenseStats({
    teamWeekRow: {}, game: GAME, teamKey: 'WAS', normalizeTeamKey,
  });
  assert.equal(was.pointsAllowed, 27, 'WAS allowed what KC scored');
  // Absent enrichment is absent, never a measured zero.
  assert.equal(was.yardsAllowed, null);
  assert.equal(cohort.synthesizeDefenseStats({
    teamWeekRow: { opponentYards: 350 }, game: GAME, teamKey: 'KC', normalizeTeamKey,
  }).yardsAllowed, 350);
});

test('a BLANK game score is refused, because zero points allowed is the top tier', () => {
  // The pinned games.csv demonstrably carries blank scores (unplayed or
  // not-yet-final games). Reading one as 0 would synthesize a SHUTOUT - the
  // maximum defensive tier - and it would happen during conversion, one
  // function upstream of assertPerGameDefenseStats, which would then inspect a
  // perfectly clean `0` and pass it.
  for (const blank of ['', '   ', null, undefined]) {
    assert.throws(() => cohort.synthesizeDefenseStats({
      teamWeekRow: {}, game: { ...GAME, away_score: blank }, teamKey: 'KC', normalizeTeamKey,
    }), /pointsAllowed is .* for game .*top defensive tier, out of a missing score/s,
    `an away_score of ${JSON.stringify(blank)} must throw`);
  }
  // The other side of the game too.
  assert.throws(() => cohort.synthesizeDefenseStats({
    teamWeekRow: {}, game: { ...GAME, home_score: '' }, teamKey: 'WAS', normalizeTeamKey,
  }), /pointsAllowed is/);
  // A real 0 is a real shutout and must still be accepted.
  assert.equal(cohort.synthesizeDefenseStats({
    teamWeekRow: {}, game: { ...GAME, away_score: 0 }, teamKey: 'KC', normalizeTeamKey,
  }).pointsAllowed, 0);
  assert.equal(cohort.synthesizeDefenseStats({
    teamWeekRow: {}, game: { ...GAME, away_score: '0' }, teamKey: 'KC', normalizeTeamKey,
  }).pointsAllowed, 0, 'a CSV "0" is still a real shutout');
  // Non-numeric junk is refused as well.
  assert.throws(() => cohort.synthesizeDefenseStats({
    teamWeekRow: {}, game: { ...GAME, away_score: 'TBD' }, teamKey: 'KC', normalizeTeamKey,
  }), /pointsAllowed is "TBD", not a number/);
});

test('a NULL opponentYards is absent, not zero - null and undefined alike', () => {
  // A CSV parse yields null far more often than undefined, so checking only
  // undefined would have left the ordinary case falling through to 0 and
  // contradicting the line's own comment.
  for (const absent of [null, undefined, '', '  ']) {
    assert.equal(cohort.synthesizeDefenseStats({
      teamWeekRow: { opponentYards: absent }, game: GAME, teamKey: 'KC', normalizeTeamKey,
    }).yardsAllowed, null, `opponentYards of ${JSON.stringify(absent)} is absent`);
  }
  // A real 0 stays 0: the opponent gained no yards, which is a measurement.
  assert.equal(cohort.synthesizeDefenseStats({
    teamWeekRow: { opponentYards: 0 }, game: GAME, teamKey: 'KC', normalizeTeamKey,
  }).yardsAllowed, 0);
  // Counting stats legitimately default to zero: no sacks recorded IS no sacks.
  assert.equal(cohort.synthesizeDefenseStats({
    teamWeekRow: {}, game: GAME, teamKey: 'KC', normalizeTeamKey,
  }).defSacks, 0);
});

test('a team that does not play in the game is a hard error, not a zero', () => {
  assert.throws(() => cohort.synthesizeDefenseStats({
    teamWeekRow: {}, game: GAME, teamKey: 'BUF', normalizeTeamKey,
  }), /team BUF does not play in game/);
  assert.equal(cohort.synthesizeDefenseStats({
    teamWeekRow: {}, game: null, teamKey: 'KC', normalizeTeamKey,
  }), null, 'no game means no synthesized line at all');
});

test('THE AGGREGATE TRAP: a season total scored as one game is refused', () => {
  // pointsAllowed and yardsAllowed are PER-GAME tier inputs. A season
  // aggregate fed through the tier table prices it as one catastrophic
  // afternoon, which is exactly the trap this guard exists for.
  assert.equal(cohort.assertPerGameDefenseStats({ pointsAllowed: 20 }), true);
  assert.equal(cohort.assertPerGameDefenseStats({ pointsAllowed: 0 }), true);
  assert.throws(() => cohort.assertPerGameDefenseStats({ pointsAllowed: 380 }),
    /not a single game's total.*PER-GAME tier inputs/s);
  assert.throws(() => cohort.assertPerGameDefenseStats({ pointsAllowed: -1 }), /not a single game/);
  assert.throws(() => cohort.assertPerGameDefenseStats({ pointsAllowed: null }), /not a number/);
  assert.throws(() => cohort.assertPerGameDefenseStats(null), /no defensive stats/);
  // A real blowout is still one game and must pass.
  assert.equal(cohort.assertPerGameDefenseStats({ pointsAllowed: 73 }), true);
});

// ---------------------------------------------------------------------------
// Outcome truth: the three-way reconciliation
// ---------------------------------------------------------------------------

test('present in both pinned sources: the external value wins and the DB is only checked', () => {
  const agreed = cohort.resolveOutcome({
    externalPoints: 18.5, presentInPrimary: true, presentInSecondary: true, dbPoints: 18.5,
  });
  assert.equal(agreed.status, 'scored');
  assert.equal(agreed.actual, 18.5);
  assert.equal(agreed.dbAgrees, true);

  // A DB disagreement is a FINDING, not a correction: the actual is unchanged.
  const disagreed = cohort.resolveOutcome({
    externalPoints: 18.5, presentInPrimary: true, presentInSecondary: true, dbPoints: 12.0,
  });
  assert.equal(disagreed.status, 'scored');
  assert.equal(disagreed.actual, 18.5, 'the pinned source is primary, the database is a QA check');
  assert.equal(disagreed.dbAgrees, false);

  // No DB value to check against is "unchecked", not "disagrees".
  assert.equal(cohort.resolveOutcome({
    externalPoints: 1, presentInPrimary: true, presentInSecondary: true, dbPoints: null,
  }).dbAgrees, null);
});

test('absence from BOTH stat sources is a measured zero, not a gap', () => {
  const absent = cohort.resolveOutcome({
    presentInPrimary: false, presentInSecondary: false, dbPoints: null,
  });
  assert.equal(absent.status, 'zero-recorded');
  assert.equal(absent.actual, 0);
  // And the DB is still only a QA check, even here.
  assert.equal(cohort.resolveOutcome({
    presentInPrimary: false, presentInSecondary: false, dbPoints: 4.2,
  }).dbAgrees, false);
  assert.equal(cohort.resolveOutcome({
    presentInPrimary: false, presentInSecondary: false, dbPoints: 0,
  }).dbAgrees, true);
});

test('ambiguity is excluded by preregistered rule and counted, never guessed', () => {
  const oneSource = cohort.resolveOutcome({
    externalPoints: 9, presentInPrimary: true, presentInSecondary: false,
  });
  assert.equal(oneSource.status, 'excluded');
  assert.equal(oneSource.reason, 'ambiguous-one-source-only');
  assert.equal(oneSource.actual, null, 'no actual is invented for an ambiguous row');

  // The other direction is equally ambiguous.
  assert.equal(cohort.resolveOutcome({
    presentInPrimary: false, presentInSecondary: true, externalPoints: 9,
  }).reason, 'ambiguous-one-source-only');

  // A contradictory team attribution outranks everything else.
  const contradiction = cohort.resolveOutcome({
    externalPoints: 9, presentInPrimary: true, presentInSecondary: true, teamContradiction: true,
  });
  assert.equal(contradiction.status, 'excluded');
  assert.equal(contradiction.reason, 'ambiguous-team-contradiction');
});

test('a row present in both sources with no usable points is an error, not a zero', () => {
  assert.throws(() => cohort.resolveOutcome({
    externalPoints: null, presentInPrimary: true, presentInSecondary: true,
  }), /present in both sources but the external points are null/);
});

test('the outcome tally separates every status for the report', () => {
  const tally = cohort.outcomeTally([
    cohort.resolveOutcome({ externalPoints: 5, presentInPrimary: true, presentInSecondary: true, dbPoints: 5 }),
    cohort.resolveOutcome({ externalPoints: 5, presentInPrimary: true, presentInSecondary: true, dbPoints: 9 }),
    cohort.resolveOutcome({ presentInPrimary: false, presentInSecondary: false, dbPoints: 0 }),
    cohort.resolveOutcome({ externalPoints: 5, presentInPrimary: true, presentInSecondary: false }),
    cohort.resolveOutcome({ externalPoints: 5, presentInPrimary: true, presentInSecondary: true, teamContradiction: true }),
  ]);
  assert.equal(tally.scored, 2);
  assert.equal(tally.zeroRecorded, 1);
  assert.equal(tally.excluded['ambiguous-one-source-only'], 1);
  assert.equal(tally.excluded['ambiguous-team-contradiction'], 1);
  assert.equal(tally.dbDisagreements, 1);
});

test('numeric agreement is decided at 10 decimal places, per the tie convention', () => {
  assert.equal(cohort.resolveOutcome({
    externalPoints: 0.1 + 0.2, presentInPrimary: true, presentInSecondary: true, dbPoints: 0.3,
  }).dbAgrees, true, 'a float artifact is not a disagreement');
  assert.equal(cohort.resolveOutcome({
    externalPoints: 5, presentInPrimary: true, presentInSecondary: true, dbPoints: 5.000000001,
  }).dbAgrees, false, 'a real difference at the tenth decimal still is one');
});

// ---------------------------------------------------------------------------
// The 2026 quarantine
// ---------------------------------------------------------------------------

test('the quarantine throws on 2026 anywhere, including a persisted evaluation row', () => {
  assert.equal(cohort.assertNotQuarantined(2025), true);
  assert.throws(() => cohort.assertNotQuarantined(2026), /at or after the quarantine boundary 2026/);
  assert.throws(() => cohort.assertNotQuarantined(2027), /at or after the quarantine boundary/);
  assert.throws(() => cohort.assertNotQuarantined('nope'), /is not a number/);

  assert.equal(cohort.assertEvaluationRows([{ season: 2024 }, { season: 2025 }]), true);
  assert.throws(() => cohort.assertEvaluationRows([{ season: 2025 }, { season: 2026 }]),
    /evaluation rows\[1\]: season 2026 is at or after/);
  // A row with no season cannot be checked, so it fails closed.
  assert.throws(() => cohort.assertEvaluationRows([{}]), /is not a number/);
  assert.throws(() => cohort.assertEvaluationRows('nope'), /expected an array of rows/);
});
