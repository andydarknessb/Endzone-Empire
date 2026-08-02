const test = require('node:test');
const assert = require('node:assert/strict');

const rosterGeneration = require('../../scripts/backtest/lib/rosterGeneration');
const rosters = require('../../scripts/backtest/lib/rosters');

/** A minimal, legal 160-candidate pool: 20 QB, 50 RB, 50 WR, 20 TE, 10 K, 10 DEF. */
function fakeCandidates({ season, week }) {
  const candidates = [];
  let id = 1;
  const add = (position, count) => {
    for (let i = 0; i < count; i++) {
      candidates.push({
        playerId: id, teamKey: `T${id % 32}`, position, isDefense: position === 'DEF',
        // A deterministic, distinct score per candidate so ranking is stable
        // and depends on (season, week) so different weeks draft differently.
        score: 1000 - id + (Number(season) * 100 + Number(week)) * 0.0001,
      });
      id++;
    }
  };
  add('QB', 20);
  add('RB', 50);
  add('WR', 50);
  add('TE', 20);
  add('K', 10);
  add('DEF', 10);
  const positionRank = new Map([['QB', 1], ['RB', 2], ['WR', 3], ['TE', 4], ['K', 5], ['DEF', 6]]);
  const nameRankById = new Map(candidates.map((c) => [c.playerId, c.playerId]));
  return { candidates, positionRank, nameRankById };
}

function fakeBuildCohortFor({ season, week }) {
  return { season, week, members: [] };
}

test('buildSeasonWeekRosterArtifact wires a cohort builder and a candidate ranker into buildRosterWeek', () => {
  const result = rosterGeneration.buildSeasonWeekRosterArtifact({
    season: 2025,
    week: 3,
    buildCohortFor: fakeBuildCohortFor,
    buildCandidatesFor: fakeCandidates,
  });
  assert.equal(result.season, 2025);
  assert.equal(result.week, 3);
  assert.equal(result.artifact.rosters.length, rosters.TEAM_COUNT * rosters.REPLICATES);
  assert.equal(typeof result.freezeHash, 'string');
  assert.equal(result.freezeHash, rosters.freezeHash(result.artifact));
});

test('buildSeasonWeekRosterArtifact requires both builder functions to be injected', () => {
  assert.throws(() => rosterGeneration.buildSeasonWeekRosterArtifact({
    season: 2025, week: 3, buildCandidatesFor: fakeCandidates,
  }), /buildCohortFor must be injected/);
  assert.throws(() => rosterGeneration.buildSeasonWeekRosterArtifact({
    season: 2025, week: 3, buildCohortFor: fakeBuildCohortFor,
  }), /buildCandidatesFor must be injected/);
});

// ---------------------------------------------------------------------------
// The 34 season-weeks
// ---------------------------------------------------------------------------

test('SEASON_WEEKS covers exactly 2025 weeks 2-18 and 2024 weeks 2-18, 34 in total', () => {
  assert.equal(rosterGeneration.SEASON_WEEKS.length, 34);
  assert.equal(rosterGeneration.EXPECTED_SEASON_WEEK_COUNT, 34);
  const bySeasson = { 2024: [], 2025: [] };
  for (const { season, week } of rosterGeneration.SEASON_WEEKS) bySeasson[season].push(week);
  assert.deepEqual(bySeasson[2024].sort((a, b) => a - b), Array.from({ length: 17 }, (unused, i) => i + 2));
  assert.deepEqual(bySeasson[2025].sort((a, b) => a - b), Array.from({ length: 17 }, (unused, i) => i + 2));
  assert.equal(rosterGeneration.EXPECTED_TOTAL_ROSTERS, 34 * 50, '34 season-weeks x 50 rosters = 1,700 roster-weeks');
});

test('buildAllRosterWeeks builds all 34 season-weeks and totals exactly 1,700 roster-weeks', () => {
  const { seasonWeeks, results, index } = rosterGeneration.buildAllRosterWeeks({
    buildCohortFor: fakeBuildCohortFor,
    buildCandidatesFor: fakeCandidates,
  });
  assert.equal(seasonWeeks.length, 34);
  assert.equal(results.length, 34);
  assert.equal(index.length, 34);
  const totalRosters = results.reduce((sum, r) => sum + r.artifact.rosters.length, 0);
  assert.equal(totalRosters, 1700);
  // Every season-week's freeze hash is distinct.
  assert.equal(new Set(index.map((r) => r.freezeHash)).size, 34);
  // The index carries what a reviewer needs to check one file without reparsing all 34.
  for (const entry of index) {
    assert.equal(typeof entry.freezeHash, 'string');
    assert.equal(entry.rosterCount, 50);
    assert.equal(entry.poolSize, 160);
  }
});

test('buildAllRosterWeeks refuses a season-week list that is not exactly the preregistered 34', () => {
  assert.throws(() => rosterGeneration.buildAllRosterWeeks({
    seasonWeeks: rosterGeneration.SEASON_WEEKS.slice(0, 10),
    buildCohortFor: fakeBuildCohortFor,
    buildCandidatesFor: fakeCandidates,
  }), /covers exactly 34/);
});

test('buildAllRosterWeeks refuses a duplicated season-week', () => {
  const withDupe = [...rosterGeneration.SEASON_WEEKS.slice(0, 33), rosterGeneration.SEASON_WEEKS[0]];
  assert.throws(() => rosterGeneration.buildAllRosterWeeks({
    seasonWeeks: withDupe,
    buildCohortFor: fakeBuildCohortFor,
    buildCandidatesFor: fakeCandidates,
  }), /is listed twice/);
});

test('buildAllRosterWeeks refuses a candidate builder that returns a malformed candidates array', () => {
  assert.throws(() => rosterGeneration.buildAllRosterWeeks({
    buildCohortFor: fakeBuildCohortFor,
    buildCandidatesFor: () => ({ candidates: null, positionRank: new Map(), nameRankById: new Map() }),
  }), /must return a candidates array/);
});

test('is deterministic: the same fakes produce the same freeze hashes on a second run', () => {
  const first = rosterGeneration.buildAllRosterWeeks({
    buildCohortFor: fakeBuildCohortFor, buildCandidatesFor: fakeCandidates,
  });
  const second = rosterGeneration.buildAllRosterWeeks({
    buildCohortFor: fakeBuildCohortFor, buildCandidatesFor: fakeCandidates,
  });
  assert.deepEqual(first.index, second.index);
});
