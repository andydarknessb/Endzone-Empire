'use strict';

const metrics = require('./metrics');
const policy = require('./policy');

function key(row) { return `${row.season}:${row.week}:${row.position}`; }

/**
 * Section 5 pins `T_regret = -mean(regret)` as "the mean deployed-policy regret
 * (prereg 5.2, section 6.1's per-season-week score: the mean over the
 * season-week's 50 rosters)".
 *
 * This precomputes everything about that statistic which the permutation cannot
 * change, so the replicate loop does the minimum work the definition allows:
 *
 *  - roster ENTRIES, which depend on the week's roster and cohort artifacts;
 *  - the ACTUAL points map, which the permutation never touches;
 *  - the BEST legal lineup per roster, computed under actual points - so it is
 *    permutation-invariant by construction and is solved once, not 10,000 times.
 *
 * Only the STARTED lineup varies, because the permutation reassigns the
 * projections a manager would have chosen from. That is the irreducible part.
 */
function buildPolicyContext({
  rosterWeeks, cohortWeeks, positionRank, nameRankById, rosterSlots, availabilityFor, optimize, ordering, actualsByWeek, label,
}) {
  const ranks = {
    positionRank: positionRank instanceof Map ? positionRank : new Map(Object.entries(positionRank || {})),
    nameRankById: nameRankById instanceof Map
      ? nameRankById
      : new Map(Object.entries(nameRankById || {}).map(([id, rank]) => [Number(id), rank])),
  };
  const entriesByWeek = new Map();
  const bestByWeek = new Map();
  for (const week of metrics.EVALUATED_WEEKS) {
    const rosterWeek = rosterWeeks[week] || rosterWeeks[String(week)];
    const cohortWeek = cohortWeeks[week] || cohortWeeks[String(week)];
    if (!rosterWeek || !Array.isArray(rosterWeek.rosters)) throw new Error(`${label}: missing roster artifact for week ${week}`);
    if (!cohortWeek || !Array.isArray(cohortWeek.members)) throw new Error(`${label}: missing cohort artifact for week ${week}`);
    const cohortByPlayerId = new Map(cohortWeek.members.map((m) => [m.playerId, m]));
    const actuals = actualsByWeek.get(week);
    const entries = rosterWeek.rosters.map((roster) => rosterEntriesFor({ roster, cohortByPlayerId, label }));
    entriesByWeek.set(week, entries);
    bestByWeek.set(week, entries.map((rosterEntries) => policy.deployedPolicyLineup({
      entries: rosterEntries, projections: actuals, ranks, rosterSlots, availabilityFor, optimize, ordering, label: `${label}: best`,
    }).started));
  }
  return { entriesByWeek, bestByWeek, ranks, rosterSlots, availabilityFor, optimize, ordering };
}

/**
 * Section 5 pins the score as "the mean over the season-week's 50 ROSTERS", and
 * section 6.4a states the governing principle: "A missing realization is a HARD
 * ERROR that aborts the run, never a silently smaller ... domain: a [gate] whose
 * domain quietly shrank is a safety gate reporting 'no catastrophic row found'
 * about rows it never looked at."
 *
 * `canonicalObservations` asserts complete coverage between the observations and
 * `rosterRows`. The roster and cohort artifacts are INDEPENDENT inputs and had no
 * such assertion, so a player present in them and absent from the observation
 * domain carried no projection and no actual - and both `policy.pointsValue` and
 * `regretFor`'s scorer read a missing value as ZERO. That is the
 * missing-evidence-becomes-a-measured-zero failure, and it moved T_obs, which
 * feeds p_hat, which decides whether the run voids.
 *
 * The COUNT is likewise INJECTED - like the optimizer and the slot model, never
 * read from the --inputs document. Production passes rosters.TEAM_COUNT *
 * rosters.REPLICATES (the same 10 x 5 = 50 that rosters.js asserts when
 * BUILDING an artifact), so an operator cannot weaken the denominator section 5
 * pins. It is a parameter rather than a literal because a conformant control is
 * 50 rosters x 24 salts x 17 weeks x 10,000 replicates = 204,000,000 lineup
 * solves, about an hour. That is a production run, not a unit test. Tests
 * inject a small count to exercise the derivation, and assert separately that
 * the runner passes the pinned 50 and that a wrong count is rejected.
 */
function assertPolicyArtifactDomain({ rosterWeeks, cohortWeeks, actualsByWeek, cells, expectedRosterCount, label }) {
  if (!Number.isInteger(expectedRosterCount) || expectedRosterCount <= 0) {
    throw new Error(`${label}: the pinned roster count must be injected; section 5's denominator is not operator-supplied`);
  }
  for (const week of metrics.EVALUATED_WEEKS) {
    const rosterWeek = rosterWeeks[week] || rosterWeeks[String(week)];
    const cohortWeek = cohortWeeks[week] || cohortWeeks[String(week)];
    if (!rosterWeek || !Array.isArray(rosterWeek.rosters)) throw new Error(`${label}: missing roster artifact for week ${week}`);
    if (!cohortWeek || !Array.isArray(cohortWeek.members)) throw new Error(`${label}: missing cohort artifact for week ${week}`);
    if (rosterWeek.rosters.length !== expectedRosterCount) {
      throw new Error(
        `${label}: week ${week} carries ${rosterWeek.rosters.length} rosters, not the ${expectedRosterCount} `
        + 'section 5 pins as the denominator. A truncated roster artifact silently changes the statistic.'
      );
    }
    // The observation domain for this week: every player the control actually
    // observed, across every position.
    const observed = actualsByWeek.get(week);
    const rostered = new Set(rosterWeek.rosters.flatMap((roster) => [
      ...roster.starters.map((s) => s.playerId), ...roster.bench.map((b) => b.playerId),
    ]));
    for (const playerId of rostered) {
      if (!observed.has(playerId)) {
        throw new Error(
          `${label}: week ${week} roster player ${playerId} has no observation. It would score ZERO in `
          + 'both the started and the best lineup rather than being absent, which is a measured zero '
          + 'standing in for missing evidence.'
        );
      }
    }
    // And the cohort must cover the roster, which `rosterEntriesFor` also
    // enforces per player - asserted here too so the failure names the artifact
    // rather than surfacing mid-derivation.
    const cohortIds = new Set(cohortWeek.members.map((m) => m.playerId));
    for (const playerId of rostered) {
      if (!cohortIds.has(playerId)) throw new Error(`${label}: week ${week} roster player ${playerId} has no cohort entry`);
    }
  }
  // `cells` is the permutation domain; it is already asserted against the
  // observations, so this only records that both were checked against the same
  // week set rather than two different ones.
  if (Object.keys(cells).length !== metrics.EVALUATED_WEEKS.length * metrics.MACRO_POSITIONS.length) {
    throw new Error(`${label}: permutation cell domain and policy artifacts disagree on the week set`);
  }
}

/** Mirrors controlCellEvaluator's rosterEntries: the identity a lineup is built from. */
function rosterEntriesFor({ roster, cohortByPlayerId, label }) {
  const identify = (p, slot) => {
    const member = cohortByPlayerId.get(p.playerId);
    if (!member) {
      throw new Error(`${label}: roster player ${p.playerId} has no cohort entry for this week - the roster and cohort artifacts must be built from the SAME week`);
    }
    return {
      playerId: p.playerId,
      position: member.position,
      teamKey: member.teamKey,
      injuryStatus: member.injuryStatus,
      onBye: member.onBye,
      locked: false,
      slot,
    };
  };
  return [
    ...roster.starters.map((s) => identify(s, s.slot)),
    ...roster.bench.map((b) => identify(b, policy.BENCH)),
  ];
}

/** The per-season-week score: mean deployed-policy regret over the week's rosters. */
function weekDeployedPolicyRegret({ week, projections, actuals, ctx, label }) {
  const entries = ctx.entriesByWeek.get(week);
  const best = ctx.bestByWeek.get(week);
  const rosterRegrets = entries.map((rosterEntries, index) => {
    const started = policy.deployedPolicyLineup({
      entries: rosterEntries,
      projections,
      ranks: ctx.ranks,
      rosterSlots: ctx.rosterSlots,
      availabilityFor: ctx.availabilityFor,
      optimize: ctx.optimize,
      ordering: ctx.ordering,
      label,
    });
    return policy.regretFor({
      startedPlayerIds: started.started, bestPlayerIds: best[index], actualPoints: actuals, label,
    });
  });
  return metrics.weekRegret(rosterRegrets, { label });
}

function canonicalRosterRows(rosterRows, label) {
  if (!Array.isArray(rosterRows) || rosterRows.length === 0) throw new Error(`${label}: requires canonical raw roster rows`);
  const cells = {};
  const seen = new Set();
  for (const row of rosterRows) {
    if (!row || row.season !== 2025 || !metrics.EVALUATED_WEEKS.includes(row.week)
      || !metrics.MACRO_POSITIONS.includes(row.position) || !Number.isFinite(row.playerId)) {
      throw new Error(`${label}: invalid raw roster row`);
    }
    const cellKey = key(row);
    const rowKey = `${cellKey}:${row.playerId}`;
    if (seen.has(rowKey)) throw new Error(`${label}: duplicate roster player ${rowKey}`);
    seen.add(rowKey);
    if (!cells[cellKey]) cells[cellKey] = [];
    cells[cellKey].push(row.playerId);
  }
  for (const week of metrics.EVALUATED_WEEKS) for (const position of metrics.MACRO_POSITIONS) {
    const cellKey = `2025:${week}:${position}`;
    if (!cells[cellKey] || cells[cellKey].length === 0) throw new Error(`${label}: missing roster cell ${cellKey}`);
  }
  if (Object.keys(cells).length !== metrics.EVALUATED_WEEKS.length * metrics.MACRO_POSITIONS.length) {
    throw new Error(`${label}: extra roster coordinate`);
  }
  // Section 5.1 step 4: "The cell's members are sorted by `playerId` as a NUMBER
  // ... ascending, before index 0 is assigned." SORTING is what step 4 requires,
  // and required test (iii) asks that a differently-ordered input yield the SAME
  // permutation - which a rejection cannot satisfy. Step 4 mandates fail-closed
  // for DUPLICATES only, and that check is retained above.
  for (const cellKey of Object.keys(cells)) cells[cellKey].sort((a, b) => a - b);
  return cells;
}

function canonicalObservations(observations, rosterRows, label = 'permutation control') {
  if (!Array.isArray(observations) || observations.length === 0) throw new Error(`${label}: requires canonical raw control observations`);
  const cells = canonicalRosterRows(rosterRows, label);
  const bySaltCell = new Map();
  let previousCoordinate = -1;
  let previousPlayerId = null;
  for (const row of observations) {
    if (!row || row.season !== 2025 || !metrics.EVALUATED_WEEKS.includes(row.week) || !metrics.SALTS.includes(row.salt)
      || !metrics.MACRO_POSITIONS.includes(row.position) || !Number.isFinite(row.playerId)
      || !Number.isFinite(row.actual) || !Number.isFinite(row.projected)) throw new Error(`${label}: invalid raw observation`);
    const coordinateIndex = metrics.SALTS.indexOf(row.salt) * metrics.EVALUATED_WEEKS.length * metrics.MACRO_POSITIONS.length
      + metrics.EVALUATED_WEEKS.indexOf(row.week) * metrics.MACRO_POSITIONS.length
      + metrics.MACRO_POSITIONS.indexOf(row.position);
    if (coordinateIndex < previousCoordinate
      || (coordinateIndex === previousCoordinate && row.playerId <= previousPlayerId)) {
      throw new Error(`${label}: observations must be in canonical salt/week/position/player order`);
    }
    previousCoordinate = coordinateIndex;
    previousPlayerId = row.playerId;
    const coordinate = `${row.salt}:${key(row)}`;
    if (!bySaltCell.has(coordinate)) bySaltCell.set(coordinate, []);
    bySaltCell.get(coordinate).push(row);
  }
  for (const week of metrics.EVALUATED_WEEKS) for (const position of metrics.MACRO_POSITIONS) {
    const cellKey = `2025:${week}:${position}`;
    for (const salt of metrics.SALTS) {
      const rows = bySaltCell.get(`${salt}:${cellKey}`);
      if (!rows || rows.length === 0) throw new Error(`${label}: missing salt/cell ${salt}:${cellKey}`);
      const ids = rows.map((row) => row.playerId);
      if (new Set(ids).size !== ids.length) throw new Error(`${label}: duplicate player in ${salt}:${cellKey}`);
      if (cells[cellKey].length !== ids.length || cells[cellKey].some((id, index) => id !== ids[index])) {
        throw new Error(`${label}: salt player domain differs from the raw roster at ${salt}:${cellKey}`);
      }
    }
  }
  const expected = metrics.SALTS.length * metrics.EVALUATED_WEEKS.length * metrics.MACRO_POSITIONS.length;
  if (bySaltCell.size !== expected) throw new Error(`${label}: extra salt/cell coordinate`);
  return { bySaltCell, cells };
}

/**
 * The order for a cell comes from section 5.1's per-`(replicate, cellKey)`
 * SHA-256 derivation, NOT from a shared stream - there is no stream, and no
 * consumption order to preserve.  The order is shared by all salts and passed
 * to both endpoint calculations; neither endpoint may draw its own randomness.
 *
 * `canonicalObservations` asserts each salt/cell's row playerIds equal the
 * cell's canonical member list elementwise, so index `i` of `order` addresses
 * the same player that `buildPermutations` sorted into position `i`.
 */
function scoreWeek(bySaltCell, orders, week, label, ctx, actualsByWeek) {
  const actuals = actualsByWeek.get(week);
  const perSalt = metrics.SALTS.map((salt) => {
    const rowsByPosition = {};
    // The projections a manager would have chosen from, AFTER the permutation.
    const projections = new Map();
    for (const position of metrics.MACRO_POSITIONS) {
      const cellKey = `2025:${week}:${position}`;
      const rows = bySaltCell.get(`${salt}:${cellKey}`);
      const permuted = orders
        ? metrics.gatherPermutedProjections({ playerIds: rows.map((r) => r.playerId), projections: rows.map((r) => r.projected), order: orders[cellKey], label })
        : rows.map((r) => ({ playerId: r.playerId, projected: r.projected }));
      rowsByPosition[position] = rows.map((row, i) => ({ actual: row.actual, projected: permuted[i].projected }));
      rows.forEach((row, i) => projections.set(row.playerId, permuted[i].projected));
    }
    // Section 5: the mean DEPLOYED-POLICY regret over the week's rosters, which
    // is `best legal lineup under actuals` minus `the lineup these projections
    // would have started`, scored on actuals. NOT mean |projected - actual|:
    // that statistic is invariant to reassigning projections under a uniform
    // bias, so the permutation would be invisible to the very control whose
    // purpose is to detect that the ranking skill has been destroyed.
    return {
      regret: weekDeployedPolicyRegret({ week, projections, actuals, ctx, label }),
      pairwise: metrics.weekPairwise(rowsByPosition, { label }).score,
    };
  });
  return { regret: perSalt.reduce((sum, value) => sum + value.regret, 0) / perSalt.length, pairwise: perSalt.reduce((sum, value) => sum + value.pairwise, 0) / perSalt.length };
}

const resultCache = new Map();

function cloneResult(result) {
  return {
    ...result,
    failures: [...result.failures],
    regret: { ...result.regret },
    pairwise: { ...result.pairwise },
  };
}

function negativeMean(rows, field) {
  const value = -rows.reduce((sum, row) => sum + row[field], 0) / rows.length;
  return value === 0 ? 0 : value;
}

function computePermutationControlFromObservations({
  observations, rosterRows, rosterWeeks, cohortWeeks, positionRank, nameRankById,
  rosterSlots, availabilityFor, optimize, ordering, expectedRosterCount, label = 'permutation control',
}) {
  const { bySaltCell, cells } = canonicalObservations(observations, rosterRows, label);
  // The key must cover EVERY input that can change the result. `positionRank`
  // and `nameRankById` decide candidate order, which policy.js's own docblock
  // calls load-bearing ("equal costs resolve by CANDIDATE COLUMN ORDER"), and
  // `rosterSlots`/`ordering` change the lineup outright. Omitting them returned a
  // stale result for a different question - the exact failure sweepEvidence.js's
  // resample cache is commented against: "a wrong-but-plausible [result] is not
  // a failure that announces itself."
  //
  // The three function-valued inputs cannot be serialized at all, so they are
  // compared by REFERENCE on the cached entry rather than encoded in the key.
  //
  // `positionRank`/`nameRankById` arrive as Maps from tests and plain objects
  // from production JSON - and JSON.stringify(new Map()) is '{}', so an
  // un-canonicalized Map would contribute NOTHING to the key and two calls
  // differing only in rank order would collide. Maps become entry arrays.
  const canonicalRankMap = (value) => (value instanceof Map ? [...value.entries()] : value);
  const cacheKey = JSON.stringify({
    observations, rosterRows, rosterWeeks, cohortWeeks, rosterSlots, ordering, expectedRosterCount,
    positionRank: canonicalRankMap(positionRank), nameRankById: canonicalRankMap(nameRankById),
  });
  const machinery = { availabilityFor, optimize };
  const cached = resultCache.get(cacheKey);
  // A hit may return before assertPolicyArtifactDomain below. That is sound
  // BECAUSE the key is complete: identical bytes mean the same inputs already
  // computed successfully, so the assertion ran and passed for exactly this
  // input set. Rejections throw before the cache is written, so a failure is
  // never replayed as a success.
  if (cached && cached.machinery.availabilityFor === availabilityFor && cached.machinery.optimize === optimize) {
    return cloneResult(cached.result);
  }
  // Actual points are a property of (week, player) and are never touched by the
  // permutation, so they are collected once and shared by every replicate.
  const actualsByWeek = new Map(metrics.EVALUATED_WEEKS.map((week) => [week, new Map()]));
  for (const row of observations) actualsByWeek.get(row.week).set(row.playerId, row.actual);
  assertPolicyArtifactDomain({ rosterWeeks, cohortWeeks, actualsByWeek, cells, expectedRosterCount, label });
  const ctx = buildPolicyContext({
    rosterWeeks, cohortWeeks, positionRank, nameRankById, rosterSlots,
    availabilityFor, optimize, ordering, actualsByWeek, label,
  });
  const observedWeeks = metrics.EVALUATED_WEEKS.map((week) => scoreWeek(bySaltCell, null, week, `${label}: observed`, ctx, actualsByWeek));
  const observed = { regret: negativeMean(observedWeeks, 'regret'), pairwise: observedWeeks.reduce((sum, row) => sum + row.pairwise, 0) / observedWeeks.length };
  const permuted = { regret: [], pairwise: [] };
  // Section 5.1 step 2: each (replicate, cellKey) is seeded by SHA-256 of
  // `PERMUTATION_SEED|replicate|cellKey`, "derived by HASH rather than by
  // consuming one long stream, so replicate `b` never depends on having
  // generated replicates 0..b-1", and step 6 forbids sharing a generator across
  // cells or replicates.
  //
  // `buildPermutations` implements exactly that and had NO production caller:
  // this path previously drew from one shared mulberry32 stream, so `cellKey`
  // never reached the RNG and the replicate index was not an input to
  // randomness at all. Section 5.1's determinism tests (ii), (iii), (iv), (vii),
  // (viii) and (x) all exercise `buildPermutations`, so their entire reach was
  // the module that did not run.
  const permutations = metrics.buildPermutations({ cells, label });
  for (let replicate = 0; replicate < metrics.PERMUTATION_DRAWS; replicate++) {
    const orders = permutations.replicate(replicate);
    const weeks = metrics.EVALUATED_WEEKS.map((week) => scoreWeek(bySaltCell, orders, week, `${label}: replicate ${replicate}`, ctx, actualsByWeek));
    permuted.regret.push(negativeMean(weeks, 'regret'));
    permuted.pairwise.push(weeks.reduce((sum, row) => sum + row.pairwise, 0) / weeks.length);
  }
  const regret = metrics.permutationPValue({ observed: observed.regret, permuted: permuted.regret, label: `${label}: regret` });
  const pairwise = metrics.permutationPValue({ observed: observed.pairwise, permuted: permuted.pairwise, label: `${label}: pairwise` });
  const gate = metrics.assertPermutationControl({ regretP: regret.p, pairwiseP: pairwise.p, label });
  const result = {
    ...gate,
    seed: metrics.PERMUTATION_SEED,
    replicates: metrics.PERMUTATION_DRAWS,
    regret: { observed: observed.regret, ...regret },
    pairwise: { observed: observed.pairwise, ...pairwise },
  };
  if (resultCache.size >= 8) resultCache.delete(resultCache.keys().next().value);
  resultCache.set(cacheKey, { result, machinery });
  return cloneResult(result);
}

module.exports = { canonicalRosterRows, canonicalObservations, computePermutationControlFromObservations };
