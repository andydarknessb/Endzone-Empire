'use strict';

/**
 * The Volatility print (spec #1845, #1847): for each completed week of a
 * season (the holdout ledger's scheduled arm under the three preset scoring
 * profiles) and for the current week's live runs, prints the players the
 * Interval reading would tag at each position, with Point estimate, Floor,
 * Ceiling and width, so the owner can sanity-check the cut (and the constants
 * in `services/intervalReading.js`) before any tag ships.
 *
 * READ-ONLY. It runs every query in a `READ ONLY` transaction, and it writes
 * nothing but markdown files into `--out`. It touches no engine, projection
 * table write or Model version (ADR 0044).
 *
 * Required arguments, no defaults:
 *
 *   --season 2026         the season
 *   --current-week 5      the current week: weeks before it are read from the
 *                         ledger, this one from the live runs
 *   --out <dir>           where the markdown tables are written; resolved against
 *                         the repository root and required to be a directory
 *                         inside it (the same rule as run-holdout-confirm.js)
 *
 * Output: one file per week, scoring profile and position,
 *   <season>-w<week>-<ledger|live>-<profile>-<model version>-<position>.md
 * plus INDEX.md listing them.
 */

const fs = require('fs');
const path = require('path');
const reading = require('../services/intervalReading');
const rootSafety = require('../../scripts/backtest/lib/rootSafety');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SOURCE_LEDGER = 'ledger';
const SOURCE_LIVE = 'live';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--season') args.season = Number(argv[++i]);
    else if (token === '--current-week') args.currentWeek = Number(argv[++i]);
    else if (token === '--out') args.outDir = argv[++i];
    else throw new Error(`print-interval-readings: unknown argument ${token}`);
  }
  for (const [key, flag] of [['season', '--season'], ['currentWeek', '--current-week']]) {
    if (args[key] === undefined) throw new Error(`print-interval-readings: ${flag} is required`);
    if (!Number.isInteger(args[key]) || args[key] < 1) {
      throw new Error(`print-interval-readings: ${flag} must be a positive integer`);
    }
  }
  if (args.outDir === undefined) throw new Error('print-interval-readings: --out is required');
  return args;
}

/**
 * Resolves and confines `--out` exactly as run-holdout-confirm.js's
 * `resolveOutputPaths` does (see there for why): non-empty, not a UNC path,
 * resolved against the repository root, and strictly inside it. Called before
 * any database read, so a bad `--out` fails before any query runs.
 */
function resolveOutputDir(outDir) {
  if (typeof outDir !== 'string' || outDir.trim() === '') {
    throw new Error('print-interval-readings: --out must be a non-empty path');
  }
  rootSafety.assertNotUncFormPath(outDir, 'print-interval-readings: --out');
  // Resolving is the first half of the containment proof: the value is compared
  // against the repository root below, before any filesystem call. The
  // suppression must stay on the line DIRECTLY above the call.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const resolved = path.resolve(REPO_ROOT, outDir);
  const rootCmp = rootSafety.normalizeForCompare(rootSafety.canonicalizeForCompare(REPO_ROOT));
  const outCmp = rootSafety.normalizeForCompare(rootSafety.canonicalizeForCompare(resolved));
  if (!rootSafety.isContainedIn(rootCmp, outCmp)) {
    throw new Error(
      `print-interval-readings: --out (${outDir}) resolves to ${resolved}, which is not a directory inside this repository`
    );
  }
  return resolved;
}

/** A file in the already-confined output directory; `file` is always a generated name. */
function outputPath(dir, file) {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return path.join(dir, file);
}

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : '-');
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * Pure: the markdown table for one position of one week/profile/source.
 * `rows` are that position's rows (interval-reading row shape plus `name`).
 */
function renderPositionTable({ season, week, source, profile, position, rows, note = '' }) {
  const tags = reading.volatilityTags(rows);
  const reference = reading.referenceSet(rows);
  const fit = reading.fitWidthLine(reference.map((r) => ({ x: r.pointEstimate, y: reading.widthOf(r) })));
  const tagged = rows
    .filter((r) => tags.get(r.playerId))
    .sort((a, b) => {
      if (tags.get(a.playerId) !== tags.get(b.playerId)) {
        return tags.get(a.playerId) === reading.TAG_BOOM_OR_BUST ? -1 : 1;
      }
      return b.pointEstimate - a.pointEstimate || String(a.name).localeCompare(String(b.name));
    });

  const lines = [
    `# ${season} week ${week}, ${source}, ${profile}, ${position}`,
    '',
    `- Rows: ${rows.length}; eligible: ${rows.filter(reading.isEligible).length}; reference set ` +
      `(eligible, Point estimate >= ${reading.CONSTANTS.minPointEstimate[position]}): ${reference.length}`,
  ];
  if (reference.length < reading.CONSTANTS.minReferenceSetSize) {
    lines.push(`- No tags: the reference set is smaller than ${reading.CONSTANTS.minReferenceSetSize}.`);
  } else {
    lines.push(`- Width line: width = ${fit.intercept.toFixed(3)} + ${fit.slope.toFixed(3)} x Point estimate`);
    lines.push(`- Tagged: ${tagged.length}`);
  }
  if (note) lines.push(`- ${note}`);
  lines.push('');
  if (tagged.length > 0) {
    lines.push('| Player | Tag | Point estimate | Floor | Ceiling | Width |');
    lines.push('| --- | --- | ---: | ---: | ---: | ---: |');
    for (const r of tagged) {
      lines.push(
        `| ${cell(r.name)} | ${tags.get(r.playerId)} | ${fmt(r.pointEstimate)} | ${fmt(r.p10)} | ${fmt(r.p90)} | ${fmt(reading.widthOf(r))} |`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function slug(season, week, source, profile, modelVersion, position) {
  // One ledger key per (season, week, scoring_hash, model_version, capture_kind):
  // two scheduled captures of a week under different Model versions must not
  // share a file.
  const version = String(modelVersion).replace(/[^A-Za-z0-9._-]/g, '_');
  return `${season}-w${week}-${source}-${profile}-${version}-${position}.md`;
}

/** Pure: every position's table for one week/profile/source. `Map<filename, markdown>`. */
function renderWeekTables({ season, week, source, profile, modelVersion, rows, note }) {
  const out = new Map();
  for (const position of reading.CONSTANTS.positions) {
    const positionRows = rows.filter((r) => r.position === position);
    out.set(
      slug(season, week, source, profile, modelVersion, position),
      renderPositionTable({ season, week, source, profile, position, rows: positionRows, note })
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// I/O shell. Everything below reads; nothing writes to the database.
// ---------------------------------------------------------------------------

function toRow(r, pointEstimate) {
  const num = (v) => (v == null ? null : Number(v));
  return {
    playerId: r.player_id,
    name: r.name,
    position: r.position,
    mean: num(r.mean),
    median: num(r.median),
    p10: num(r.p10),
    p25: num(r.p25),
    p75: num(r.p75),
    p90: num(r.p90),
    sampleSize: Number(r.sample_size) || 0,
    factors: r.factors || {},
    pointEstimate: pointEstimate(r),
  };
}

async function loadLedgerWeeks({ client, season, currentWeek, profile, rules, model, pointEstimateFor }) {
  const headers = await client.query(
    `SELECT "id", "week", "model_version", "is_late"
     FROM "projection_snapshots"
     WHERE "season" = $1 AND "week" < $2 AND "scoring_profile" = $3 AND "scoring_hash" = $4
       AND "capture_kind" = 'scheduled'
     ORDER BY "week"`,
    [season, currentWeek, profile, model.scoringHash(rules)]
  );
  const weeks = [];
  for (const header of headers.rows) {
    const result = await client.query(
      `SELECT sp."player_id", p."name", sp."position", sp."mean", sp."median", sp."p10", sp."p25",
              sp."p75", sp."p90", sp."sample_size", sp."factors"
       FROM "projection_snapshot_players" sp
       JOIN "players" p ON p."id" = sp."player_id"
       WHERE sp."snapshot_id" = $1
       ORDER BY sp."player_id"`,
      [header.id]
    );
    const point = (r) =>
      pointEstimateFor({ mean: r.mean == null ? null : Number(r.mean), median: r.median == null ? null : Number(r.median), modelVersion: header.model_version });
    weeks.push({
      week: header.week,
      modelVersion: header.model_version,
      note: `model ${header.model_version}${header.is_late ? '; LATE capture' : ''}`,
      rows: result.rows.map((r) => toRow(r, point)),
    });
  }
  return weeks;
}

async function loadLiveWeek({ client, season, currentWeek, rules, model, pointEstimateFor }) {
  const runs = await client.query(
    `SELECT "id" FROM "projection_runs"
     WHERE "season" = $1 AND "week" = $2 AND "scoring_hash" = $3 AND "model_version" = $4`,
    [season, currentWeek, model.scoringHash(rules), model.MODEL_VERSION]
  );
  if (runs.rows.length === 0) return null;
  const result = await client.query(
    `SELECT w."player_id", p."name", p."position", w."mean", w."median", w."p10", w."p25",
            w."p75", w."p90", w."sample_size", w."factors"
     FROM "player_week_projections" w
     JOIN "players" p ON p."id" = w."player_id"
     WHERE w."run_id" = $1
     ORDER BY w."player_id"`,
    [runs.rows[0].id]
  );
  const point = (r) =>
    pointEstimateFor({ mean: r.mean == null ? null : Number(r.mean), median: r.median == null ? null : Number(r.median), modelVersion: model.MODEL_VERSION });
  return { week: currentWeek, modelVersion: model.MODEL_VERSION, note: `model ${model.MODEL_VERSION}`, rows: result.rows.map((r) => toRow(r, point)) };
}

async function main(argv) {
  const args = parseArgs(argv);
  const outDir = resolveOutputDir(args.outDir);
  // Loaded here, not at the top, so the pure renderers above import without a pool.
  const pool = require('../modules/pool');
  const model = require('../services/projectionModel');
  const { pointEstimateFor } = require('../services/projection.service');
  const { SCORING_PRESETS } = require('../services/scoringRules');

  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    for (const [profile, rules] of Object.entries(SCORING_PRESETS)) {
      const ctx = { client, season: args.season, currentWeek: args.currentWeek, rules, model, pointEstimateFor };
      const liveWeek = await loadLiveWeek(ctx);
      if (!liveWeek) {
        console.log(`print-interval-readings: no live run for ${profile}, week ${args.currentWeek}, model ${model.MODEL_VERSION}`);
      }
      const sources = [
        [SOURCE_LEDGER, await loadLedgerWeeks({ ...ctx, profile })],
        [SOURCE_LIVE, [liveWeek].filter(Boolean)],
      ];
      for (const [source, weeks] of sources) {
        for (const { week, modelVersion, note, rows } of weeks) {
          const tables = renderWeekTables({ season: args.season, week, source, profile, modelVersion, rows, note });
          for (const [file, markdown] of tables) {
            fs.writeFileSync(outputPath(outDir, file), markdown);
            written.push(file);
          }
        }
      }
    }
    await client.query('ROLLBACK');
  } finally {
    client.release();
    await pool.end();
  }
  written.sort();
  fs.writeFileSync(
    outputPath(outDir, 'INDEX.md'),
    ['# Interval reading print', '', ...written.map((f) => `- [${f}](${f})`), ''].join('\n')
  );
  console.log(`print-interval-readings: wrote ${written.length} tables to ${outDir}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, resolveOutputDir, renderPositionTable, renderWeekTables, slug };
