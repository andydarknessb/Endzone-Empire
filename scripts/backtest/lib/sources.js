'use strict';

/**
 * The PINNED source registry for the reconstructed historical backtest.
 *
 * Every file the backtest may ever read is listed here with a stable URL and
 * the columns a preregistered rule depends on. Nothing else is fetchable: the
 * fetch script iterates this list and has no free-form URL argument.
 *
 * Two families of URL, both free and no-auth (zero Tank01/RapidAPI spend):
 *
 *   1. nflverse-data release downloads, the same base
 *      `server/services/nflverseSync.service.js:33` already uses. These are
 *      MOVING targets: a release tag's asset is replaced in place as nflverse
 *      republishes. They are pinned by the SHA-256 of the bytes we fetched,
 *      not by a revision identifier the publisher does not offer.
 *   2. Lee Sharpe's games.csv, pinned at an exact commit AND blob SHA on
 *      raw.githubusercontent.com. This one has a real content address, so it
 *      gets checked against it: the same pin the schedule manifest already
 *      carries (server/scripts/generate-schedule-manifest.js).
 *
 * `requiredColumns` is the schema contract. Extra columns are expected and
 * fine; a missing one stops the run. `optionalColumns` are columns whose
 * PRESENCE is itself a recorded finding - `date_modified` on the injury files
 * is the load-bearing example, because the injury policy differs depending on
 * whether a season's file carries an as-of timestamp at all.
 */

const NFLVERSE_RELEASE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download';

/** The games.csv pin: nflverse/nfldata at this commit, this blob. */
const GAMES_CSV_COMMIT = 'b19514f50ba4675e128c21c818592b4d92061a8f';
const GAMES_CSV_BLOB = '4f1edd10f607152ad3a8a3286aac567929781c42';
/**
 * The SHA-256 of games.csv's exact bytes, from the sealed preregistration's
 * pinned-source table (section 1.3). The blob SHA above is what ties the file
 * to the revision it names; this hash is what lets a later phase ask "are these
 * the pinned bytes?" without reading the provenance file, which matters for
 * checks that must decide whether a preregistered per-season game count applies
 * to the source in front of them or whether they are looking at a fixture.
 */
const GAMES_CSV_SHA256 = '9b512fecf7c73a7680006259118411c75f01b3762100f776d96400e7284a94fe';
const GAMES_CSV_URL =
  `https://raw.githubusercontent.com/nflverse/nfldata/${GAMES_CSV_COMMIT}/data/games.csv`;

const BACKTEST_SEASONS = Object.freeze([2024, 2025]);

/** Identity + policy columns of the weekly roster files. */
const ROSTER_WEEKLY_REQUIRED = Object.freeze([
  'season', 'week', 'team', 'position', 'status', 'gsis_id', 'full_name', 'game_type',
]);

/** Identity + policy columns of the injury report files. */
const INJURY_REQUIRED = Object.freeze([
  'season', 'week', 'team', 'gsis_id', 'report_status', 'game_type', 'full_name', 'position',
]);

/**
 * `date_modified` exists on some seasons and not others. The injury policy
 * depends on which, so its presence is measured, never assumed (the 2024
 * as-of sensitivity fails closed if the column is absent).
 */
const INJURY_OPTIONAL = Object.freeze(['date_modified', 'practice_status']);

/** Identity columns of the player-week stat files. */
const STATS_PLAYER_WEEK_REQUIRED = Object.freeze([
  'season', 'week', 'season_type', 'player_id', 'team', 'position',
]);

/** Identity columns of the team-week stat files. */
const STATS_TEAM_WEEK_REQUIRED = Object.freeze([
  'season', 'week', 'season_type', 'team', 'opponent_team',
]);

/** Identity columns of the schedule/score file. */
const GAMES_REQUIRED = Object.freeze([
  'game_id', 'season', 'game_type', 'week', 'gameday', 'gametime',
  'away_team', 'home_team', 'away_score', 'home_score', 'location',
]);

/** The gsis -> espn crosswalk columns. */
const PLAYERS_REQUIRED = Object.freeze(['gsis_id', 'espn_id']);

function releaseUrl(tag, file) {
  return `${NFLVERSE_RELEASE_BASE}/${tag}/${file}`;
}

/**
 * The ONLY shape a pinned source's on-disk name may take: a lowercase CSV
 * basename. No directory separator, no drive letter, no traversal segment, no
 * leading dot.
 *
 * Every `path.join(<some sources dir>, source.file)` in this tree is anchored
 * to a directory the tooling owns and joined with a name that came from the
 * frozen registry below rather than from any input, so a traversal was never
 * reachable. This function makes that a CHECKED property rather than an
 * argument about where the string came from: if a future edit ever puts a
 * computed name in the registry, the module fails to load instead of writing
 * outside `backtest-data/`.
 *
 * The pattern is an allowlist, and the two explicit rejections after it are
 * redundant with it on purpose - they name the two failure modes a reader
 * cares about, so a regex typo that widened the allowlist would still be
 * caught.
 */
const SAFE_SOURCE_FILE = /^[a-z0-9][a-z0-9_]*\.csv$/;

function assertSafeSourceFile(file, { label = 'source file' } = {}) {
  const name = String(file == null ? '' : file);
  if (!SAFE_SOURCE_FILE.test(name)) {
    throw new Error(
      `${label}: ${JSON.stringify(name)} is not a bare lowercase .csv basename ` +
      `(required shape ${SAFE_SOURCE_FILE}) - refusing to build a path from it`
    );
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new Error(`${label}: ${JSON.stringify(name)} contains a path separator`);
  }
  if (name.split('.').includes('..') || name.includes('..')) {
    throw new Error(`${label}: ${JSON.stringify(name)} contains a traversal segment`);
  }
  return name;
}

/**
 * The frozen source list, in a fixed order so every derived artifact (the
 * provenance file, the inspection index, the preregistration table) is
 * deterministic.
 */
const SOURCES = Object.freeze([
  ...BACKTEST_SEASONS.map((season) => ({
    name: `roster_weekly_${season}`,
    file: `roster_weekly_${season}.csv`,
    url: releaseUrl('weekly_rosters', `roster_weekly_${season}.csv`),
    kind: 'roster_weekly',
    season,
    requiredColumns: ROSTER_WEEKLY_REQUIRED,
    optionalColumns: ['espn_id', 'status_description_abbr', 'depth_chart_position'],
  })),
  ...BACKTEST_SEASONS.map((season) => ({
    name: `injuries_${season}`,
    file: `injuries_${season}.csv`,
    url: releaseUrl('injuries', `injuries_${season}.csv`),
    kind: 'injuries',
    season,
    requiredColumns: INJURY_REQUIRED,
    optionalColumns: INJURY_OPTIONAL,
  })),
  {
    name: 'games',
    file: 'games.csv',
    url: GAMES_CSV_URL,
    kind: 'games',
    season: null,
    requiredColumns: GAMES_REQUIRED,
    optionalColumns: ['result', 'total', 'overtime', 'roof', 'surface', 'stadium'],
    gitBlobSha1: GAMES_CSV_BLOB,
    gitCommit: GAMES_CSV_COMMIT,
  },
  ...BACKTEST_SEASONS.map((season) => ({
    name: `stats_player_week_${season}`,
    file: `stats_player_week_${season}.csv`,
    url: releaseUrl('stats_player', `stats_player_week_${season}.csv`),
    kind: 'stats_player_week',
    season,
    requiredColumns: STATS_PLAYER_WEEK_REQUIRED,
    optionalColumns: ['opponent_team', 'player_display_name'],
  })),
  ...BACKTEST_SEASONS.map((season) => ({
    name: `stats_team_week_${season}`,
    file: `stats_team_week_${season}.csv`,
    url: releaseUrl('stats_team', `stats_team_week_${season}.csv`),
    kind: 'stats_team_week',
    season,
    requiredColumns: STATS_TEAM_WEEK_REQUIRED,
    optionalColumns: [],
  })),
  {
    name: 'players',
    file: 'players.csv',
    url: releaseUrl('players', 'players.csv'),
    kind: 'players',
    season: null,
    requiredColumns: PLAYERS_REQUIRED,
    optionalColumns: ['display_name', 'position', 'status', 'latest_team'],
  },
]);

// Validated once, at module load, so a bad registry entry can never reach a
// path.join anywhere downstream - including in Phase 1, which reads these same
// archived files back.
for (const source of SOURCES) assertSafeSourceFile(source.file, { label: source.name });

function sourceByName(name) {
  const found = SOURCES.find((s) => s.name === name);
  if (!found) {
    throw new Error(`unknown source ${name} - the registry has [${SOURCES.map((s) => s.name).join(', ')}]`);
  }
  return found;
}

module.exports = {
  NFLVERSE_RELEASE_BASE,
  GAMES_CSV_COMMIT,
  GAMES_CSV_BLOB,
  GAMES_CSV_SHA256,
  GAMES_CSV_URL,
  BACKTEST_SEASONS,
  SAFE_SOURCE_FILE,
  SOURCES,
  sourceByName,
  assertSafeSourceFile,
};
