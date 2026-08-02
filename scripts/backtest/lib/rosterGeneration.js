'use strict';

/**
 * The Step-1 orchestration: every (season, week) the preregistration's cohort
 * covers, 5 seeded replicates each, turned into the frozen roster artifacts
 * committed in freeze Commit A.
 *
 * WHY THIS IS ITS OWN MODULE, SEPARATE FROM `run-backtest-rosters.js`. Building
 * one season-week's rosters needs real database-shaped input - the reconstructed
 * cohort (`lib/cohort.buildCohort`, which itself needs a roster index, a
 * crosswalk, bye/defense team keys, and `normalizeTeamKey`) and the
 * recency-weighted candidate ranking (`lib/rosters.recencyWeightedScore`, which
 * needs each candidate's prior-game history). None of that can be fabricated
 * confidently offline. But the LOOP - "for every one of the 34 preregistered
 * season-weeks, build the cohort, rank it into candidates, build the 5-replicate
 * roster artifact, hash it, and fail loudly if the count comes out wrong" - has
 * nothing database-shaped in it at all. Splitting the loop out here means it can
 * be unit-tested with injected fakes for `buildCohortFor`/`buildCandidatesFor`,
 * the same fake-injection discipline every other file in this tree uses, while
 * `server/scripts/run-backtest-rosters.js` stays a thin real-wiring shim that
 * supplies the real snapshot-client-backed versions of those two functions.
 *
 * THE 34 SEASON-WEEKS (preregistration 4.1, 5.1): 2025 REG weeks 2-18 (the 17
 * primary weeks) and 2024 REG weeks 2-18 (the 17 safety/sensitivity weeks).
 * Order here is season ascending then week ascending (2024 first) purely for a
 * stable, readable artifact index - every artifact's identity is its own
 * `(season, week, replicate, teamIndex)`, seeded independently via
 * `rosters.seedFor`, so iteration order can never change a single roster pick.
 *
 * Pure: no database, no filesystem, no clock, no `Math.random`. `buildCohortFor`
 * and `buildCandidatesFor` are injected, because nothing in `scripts/backtest`
 * may require `server/services` or touch a database directly.
 */

const rosters = require('./rosters');

/** Preregistration 4.1: weeks 2-18 in both seasons, 17 weeks each. */
const EVALUATION_WEEKS = Object.freeze(Array.from({ length: 17 }, (unused, i) => i + 2));
const PRIMARY_SEASON = 2025;
const SENSITIVITY_SEASON = 2024;

/**
 * The 34 preregistered season-weeks, in a stable, deterministic order.
 * 2024 (the sensitivity season) first, then 2025 (the primary season), each
 * ascending by week - an arbitrary but fixed choice, since nothing about a
 * roster artifact's own identity depends on this order.
 */
const SEASON_WEEKS = Object.freeze([
  ...EVALUATION_WEEKS.map((week) => Object.freeze({ season: SENSITIVITY_SEASON, week })),
  ...EVALUATION_WEEKS.map((week) => Object.freeze({ season: PRIMARY_SEASON, week })),
]);

/** 34 season-weeks x 50 rosters (10 teams x 5 replicates) = 1,700 roster-weeks. */
const EXPECTED_SEASON_WEEK_COUNT = 34;
const EXPECTED_ROSTERS_PER_WEEK = rosters.TEAM_COUNT * rosters.REPLICATES;
const EXPECTED_TOTAL_ROSTERS = EXPECTED_SEASON_WEEK_COUNT * EXPECTED_ROSTERS_PER_WEEK;

/**
 * Build one season-week's roster artifact from injected cohort/candidate
 * builders, and hash it.
 *
 * `buildCohortFor({ season, week })` must return whatever `buildCandidatesFor`
 * needs (a real caller's cohort shape, from `lib/cohort.buildCohort`); this
 * module never inspects it beyond passing it through, so `buildCandidatesFor`
 * owns the cohort-to-candidate contract entirely. That keeps this module honest
 * about being an ORCHESTRATOR: it does not know what a cohort or a candidate
 * looks like, only that one produces the other and the other produces a roster.
 */
function buildSeasonWeekRosterArtifact({
  season,
  week,
  buildCohortFor,
  buildCandidatesFor,
  buildRosterWeek = rosters.buildRosterWeek,
  quotas = rosters.CANDIDATE_QUOTAS,
  replicates = rosters.REPLICATES,
  label = 'roster generation',
}) {
  const where = `${label} ${season}w${week}`;
  if (typeof buildCohortFor !== 'function') {
    throw new Error(`${where}: buildCohortFor must be injected - this module cannot fabricate a cohort`);
  }
  if (typeof buildCandidatesFor !== 'function') {
    throw new Error(`${where}: buildCandidatesFor must be injected - this module cannot fabricate a ranking`);
  }
  const cohort = buildCohortFor({ season, week });
  const { candidates, positionRank, nameRankById } = buildCandidatesFor({ season, week, cohort });
  if (!Array.isArray(candidates)) {
    throw new Error(`${where}: buildCandidatesFor must return a candidates array`);
  }
  const artifact = buildRosterWeek({
    season, week, candidates, positionRank, nameRankById, quotas, replicates, label: where,
  });
  if (artifact.rosters.length !== rosters.TEAM_COUNT * replicates) {
    throw new Error(
      `${where}: built ${artifact.rosters.length} rosters, expected ${rosters.TEAM_COUNT * replicates}`
    );
  }
  return { season, week, artifact, freezeHash: rosters.freezeHash(artifact) };
}

/**
 * Build every roster artifact for every preregistered season-week.
 *
 * Fails loudly, rather than returning a partial list, if any season-week is
 * missing from `seasonWeeks`, if the total roster count does not come out to
 * exactly 1,700, or if two season-weeks somehow produce the same freeze hash
 * (which would mean the seeding collapsed two supposedly-independent weeks into
 * one draft - unreachable while `rosters.seedFor` works, and exercised by test
 * for the same reason `arms.assertDistinctConstants` is: a guard that can only
 * fire on an already-broken codebase is still worth having seen fire once).
 */
function buildAllRosterWeeks({
  seasonWeeks = SEASON_WEEKS,
  buildCohortFor,
  buildCandidatesFor,
  buildRosterWeek = rosters.buildRosterWeek,
  quotas = rosters.CANDIDATE_QUOTAS,
  replicates = rosters.REPLICATES,
  label = 'roster generation',
}) {
  if (!Array.isArray(seasonWeeks) || seasonWeeks.length === 0) {
    throw new Error(`${label}: seasonWeeks must be a non-empty array`);
  }
  if (seasonWeeks.length !== EXPECTED_SEASON_WEEK_COUNT) {
    throw new Error(
      `${label}: ${seasonWeeks.length} season-weeks supplied, the preregistration covers exactly `
      + `${EXPECTED_SEASON_WEEK_COUNT} (2025 weeks 2-18 and 2024 weeks 2-18)`
    );
  }
  const seen = new Set();
  for (const { season, week } of seasonWeeks) {
    const key = `${season}:${week}`;
    if (seen.has(key)) throw new Error(`${label}: season-week ${key} is listed twice`);
    seen.add(key);
  }

  const results = [];
  const hashesSeen = new Map();
  let totalRosters = 0;
  for (const { season, week } of seasonWeeks) {
    const result = buildSeasonWeekRosterArtifact({
      season, week, buildCohortFor, buildCandidatesFor, buildRosterWeek, quotas, replicates, label,
    });
    if (hashesSeen.has(result.freezeHash)) {
      throw new Error(
        `${label}: season-week ${season}w${week} has the same freezeHash as `
        + `${hashesSeen.get(result.freezeHash)} - two supposedly-independent weeks produced an `
        + 'identical roster artifact, which should be impossible while the seed derivation is intact'
      );
    }
    hashesSeen.set(result.freezeHash, `${season}w${week}`);
    totalRosters += result.artifact.rosters.length;
    results.push(result);
  }
  // Checked against the ACTUAL `replicates` parameter, not the module-level
  // default-5 constant - EXPECTED_TOTAL_ROSTERS is frozen at load time against
  // rosters.REPLICATES, so asserting against it here would reject any correct
  // run made with a caller-supplied `replicates` override, even though every
  // per-week check above (this function's own hash/count bookkeeping and
  // buildSeasonWeekRosterArtifact's own check) already validates against the
  // real parameter.
  const expectedRostersPerWeek = rosters.TEAM_COUNT * replicates;
  const expectedTotalRosters = seasonWeeks.length * expectedRostersPerWeek;
  if (totalRosters !== expectedTotalRosters) {
    throw new Error(
      `${label}: built ${totalRosters} roster-weeks in total, expected exactly `
      + `${expectedTotalRosters} (${seasonWeeks.length} season-weeks x `
      + `${expectedRostersPerWeek} rosters each)`
    );
  }
  return {
    seasonWeeks: [...seasonWeeks],
    results,
    index: results.map((r) => ({
      season: r.season,
      week: r.week,
      freezeHash: r.freezeHash,
      rosterCount: r.artifact.rosters.length,
      poolSize: r.artifact.poolSize,
    })),
  };
}

module.exports = {
  EVALUATION_WEEKS,
  PRIMARY_SEASON,
  SENSITIVITY_SEASON,
  SEASON_WEEKS,
  EXPECTED_SEASON_WEEK_COUNT,
  EXPECTED_ROSTERS_PER_WEEK,
  EXPECTED_TOTAL_ROSTERS,
  buildSeasonWeekRosterArtifact,
  buildAllRosterWeeks,
};
