/* eslint-disable no-console */
'use strict';

/**
 * Phase 0 scripted inspection of the pinned sources.
 *
 * Usage:
 *   node scripts/backtest/inspect-sources.js [--only <name>]... [--stdout]
 *
 * Writes one JSON report per source plus an index and a readable summary to
 * `backtest-data/inspection/`. Every source is re-read through
 * `readVerified`, so a report can only ever describe bytes that still hash to
 * what the provenance pinned.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. The preregistration is sealed against
 * these reports, so the reports must not contain anything that could steer a
 * preregistered choice toward a favorable answer. Three report families only:
 *
 *   1. schema - the exact column list of each file;
 *   2. categorical value counts - roster `status`, injury `report_status`,
 *      position codes, team codes, game/season types;
 *   3. ID integrity - duplicate gsis->espn crosswalk rows, malformed ids,
 *      duplicate player-week roster and injury records.
 *
 * No fantasy points. No stat column is summed, averaged, or scored. No
 * candidate metric, no arm, no comparison between seasons on any outcome. The
 * builders in `lib/inspect.js` cannot express one.
 *
 * Reads nothing but the pinned files on disk: no network, no database.
 */

const fs = require('fs');
const path = require('path');

const { readVerified, assertColumns } = require('./lib/sourceFetch');
const { collectColumns, parseCsvHeader } = require('./lib/csv');
const { SOURCES } = require('./lib/sources');
const {
  GSIS_PATTERN,
  ESPN_PATTERN,
  valueCounts,
  crossTab,
  duplicateReport,
  idShapeReport,
  crosswalkReport,
  coverageReport,
  serializeReport,
} = require('./lib/inspect');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'backtest-data');
const SOURCES_DIR = path.join(DATA_DIR, 'sources');
const INSPECTION_DIR = path.join(DATA_DIR, 'inspection');
const PROVENANCE_PATH = path.join(SOURCES_DIR, 'provenance.json');

/** The GSIS placeholder nflverse uses for team-level and penalty rows. */
const GSIS_PLACEHOLDERS = ['0'];

function parseArgs(argv) {
  const args = { only: [], stdout: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--stdout') args.stdout = true;
    else if (token === '--only') args.only.push(argv[++i]);
    else if (token.startsWith('--only=')) args.only.push(token.slice('--only='.length));
    else throw new Error(`unknown argument ${token}`);
  }
  return args;
}

/** Columns each kind projects out of its file. Nothing else is even read. */
const PROJECTIONS = {
  roster_weekly: ['season', 'week', 'game_type', 'team', 'position', 'status', 'status_description_abbr', 'gsis_id'],
  injuries: ['season', 'week', 'game_type', 'team', 'position', 'report_status', 'gsis_id'],
  games: ['game_id', 'season', 'game_type', 'week', 'home_team', 'away_team', 'location'],
  stats_player_week: ['season', 'week', 'season_type', 'player_id', 'team', 'position'],
  stats_team_week: ['season', 'week', 'season_type', 'team', 'opponent_team'],
  players: ['gsis_id', 'espn_id'],
};

/** Optional columns whose presence is itself a recorded Phase-0 finding. */
const PRESENCE_PROBES = {
  injuries: ['date_modified', 'practice_status', 'report_primary_injury'],
  roster_weekly: ['espn_id', 'status_description_abbr', 'depth_chart_position'],
};

function buildSourceReport(source, text) {
  const header = parseCsvHeader(text);
  // Re-run the fetch-time schema gate. The SHA-256 check above proves the bytes
  // have not drifted since they were pinned; it does NOT prove the registry
  // still asks for the same columns. Re-validating here means an edit to
  // `requiredColumns` cannot produce a report built on a column the source does
  // not have, and it keeps the inspector honest when run standalone.
  assertColumns({ header, requiredColumns: source.requiredColumns, label: source.name });
  const probes = PRESENCE_PROBES[source.kind] || [];
  const projected = PROJECTIONS[source.kind];
  const present = new Set(header);
  const { rows, rowCount } = collectColumns(text, projected, { label: source.name });

  const report = {
    source: source.name,
    kind: source.kind,
    season: source.season,
    schema: {
      columnCount: header.length,
      columns: [...header],
    },
    columnPresence: Object.fromEntries(probes.map((c) => [c, present.has(c)])),
    rowCount,
    categorical: {},
    idIntegrity: {},
  };

  if (source.kind === 'roster_weekly') {
    report.categorical.status = valueCounts(rows, 'status');
    report.categorical.position = valueCounts(rows, 'position');
    report.categorical.team = valueCounts(rows, 'team');
    report.categorical.game_type = valueCounts(rows, 'game_type');
    report.categorical.week = valueCounts(rows, 'week');
    report.categorical.status_description_abbr = valueCounts(rows, 'status_description_abbr');
    // The league's own longer code for the same row: this is what makes the
    // active-type / reserve-type split mechanical rather than a guess.
    report.categorical.statusByDescription = crossTab(rows, 'status', 'status_description_abbr');
    report.categorical.statusByPosition = crossTab(rows, 'status', 'position');
    report.idIntegrity.gsis = idShapeReport(rows, 'gsis_id', GSIS_PATTERN, { placeholders: GSIS_PLACEHOLDERS });
    report.idIntegrity.playerWeekDuplicates = duplicateReport(rows, ['season', 'week', 'game_type', 'gsis_id']);
    report.idIntegrity.playerWeekTeamDuplicates = duplicateReport(rows, ['season', 'week', 'game_type', 'team', 'gsis_id']);
    report.idIntegrity.playerWeekDuplicatesWithGsis = duplicateReport(
      rows.filter((r) => String(r.gsis_id || '').trim() !== ''),
      ['season', 'week', 'game_type', 'gsis_id']
    );
  } else if (source.kind === 'injuries') {
    report.categorical.report_status = valueCounts(rows, 'report_status');
    report.categorical.position = valueCounts(rows, 'position');
    report.categorical.team = valueCounts(rows, 'team');
    report.categorical.game_type = valueCounts(rows, 'game_type');
    report.categorical.week = valueCounts(rows, 'week');
    report.idIntegrity.gsis = idShapeReport(rows, 'gsis_id', GSIS_PATTERN, { placeholders: GSIS_PLACEHOLDERS });
    report.idIntegrity.playerWeekDuplicates = duplicateReport(rows, ['season', 'week', 'game_type', 'gsis_id']);
  } else if (source.kind === 'games') {
    report.categorical.game_type = valueCounts(rows, 'game_type');
    report.categorical.location = valueCounts(rows, 'location');
    report.categorical.home_team = valueCounts(rows, 'home_team');
    report.categorical.away_team = valueCounts(rows, 'away_team');
    report.categorical.season = valueCounts(rows, 'season');
    report.idIntegrity.gameIdDuplicates = duplicateReport(rows, ['game_id']);
    const backtestRows = rows.filter(
      (r) => (r.season === '2024' || r.season === '2025') && r.game_type === 'REG'
    );
    report.backtestScope = {
      note: 'REG rows for the two backtest seasons only; counts, no outcomes.',
      rowCount: backtestRows.length,
      bySeasonWeek: valueCounts(backtestRows, 'season'),
      weekCounts: valueCounts(backtestRows, 'week'),
      neutralOrOtherLocation: valueCounts(backtestRows, 'location'),
    };
  } else if (source.kind === 'stats_player_week') {
    report.categorical.season_type = valueCounts(rows, 'season_type');
    report.categorical.position = valueCounts(rows, 'position');
    report.categorical.team = valueCounts(rows, 'team');
    report.categorical.week = valueCounts(rows, 'week');
    report.idIntegrity.gsis = idShapeReport(rows, 'player_id', GSIS_PATTERN, { placeholders: GSIS_PLACEHOLDERS });
    report.idIntegrity.playerWeekDuplicates = duplicateReport(rows, ['season', 'week', 'season_type', 'player_id']);
    report.idIntegrity.playerWeekTeamDuplicates = duplicateReport(rows, ['season', 'week', 'season_type', 'team', 'player_id']);
  } else if (source.kind === 'stats_team_week') {
    report.categorical.season_type = valueCounts(rows, 'season_type');
    report.categorical.team = valueCounts(rows, 'team');
    report.categorical.opponent_team = valueCounts(rows, 'opponent_team');
    report.categorical.week = valueCounts(rows, 'week');
    report.idIntegrity.teamWeekDuplicates = duplicateReport(rows, ['season', 'week', 'season_type', 'team']);
  } else if (source.kind === 'players') {
    report.idIntegrity.gsis = idShapeReport(rows, 'gsis_id', GSIS_PATTERN, { placeholders: GSIS_PLACEHOLDERS });
    report.idIntegrity.espn = idShapeReport(rows, 'espn_id', ESPN_PATTERN);
    report.idIntegrity.crosswalk = crosswalkReport(rows);
  } else {
    throw new Error(`${source.name}: no inspection rules for kind ${source.kind}`);
  }
  return { report, rows };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(PROVENANCE_PATH)) {
    throw new Error(`no provenance at ${PROVENANCE_PATH} - run fetch-sources.js first`);
  }
  const provenance = JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf8'));
  const byName = new Map((provenance.records || []).map((r) => [r.name, r]));
  const targets = args.only.length > 0
    ? SOURCES.filter((s) => args.only.includes(s.name))
    : SOURCES;
  if (targets.length === 0) throw new Error('no matching sources');

  fs.mkdirSync(INSPECTION_DIR, { recursive: true });

  const index = [];
  const rowsByName = new Map();
  for (const source of targets) {
    const record = byName.get(source.name);
    if (!record) throw new Error(`${source.name}: no provenance record; refusing to inspect unpinned bytes`);
    const bytes = readVerified(path.join(SOURCES_DIR, source.file), record.sha256, { label: source.name });
    const { report, rows } = buildSourceReport(source, bytes.toString('utf8'));
    report.provenance = {
      url: record.url,
      sha256: record.sha256,
      byteLength: record.byteLength,
      observedHosts: record.observedHosts,
      ...(record.gitBlobSha1 ? { gitBlobSha1: record.gitBlobSha1 } : {}),
    };
    rowsByName.set(source.name, rows);
    const outPath = path.join(INSPECTION_DIR, `${source.name}.json`);
    const text = serializeReport(report);
    if (args.stdout) console.log(text);
    else fs.writeFileSync(outPath, text);
    index.push({
      source: source.name,
      kind: source.kind,
      season: source.season,
      rowCount: report.rowCount,
      columnCount: report.schema.columnCount,
      sha256: record.sha256,
      report: `${source.name}.json`,
    });
    console.log(`  ${source.name}: ${report.rowCount} rows, ${report.schema.columnCount} columns -> ${path.relative(REPO_ROOT, outPath)}`);
  }

  // Cross-source ID coverage: how many roster/stat GSIS ids the crosswalk
  // actually carries. Counts only; nothing is scored or ranked.
  if (rowsByName.has('players')) {
    const playerRows = rowsByName.get('players');
    const known = new Set(
      playerRows
        .map((r) => String(r.gsis_id || '').trim())
        .filter((v) => v && !GSIS_PLACEHOLDERS.includes(v))
    );
    // Only well-formed GSIS ids WITH an espn id are actually mappable to an
    // internal player, which is what "mapped reconstructed roster cohort"
    // means. players.csv also carries pre-GSIS-era rows under a legacy id
    // shape; those are counted separately and never used as a crosswalk key.
    const mapped = new Set(
      playerRows
        .filter((r) => GSIS_PATTERN.test(String(r.gsis_id || '').trim()) && ESPN_PATTERN.test(String(r.espn_id || '').trim()))
        .map((r) => String(r.gsis_id).trim())
    );
    const coverage = {};
    for (const [name, rows] of rowsByName) {
      if (name === 'players' || name === 'games') continue;
      const column = name.startsWith('stats_player_week') ? 'player_id' : 'gsis_id';
      if (name.startsWith('stats_team_week')) continue;
      coverage[name] = coverageReport(rows, column, known, {
        placeholders: GSIS_PLACEHOLDERS,
        mappedIds: mapped,
      });
    }
    const coveragePath = path.join(INSPECTION_DIR, 'crosswalk-coverage.json');
    const text = serializeReport({
      note: 'Distinct GSIS ids per source and whether the players.csv crosswalk carries them. Counts only.',
      crosswalkDistinctGsis: known.size,
      crosswalkWellFormedGsisWithEspn: mapped.size,
      crosswalkLegacyShapeGsisRows: playerRows.filter((r) => !GSIS_PATTERN.test(String(r.gsis_id || '').trim())).length,
      coverage,
    });
    if (args.stdout) console.log(text);
    else fs.writeFileSync(coveragePath, text);
    console.log(`  crosswalk-coverage -> ${path.relative(REPO_ROOT, coveragePath)}`);
  }

  if (!args.stdout) {
    fs.writeFileSync(
      path.join(INSPECTION_DIR, 'index.json'),
      serializeReport({
        note: 'Scripted Phase-0 inspection: schema, categorical value counts, ID integrity. No outcomes.',
        generator: 'scripts/backtest/inspect-sources.js',
        sources: index,
      })
    );
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
}

module.exports = { parseArgs, buildSourceReport, INSPECTION_DIR, PROJECTIONS };
