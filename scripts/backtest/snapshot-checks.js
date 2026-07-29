/* eslint-disable no-console */
'use strict';

/**
 * Post-extraction verification of a snapshot. Read-only, offline, and exits
 * nonzero on any failure.
 *
 * This is the second pair of eyes on the extraction, and the two must not share
 * their arithmetic. Two rules keep it honest:
 *
 * 1. **Every expected count is DERIVED, never hardcoded.** Row counts come from
 *    the manifest the extraction wrote; the orientation patch count comes from
 *    counting REG games in the archived `games.csv` and doubling it (two team
 *    rows per game). A literal `544` in this file would pass whatever the
 *    extraction happened to produce, which is the opposite of a check. The
 *    preregistration's 272-per-season figure appears only as a plausibility
 *    band, so a source that changed identity is noticed, and the band is stated
 *    as a range rather than an equality.
 *
 * 2. **Digests are re-verified from bytes.** `snapshotStore.loadDataset`
 *    recomputes each dataset's SHA-256 and compares it to the sidecar; this
 *    file additionally compares the sidecar to the MANIFEST's independently
 *    recorded digest, so rewriting a dataset and its sidecar together is still
 *    caught.
 *
 * What it reports beyond pass/fail, because the plan asks for these counts
 * explicitly and they are findings rather than failures: `stats.gameTeam`
 * coverage, crosswalk-unmapped roster identifiers, and roster-versus-`gameTeam`
 * team contradictions (the roster file is the authority; a contradiction is
 * REPORTED and never used to exclude - preregistration 4.1).
 *
 * Usage:
 *   node scripts/backtest/snapshot-checks.js [--snapshot <dir>] [--sources-dir <dir>]
 *                                            [--provenance <file>] [--quiet]
 */

const path = require('path');

const { readVerified, readProvenanceRecords, sha256Hex } = require('./lib/verifiedBytes');
const { collectColumns } = require('./lib/csv');
const { SOURCES, sourceByName, assertSafeSourceFile, GAMES_CSV_SHA256 } = require('./lib/sources');
const store = require('./lib/snapshotStore');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_DATA_DIR = path.join(REPO_ROOT, 'backtest-data');
const DEFAULT_SNAPSHOT_DIR = path.join(DEFAULT_DATA_DIR, 'snapshot');
const DEFAULT_SOURCES_DIR = path.join(DEFAULT_DATA_DIR, 'sources');
const DEFAULT_PROVENANCE_PATH = path.join(DEFAULT_SOURCES_DIR, 'provenance.json');

/**
 * Plausibility band for regular-season games per season.
 *
 * The AUTHORITY for the expected patch count is always the archived file
 * itself - two team rows per REG game, counted from the bytes. This band exists
 * only to notice that the PINNED source's identity changed underneath the pin,
 * so it is applied ONLY when the bytes just read hash to the preregistered
 * `games.csv` SHA-256. Applying it to any other bytes would turn a legitimate
 * smaller input into a failure and would tell a reader nothing about the pinned
 * file, which is the only thing the band is about.
 */
const REG_GAMES_PER_SEASON_BAND = Object.freeze({ min: 256, max: 285 });

function pass(name, detail, counts = {}) {
  return { name, ok: true, detail, counts };
}

function fail(name, detail, counts = {}) {
  return { name, ok: false, detail, counts };
}

/**
 * Read one archived source, hash-verified. Same discipline as the extraction:
 * `sourcesDir` is ours and `source.file` is a frozen-registry literal re-proved
 * to be a bare lowercase `.csv` basename, so the join cannot escape. Do not
 * relax `assertSafeSourceFile` without revisiting this line.
 */
function makeSourceReader({ sourcesDir, provenancePath }) {
  const provenance = readProvenanceRecords(provenancePath);
  return function readSource(name) {
    const source = sourceByName(name);
    const record = provenance.get(name);
    if (!record) throw new Error(`${name}: no Phase-0 provenance record to verify against`);
    const file = assertSafeSourceFile(source.file, { label: name });
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const full = path.join(sourcesDir, file);
    return readVerified(full, record.sha256, { label: name }).toString('utf8');
  };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Every dataset the manifest lists must load, hash to the digest the manifest
 * recorded, and carry the row count the manifest recorded.
 *
 * `loadDataset` re-runs the quarantine and the target-week cutoff on read, so
 * this single check also proves that no evaluation dataset holds a 2026 row.
 */
function checkDatasets({ root, manifest }) {
  const results = [];
  const loaded = new Map();
  const listed = manifest.datasets || [];
  if (listed.length === 0) {
    results.push(fail('datasets', 'the manifest lists no datasets'));
    return { results, loaded };
  }
  for (const entry of listed) {
    const label = `${entry.store}/${entry.path}/${entry.dataset}`;
    try {
      const { rows, meta } = store.loadDataset({
        root,
        store: entry.store,
        path: entry.path,
        dataset: entry.dataset,
        expectedSha256: entry.sha256,
      });
      if (rows.length !== entry.rowCount) {
        results.push(fail(`dataset:${label}`,
          `${rows.length} rows on disk, the manifest records ${entry.rowCount}`));
        continue;
      }
      if (meta.seasonScoped !== entry.seasonScoped) {
        results.push(fail(`dataset:${label}`,
          `sidecar says seasonScoped=${meta.seasonScoped}, the manifest says ${entry.seasonScoped}`));
        continue;
      }
      loaded.set(entry.dataset, { rows, meta, entry });
      results.push(pass(`dataset:${label}`, 'digest, row count and quarantine verified',
        { rows: rows.length }));
    } catch (err) {
      results.push(fail(`dataset:${label}`, err.message));
    }
  }
  return { results, loaded };
}

/**
 * The 2026 quarantine, asserted independently of the store's own load-time
 * guard: this walks every loaded evaluation row and looks at its season
 * directly, so a bug that disabled the guard inside the store still fails here.
 */
function checkQuarantine({ loaded }) {
  let evaluationRows = 0;
  const offenders = [];
  for (const [dataset, { rows, entry }] of loaded) {
    if (entry.store !== store.STORES.EVALUATION) continue;
    for (const row of rows) {
      evaluationRows++;
      const season = store.seasonOf(row);
      if (season !== null && season >= store.QUARANTINE_FROM_SEASON) {
        offenders.push(`${dataset} season ${season}`);
      }
    }
  }
  if (offenders.length > 0) {
    return fail('quarantine',
      `${offenders.length} evaluation row(s) at or after ${store.QUARANTINE_FROM_SEASON}: ` +
      `${offenders.slice(0, 5).join(', ')}`);
  }
  return pass('quarantine',
    `no evaluation row is at or after ${store.QUARANTINE_FROM_SEASON}`,
    { evaluationRows });
}

/**
 * The raw provenance store is where games.csv's 2026 rows are ALLOWED to live
 * (preregistration section 17). If they are absent, provenance was silently
 * trimmed - which would be a quiet loss of the pinned file's identity, so it is
 * a failure and not a shrug.
 */
function checkRawProvenanceRetains2026({ loaded, manifest }) {
  const games = loaded.get('games_csv');
  if (!games) return fail('rawProvenance', 'the raw store has no games_csv dataset');
  if (games.entry.store !== store.STORES.RAW) {
    return fail('rawProvenance', `games_csv is in the ${games.entry.store} store, not raw`);
  }
  // The provenance PATH, specifically. This is the one dataset in the snapshot
  // that legitimately holds rows at or after the quarantine boundary, and the
  // path kind is what makes a feature loader unable to reach it.
  if (games.entry.path !== store.PATHS.PROVENANCE) {
    return fail('rawProvenance',
      `games_csv is on the ${games.entry.path} path, not provenance; it retains 2026 rows, so a `
      + 'feature loader must not be able to address it');
  }
  const quarantined = games.rows.filter(
    (r) => store.seasonOf(r) >= store.QUARANTINE_FROM_SEASON
  ).length;
  const recorded = Number((manifest.overlay || {}).quarantinedProvenanceRows);
  if (quarantined === 0) {
    return fail('rawProvenance',
      'games.csv provenance retains no 2026 rows - the pinned file spans 1999-2026, so they were lost');
  }
  if (Number.isFinite(recorded) && recorded !== quarantined) {
    return fail('rawProvenance',
      `${quarantined} quarantined provenance rows on disk, the manifest records ${recorded}`);
  }
  return pass('rawProvenance', 'games.csv 2026 rows are retained in the raw store only',
    { quarantinedRows: quarantined, totalRows: games.rows.length });
}

/**
 * The orientation patch count, derived from the archived games.csv rather than
 * asserted from memory: two team rows per REG game per captured season.
 */
function checkOrientationOverlay({ loaded, manifest, readSource, assumePinnedSource = null }) {
  const results = [];
  const overlay = loaded.get('orientation_overlay');
  if (!overlay) {
    results.push(fail('overlay', 'the snapshot has no orientation_overlay dataset'));
    return results;
  }
  const seasons = (manifest.seasons || []).map(Number);
  const gamesText = readSource('games');
  const gamesSha = sha256Hex(Buffer.from(gamesText, 'utf8'));

  // The bytes in front of us must be the bytes the extraction recorded reading.
  // This is what ties the derived expectations below to the manifest instead of
  // to whatever happens to be on disk now.
  const recorded = (manifest.sources || []).find((s) => s.name === 'games');
  if (!recorded) {
    results.push(fail('overlay:source', 'the manifest records no hash for the games source'));
    return results;
  }
  if (recorded.sha256 !== gamesSha) {
    results.push(fail('overlay:source',
      `the games.csv read now hashes to ${gamesSha}, but the extraction recorded ${recorded.sha256}`));
    return results;
  }
  const pinnedSource = assumePinnedSource === null ? gamesSha === GAMES_CSV_SHA256 : !!assumePinnedSource;
  results.push(pass('overlay:source',
    pinnedSource
      ? 'the overlay was built from the preregistered pinned games.csv bytes'
      : 'the games bytes match the manifest but are NOT the preregistered pin, so the '
        + 'per-season plausibility band does not apply',
    { sha256: gamesSha, pinnedSource: pinnedSource ? 1 : 0 }));

  const games = collectColumns(
    gamesText,
    ['game_id', 'season', 'game_type', 'week', 'home_team', 'away_team', 'location'],
    { label: 'games' }
  );

  const expectedGames = new Map(seasons.map((s) => [s, 0]));
  let expectedNeutral = 0;
  for (const row of games.rows) {
    const season = Number(row.season);
    if (!expectedGames.has(season)) continue;
    if (String(row.game_type).trim() !== 'REG') continue;
    expectedGames.set(season, expectedGames.get(season) + 1);
    if (String(row.location || '').trim().toLowerCase() === 'neutral') expectedNeutral++;
  }

  const actualBySeason = new Map(seasons.map((s) => [s, 0]));
  let actualNeutralRows = 0;
  const seen = new Set();
  for (const row of overlay.rows) {
    const season = Number(row.season);
    if (!actualBySeason.has(season)) {
      results.push(fail('overlay', `overlay carries season ${season}, which is not a captured season`));
      return results;
    }
    actualBySeason.set(season, actualBySeason.get(season) + 1);
    if (row.neutral_site === true) actualNeutralRows++;
    if (row.home_away !== 'home' && row.home_away !== 'away') {
      results.push(fail('overlay',
        `overlay row ${row.game_id}/${row.team_key} has home_away ${JSON.stringify(row.home_away)}`));
      return results;
    }
    const key = `${season}:${row.week}:${row.team_key}`;
    if (seen.has(key)) {
      results.push(fail('overlay', `overlay has two rows for ${key}`));
      return results;
    }
    seen.add(key);
  }

  for (const season of seasons) {
    const regGames = expectedGames.get(season);
    const expectedRows = regGames * 2;
    const actual = actualBySeason.get(season);
    if (actual !== expectedRows) {
      results.push(fail(`overlay:${season}`,
        `${actual} overlay rows, but the archived games.csv has ${regGames} REG games ` +
        `(expected ${expectedRows} team-rows, two per game)`));
      continue;
    }
    if (pinnedSource
      && (regGames < REG_GAMES_PER_SEASON_BAND.min || regGames > REG_GAMES_PER_SEASON_BAND.max)) {
      results.push(fail(`overlay:${season}`,
        `${regGames} REG games is outside the plausibility band ` +
        `${REG_GAMES_PER_SEASON_BAND.min}-${REG_GAMES_PER_SEASON_BAND.max}; the pinned source's ` +
        'identity changed underneath its hash'));
      continue;
    }
    results.push(pass(`overlay:${season}`,
      `${actual} team-rows derived from ${regGames} REG games in the archived source`,
      { regGames, overlayRows: actual }));
  }

  // Two team rows per neutral game, and every one of them must still carry the
  // flag: `scheduleOrientation` returns null only when `neutral_site === true`,
  // so a lost flag would silently hand a London game to the home-field factor.
  if (actualNeutralRows !== expectedNeutral * 2) {
    results.push(fail('overlay:neutral',
      `${actualNeutralRows} neutral-flagged overlay rows for ${expectedNeutral} neutral games ` +
      `(expected ${expectedNeutral * 2})`));
  } else {
    results.push(pass('overlay:neutral',
      `${expectedNeutral} neutral-site games flagged on both team rows`,
      { neutralGames: expectedNeutral, neutralRows: actualNeutralRows }));
  }

  // The overlay must reach every scheduled team-week the database holds, or the
  // reconstructed mode would leave some rows with production's null orientation
  // while patching their opponents.
  for (const season of seasons) {
    const dbGames = loaded.get(`nfl_games_${season}`);
    if (!dbGames) {
      results.push(fail(`overlay:coverage:${season}`, `no nfl_games_${season} dataset to cover`));
      continue;
    }
    const unmatched = dbGames.rows.filter((row) => {
      const week = Number(row.week);
      if (!Number.isInteger(week) || week < 1 || week > 18) return false;
      return !seen.has(`${Number(row.season)}:${week}:${row.team_key}`);
    });
    if (unmatched.length > 0) {
      results.push(fail(`overlay:coverage:${season}`,
        `${unmatched.length} nfl_games row(s) have no overlay patch, first ` +
        `${JSON.stringify(unmatched[0] && unmatched[0].team_key)} week ${unmatched[0] && unmatched[0].week}`));
    } else {
      results.push(pass(`overlay:coverage:${season}`,
        'every regular-season nfl_games row has an overlay patch',
        { rows: dbGames.rows.length }));
    }
  }

  return results;
}

/**
 * The schedule capture must span the SAME seasons as the weekly-stat capture.
 *
 * `historyWindowSchedule` reads `WHERE "season" >= target - HISTORY_SEASONS`, so
 * a 2024 target legitimately reaches 2022 and 2023 `nfl_games` rows, and those
 * rows are what `opponentByTeamWeek` resolves a prior-season stat line through.
 * A snapshot that captured only the target seasons would answer that query with
 * a strictly smaller set than the in-transaction oracle saw, and the difference
 * would show up only in the homeAway-on arms on the 2024 safety season. So the
 * two windows are compared directly, and a season the query reached and found
 * empty must be RECORDED as an observation rather than merely missing.
 */
function checkScheduleWindow({ loaded, manifest }) {
  const results = [];
  const scheduleSeasons = (manifest.scheduleSeasons || []).map(Number);
  const weeklySeasons = (manifest.weeklyStatSeasons || []).map(Number);
  if (scheduleSeasons.length === 0) {
    results.push(fail('scheduleWindow', 'the manifest records no scheduleSeasons'));
    return results;
  }
  if (JSON.stringify(scheduleSeasons) !== JSON.stringify(weeklySeasons)) {
    results.push(fail('scheduleWindow',
      `nfl_games was captured for [${scheduleSeasons.join(', ')}] but player_stats for `
      + `[${weeklySeasons.join(', ')}]; the history window reaches both relations equally, so a `
      + 'narrower schedule capture would under-answer historyWindowSchedule'));
    return results;
  }
  // A missing `scheduleRowsBySeason` is a FAILED CHECK, not a crash. The
  // completeness check already reports the absent field, but this function must
  // still produce a legible FAIL line rather than a TypeError that buries every
  // other result behind a stack trace.
  const recordedRows = manifest.scheduleRowsBySeason;
  if (!recordedRows || typeof recordedRows !== 'object') {
    results.push(fail('scheduleWindow',
      'the manifest records no scheduleRowsBySeason, so the per-season row counts cannot be '
      + 'checked against the datasets on disk'));
    return results;
  }
  const emptyRecorded = new Set(((manifest.capturedAsEmpty || {}).nfl_games || []).map(Number));
  const counts = {};
  for (const season of scheduleSeasons) {
    const dataset = loaded.get(`nfl_games_${season}`);
    if (!dataset) {
      results.push(fail(`scheduleWindow:${season}`,
        `no nfl_games_${season} dataset, although the history window reaches that season`));
      continue;
    }
    counts[String(season)] = dataset.rows.length;
    const recordedEmpty = emptyRecorded.has(season);
    if ((dataset.rows.length === 0) !== recordedEmpty) {
      const listing = recordedEmpty ? 'lists it as empty' : 'does not list it';
      results.push(fail(`scheduleWindow:${season}`,
        `nfl_games_${season} has ${dataset.rows.length} rows but capturedAsEmpty ${listing}; `
        + 'a season the query reached and found empty must be recorded as an observation, not '
        + 'left to look like an omission'));
      continue;
    }
    if (Number(recordedRows[String(season)]) !== dataset.rows.length) {
      results.push(fail(`scheduleWindow:${season}`,
        `${dataset.rows.length} rows on disk, the manifest records `
        + `${JSON.stringify(recordedRows[String(season)])}`));
      continue;
    }
    results.push(pass(`scheduleWindow:${season}`,
      recordedEmpty
        ? 'captured as empty, and recorded as an observation'
        : `${dataset.rows.length} schedule rows`,
      { rows: dataset.rows.length }));
  }
  results.push(pass('scheduleWindow',
    `nfl_games spans the same seasons as player_stats (${scheduleSeasons.join(', ')})`, counts));
  return results;
}

/**
 * `stats.gameTeam` coverage. Reported, not gated: the key exists only on rows
 * the nflverse backfill wrote, and `buildPriorGames` degrades to
 * opponent/isHome null without it. The count is what tells a reader how much of
 * the prior-season history could be oriented at all.
 */
function checkGameTeamCoverage({ loaded }) {
  const stats = loaded.get('player_stats');
  if (!stats) return fail('gameTeamCoverage', 'the snapshot has no player_stats dataset');
  const bySeason = new Map();
  for (const row of stats.rows) {
    const season = Number(row.season);
    if (!bySeason.has(season)) bySeason.set(season, { rows: 0, withGameTeam: 0, withGameOpponent: 0 });
    const bucket = bySeason.get(season);
    bucket.rows++;
    const jsonb = row.stats && typeof row.stats === 'object' ? row.stats : {};
    if (jsonb.gameTeam != null && jsonb.gameTeam !== '') bucket.withGameTeam++;
    if (jsonb.gameOpponent != null && jsonb.gameOpponent !== '') bucket.withGameOpponent++;
  }
  const counts = {};
  for (const [season, bucket] of [...bySeason].sort((a, b) => a[0] - b[0])) {
    counts[String(season)] = bucket;
  }
  return pass('gameTeamCoverage', 'gameTeam jsonb coverage counted per season', counts);
}

/**
 * Crosswalk-unmapped roster identifiers. Reported per season, because the
 * cohort is NAMED for this exclusion ("the mapped reconstructed roster cohort")
 * and the published report has to state the count rather than absorb it.
 */
function checkCrosswalkCoverage({ readSource }) {
  const crosswalk = collectColumns(readSource('players'), ['gsis_id', 'espn_id'], { label: 'players' });
  const mappable = new Set();
  for (const row of crosswalk.rows) {
    const gsis = String(row.gsis_id || '').trim();
    const espn = String(row.espn_id || '').trim();
    if (/^00-\d{7}$/.test(gsis) && espn !== '') mappable.add(gsis);
  }
  const counts = { crosswalkMappable: mappable.size };
  for (const source of SOURCES.filter((s) => s.kind === 'roster_weekly')) {
    const roster = collectColumns(readSource(source.name), ['gsis_id'], { label: source.name });
    const distinct = new Set();
    let blank = 0;
    for (const row of roster.rows) {
      const gsis = String(row.gsis_id || '').trim();
      if (gsis === '') { blank++; continue; }
      distinct.add(gsis);
    }
    const unmapped = [...distinct].filter((id) => !mappable.has(id));
    counts[source.name] = {
      distinctIds: distinct.size,
      unmapped: unmapped.length,
      blankGsisId: blank,
    };
  }
  return pass('crosswalkCoverage', 'unmappable roster identifiers counted per season', counts);
}

/**
 * Roster-versus-`gameTeam` team contradictions, per season.
 *
 * The roster file is the authority (preregistration 4.1); a contradiction is
 * REPORTED and never used to exclude, so this is a count and never a failure.
 * Both sides are folded through the same normalization the overlay uses, or
 * `WAS` versus `WSH` would read as thousands of contradictions that are only a
 * spelling.
 */
function checkTeamContradictions({ readSource, normalizeTeamKey, seasons }) {
  if (typeof normalizeTeamKey !== 'function') {
    return pass('teamContradictions', 'skipped: no normalizeTeamKey injected', {});
  }
  const counts = {};
  for (const season of seasons) {
    const rosterSource = SOURCES.find((s) => s.kind === 'roster_weekly' && s.season === season);
    const statsSource = SOURCES.find((s) => s.kind === 'stats_player_week' && s.season === season);
    if (!rosterSource || !statsSource) continue;
    const roster = collectColumns(
      readSource(rosterSource.name), ['season', 'week', 'game_type', 'gsis_id', 'team'],
      { label: rosterSource.name }
    );
    const rosterTeam = new Map();
    for (const row of roster.rows) {
      const gsis = String(row.gsis_id || '').trim();
      if (gsis === '' || String(row.game_type).trim() !== 'REG') continue;
      rosterTeam.set(`${Number(row.season)}:${Number(row.week)}:${gsis}`, normalizeTeamKey(row.team));
    }
    const stats = collectColumns(
      readSource(statsSource.name), ['season', 'week', 'season_type', 'player_id', 'team'],
      { label: statsSource.name }
    );
    let compared = 0;
    let contradictions = 0;
    let noRosterRow = 0;
    for (const row of stats.rows) {
      const id = String(row.player_id || '').trim();
      if (id === '' || String(row.season_type).trim() !== 'REG') continue;
      const key = `${Number(row.season)}:${Number(row.week)}:${id}`;
      if (!rosterTeam.has(key)) { noRosterRow++; continue; }
      compared++;
      if (rosterTeam.get(key) !== normalizeTeamKey(row.team)) contradictions++;
    }
    counts[String(season)] = { compared, contradictions, statRowsWithNoRosterRow: noRosterRow };
  }
  return pass('teamContradictions',
    'roster-vs-gameTeam contradictions counted per season (reported, never excluding)', counts);
}

/**
 * Every preregistered oracle week must be present, with the branch flags the
 * preregistration's section-15 table demands and a stored output whose digest
 * matches the manifest.
 */
function checkOracles({ loaded, manifest }) {
  const results = [];
  const recorded = manifest.oracles || [];
  const expected = (manifest.oracleSettings || {}).weeks || [];
  if (expected.length === 0) {
    results.push(fail('oracles', 'the manifest records no oracle weeks'));
    return results;
  }
  for (const want of expected) {
    const label = `${want.season} W${want.week}`;
    const entry = recorded.find((o) => o.season === want.season && o.week === want.week);
    if (!entry) {
      results.push(fail(`oracle:${label}`, 'no oracle recorded for a preregistered week'));
      continue;
    }
    const dataset = loaded.get(entry.dataset);
    if (!dataset) {
      results.push(fail(`oracle:${label}`, `dataset ${entry.dataset} is missing from the snapshot`));
      continue;
    }
    if (dataset.entry.path !== store.PATHS.OUTCOME) {
      results.push(fail(`oracle:${label}`,
        `oracle output is on the ${dataset.entry.path} path; an oracle for week W read as a ` +
        'week-W feature is exactly the poisoning the two paths exist to prevent'));
      continue;
    }
    const branchNote = `scan ${entry.branches.leagueScan ? 'ON' : 'OFF'}, ` +
      `defenseCount ${entry.branches.defenseGameCount ? 'ON' : 'OFF'}`;
    const scanObserved = (entry.observedSql || []).includes('leagueScan');
    const defenseObserved = (entry.observedSql || []).includes('defenseGameCount');
    if (scanObserved !== !!entry.branches.leagueScan
      || defenseObserved !== !!entry.branches.defenseGameCount) {
      results.push(fail(`oracle:${label}`,
        `observed SQL [${(entry.observedSql || []).join(', ')}] disagrees with the recorded ` +
        `branches (${branchNote})`));
      continue;
    }
    results.push(pass(`oracle:${label}`,
      `${dataset.rows.length} projections, ${branchNote}`,
      { rows: dataset.rows.length, playerCount: entry.playerCount }));
  }
  return results;
}

/** The manifest itself has to carry everything the freeze will pin. */
function checkManifestCompleteness({ manifest }) {
  const required = [
    'studyId', 'extractedAt', 'quarantineFromSeason', 'seasons', 'weeklyStatSeasons',
    'scheduleSeasons', 'capturedAsEmpty', 'database', 'sqlSurface', 'schemaFingerprint',
    'rowCounts', 'scheduleRowsBySeason', 'collation', 'oracles', 'oracleSettings', 'overlay',
    'sources', 'integrityChecks', 'datasets', 'planDigest',
  ];
  const missing = required.filter((key) => manifest[key] === undefined || manifest[key] === null);
  if (missing.length > 0) {
    return fail('manifest', `missing field(s) ${missing.join(', ')}`);
  }
  if (!Array.isArray(manifest.sqlSurface) || manifest.sqlSurface.length !== 8) {
    return fail('manifest',
      `sqlSurface pins ${(manifest.sqlSurface || []).length} SQL texts, expected the 8 the ` +
      'production read surface issues');
  }
  const failedChecks = (manifest.integrityChecks || []).filter((c) => c.status !== 'passed');
  if (failedChecks.length > 0) {
    return fail('manifest',
      `integrity check(s) not recorded as passed: ${failedChecks.map((c) => c.name).join(', ')}`);
  }
  if (!manifest.database.database || !manifest.database.role
    || manifest.database.transactionReadOnly !== 'on') {
    return fail('manifest',
      'the manifest does not record a passed database identity assertion ' +
      '(database, role, transaction_read_only = on)');
  }
  if (manifest.overlay.writtenToDatabase !== false) {
    return fail('manifest',
      'the manifest does not record that the orientation overlay was NOT written to the database');
  }
  return pass('manifest', 'every field the freeze manifest will pin is present', {
    sqlTexts: manifest.sqlSurface.length,
    integrityChecks: (manifest.integrityChecks || []).length,
    datasets: manifest.datasets.length,
  });
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function runChecks({
  root, sourcesDir, provenancePath, readSource, normalizeTeamKey = null,
  assumePinnedSource = null,
}) {
  const manifest = store.loadManifest(root);
  const read = readSource || makeSourceReader({ sourcesDir, provenancePath });
  const seasons = (manifest.seasons || []).map(Number);

  const results = [];
  results.push(checkManifestCompleteness({ manifest }));
  const datasets = checkDatasets({ root, manifest });
  results.push(...datasets.results);
  results.push(checkQuarantine({ loaded: datasets.loaded }));
  results.push(checkRawProvenanceRetains2026({ loaded: datasets.loaded, manifest }));
  results.push(...checkScheduleWindow({ loaded: datasets.loaded, manifest }));
  results.push(...checkOrientationOverlay({
    loaded: datasets.loaded, manifest, readSource: read, assumePinnedSource,
  }));
  results.push(checkGameTeamCoverage({ loaded: datasets.loaded }));
  results.push(checkCrosswalkCoverage({ readSource: read }));
  results.push(checkTeamContradictions({ readSource: read, normalizeTeamKey, seasons }));
  results.push(...checkOracles({ loaded: datasets.loaded, manifest }));

  return { manifest, results, failures: results.filter((r) => !r.ok) };
}

function parseArgs(argv) {
  const args = {
    snapshot: DEFAULT_SNAPSHOT_DIR,
    sourcesDir: DEFAULT_SOURCES_DIR,
    provenance: DEFAULT_PROVENANCE_PATH,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--snapshot') args.snapshot = argv[++i];
    else if (token === '--sources-dir') args.sourcesDir = argv[++i];
    else if (token === '--provenance') args.provenance = argv[++i];
    else if (token === '--quiet') args.quiet = true;
    else throw new Error(`unknown argument ${token}`);
  }
  return args;
}

function formatResults(results, { quiet = false } = {}) {
  const lines = [];
  for (const result of results) {
    if (result.ok && quiet) continue;
    lines.push(`  ${result.ok ? 'ok  ' : 'FAIL'} ${result.name}: ${result.detail}`);
    if (!quiet && result.counts && Object.keys(result.counts).length > 0) {
      lines.push(`        ${JSON.stringify(result.counts)}`);
    }
  }
  return lines;
}

function main(argv, deps = {}) {
  const args = parseArgs(argv);
  const log = deps.log || console.log;
  const { manifest, results, failures } = runChecks({
    root: args.snapshot,
    sourcesDir: args.sourcesDir,
    provenancePath: args.provenance,
    readSource: deps.readSource,
    normalizeTeamKey: deps.normalizeTeamKey,
  });
  log(`snapshot checks for ${manifest.studyId} (extracted ${manifest.extractedAt})`);
  for (const line of formatResults(results, { quiet: args.quiet })) log(line);
  log(`${results.length - failures.length} passed, ${failures.length} failed`);
  return failures.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_SNAPSHOT_DIR,
  DEFAULT_SOURCES_DIR,
  DEFAULT_PROVENANCE_PATH,
  REG_GAMES_PER_SEASON_BAND,
  makeSourceReader,
  checkDatasets,
  checkQuarantine,
  checkRawProvenanceRetains2026,
  checkScheduleWindow,
  checkOrientationOverlay,
  checkGameTeamCoverage,
  checkCrosswalkCoverage,
  checkTeamContradictions,
  checkOracles,
  checkManifestCompleteness,
  runChecks,
  parseArgs,
  formatResults,
  main,
};
