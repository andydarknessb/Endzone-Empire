'use strict';

/**
 * Pure report builders for the Phase-0 scripted inspection pass.
 *
 * SCOPE IS LOAD-BEARING. Before the preregistration seals, the only things
 * anyone is allowed to learn from these files are (1) their schema, (2)
 * categorical value counts, and (3) ID integrity. No fantasy points, no
 * per-player statistics, no candidate metric, no outcome of any kind is
 * computed here, because a preregistration written after peeking at outcomes
 * is not a preregistration. The functions in this module physically cannot
 * produce one: they count strings and compare identifiers, and nothing in the
 * module multiplies, sums, or scores a stat column.
 *
 * Every output is deterministic - sorted by value, never by count, never by
 * encounter order - so the same bytes always produce the same report file and
 * a diff means the SOURCE changed.
 */

/** How many example keys a duplicate/malformed list carries before truncating. */
const SAMPLE_LIMIT = 25;

/** Pure: sorted `[{ value, count }]` over one column, blanks counted as "". */
function valueCounts(rows, column) {
  const counts = new Map();
  for (const row of rows) {
    const raw = row[column];
    const value = raw == null ? '' : String(raw);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([value, count]) => ({ value, count }));
}

/** Pure: a composite key string from the named columns, tab-joined. */
function compositeKey(row, columns) {
  return columns.map((c) => (row[c] == null ? '' : String(row[c]))).join('\t');
}

/**
 * Pure: sorted cross-tabulation of two categorical columns.
 *
 * This is what makes the roster status mapping MECHANICAL rather than a guess:
 * nflverse's `status` is a three-letter transaction code and
 * `status_description_abbr` is the league's own longer code for the same row,
 * so crossing them shows which description each status code actually stands
 * for in these exact bytes, with no outcome involved.
 */
function crossTab(rows, columnA, columnB) {
  const counts = new Map();
  for (const row of rows) {
    const a = row[columnA] == null ? '' : String(row[columnA]);
    const b = row[columnB] == null ? '' : String(row[columnB]);
    const key = `${a}\t${b}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([key, count]) => {
      const [a, b] = key.split('\t');
      return { [columnA]: a, [columnB]: b, count };
    });
}

/**
 * Pure: duplicate-record report over a composite key.
 * `duplicateKeys` lists only keys seen more than once, sorted, truncated to
 * SAMPLE_LIMIT with the true total kept alongside - fail-closed extraction in
 * Phase 1 refuses on any duplicate at all, so the count is what matters and
 * the sample is for the human reading the report.
 */
function duplicateReport(rows, keyColumns) {
  const counts = new Map();
  for (const row of rows) {
    const key = compositeKey(row, keyColumns);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const dupes = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    keyColumns: [...keyColumns],
    rowCount: rows.length,
    distinctKeys: counts.size,
    duplicateKeyCount: dupes.length,
    duplicateRowExcess: dupes.reduce((sum, [, n]) => sum + (n - 1), 0),
    duplicateKeys: dupes.slice(0, SAMPLE_LIMIT).map(([key, count]) => ({
      key: key.split('\t'),
      count,
    })),
    duplicateKeysTruncated: dupes.length > SAMPLE_LIMIT,
  };
}

/**
 * ID shape rules. nflverse GSIS ids are `00-` plus seven digits; the stat
 * files additionally use the literal `0` as a placeholder on team-level and
 * penalty rows (nflverseSync.service.js:174 already skips those). ESPN ids are
 * bare digits. Anything else is malformed and is REPORTED, never silently
 * dropped, because Phase-1 extraction fails closed on malformed ids.
 */
const GSIS_PATTERN = /^00-\d{7}$/;
const ESPN_PATTERN = /^\d+$/;

/** Pure: shape report for one identifier column. */
function idShapeReport(rows, column, pattern, { placeholders = [] } = {}) {
  let blank = 0;
  let placeholder = 0;
  let wellFormed = 0;
  const malformed = new Map();
  for (const row of rows) {
    const raw = row[column];
    const value = raw == null ? '' : String(raw).trim();
    if (value === '') {
      blank++;
    } else if (placeholders.includes(value)) {
      placeholder++;
    } else if (pattern.test(value)) {
      wellFormed++;
    } else {
      malformed.set(value, (malformed.get(value) || 0) + 1);
    }
  }
  const malformedSorted = [...malformed.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return {
    column,
    pattern: String(pattern),
    rowCount: rows.length,
    blank,
    placeholder,
    wellFormed,
    malformedRowCount: malformedSorted.reduce((sum, [, n]) => sum + n, 0),
    malformedDistinctCount: malformedSorted.length,
    malformedSamples: malformedSorted.slice(0, SAMPLE_LIMIT).map(([value, count]) => ({ value, count })),
    malformedTruncated: malformedSorted.length > SAMPLE_LIMIT,
  };
}

/**
 * Pure: the gsis -> espn crosswalk integrity report.
 *
 * Three separate failure modes, deliberately reported separately because they
 * mean different things:
 *   - `gsisWithMultipleEspn`: one GSIS id mapped to two different ESPN ids.
 *     Phase 1 refuses to extract on any of these (the plan's fail-closed rule).
 *   - `espnWithMultipleGsis`: two players collapsing onto one ESPN id, which
 *     would silently merge two careers on join.
 *   - `duplicateGsisRows`: the same (gsis, espn) pair listed twice, which is
 *     harmless to the mapping but still a source defect worth naming.
 */
function crosswalkReport(rows, { gsisColumn = 'gsis_id', espnColumn = 'espn_id' } = {}) {
  const byGsis = new Map();
  const byEspn = new Map();
  const pairCounts = new Map();
  let bothPresent = 0;
  let gsisOnly = 0;
  let espnOnly = 0;
  let neither = 0;
  for (const row of rows) {
    const gsis = String(row[gsisColumn] == null ? '' : row[gsisColumn]).trim();
    const espn = String(row[espnColumn] == null ? '' : row[espnColumn]).trim();
    if (gsis && espn) bothPresent++;
    else if (gsis) gsisOnly++;
    else if (espn) espnOnly++;
    else neither++;
    if (!gsis || !espn) continue;
    if (!byGsis.has(gsis)) byGsis.set(gsis, new Set());
    byGsis.get(gsis).add(espn);
    if (!byEspn.has(espn)) byEspn.set(espn, new Set());
    byEspn.get(espn).add(gsis);
    const pair = `${gsis}\t${espn}`;
    pairCounts.set(pair, (pairCounts.get(pair) || 0) + 1);
  }
  const multiEspn = [...byGsis.entries()]
    .filter(([, set]) => set.size > 1)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const multiGsis = [...byEspn.entries()]
    .filter(([, set]) => set.size > 1)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const dupePairs = [...pairCounts.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return {
    rowCount: rows.length,
    bothPresent,
    gsisOnly,
    espnOnly,
    neither,
    distinctGsisWithEspn: byGsis.size,
    distinctEspnWithGsis: byEspn.size,
    gsisWithMultipleEspnCount: multiEspn.length,
    gsisWithMultipleEspn: multiEspn.slice(0, SAMPLE_LIMIT).map(([gsis, set]) => ({
      gsis_id: gsis,
      espn_ids: [...set].sort(),
    })),
    espnWithMultipleGsisCount: multiGsis.length,
    espnWithMultipleGsis: multiGsis.slice(0, SAMPLE_LIMIT).map(([espn, set]) => ({
      espn_id: espn,
      gsis_ids: [...set].sort(),
    })),
    duplicatePairRowCount: dupePairs.length,
    duplicatePairs: dupePairs.slice(0, SAMPLE_LIMIT).map(([pair, count]) => {
      const [gsis_id, espn_id] = pair.split('\t');
      return { gsis_id, espn_id, count };
    }),
  };
}

/**
 * Pure: cross-source coverage of an identifier - how many distinct ids in
 * `rows` appear in the crosswalk's key set. Counting only; no outcome is
 * attached to any id.
 */
function coverageReport(rows, column, knownIds, { placeholders = [], mappedIds = null } = {}) {
  const distinct = new Set();
  for (const row of rows) {
    const value = String(row[column] == null ? '' : row[column]).trim();
    if (!value || placeholders.includes(value)) continue;
    distinct.add(value);
  }
  const missing = [...distinct].filter((id) => !knownIds.has(id)).sort();
  const report = {
    column,
    distinctIds: distinct.size,
    coveredByCrosswalk: distinct.size - missing.length,
    missingFromCrosswalkCount: missing.length,
    missingSamples: missing.slice(0, SAMPLE_LIMIT),
    missingTruncated: missing.length > SAMPLE_LIMIT,
  };
  if (mappedIds) {
    // Present in the crosswalk is not the same as MAPPABLE: a players.csv row
    // can carry a gsis id and no espn id, and the cohort is the MAPPED one.
    const unmapped = [...distinct].filter((id) => !mappedIds.has(id)).sort();
    report.mappableToEspn = distinct.size - unmapped.length;
    report.unmappableCount = unmapped.length;
    report.unmappableSamples = unmapped.slice(0, SAMPLE_LIMIT);
    report.unmappableTruncated = unmapped.length > SAMPLE_LIMIT;
  }
  return report;
}

/** Pure: recursively sort object keys so a serialized report is byte-stable. */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/** Pure: canonical JSON text for a report - sorted keys, LF, trailing newline. */
function serializeReport(report) {
  return `${JSON.stringify(canonicalize(report), null, 2)}\n`;
}

module.exports = {
  SAMPLE_LIMIT,
  GSIS_PATTERN,
  ESPN_PATTERN,
  valueCounts,
  compositeKey,
  crossTab,
  duplicateReport,
  idShapeReport,
  crosswalkReport,
  coverageReport,
  canonicalize,
  serializeReport,
};
