/* eslint-disable no-console */
'use strict';

/**
 * The real-wiring entry point for Step 1 of the freeze sequence: generate the
 * 1,700 frozen roster-weeks (34 preregistered season-weeks x 50 rosters each)
 * committed verbatim in freeze Commit A.
 *
 * WHY THIS FILE LIVES UNDER server/scripts/, NOT scripts/backtest/
 *
 * Same reason as every other real entry point in this pipeline
 * (`run-backtest-extraction.js`, `run-backtest-canaries.js`,
 * `run-backtest-rehydrate.js`): `lib/cohort.buildCohort` and
 * `lib/rosters.buildRosterWeek` are pure and take everything database-shaped as
 * an argument, but SOMETHING has to build those arguments from real bytes on
 * disk, and `scripts/backtest/**` may not require `server/services/*` or touch
 * `process.env`. That something is this file. The actual iteration logic - "for
 * every preregistered season-week, build a cohort, rank it, draft it, hash it,
 * and check the totals" - lives in the pure, fake-testable
 * `scripts/backtest/lib/rosterGeneration.js`; this file supplies the two
 * functions that module needs and cannot fabricate: a real cohort builder and a
 * real candidate ranker, both backed by a REHYDRATED tree.
 *
 * WHY A REHYDRATED TREE, NOT THE LOCAL SEALED SNAPSHOT
 *
 * `backtest-data/snapshot/` and `backtest-data/sources/` are deliberately never
 * committed; only `backtest-data/publish/` is. Reading the local sealed
 * snapshot directly here would make Commit A's artifacts derived from
 * local-only state nobody else can reproduce. Gate 3's reconstruction proof
 * establishes that rehydrating `backtest-data/publish/` is byte-identical to
 * the sealed snapshot, so this script is pointed at rehydration OUTPUT -
 * produced by `run-backtest-rehydrate.js` first, as a separate step - never at
 * `backtest-data/snapshot/` or `backtest-data/sources/` themselves. Both
 * `--rehydrated-snapshot` and `--rehydrated-sources` are required with no
 * default, matching `rehydrate.js`'s own no-defaults discipline: a script that
 * silently guessed a path could silently point at the real sealed directories.
 *
 * WHAT THIS SCRIPT BUILDS, PER SEASON-WEEK
 *
 *   - `rosterIndex` / `injuryIndex` (`lib/asOfView`), from the REHYDRATED
 *     `roster_weekly_<season>.csv` / `injuries_<season>.csv` sources - the
 *     primary injury policy (section 4.2) makes the injury index inert for
 *     cohort purposes, but it is still built and passed so the reconstruction
 *     path this script exercises is the same one the sweep will use later.
 *   - `crosswalk` / `playerIdByGsis` / `defensePlayerIdByTeamKey`
 *     (`lib/cohort`), from the REHYDRATED `players.csv` source and the
 *     REHYDRATED snapshot's captured `players` rows.
 *   - `byeTeamKeys` / `defenseTeamKeys`, derived from the rehydrated snapshot's
 *     `nfl_games` rows for that season: a team scheduled that week gets a
 *     synthesized DEF; a team in the league but NOT scheduled that week is on
 *     bye (and still gets a synthesized DEF, marked `onBye`).
 *   - the model-independent candidate ranking (`lib/rosters.recencyWeightedScore`
 *     + `lib/rosters.rankCandidates`), fed by each cohort member's PRIOR
 *     league-scored points, rescored under the pinned half-PPR profile
 *     (`scoring.service.calculateFantasyPoints`), never read off a model. A
 *     HUMAN member's history comes from the rehydrated snapshot's captured
 *     `player_stats` rows, keyed by `gsisId` (`buildPriorGamesIndex`). A DEF
 *     pseudo-player has no `gsisId` and no database `player_stats` row at all
 *     (`lib/outcomes.js` module docblock), so its history is built separately,
 *     keyed by `teamKey`, from the pinned `stats_team_week_<season>.csv` +
 *     `games.csv` sources for both pinned seasons
 *     (`buildDefensePriorGamesIndex`) - the same pinned sources Step 2's DEF
 *     outcome truth reads, and the same per-team-week scoring computation
 *     (`computeDefenseTeamPoints`), just applied to prior weeks instead of the
 *     target week.
 *   - the two ordering artifacts (`lib/ordering.buildRankIndex`), from the
 *     rehydrated snapshot's captured `position_rank` / `player_name_rank` rows.
 *
 * OUTPUT. One canonical JSON file per season-week under `--out`
 * (`<out>/roster-weeks/<season>-w<week>.json`), plus `<out>/index.json`
 * recording every season-week's `freezeHash` (`lib/rosters.js` `freezeHash`,
 * which hashes the canonical PARSED object, not raw bytes) so a reviewer can
 * check any single file against the index without reparsing all 34.
 *
 * STEP 2, ADDED IN THE SAME PASS: OUTCOME TRUTH (preregistration 4.3)
 *
 * For the SAME 34 season-weeks, this script also builds the cohort a second
 * time (cheap and pure - `lib/cohort.buildCohort` takes no model, no
 * randomness, and produces the identical members list either way, so
 * recomputing it here rather than threading it out of
 * `lib/rosterGeneration.buildAllRosterWeeks`'s internal loop costs nothing and
 * keeps that module's contract - "returns roster artifacts" - unchanged) and
 * resolves the reconciled OUTCOME TRUTH for it: `lib/outcomes.resolveCohortOutcomes`,
 * fed
 *
 *   - the pinned `stats_player_week_<season>.csv` rows, rescored through the
 *     SAME production normalizer full nflverse backfills use
 *     (`nflverseSync.service.normalizeNflversePlayerStats` +
 *     `scoring.service.calculateFantasyPoints`) - a human player's PRIMARY and
 *     SECONDARY presence signals are the same boolean (there is exactly one
 *     pinned per-player file; see `lib/outcomes.js`'s module docblock for why
 *     that is deliberate, not a shortcut), and the ambiguity channel that
 *     matters for a human row is `teamContradiction`: the stats row's own
 *     `team` field disagreeing with the cohort's roster-reconstructed team;
 *   - the pinned `stats_team_week_<season>.csv` rows plus the pinned
 *     `games.csv` scores, combined through `lib/cohort.synthesizeDefenseStats`
 *     + `assertPerGameDefenseStats` exactly as that module documents, for
 *     DEF's PRIMARY (team-week row present) and SECONDARY (a completed REG
 *     game exists for that team-week in `games.csv`) signals - two genuinely
 *     independent pinned sources, unlike the human case;
 *   - the rehydrated snapshot's captured `player_stats` rows, rescored the
 *     same way, as the QA-only `dbPoints` signal (never for a DEF, which has
 *     no per-player database row to check against).
 *
 * OUTPUT. One canonical JSON file per season-week under `--out`
 * (`<out>/cohort-weeks/<season>-w<week>.json`) - the artifact
 * `run-backtest-mde.js`'s `--cohort` reads, a DIRECTORY of these files (the
 * same shape convention as `--rosters`/`roster-weeks/`, not a single
 * aggregated map - see that script's own docblock for why the two scripts'
 * directory-of-per-week-files contract is the one that actually matches what
 * this script writes).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const snapshotClientLib = require('../../scripts/backtest/lib/snapshotClient');
const asOf = require('../../scripts/backtest/lib/asOfView');
const cohortLib = require('../../scripts/backtest/lib/cohort');
const rosters = require('../../scripts/backtest/lib/rosters');
const ordering = require('../../scripts/backtest/lib/ordering');
const rosterGeneration = require('../../scripts/backtest/lib/rosterGeneration');
const { PRIMARY_SEASON, SENSITIVITY_SEASON } = rosterGeneration;
const outcomesLib = require('../../scripts/backtest/lib/outcomes');
const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');
const { collectColumns } = require('../../scripts/backtest/lib/csv');
const { makeSourceReader } = require('../../scripts/backtest/snapshot-checks');

const { normalizeTeamKey } = require('../services/projectionFeatures');
const { calculateFantasyPoints, SCORING_RULES } = require('../services/scoring.service');
const { normalizeNflversePlayerStats, filterRowsForWeek } = require('../services/nflverseSync.service');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function requireFlagValue(argv, index, flagName) {
  const value = argv[index];
  if (value === undefined || (typeof value === 'string' && value.startsWith('--'))) {
    throw new Error(`run-backtest-rosters: ${flagName} requires a value`);
  }
  return value;
}

function parseArgs(argv) {
  const args = { rehydratedSnapshot: null, rehydratedSources: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--rehydrated-snapshot') args.rehydratedSnapshot = requireFlagValue(argv, ++i, token);
    else if (token === '--rehydrated-sources') args.rehydratedSources = requireFlagValue(argv, ++i, token);
    else if (token === '--out') args.out = requireFlagValue(argv, ++i, token);
    else throw new Error(`run-backtest-rosters: unknown argument ${token}`);
  }
  for (const [flag, value] of [
    ['--rehydrated-snapshot', args.rehydratedSnapshot],
    ['--rehydrated-sources', args.rehydratedSources],
    ['--out', args.out],
  ]) {
    if (!value) {
      throw new Error(
        `run-backtest-rosters: ${flag} is required, with no default. This tool must never be able to `
        + 'silently fall back to the real backtest-data/snapshot/ or backtest-data/sources/ directories, '
        + 'which are never committed and are not what Commit A is derived from.'
      );
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Reading the rehydrated raw sources this script needs beyond the snapshot
// ---------------------------------------------------------------------------

function readCsvRows({ readSource, sourceName, columns, label }) {
  const text = readSource(sourceName);
  return collectColumns(text, columns, { label: label || sourceName }).rows;
}

const ROSTER_COLUMNS = ['season', 'week', 'game_type', 'gsis_id', 'team', 'position', 'status', 'full_name'];
const INJURY_COLUMNS_BASE = ['season', 'week', 'game_type', 'gsis_id', 'report_status'];
const PLAYERS_CROSSWALK_COLUMNS = ['gsis_id', 'espn_id'];

/**
 * The columns `normalizeNflversePlayerStats` reads off a `stats_player_week`
 * row, plus the identity columns `filterRowsForWeek`/the outcome resolver need
 * (`season_type` for the REG filter, `player_id` for the gsis join, `team` for
 * the contradiction check). Kept as an explicit list, matching every other
 * pinned-source reader in this file, rather than trusting the CSV to carry
 * exactly what one particular normalizer happens to read this month.
 */
const STATS_PLAYER_WEEK_COLUMNS = [
  'season', 'week', 'season_type', 'player_id', 'team',
  'attempts', 'completions', 'carries', 'targets', 'receiving_air_yards',
  'passing_yards', 'passing_tds', 'passing_interceptions', 'passing_2pt_conversions',
  'rushing_yards', 'rushing_tds', 'rushing_2pt_conversions',
  'receiving_yards', 'receiving_tds', 'receptions', 'receiving_2pt_conversions',
  'fumbles_lost_total',
  'fg_made', 'fg_missed', 'fg_made_list', 'pat_made', 'pat_missed',
  'special_teams_tds', 'punt_returns', 'punt_return_yards', 'kickoff_returns', 'kickoff_return_yards',
  'def_tackles_solo', 'def_tackle_assists', 'def_sacks', 'def_interceptions', 'def_fumbles_forced',
  'fumble_recovery_opp', 'def_pass_defended', 'def_qb_hits', 'def_tackles_for_loss',
  'fumble_recovery_tds', 'def_sack_yards', 'def_tackles_for_loss_yards', 'fumble_recovery_yards_opp',
  'def_interception_yards', 'def_safeties',
];

/**
 * The columns `lib/cohort.synthesizeDefenseStats` reads (`def_sacks`,
 * `def_interceptions`, `def_fumbles_forced`, `def_tds`, `def_safeties`, per
 * its own docblock and `backtestCohort.test.js`), plus `passing_yards` /
 * `sack_yards_lost` / `rushing_yards` on the OPPONENT's row - the net-yards
 * identity `nflverseSync.buildDstStatUpdates` uses for `yardsAllowed`, applied
 * here to the pinned file directly rather than through that DB-writing path.
 */
const STATS_TEAM_WEEK_COLUMNS = [
  'season', 'week', 'season_type', 'team', 'opponent_team', 'game_id',
  'def_sacks', 'def_interceptions', 'def_fumbles_forced', 'def_tds', 'def_safeties',
  'passing_yards', 'sack_yards_lost', 'rushing_yards',
];

/** The pinned schedule/score file's identity + score columns (prereg 1.3). */
const GAMES_COLUMNS = ['game_id', 'season', 'game_type', 'week', 'home_team', 'away_team', 'home_score', 'away_score'];

/**
 * `lib/cohort.synthesizeDefenseStats` names its output fields for what they
 * ARE (`defSacks`, `defInterceptions`, ...); `scoring.service.calculateFantasyPoints`
 * expects the FLAT rule-key names (`sack`, `interceptionReturn`, ...) its
 * `STAT_KEY_PATHS` table matches against. This is the translation between the
 * two - `blockedKick` has no equivalent in `synthesizeDefenseStats`'s output
 * (it is not among the fields prereg 4.3 names for DEF synthesis) and is
 * simply never scored here.
 */
const DEFENSE_STAT_SCORING_KEYS = Object.freeze({
  pointsAllowed: 'pointsAllowed',
  yardsAllowed: 'yardsAllowed',
  defSacks: 'sack',
  defInterceptions: 'interceptionReturn',
  defFumbleRecoveries: 'fumbleRecovery',
  defTouchdowns: 'defensiveTD',
  defSafeties: 'safety',
});

function mapDefenseStatsToScoringKeys(stats) {
  const flat = {};
  for (const [from, to] of Object.entries(DEFENSE_STAT_SCORING_KEYS)) {
    if (stats[from] !== undefined && stats[from] !== null) flat[to] = stats[from];
  }
  return flat;
}

/**
 * 2025's injury file carries no `date_modified` (preregistration 4.2); 2024's
 * does. The primary injury policy discards injury status entirely either way,
 * but the column list is read per season so a 2025 run never throws on a
 * column the pinned file genuinely does not have.
 */
const SEASONS_WITH_DATE_MODIFIED = new Set([2024]);

/**
 * Build the season-scoped reconstruction inputs `buildCohortFor` needs: the
 * roster/injury indexes, the crosswalk, the internal-id links, and the
 * bye/defense team-key sets for every week of one season - built once per
 * season and reused across that season's weeks, since none of it depends on
 * the target week.
 */
function buildSeasonContext({
  season, readSource, snapshot, defensePlayerIdByTeamKey,
}) {
  const rosterRows = readCsvRows({
    readSource, sourceName: `roster_weekly_${season}`, columns: ROSTER_COLUMNS,
    label: `roster_weekly_${season}`,
  });
  const hasDateModified = SEASONS_WITH_DATE_MODIFIED.has(Number(season));
  const injuryRows = readCsvRows({
    readSource,
    sourceName: `injuries_${season}`,
    columns: hasDateModified ? [...INJURY_COLUMNS_BASE, 'date_modified'] : INJURY_COLUMNS_BASE,
    label: `injuries_${season}`,
  });
  const rosterIndex = asOf.buildRosterIndex(rosterRows);
  // The primary policy discards injury status entirely (prereg 4.2), but the
  // index is still built so this script exercises the same reconstruction path
  // the sweep will later use for the labelled sensitivities.
  const injuryIndex = asOf.buildInjuryIndex(injuryRows, { hasDateModified });

  const scheduleRows = snapshot.nflGamesBySeason.get(Number(season)) || [];
  const scheduledByWeek = new Map();
  for (const row of scheduleRows) {
    const week = Number(row.week);
    if (!scheduledByWeek.has(week)) scheduledByWeek.set(week, new Set());
    scheduledByWeek.get(week).add(row.team_key);
  }
  // The full league is every team key this season's schedule ever names -
  // stable across weeks, and what "on bye" is defined against.
  const leagueTeamKeys = new Set();
  for (const teams of scheduledByWeek.values()) for (const key of teams) leagueTeamKeys.add(key);

  return {
    rosterIndex, injuryIndex, leagueTeamKeys, scheduledByWeek, defensePlayerIdByTeamKey,
  };
}

/** Every prior-game (season, week, points) for one gsisId, rescored from the pinned raw stats. */
function buildPriorGamesIndex({ snapshot, playerIdByGsis, gsisByPlayerId, rules }) {
  const byGsis = new Map();
  for (const row of snapshot.playerStats) {
    const playerId = Number(row.player_id);
    const gsisId = gsisByPlayerId.get(playerId);
    if (!gsisId) continue; // no crosswalk link -> cannot be scored into a candidate's history
    const points = calculateFantasyPoints(row.stats, rules);
    if (!byGsis.has(gsisId)) byGsis.set(gsisId, []);
    byGsis.get(gsisId).push({ season: Number(row.season), week: Number(row.week), points });
  }
  return byGsis;
}

/**
 * The two pinned seasons with a `stats_team_week_<season>.csv` +
 * `games.csv` REG history (prereg 1.3) - the only seasons a DEF pseudo-player's
 * prior-game index can be built from. Unlike a human's prior-game index (built
 * from `snapshot.playerStats`, the rehydrated snapshot's captured DATABASE
 * `player_stats` rows, which reach back further than these two pinned CSVs),
 * a DEF has no database `player_stats` row at all (prereg 4.3, `lib/outcomes.js`
 * module docblock), so the pinned team-week files are the only source this
 * script has for a DEF's history - a real, named limitation, not an oversight.
 * Reuses `rosterGeneration`'s own season constants rather than re-declaring
 * them, so the two lists cannot silently drift apart.
 */
const DEFENSE_PRIOR_GAME_SEASONS = Object.freeze([SENSITIVITY_SEASON, PRIMARY_SEASON]);

/**
 * The shared DEF-scoring computation: one team's rescored fantasy points for
 * one week, from the pinned `stats_team_week`/`games.csv` rows already indexed
 * by team key - `null` when either pinned source lacks the team-week (a bye, or
 * a genuine data gap), never a guessed value. Used for BOTH the target week's
 * outcome truth (`buildOutcomeSignalsFor`) and every PRIOR week's ranking input
 * (`buildDefensePriorGamesIndex`): it is the same computation, just applied to
 * a different week, so it is written once rather than duplicated.
 */
function computeDefenseTeamPoints({
  teamKey, teamWeekRowByTeamKey, gameByTeamKey, season, week,
}) {
  const row = teamWeekRowByTeamKey.get(teamKey);
  const game = gameByTeamKey.get(teamKey);
  if (!row || !game) return null;
  const homeKey = normalizeTeamKey(game.home_team);
  const opponentTeamKey = homeKey === teamKey ? normalizeTeamKey(game.away_team) : homeKey;
  const opponentRow = teamWeekRowByTeamKey.get(opponentTeamKey);
  const opponentYards = opponentRow
    ? (Number(opponentRow.passing_yards) || 0)
      + (Number(opponentRow.sack_yards_lost) || 0)
      + (Number(opponentRow.rushing_yards) || 0)
    : undefined;
  const stats = cohortLib.synthesizeDefenseStats({
    teamWeekRow: { ...row, opponentYards },
    game,
    teamKey,
    normalizeTeamKey,
    label: `DEF ${season}w${week} ${teamKey}`,
  });
  if (!stats) return null;
  cohortLib.assertPerGameDefenseStats(stats, { label: `DEF ${season}w${week} ${teamKey}` });
  return calculateFantasyPoints(mapDefenseStatsToScoringKeys(stats), SCORING_RULES);
}

/**
 * Every prior-game (season, week, points) for one DEF team key, rescored from
 * the pinned `stats_team_week_<season>.csv` + `games.csv` sources across BOTH
 * pinned seasons (`DEFENSE_PRIOR_GAME_SEASONS`) - the DEF-side counterpart to
 * `buildPriorGamesIndex`, keyed by `teamKey` instead of `gsisId` because a DEF
 * pseudo-player has no `gsisId` (`cohort.js` sets it to `null` for DEF
 * members). Without this, `makeBuildCandidatesFor` had nothing to look a DEF
 * candidate's history up by, `rosters.recencyWeightedScore` returned `null`
 * ("no prior game") for every one of them, and every DEF candidate was
 * silently dropped from the pool before the DEF quota could ever be filled.
 *
 * Every REG week in each pinned season's `games.csv` is scanned (not just the
 * 17 preregistered evaluation weeks), because a season-week's PRIOR window can
 * reach back to week 1 - `rosters.recencyWeightedScore` itself decides what is
 * in range via `season`/`week`, this index just needs to offer it everything
 * available.
 */
function buildDefensePriorGamesIndex({
  outcomeSourceContextFor, seasons = DEFENSE_PRIOR_GAME_SEASONS,
}) {
  const byTeamKey = new Map();
  for (const season of seasons) {
    const outcomeSource = outcomeSourceContextFor(season);
    const weeksThisSeason = new Set(outcomeSource.gamesRows.map((row) => Number(row.week)));
    for (const week of weeksThisSeason) {
      const teamWeekRowsThisWeek = filterRowsForWeek(outcomeSource.teamWeekRows, { season, week });
      const teamWeekRowByTeamKey = new Map();
      for (const row of teamWeekRowsThisWeek) {
        teamWeekRowByTeamKey.set(normalizeTeamKey(row.team), row);
      }
      const gamesRowsThisWeek = outcomeSource.gamesRows.filter((row) => Number(row.week) === week);
      const gameByTeamKey = new Map();
      for (const row of gamesRowsThisWeek) {
        gameByTeamKey.set(normalizeTeamKey(row.home_team), row);
        gameByTeamKey.set(normalizeTeamKey(row.away_team), row);
      }
      for (const teamKey of teamWeekRowByTeamKey.keys()) {
        const points = computeDefenseTeamPoints({
          teamKey, teamWeekRowByTeamKey, gameByTeamKey, season, week,
        });
        if (points === null) continue; // no matching game this week - a data gap, never a guessed 0
        if (!byTeamKey.has(teamKey)) byTeamKey.set(teamKey, []);
        byTeamKey.get(teamKey).push({ season: Number(season), week: Number(week), points });
      }
    }
  }
  return byTeamKey;
}

/** Every DATABASE player-week's rescored points, QA-only (prereg 4.3). */
function buildDbPointsBySeasonWeekPlayer({ snapshot, rules }) {
  const index = new Map();
  for (const row of snapshot.playerStats) {
    const key = `${Number(row.season)}:${Number(row.week)}:${Number(row.player_id)}`;
    index.set(key, calculateFantasyPoints(row.stats, rules));
  }
  return index;
}

/**
 * Build the season-scoped OUTCOME-TRUTH source rows `buildOutcomesFor` needs:
 * the pinned `stats_player_week`/`stats_team_week` rows for this season, and
 * this season's REG rows from the pinned `games.csv` - built once per season
 * and reused across that season's weeks, same caching shape as
 * `buildSeasonContext`.
 */
function buildOutcomeSourceContext({ season, readSource }) {
  const playerWeekRows = readCsvRows({
    readSource, sourceName: `stats_player_week_${season}`, columns: STATS_PLAYER_WEEK_COLUMNS,
    label: `stats_player_week_${season}`,
  });
  const teamWeekRows = readCsvRows({
    readSource, sourceName: `stats_team_week_${season}`, columns: STATS_TEAM_WEEK_COLUMNS,
    label: `stats_team_week_${season}`,
  });
  const allGamesRows = readCsvRows({
    readSource, sourceName: 'games', columns: GAMES_COLUMNS, label: 'games',
  });
  const gamesRows = allGamesRows.filter(
    (row) => Number(row.season) === Number(season) && row.game_type === 'REG'
  );
  return { playerWeekRows, teamWeekRows, gamesRows };
}

/**
 * The per-team-week signals `lib/outcomes.resolveCohortOutcomes` needs for
 * ONE season-week, assembled from the pinned sources: rescored external
 * points, PRIMARY/SECONDARY presence, team-attribution contradiction (humans
 * only), and the QA-only database points. See `lib/outcomes.js`'s module
 * docblock for why humans and DEF resolve PRIMARY/SECONDARY differently.
 */
function buildOutcomeSignalsFor({
  season, week, cohort, outcomeSource, dbPointsBySeasonWeekPlayer, defensePlayerIdByTeamKey,
}) {
  const pointsByPlayerId = new Map();
  const presentInPrimaryByPlayerId = new Set();
  const presentInSecondaryByPlayerId = new Set();
  const teamContradictionByPlayerId = new Set();
  const dbPointsByPlayerId = new Map();

  // --- Humans: one pinned per-player file, so presence is one signal fed
  // twice, and the ambiguity channel is team-attribution contradiction. ---
  const playerRowsThisWeek = filterRowsForWeek(outcomeSource.playerWeekRows, { season, week });
  const statsRowByGsis = new Map();
  for (const row of playerRowsThisWeek) {
    if (!row.player_id || row.player_id === '0') continue; // nflverse placeholder rows
    statsRowByGsis.set(row.player_id, row);
  }
  for (const member of cohort.members) {
    if (member.isDefense) continue;
    const row = statsRowByGsis.get(member.gsisId);
    if (!row) continue;
    const normalized = normalizeNflversePlayerStats(row);
    presentInPrimaryByPlayerId.add(member.playerId);
    presentInSecondaryByPlayerId.add(member.playerId);
    pointsByPlayerId.set(member.playerId, calculateFantasyPoints(normalized, SCORING_RULES));
    if (normalized.gameTeam && normalized.gameTeam !== member.teamKey) {
      teamContradictionByPlayerId.add(member.playerId);
    }
    const dbKey = `${Number(season)}:${Number(week)}:${Number(member.playerId)}`;
    if (dbPointsBySeasonWeekPlayer.has(dbKey)) {
      dbPointsByPlayerId.set(member.playerId, dbPointsBySeasonWeekPlayer.get(dbKey));
    }
  }

  // --- DEF: two genuinely independent pinned sources. ---
  const teamWeekRowsThisWeek = filterRowsForWeek(outcomeSource.teamWeekRows, { season, week });
  const teamWeekRowByTeamKey = new Map();
  for (const row of teamWeekRowsThisWeek) {
    teamWeekRowByTeamKey.set(normalizeTeamKey(row.team), row);
  }
  const gamesRowsThisWeek = outcomeSource.gamesRows.filter((row) => Number(row.week) === Number(week));
  const gameByTeamKey = new Map();
  for (const row of gamesRowsThisWeek) {
    gameByTeamKey.set(normalizeTeamKey(row.home_team), row);
    gameByTeamKey.set(normalizeTeamKey(row.away_team), row);
  }

  for (const member of cohort.members) {
    if (!member.isDefense) continue;
    const teamKey = member.teamKey;
    const primaryPresent = teamWeekRowByTeamKey.has(teamKey);
    const secondaryPresent = gameByTeamKey.has(teamKey);
    if (primaryPresent) presentInPrimaryByPlayerId.add(member.playerId);
    if (secondaryPresent) presentInSecondaryByPlayerId.add(member.playerId);
    if (!primaryPresent || !secondaryPresent) continue; // ambiguous, or a bye - nothing to synthesize

    // Same computation `buildDefensePriorGamesIndex` applies to every PRIOR
    // week - see that function's docblock for why it is shared rather than
    // duplicated.
    const points = computeDefenseTeamPoints({
      teamKey, teamWeekRowByTeamKey, gameByTeamKey, season, week,
    });
    if (points === null) continue;
    const defensePlayerId = defensePlayerIdByTeamKey.get(teamKey);
    if (defensePlayerId === undefined) continue; // unreachable if the cohort itself built - defensive only
    pointsByPlayerId.set(member.playerId, points);
  }

  return {
    pointsByPlayerId,
    presentInPrimaryByPlayerId,
    presentInSecondaryByPlayerId,
    teamContradictionByPlayerId,
    dbPointsByPlayerId,
  };
}

function makeBuildOutcomesFor({
  outcomeSourceContextFor, dbPointsBySeasonWeekPlayer, defensePlayerIdByTeamKey,
}) {
  return function buildOutcomesFor({ season, week, cohort }) {
    const signals = buildOutcomeSignalsFor({
      season,
      week,
      cohort,
      outcomeSource: outcomeSourceContextFor(season),
      dbPointsBySeasonWeekPlayer,
      defensePlayerIdByTeamKey,
    });
    return outcomesLib.resolveCohortOutcomes({
      season,
      week,
      members: cohort.members,
      pointsByPlayerId: signals.pointsByPlayerId,
      presentInPrimaryByPlayerId: signals.presentInPrimaryByPlayerId,
      presentInSecondaryByPlayerId: signals.presentInSecondaryByPlayerId,
      teamContradictionByPlayerId: signals.teamContradictionByPlayerId,
      dbPointsByPlayerId: signals.dbPointsByPlayerId,
      label: `outcome truth ${season}w${week}`,
    });
  };
}

// ---------------------------------------------------------------------------
// buildCohortFor / buildCandidatesFor
// ---------------------------------------------------------------------------

function makeBuildCohortFor({ snapshot, crosswalk, playerIdByGsis, seasonContextFor }) {
  return function buildCohortFor({ season, week }) {
    const ctx = seasonContextFor(season);
    const scheduled = ctx.scheduledByWeek.get(Number(week)) || new Set();
    const byeTeamKeys = [...ctx.leagueTeamKeys].filter((k) => !scheduled.has(k));
    return cohortLib.buildCohort({
      season,
      week,
      rosterIndex: ctx.rosterIndex,
      crosswalk,
      playerIdByGsis,
      injuryIndex: ctx.injuryIndex,
      normalizeTeamKey,
      // The primary regret estimand exercises bye availability only, never
      // O/IR filtering (prereg 4.2) - `statsGameTeamFor` is only used to REPORT
      // roster/stats team contradictions, never to exclude, so a source that
      // never resolves a game team here still yields a valid (if less complete)
      // contradiction count rather than a broken cohort.
      statsGameTeamFor: () => null,
      byeTeamKeys,
      defenseTeamKeys: [...ctx.leagueTeamKeys],
      defensePlayerIdByTeamKey: ctx.defensePlayerIdByTeamKey,
      label: `cohort ${season}w${week}`,
    });
  };
}

function makeBuildCandidatesFor({
  priorGamesByGsis, priorGamesByTeamKey, positionRankRows, playerNameRankRows,
}) {
  const ranks = ordering.buildRankIndex({
    positionRankRows, playerNameRankRows, label: 'candidate ranking',
  });
  return function buildCandidatesFor({ season, week, cohort }) {
    const candidates = [];
    for (const member of cohort.members) {
      // A DEF pseudo-player has no `gsisId` (`cohort.js` sets it to `null` for
      // DEF members) and therefore no entry in `priorGamesByGsis` - it is
      // looked up by `teamKey` in the DEF-specific index instead
      // (`buildDefensePriorGamesIndex`). Looking every member up by `gsisId`
      // regardless of kind is the bug this branch exists to fix: every DEF
      // candidate's `priorGames` came back `[]`, `recencyWeightedScore`
      // returned `null` for all of them, and the DEF quota could never be
      // filled.
      const priorGames = member.isDefense
        ? (priorGamesByTeamKey.get(member.teamKey) || [])
        : (member.gsisId ? (priorGamesByGsis.get(member.gsisId) || []) : []);
      const scored = rosters.recencyWeightedScore({ priorGames, season, week });
      if (!scored) continue; // no prior game -> not rankable (rosters.js:171-173)
      candidates.push({
        playerId: member.playerId,
        teamKey: member.teamKey,
        position: member.position,
        isDefense: member.isDefense,
        score: scored.score,
      });
    }
    return { candidates, positionRank: ranks.positionRank, nameRankById: ranks.nameRankById };
  };
}

// ---------------------------------------------------------------------------
// cohort-week artifact assembly
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: a Map serializes as `{}` (no own enumerable keys), so the
 * artifact carries `actualPointsByPlayerId` as a plain object keyed by the
 * player id STRING - exactly the shape `run-backtest-mde.js` already expects
 * and converts back to a `Map` on read (`Number(id)` on each key).
 */
function cohortWeekArtifact(outcome, cohort) {
  if (!cohort || !cohort.counts || typeof cohort.counts !== 'object') {
    throw new Error('run-backtest-rosters: cohortWeekArtifact requires the cohort exclusion counts for section 7 publication');
  }
  const actualPointsByPlayerId = {};
  for (const [playerId, points] of outcome.actualPointsByPlayerId) {
    actualPointsByPlayerId[String(playerId)] = points;
  }
  return {
    season: outcome.season,
    week: outcome.week,
    members: outcome.members,
    counts: outcome.counts,
    cohortExclusions: {
      ...cohort.counts,
      excluded: { ...cohort.counts.excluded },
    },
    actualPointsByPlayerId,
  };
}

function cohortFreezeHash(artifact) {
  return crypto.createHash('sha256').update(canonicalJson(artifact), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(argv) {
  const args = parseArgs(argv);

  const snapshot = snapshotClientLib.loadSnapshot({ root: args.rehydratedSnapshot });
  // `makeSourceReader` verifies every source read against a Phase-0
  // provenance record; it has no default provenance path of its own, and
  // `rehydrate.js` writes the rehydrated tree's own provenance record to
  // `<rehydratedSources>/provenance.json` (copied verbatim from the
  // publication tree's `sources-provenance.json`, verified against the
  // sealed manifest - see `rehydrate.js`'s `copyProvenanceIntoSources`).
  // Passing no `provenancePath` here silently resolved to `undefined` and
  // failed every real container run before this fix ("no Phase-0
  // provenance at undefined") - caught by an actual end-to-end run, not by
  // code review.
  const readSource = makeSourceReader({
    sourcesDir: args.rehydratedSources,
    // args.rehydratedSources is the operator's own CLI argument, joined only
    // with a hardcoded literal filename - not external input.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    provenancePath: path.join(args.rehydratedSources, 'provenance.json'),
  });

  const playersCsvRows = readCsvRows({
    readSource, sourceName: 'players', columns: PLAYERS_CROSSWALK_COLUMNS, label: 'players.csv',
  });
  const crosswalk = cohortLib.buildCrosswalk(playersCsvRows);
  const { gsisByPlayerId, playerIdByGsis } = cohortLib.buildGsisByPlayerId({
    dbPlayers: snapshot.players, crosswalk,
  });
  const defensePlayerIdByTeamKey = cohortLib.buildDefensePlayerIndex({
    dbPlayers: snapshot.players, normalizeTeamKey,
  });

  const seasonContextCache = new Map();
  const seasonContextFor = (season) => {
    if (!seasonContextCache.has(season)) {
      seasonContextCache.set(season, buildSeasonContext({
        season, readSource, snapshot, defensePlayerIdByTeamKey,
      }));
    }
    return seasonContextCache.get(season);
  };

  const priorGamesByGsis = buildPriorGamesIndex({
    snapshot, playerIdByGsis, gsisByPlayerId, rules: SCORING_RULES,
  });

  // Built here, ahead of Step 1, because Step 1's candidate ranking now needs
  // it too: a DEF pseudo-player's prior-game history comes from the pinned
  // `stats_team_week`/`games.csv` sources (`buildDefensePriorGamesIndex`), the
  // same sources Step 2's outcome truth reads, so the reader is shared rather
  // than opened twice.
  const outcomeSourceContextCache = new Map();
  const outcomeSourceContextFor = (season) => {
    if (!outcomeSourceContextCache.has(season)) {
      outcomeSourceContextCache.set(season, buildOutcomeSourceContext({ season, readSource }));
    }
    return outcomeSourceContextCache.get(season);
  };
  const priorGamesByTeamKey = buildDefensePriorGamesIndex({ outcomeSourceContextFor });

  const buildCohortFor = makeBuildCohortFor({
    snapshot, crosswalk, playerIdByGsis, seasonContextFor,
  });
  const buildCandidatesFor = makeBuildCandidatesFor({
    priorGamesByGsis,
    priorGamesByTeamKey,
    positionRankRows: snapshot.positionRank,
    playerNameRankRows: snapshot.playerNameRank,
  });

  const { results, index } = rosterGeneration.buildAllRosterWeeks({
    buildCohortFor, buildCandidatesFor,
  });

  // args.out is the operator's own CLI argument to this locally-invoked
  // tool, not external/network input.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const outDir = path.resolve(String(args.out));
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const rosterWeeksDir = path.join(outDir, 'roster-weeks');
  fs.mkdirSync(rosterWeeksDir, { recursive: true });
  for (const result of results) {
    // result.season/result.week are numeric fields from this run's own
    // internally-generated results, not external input.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const file = path.join(rosterWeeksDir, `${result.season}-w${result.week}.json`);
    fs.writeFileSync(file, `${canonicalJson({ ...result.artifact, freezeHash: result.freezeHash })}\n`, 'utf8');
  }

  // --- Step 2: outcome truth, for the SAME 34 season-weeks (prereg 4.3). ---
  const dbPointsBySeasonWeekPlayer = buildDbPointsBySeasonWeekPlayer({ snapshot, rules: SCORING_RULES });
  const buildOutcomesFor = makeBuildOutcomesFor({
    outcomeSourceContextFor, dbPointsBySeasonWeekPlayer, defensePlayerIdByTeamKey,
  });

  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const cohortWeeksDir = path.join(outDir, 'cohort-weeks');
  fs.mkdirSync(cohortWeeksDir, { recursive: true });
  const cohortIndex = [];
  for (const { season, week } of rosterGeneration.SEASON_WEEKS) {
    const cohort = buildCohortFor({ season, week });
    const outcome = buildOutcomesFor({ season, week, cohort });
    const artifact = cohortWeekArtifact(outcome, cohort);
    const freezeHash = cohortFreezeHash(artifact);
    // season/week come from the preregistered SEASON_WEEKS constant, not
    // external input.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const file = path.join(cohortWeeksDir, `${season}-w${week}.json`);
    fs.writeFileSync(file, `${canonicalJson({ ...artifact, freezeHash })}\n`, 'utf8');
    cohortIndex.push({
      season,
      week,
      freezeHash,
      memberCount: artifact.members.length,
      outcomeTally: artifact.counts.outcomeTally,
    });
  }

  fs.writeFileSync(
    // outDir is derived from the operator's own --out CLI argument
    // (resolved above), joined only with a hardcoded literal filename.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    path.join(outDir, 'index.json'),
    `${canonicalJson({ seasonWeeks: index, cohortWeeks: cohortIndex })}\n`,
    'utf8'
  );

  console.log(`wrote ${results.length} roster-week artifacts to ${rosterWeeksDir}`);
  console.log(`wrote ${cohortIndex.length} cohort-week artifacts to ${cohortWeeksDir}`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code || 0))
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  readCsvRows,
  buildSeasonContext,
  buildPriorGamesIndex,
  DEFENSE_PRIOR_GAME_SEASONS,
  computeDefenseTeamPoints,
  buildDefensePriorGamesIndex,
  makeBuildCohortFor,
  makeBuildCandidatesFor,
  buildOutcomeSourceContext,
  buildDbPointsBySeasonWeekPlayer,
  buildOutcomeSignalsFor,
  makeBuildOutcomesFor,
  mapDefenseStatsToScoringKeys,
  cohortWeekArtifact,
  cohortFreezeHash,
  main,
};
