'use strict';

/**
 * The offline fidelity harness: proof that `off` mode reproduces the stored
 * oracles BIT-IDENTICALLY.
 *
 * This is the load-bearing check of the whole rebuild. Every later number - the
 * sweep, the contrasts, the claim - is computed by replaying production through
 * the snapshot client. If that replay does not reproduce, on the same inputs,
 * the exact output production produced inside the read-only extraction
 * transaction, then nothing downstream describes production and the study
 * measures the harness instead of the model.
 *
 * "Bit-identical" is meant literally: the comparison is over the canonical JSON
 * serialization of the projections, so a `12.300000000000001` against a `12.3`
 * fails, and so does a key that moved. Anything looser would let a rounding
 * difference through, and a rounding difference is exactly how a type-fidelity
 * bug (an ISO string where the oracle had a `Date`) would show up.
 *
 * BRANCH COVERAGE. The six preregistered oracle weeks exist to cover every
 * conditional SQL branch of `loadFeatureBundle` (prereg section 15): the
 * league-wide scan and the normalized defense-game count are each ON in four
 * weeks and OFF in two. The harness asserts it exercised BOTH states of BOTH
 * conditionals - a fidelity run that only ever took one side of a branch has
 * not shown that the other side reproduces.
 *
 * Pure: `generateProjections` is injected (nothing in this tree may require
 * `server/services`), and the snapshot and oracles are handed in already
 * loaded.
 */

const { createSnapshotClient, MODES } = require('./snapshotClient');
const { canonicalJson } = require('./snapshotStore');

/** Pure: the canonical form one oracle row's projection is compared in. */
function canonicalProjection(projection) {
  return canonicalJson(projection);
}

/**
 * Pure: compare a freshly generated projection map against stored oracle rows.
 *
 * Returns every difference rather than the first: when fidelity breaks, the
 * shape of the breakage (one player, one field, or everything) is what tells
 * you where to look.
 */
function diffAgainstOracle({ projections, oracleRows, season, week }) {
  const stored = new Map(oracleRows.map((row) => [Number(row.player_id), row.projection]));
  const produced = new Map([...projections.entries()].map(([id, p]) => [Number(id), p]));

  const differences = [];
  for (const [playerId, storedProjection] of stored) {
    if (!produced.has(playerId)) {
      differences.push({ playerId, kind: 'missing', detail: 'the replay produced no projection' });
      continue;
    }
    // The replay's projection is round-tripped through JSON first, because the
    // stored side already went through it. Comparing a live object against a
    // parsed one would flag `undefined` versus absent as a difference when the
    // storage contract already settled that question.
    const producedJson = canonicalProjection(JSON.parse(JSON.stringify(produced.get(playerId))));
    const storedJson = canonicalProjection(storedProjection);
    if (producedJson !== storedJson) {
      differences.push({
        playerId,
        kind: 'mismatch',
        stored: storedJson,
        produced: producedJson,
      });
    }
  }
  for (const playerId of produced.keys()) {
    if (!stored.has(playerId)) {
      differences.push({ playerId, kind: 'extra', detail: 'the replay produced an unstored projection' });
    }
  }
  return { season, week, compared: stored.size, differences };
}

/**
 * Replay one oracle week through the snapshot client in `off` mode and compare.
 *
 * The client is constructed for exactly this `{season, week}`, so a mistake in
 * the loop that reused a client would be caught by the client's own binding
 * check rather than producing a plausible wrong answer.
 */
async function replayOracleWeek({
  snapshot,
  oracle,
  generateProjections,
  rules,
  hashValue,
  modelConstants,
  now,
  oracleRows,
}) {
  const client = createSnapshotClient({
    snapshot, season: oracle.season, week: oracle.week, mode: MODES.OFF,
  });
  const result = await generateProjections({
    season: oracle.season,
    week: oracle.week,
    rules,
    playerIds: oracleRows.map((row) => Number(row.player_id)),
    hashValue,
    client,
    now,
    // The oracles were captured with weather off; a replay with it on would be
    // comparing two different models.
    weatherService: false,
    modelConstants,
  });
  const diff = diffAgainstOracle({
    projections: result.projections, oracleRows, season: oracle.season, week: oracle.week,
  });
  return {
    ...diff,
    observedQueries: { ...client.counters.byQuery },
    branches: {
      leagueScan: (client.counters.byQuery.leagueScan || 0) > 0,
      defenseGameCount: (client.counters.byQuery.defenseGameCount || 0) > 0,
    },
  };
}

/**
 * Pure: assert each replay took the SAME branch the extraction recorded.
 *
 * Coverage alone is not enough. The extraction wrote down, per oracle week,
 * which conditionals fired when the real engine ran against the real database.
 * If a replay takes the other side of one of those branches, that is a fidelity
 * failure EVEN IF the projections happen to match: it means the snapshot fed
 * the engine a different shape of input (an empty schedule where there were
 * rows, say) and the outputs agreeing was luck rather than reproduction.
 *
 * `manifestOracles` is the manifest's `oracles` array. A week the manifest does
 * not describe is a failure, not a skip.
 */
function assertBranchesMatchManifest(weekReports, manifestOracles, { label = 'fidelity' } = {}) {
  if (!Array.isArray(manifestOracles) || manifestOracles.length === 0) {
    throw new Error(
      `${label}: the manifest records no oracle branches to check the replay against, so "the `
      + 'replay took the right branch" cannot be established'
    );
  }
  const byWeek = new Map(manifestOracles.map((o) => [`${o.season}:${o.week}`, o]));
  for (const report of weekReports) {
    const recorded = byWeek.get(`${report.season}:${report.week}`);
    if (!recorded) {
      throw new Error(
        `${label}: replayed ${report.season} W${report.week}, which the manifest does not describe`
      );
    }
    for (const conditional of ['leagueScan', 'defenseGameCount']) {
      const expected = !!(recorded.branches || {})[conditional];
      const actual = !!report.branches[conditional];
      if (expected !== actual) {
        throw new Error(
          `${label}: ${report.season} W${report.week} replayed with ${conditional} `
          + `${actual ? 'ON' : 'OFF'}, but the extraction recorded it ${expected ? 'ON' : 'OFF'}. `
          + 'The snapshot handed the engine a different shape of input than the database did, so '
          + 'any agreement between the outputs is luck rather than reproduction.'
        );
      }
    }
  }
  return true;
}

/**
 * Pure: assert the replayed weeks exercised BOTH states of BOTH conditionals.
 *
 * A run in which the scan was always on has not shown that the scan-off branch
 * reproduces, and the scan-off branch is the one no evaluated week touches -
 * which is exactly why the preregistration spends two of its six oracles on it.
 */
function assertBranchCoverage(weekReports, { label = 'fidelity' } = {}) {
  const coverage = {};
  for (const conditional of ['leagueScan', 'defenseGameCount']) {
    const seen = new Set(weekReports.map((r) => r.branches[conditional]));
    coverage[conditional] = { on: seen.has(true), off: seen.has(false) };
    if (!seen.has(true) || !seen.has(false)) {
      throw new Error(
        `${label}: the ${conditional} branch was only ever ${seen.has(true) ? 'ON' : 'OFF'} across ` +
        `the ${weekReports.length} replayed week(s). Fidelity has to be shown on BOTH sides of every ` +
        'conditional, and the preregistration picks its oracle weeks precisely so that it can be.'
      );
    }
  }
  return coverage;
}

/**
 * The harness. Replays every oracle week, requires bit-identity everywhere, and
 * requires full branch coverage. Throws on any failure.
 */
async function assertOffModeFidelity({
  snapshot,
  oracles,
  loadOracleRows,
  generateProjections,
  rules,
  hashValue,
  modelConstants,
  now,
  label = 'off-mode fidelity',
}) {
  if (typeof generateProjections !== 'function') {
    throw new Error(`${label} requires the real generateProjections to be injected`);
  }
  if (typeof loadOracleRows !== 'function') {
    throw new Error(`${label} requires a loader for the stored oracle rows`);
  }
  if (!Array.isArray(oracles) || oracles.length === 0) {
    throw new Error(`${label}: no oracles to replay, so nothing was proven`);
  }

  const weekReports = [];
  for (const oracle of oracles) {
    const oracleRows = loadOracleRows(oracle);
    if (!Array.isArray(oracleRows) || oracleRows.length === 0) {
      throw new Error(`${label}: oracle ${oracle.season} W${oracle.week} stored no projections`);
    }
    /* eslint-disable no-await-in-loop */
    weekReports.push(await replayOracleWeek({
      snapshot, oracle, generateProjections, rules, hashValue, modelConstants, now, oracleRows,
    }));
    /* eslint-enable no-await-in-loop */
  }

  const failed = weekReports.filter((r) => r.differences.length > 0);
  if (failed.length > 0) {
    const first = failed[0];
    const firstDiff = first.differences[0];
    throw new Error(
      `${label} FAILED: ${failed.length} of ${weekReports.length} oracle week(s) did not reproduce ` +
      `bit-identically. First: ${first.season} W${first.week}, player ${firstDiff.playerId} ` +
      `(${firstDiff.kind}). ${firstDiff.kind === 'mismatch'
        ? `stored ${String(firstDiff.stored).slice(0, 200)} / produced ${String(firstDiff.produced).slice(0, 200)}`
        : firstDiff.detail}`
    );
  }

  // Checked BEFORE coverage: "you took the branch the database took" is the
  // stronger statement, and its failure message is the more useful one.
  assertBranchesMatchManifest(weekReports, (snapshot.manifest || {}).oracles, { label });
  const coverage = assertBranchCoverage(weekReports, { label });
  return {
    status: 'passed',
    weeks: weekReports.length,
    projectionsCompared: weekReports.reduce((sum, r) => sum + r.compared, 0),
    branchCoverage: coverage,
    perWeek: weekReports.map((r) => ({
      season: r.season, week: r.week, compared: r.compared, branches: r.branches,
    })),
  };
}

module.exports = {
  canonicalProjection,
  diffAgainstOracle,
  replayOracleWeek,
  assertBranchesMatchManifest,
  assertBranchCoverage,
  assertOffModeFidelity,
};
