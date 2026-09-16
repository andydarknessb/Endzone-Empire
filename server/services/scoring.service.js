/**
 * scoring.service: a re-export shim over the six modules the old scoring
 * module split into (#1504, spec #1492) — Scoring rules (scoringRules.js),
 * the Tank01 feed adapter (tank01Feed.js), Box-score apply
 * (boxScoreApply.service.js), feed Sync runs (feedSyncRuns.service.js),
 * Season summary (seasonSummary.service.js) and Matchup scoring
 * (matchupScoring.service.js).
 *
 * This module carries no logic of its own: it re-exports every name this
 * file used to export directly, and nothing more, so every existing importer
 * and every existing test keeps working unchanged while step two of #1492's
 * chain moves importers onto the new modules one concept at a time. Its
 * properties stay plain data (ADR 0036) — a straight re-export, not a getter
 * — so `t.mock.method(scoringService, 'someExport', fn)` still mocks exactly
 * the property tests already target.
 *
 * generateMatchups and scoreMatchups now live in matchupScoring.service.js;
 * see that module for the full account. scoreMatchups still computes each
 * matchup's score from one of three populations, chosen by the week's
 * finality and the `settle` option, never inferred from anything else:
 * - LIVE (an open week, no `settle`): materialize first, then the CURRENT
 *   roster — a player dropped mid-week stops scoring immediately.
 * - SETTLE (an open week, `settle: true`): the week AS PLAYED — the
 *   existing lineup_entries rows, minus any a tenure of this team did not
 *   cover at its player's kickoff.
 * - FINAL (`matchups.final`): the SAME population and the SAME exclusion as
 *   SETTLE — a player traded or dropped since then still counts.
 */
const { SCORING_RULES, SCORING_PRESETS, isValidTierArray, rulesForLeague, calculateFantasyPoints, hasTeamDefenseTiers } = require('./scoringRules');
const {
  rapidApiClient, tank01Body, normalizeTank01Stats, normalizeTank01IdpStats, extractPlayByPlayBonusStats,
  normalizeTank01DstStats, normalizeTeamAbbr, NFL_TEAM_NAME_TO_ABBR, buildGameKey, normalizeTank01Game,
  resolveHeadshotUrl,
} = require('./tank01Feed');
const {
  loadDefUnitsByTeamCode, loadWeekMaps, applyGameBoxScore, gamesNeedingBoxScore, markFinalStatsSynced,
  NFLVERSE_ONLY_STAT_KEYS, pickPresentKeys, mergeCarriedStats, detectScoringEvents,
} = require('./boxScoreApply.service');
const {
  missingTeamDefenses, syncTeamDefenses, normalizeInjuryStatus, normalizePlayerEntry, IDP_POSITIONS,
  DEFENSIVE_POSITIONS, syncWeekStats, syncSchedule, syncInjuries, NFL_PLAYER_LIST_FLOOR, syncPlayers,
  syncPlayerSeasonStats,
} = require('./feedSyncRuns.service');
const { aggregateSeasonStats, buildPlayerSummary, projectSeasonPoints, getSeasonPositionRank } = require('./seasonSummary.service');
const { generateMatchups, scoreMatchups } = require('./matchupScoring.service');

module.exports = {
  SCORING_RULES,
  SCORING_PRESETS,
  isValidTierArray,
  rulesForLeague,
  calculateFantasyPoints,
  rapidApiClient,
  tank01Body,
  normalizeTank01Stats,
  normalizeTank01IdpStats,
  extractPlayByPlayBonusStats,
  normalizeTank01DstStats,
  normalizeTeamAbbr,
  NFL_TEAM_NAME_TO_ABBR,
  loadDefUnitsByTeamCode,
  loadWeekMaps,
  applyGameBoxScore,
  gamesNeedingBoxScore,
  markFinalStatsSynced,
  missingTeamDefenses,
  syncTeamDefenses,
  buildGameKey,
  normalizeTank01Game,
  normalizeInjuryStatus,
  normalizePlayerEntry,
  resolveHeadshotUrl,
  aggregateSeasonStats,
  buildPlayerSummary,
  projectSeasonPoints,
  hasTeamDefenseTiers,
  IDP_POSITIONS,
  DEFENSIVE_POSITIONS,
  NFLVERSE_ONLY_STAT_KEYS,
  pickPresentKeys,
  mergeCarriedStats,
  detectScoringEvents,
  syncWeekStats,
  syncSchedule,
  syncInjuries,
  NFL_PLAYER_LIST_FLOOR,
  syncPlayers,
  syncPlayerSeasonStats,
  getSeasonPositionRank,
  generateMatchups,
  scoreMatchups,
};
