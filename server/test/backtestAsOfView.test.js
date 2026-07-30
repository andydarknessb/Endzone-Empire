const test = require('node:test');
const assert = require('node:assert/strict');

const asOf = require('../../scripts/backtest/lib/asOfView');
// The REAL production normalization, so WAS/WSH and LA/LAR are folded the way
// `fn_normalize_nfl_team` folds them rather than by a stand-in that would agree
// with a wrong implementation.
const { normalizeTeamKey } = require('../services/projectionFeatures');

/** A roster row in the shape the pinned nflverse files carry. */
function roster({ season = 2024, week = 1, team = 'KC', position = 'QB', status = 'ACT', gsis = '00-0000001', name = 'A Player', gameType = 'REG' } = {}) {
  return {
    season, week, team, position, status, gsis_id: gsis, full_name: name, game_type: gameType,
  };
}

function injury({ season = 2024, week = 1, gsis = '00-0000001', status = 'Questionable', dateModified = null, gameType = 'REG' } = {}) {
  return {
    season, week, gsis_id: gsis, report_status: status, game_type: gameType,
    date_modified: dateModified, team: 'KC', full_name: 'A Player', position: 'QB',
  };
}

// ---------------------------------------------------------------------------
// The roster index: per-week team and position
// ---------------------------------------------------------------------------

test('the roster index keys by player-week and counts what it skips', () => {
  const index = asOf.buildRosterIndex([
    roster({ week: 1 }),
    roster({ week: 2, team: 'BUF' }),
    roster({ week: 1, gsis: '' }), // blank gsis: unmappable, counted
    roster({ week: 1, gsis: '00-0000002', gameType: 'POST' }), // not REG
  ]);
  assert.equal(index.byPlayerWeek.size, 2);
  assert.equal(index.blankGsisId, 1);
  assert.equal(index.skippedGameType, 1);
  assert.equal(asOf.rosterEntryFor(index, { season: 2024, week: 1, gsisId: '00-0000001' }).team, 'KC');
  assert.equal(asOf.rosterEntryFor(index, { season: 2024, week: 2, gsisId: '00-0000001' }).team, 'BUF');
  // No adjacent-week fallback: absent from week 3's roster means absent.
  assert.equal(asOf.rosterEntryFor(index, { season: 2024, week: 3, gsisId: '00-0000001' }), null);
});

test('a duplicate roster player-week is a hard error, never a silent winner', () => {
  assert.throws(
    () => asOf.buildRosterIndex([roster({ week: 4 }), roster({ week: 4, team: 'BUF' })]),
    /duplicate roster player-week 2024:4:00-0000001/
  );
});

test('an unseen status or position code fails closed rather than defaulting', () => {
  assert.throws(() => asOf.buildRosterIndex([roster({ status: 'XYZ' })]), /unknown roster status code/);
  assert.throws(() => asOf.buildRosterIndex([roster({ position: 'ZZ' })]), /unknown roster position code/);
});

test('status classes follow the sealed vocabulary, and INA is in the cohort deliberately', () => {
  const index = asOf.buildRosterIndex([
    roster({ week: 1, status: 'ACT', gsis: '00-0000001' }),
    roster({ week: 1, status: 'INA', gsis: '00-0000002' }),
    roster({ week: 1, status: 'RES', gsis: '00-0000003' }),
    roster({ week: 1, status: 'E01', gsis: '00-0000004' }),
    roster({ week: 1, status: 'CUT', gsis: '00-0000005' }),
  ]);
  const at = (gsis) => asOf.rosterEntryFor(index, { season: 2024, week: 1, gsisId: gsis });
  // ACT and INA are both cohort members: dropping game-day inactives would be
  // the survivorship cohort the rebuild exists to remove.
  assert.equal(asOf.isActiveClass(at('00-0000001')), true);
  assert.equal(asOf.isActiveClass(at('00-0000002')), true);
  // RES and E01 are the IR-equivalent signal, excluded from the primary cohort.
  assert.equal(asOf.isReserveClass(at('00-0000003')), true);
  assert.equal(asOf.isReserveClass(at('00-0000004')), true);
  assert.equal(asOf.isActiveClass(at('00-0000005')), false);
  assert.equal(asOf.isReserveClass(at('00-0000005')), false);
});

test('only the five fantasy roster positions produce a fantasy position', () => {
  const index = asOf.buildRosterIndex([
    roster({ week: 1, position: 'QB', gsis: '00-0000001' }),
    roster({ week: 1, position: 'K', gsis: '00-0000002' }),
    roster({ week: 1, position: 'LB', gsis: '00-0000003' }),
    roster({ week: 1, position: 'OL', gsis: '00-0000004' }),
  ]);
  const at = (gsis) => asOf.rosterEntryFor(index, { season: 2024, week: 1, gsisId: gsis });
  assert.equal(at('00-0000001').fantasyPosition, 'QB');
  assert.equal(at('00-0000002').fantasyPosition, 'K');
  assert.equal(at('00-0000003').fantasyPosition, null);
  assert.equal(at('00-0000004').fantasyPosition, null);
});

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

test('a trade produces a per-week team timeline, folded through the real normalization', () => {
  const index = asOf.buildRosterIndex([
    roster({ week: 1, team: 'KC' }),
    roster({ week: 2, team: 'KC' }),
    roster({ week: 3, team: 'WAS' }),
    roster({ week: 4, team: 'WAS' }),
  ]);
  const timeline = asOf.teamTimelineFor(index, {
    season: 2024, gsisId: '00-0000001', normalizeTeamKey,
  });
  assert.equal(timeline.traded, true);
  assert.deepEqual(timeline.changes, [{ week: 3, from: 'KC', to: 'WAS' }]);
  assert.deepEqual(timeline.weeks.map((w) => w.teamKey), ['KC', 'KC', 'WAS', 'WAS']);

  // A SPELLING change is not a trade: games.csv's WAS and the schedule's WSH
  // fold to the same key, so this player never moved.
  const spelling = asOf.buildRosterIndex([
    roster({ week: 1, team: 'WAS' }), roster({ week: 2, team: 'WSH' }),
  ]);
  const same = asOf.teamTimelineFor(spelling, { season: 2024, gsisId: '00-0000001', normalizeTeamKey });
  assert.equal(same.traded, false, 'WAS and WSH are one team');
  assert.deepEqual(same.changes, []);
});

test('teamTimelineFor refuses to guess at normalization', () => {
  const index = asOf.buildRosterIndex([roster()]);
  assert.throws(
    () => asOf.teamTimelineFor(index, { season: 2024, gsisId: '00-0000001' }),
    /requires the production normalizeTeamKey/
  );
});

// ---------------------------------------------------------------------------
// Contradictions: reported, never excluding
// ---------------------------------------------------------------------------

test('a roster-vs-gameTeam contradiction is reported and the ROSTER still wins', () => {
  const conflict = asOf.reconcileTeam({
    rosterTeam: 'WAS', statsGameTeam: 'BUF', normalizeTeamKey,
  });
  assert.equal(conflict.contradicted, true);
  // The authority is the roster, even in disagreement (prereg 4.1).
  assert.equal(conflict.teamKey, 'WAS');
  assert.equal(conflict.statsTeamKey, 'BUF');

  // A spelling difference is NOT a contradiction.
  const spelling = asOf.reconcileTeam({
    rosterTeam: 'WAS', statsGameTeam: 'WSH', normalizeTeamKey,
  });
  assert.equal(spelling.contradicted, false);
  assert.equal(spelling.teamKey, 'WAS');

  // Missing enrichment is missing, not disagreement.
  const absent = asOf.reconcileTeam({ rosterTeam: 'KC', statsGameTeam: null, normalizeTeamKey });
  assert.equal(absent.contradicted, false);
  assert.equal(absent.unattributed, true);
  assert.equal(absent.teamKey, 'KC');
});

test('contradictions are tallied for the report and nothing filters on them', () => {
  const rows = [
    asOf.reconcileTeam({ rosterTeam: 'KC', statsGameTeam: 'KC', normalizeTeamKey }),
    asOf.reconcileTeam({ rosterTeam: 'WAS', statsGameTeam: 'BUF', normalizeTeamKey }),
    asOf.reconcileTeam({ rosterTeam: 'LAR', statsGameTeam: null, normalizeTeamKey }),
  ];
  assert.deepEqual(asOf.contradictionTally(rows), { compared: 2, contradicted: 1, unattributed: 1 });

  // The contradicting player is still IN the cohort - the whole point.
  const index = asOf.buildRosterIndex([roster({ week: 5, team: 'WAS', position: 'RB' })]);
  const view = asOf.reconstructPlayerWeek({
    rosterIndex: index, season: 2024, week: 5, gsisId: '00-0000001',
    normalizeTeamKey, statsGameTeam: 'BUF',
  });
  assert.equal(view.inCohort, true, 'a contradiction never excludes');
  assert.equal(view.contradiction.contradicted, true);
  assert.equal(view.teamKey, 'WAS');
});

// ---------------------------------------------------------------------------
// The injury policy
// ---------------------------------------------------------------------------

test('the PRIMARY policy is null for every player-week, in both seasons', () => {
  const index = asOf.buildInjuryIndex([
    injury({ season: 2024, status: 'Out' }), injury({ season: 2025, status: 'Doubtful' }),
  ], { hasDateModified: false });
  for (const season of [2024, 2025]) {
    assert.equal(asOf.resolveInjuryStatus({
      policy: asOf.INJURY_POLICIES.PRIMARY, injuryIndex: index, season, week: 1, gsisId: '00-0000001',
    }), null, 'the primary estimand exercises only bye availability, never O/IR filtering');
  }
});

test('S1 resolves to the latest revision at or before kickoff, and fails closed otherwise', () => {
  const index = asOf.buildInjuryIndex([
    injury({ week: 15, status: 'Questionable', dateModified: '2024-12-12T18:00:00Z' }),
    injury({ week: 15, status: 'Out', dateModified: '2024-12-14T18:00:00Z' }),
  ], { hasDateModified: true });
  const resolve = (kickoff) => asOf.resolveInjuryStatus({
    policy: asOf.INJURY_POLICIES.S1_AS_OF_2024,
    injuryIndex: index, season: 2024, week: 15, gsisId: '00-0000001', earliestKickoff: kickoff,
  });
  // Before the second revision: the manager saw Questionable.
  assert.equal(resolve('2024-12-13T18:00:00Z'), 'Q');
  // After it: Out.
  assert.equal(resolve('2024-12-15T18:00:00Z'), 'O');
  // Before both: no report had been filed yet.
  assert.equal(resolve('2024-12-11T18:00:00Z'), null);

  // Exactly AT a revision's timestamp counts as having been seen ("at or
  // before"), which is the preregistration's wording.
  assert.equal(resolve('2024-12-12T18:00:00Z'), 'Q');
});

test('S1 fails closed on a missing column, a blank stamp, and an exact tie', () => {
  const noColumn = asOf.buildInjuryIndex([injury({ week: 1 })], { hasDateModified: false });
  assert.throws(() => asOf.resolveInjuryStatus({
    policy: asOf.INJURY_POLICIES.S1_AS_OF_2024, injuryIndex: noColumn,
    season: 2024, week: 1, gsisId: '00-0000001', earliestKickoff: '2024-09-08T17:00:00Z',
  }), /needs date_modified and this file has none/);

  const tied = asOf.buildInjuryIndex([
    injury({ week: 1, status: 'Questionable', dateModified: '2024-09-06T18:00:00Z' }),
    injury({ week: 1, status: 'Out', dateModified: '2024-09-06T18:00:00Z' }),
  ], { hasDateModified: true });
  assert.throws(() => asOf.resolveInjuryStatus({
    policy: asOf.INJURY_POLICIES.S1_AS_OF_2024, injuryIndex: tied,
    season: 2024, week: 1, gsisId: '00-0000001', earliestKickoff: '2024-09-08T17:00:00Z',
  }), /tie exactly on date_modified/);

  const blank = asOf.buildInjuryIndex([
    injury({ week: 1, dateModified: '' }),
  ], { hasDateModified: true });
  assert.throws(() => asOf.resolveInjuryStatus({
    policy: asOf.INJURY_POLICIES.S1_AS_OF_2024, injuryIndex: blank,
    season: 2024, week: 1, gsisId: '00-0000001', earliestKickoff: '2024-09-08T17:00:00Z',
  }), /blank date_modified/);

  // And it needs the kickoff at all.
  const fine = asOf.buildInjuryIndex([
    injury({ week: 1, dateModified: '2024-09-06T18:00:00Z' }),
  ], { hasDateModified: true });
  assert.throws(() => asOf.resolveInjuryStatus({
    policy: asOf.INJURY_POLICIES.S1_AS_OF_2024, injuryIndex: fine,
    season: 2024, week: 1, gsisId: '00-0000001',
  }), /needs the week's earliest kickoff/);
});

test('S2 serves the final status and S3 reads only the reserve roster class', () => {
  const index = asOf.buildInjuryIndex([injury({ season: 2025, status: 'Doubtful' })],
    { hasDateModified: false });
  assert.equal(asOf.resolveInjuryStatus({
    policy: asOf.INJURY_POLICIES.S2_FINAL_2025, injuryIndex: index,
    season: 2025, week: 1, gsisId: '00-0000001',
  }), 'D');

  // S3 is the ONLY IR-equivalent signal and reads no injury report at all.
  const rosterIndex = asOf.buildRosterIndex([
    roster({ week: 1, status: 'RES', gsis: '00-0000001' }),
    roster({ week: 1, status: 'ACT', gsis: '00-0000002' }),
  ]);
  const s3 = (gsis) => asOf.resolveInjuryStatus({
    policy: asOf.INJURY_POLICIES.S3_RESERVE_AS_IR,
    rosterEntry: asOf.rosterEntryFor(rosterIndex, { season: 2024, week: 1, gsisId: gsis }),
    season: 2024, week: 1, gsisId: gsis,
  });
  assert.equal(s3('00-0000001'), 'IR');
  assert.equal(s3('00-0000002'), null);
});

test('IR is unreachable from an injury report, and an unknown policy or status throws', () => {
  // No injury report in either season carries IR; mapping one to it would
  // invent a signal the data does not have.
  const index = asOf.buildInjuryIndex([injury({ status: 'Out' })], { hasDateModified: false });
  assert.equal(asOf.resolveInjuryStatus({
    policy: asOf.INJURY_POLICIES.S2_FINAL_2025, injuryIndex: index,
    season: 2024, week: 1, gsisId: '00-0000001',
  }), 'O');
  assert.throws(() => asOf.resolveInjuryStatus({
    policy: 'whatever', season: 2024, week: 1, gsisId: '00-0000001',
  }), /unknown injury policy/);
  const bogus = asOf.buildInjuryIndex([injury({ status: 'Probable' })], { hasDateModified: false });
  assert.throws(() => asOf.resolveInjuryStatus({
    policy: asOf.INJURY_POLICIES.S2_FINAL_2025, injuryIndex: bogus,
    season: 2024, week: 1, gsisId: '00-0000001',
  }), /unknown injury report_status "Probable"/);
});

test('buildInjuryIndex must be told whether the file carries date_modified', () => {
  assert.throws(() => asOf.buildInjuryIndex([injury()], {}), /needs to be told whether/);
});

// ---------------------------------------------------------------------------
// The composed view
// ---------------------------------------------------------------------------

test('reconstructPlayerWeek serves the week team, week position and policy status', () => {
  const rosterIndex = asOf.buildRosterIndex([
    roster({ week: 1, team: 'KC', position: 'QB' }),
    roster({ week: 9, team: 'WAS', position: 'QB' }),
  ]);
  const week1 = asOf.reconstructPlayerWeek({
    rosterIndex, season: 2024, week: 1, gsisId: '00-0000001', normalizeTeamKey,
  });
  const week9 = asOf.reconstructPlayerWeek({
    rosterIndex, season: 2024, week: 9, gsisId: '00-0000001', normalizeTeamKey,
  });
  assert.equal(week1.teamKey, 'KC');
  assert.equal(week9.teamKey, 'WAS', 'the same player, a different team, because he was traded');
  assert.equal(week1.position, 'QB');
  assert.equal(week1.injuryStatus, null, 'primary policy');
  assert.equal(week1.inCohort, true);
});

test('a player-week with no roster row is excluded WITH A REASON, never guessed', () => {
  const rosterIndex = asOf.buildRosterIndex([roster({ week: 1 })]);
  const missing = asOf.reconstructPlayerWeek({
    rosterIndex, season: 2024, week: 7, gsisId: '00-0000001', normalizeTeamKey,
  });
  assert.equal(missing.inCohort, false);
  assert.equal(missing.reason, 'no-roster-row');
  assert.equal(missing.position, null, 'no today\'s-position fallback in the primary analysis');
  assert.equal(missing.teamKey, null);
});

test('exclusions are labelled by cause so the report can count each kind', () => {
  const rosterIndex = asOf.buildRosterIndex([
    roster({ week: 1, status: 'RES', gsis: '00-0000001' }),
    roster({ week: 1, status: 'CUT', gsis: '00-0000002' }),
    roster({ week: 1, status: 'ACT', position: 'LB', gsis: '00-0000003' }),
  ]);
  const view = (gsis) => asOf.reconstructPlayerWeek({
    rosterIndex, season: 2024, week: 1, gsisId: gsis, normalizeTeamKey,
  });
  assert.equal(view('00-0000001').reason, 'status-class-reserve');
  assert.equal(view('00-0000002').reason, 'status-class-off_roster');
  assert.equal(view('00-0000003').reason, 'no-fantasy-position');
  for (const gsis of ['00-0000001', '00-0000002', '00-0000003']) {
    assert.equal(view(gsis).inCohort, false);
  }
});

test('reconstructPlayerWeek refuses a status outside the app vocabulary', () => {
  const rosterIndex = asOf.buildRosterIndex([roster({ week: 1 })]);
  assert.throws(() => asOf.reconstructPlayerWeek({
    rosterIndex, season: 2024, week: 1, gsisId: '00-0000001', normalizeTeamKey,
    policy: 'nope',
  }), /unknown injury policy/);
  assert.throws(() => asOf.reconstructPlayerWeek({
    rosterIndex, season: 2024, week: 1, gsisId: '00-0000001',
  }), /requires the production normalizeTeamKey/);
});

test('the app injury vocabulary is exactly what projectionModel.availabilityFor accepts', () => {
  assert.deepEqual([...asOf.APP_INJURY_STATUSES], [null, 'Q', 'D', 'O', 'IR']);
  assert.deepEqual([...asOf.INJURY_POLICY_NAMES],
    ['primary', 's1-as-of-2024', 's2-final-2025', 's3-reserve-as-ir']);
});
