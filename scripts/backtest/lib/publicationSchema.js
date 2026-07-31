'use strict';

/**
 * The closed-schema allowlists for every dataset the Gate-3 snapshot
 * publishes, named individually per the user's binding sanitization review.
 * Nothing here is inherited or inferred from the data at packaging time -
 * every field below was enumerated by hand against the real captured
 * snapshot (column names and nesting only; no row values were carried into
 * this file or into any commit message).
 *
 * Two binding rulings from that review are encoded as STRUCTURE here, not
 * just as comments:
 *
 *   - `external_id` is declared ONLY in `PLAYERS_SCHEMA`. No other dataset's
 *     schema below names it, and `assertExternalIdOnlyInPlayers` (run once,
 *     at module load) proves that structurally rather than by convention -
 *     it walks every OTHER schema's declared keys, at every depth, and
 *     throws if `external_id` appears anywhere in them.
 *   - `injury_detail` is retained (fidelity: production's decision policy
 *     reads it) but must be EXPLICITLY allowlisted - `PLAYERS_SCHEMA` names
 *     it as its own field, not folded into a wildcard, and
 *     `assertInjuryDetailExplicitlyAllowlisted` proves the literal key is
 *     present in the schema object.
 *
 * See `schemaGuard.js` for what `kind`/`mode`/`oneOf` mean. Two object modes
 * matter here for a real reason, not a stylistic one: the DB-captured row
 * envelopes (`players`, the outer `player_stats` row, `nfl_games_*`, ...)
 * come from a fixed SQL column list, so every declared key is always
 * present - `mode: 'exact'`. The JSONB blobs nested inside them
 * (`player_stats.stats`, `player_season_stats.stats`) and the projection
 * engine's optional sub-factors are written incrementally depending on a
 * player's position and the factor's availability, so a declared key may
 * legitimately be ABSENT on any given row - `mode: 'subset'`. Getting this
 * backwards in either direction would either reject real production data
 * (exact applied to a sparse blob) or silently accept a key nobody named
 * (subset applied where every key really is guaranteed).
 */

const { collectDeclaredKeys } = require('./schemaGuard');

const STRING = Object.freeze({ kind: 'string' });
const NUMBER = Object.freeze({ kind: 'number' });
const BOOLEAN = Object.freeze({ kind: 'boolean' });
const NUMERIC_STRING = Object.freeze({ kind: 'numeric-string' });
const NULL = Object.freeze({ kind: 'null' });
const NULLABLE_STRING = Object.freeze({ oneOf: [NULL, STRING] });
const NULLABLE_NUMBER = Object.freeze({ oneOf: [NULL, NUMBER] });
const NULLABLE_NUMERIC_STRING = Object.freeze({ oneOf: [NULL, NUMERIC_STRING] });
const NULLABLE_BOOLEAN = Object.freeze({ oneOf: [NULL, BOOLEAN] });
const ARRAY_OF_STRING = Object.freeze({ kind: 'array', items: STRING });
const ARRAY_OF_NUMBER = Object.freeze({ kind: 'array', items: NUMBER });

function exactObject(fields) {
  return Object.freeze({ kind: 'object', mode: 'exact', fields: Object.freeze(fields) });
}

function subsetObject(fields) {
  return Object.freeze({ kind: 'object', mode: 'subset', fields: Object.freeze(fields) });
}

// ---------------------------------------------------------------------------
// players
// ---------------------------------------------------------------------------

const PLAYERS_SCHEMA = exactObject({
  id: NUMBER,
  external_id: NULLABLE_NUMBER, // approved ONLY here - see the module docblock
  name: STRING,
  position: STRING,
  nfl_team: STRING,
  injury_status: NULLABLE_STRING,
  injury_detail: NULLABLE_STRING, // explicitly allowlisted, retained for fidelity
  adp: NULLABLE_NUMERIC_STRING,
  team_key: STRING,
});

// ---------------------------------------------------------------------------
// player_stats (weekly JSONB stat blob - subset, position-dependent keys)
// ---------------------------------------------------------------------------

const PLAYER_STATS_NUMBER_KEYS = [
  'assistedTackle', 'blockedKick', 'defensiveTD', 'extraPoint', 'extraPointMissed',
  'fieldGoal', 'fieldGoalMissed', 'forcedFumble', 'fumbleRecovery', 'fumbles',
  'idpDefensiveTD', 'idpFumbleRecovery', 'idpFumbleReturnYards', 'idpInterception',
  'idpInterceptionReturnYards', 'idpSack', 'idpSackYards', 'idpSafety',
  'idpTacklesForLossYards', 'interceptionReturn', 'interceptions', 'kickReturnYards',
  'kickReturns', 'passDeflection', 'passingTDs', 'passingTwoPt', 'passingYards',
  'pointsAllowed', 'puntReturnYards', 'puntReturns', 'qbHit', 'receivingTDs',
  'receivingTwoPt', 'receivingYards', 'receptions', 'returnTDs', 'rushingTDs',
  'rushingTwoPt', 'rushingYards', 'sack', 'safety', 'soloTackle', 'tacklesForLoss',
  'twoPointReturn', 'usageAirYards', 'usageCarries', 'usageCompletions',
  'usagePassAttempts', 'usageTargets', 'yardsAllowed',
];
const PLAYER_STATS_STRING_KEYS = ['gameTeam', 'gameOpponent'];
const PLAYER_STATS_ARRAY_NUMBER_KEYS = [
  'fieldGoalDistances', 'passingTDLengths', 'receivingTDLengths', 'rushingTDLengths',
];

const PLAYER_STATS_JSONB_SCHEMA = subsetObject({
  ...Object.fromEntries(PLAYER_STATS_NUMBER_KEYS.map((k) => [k, NUMBER])),
  ...Object.fromEntries(PLAYER_STATS_STRING_KEYS.map((k) => [k, STRING])),
  ...Object.fromEntries(PLAYER_STATS_ARRAY_NUMBER_KEYS.map((k) => [k, ARRAY_OF_NUMBER])),
});

const PLAYER_STATS_SCHEMA = exactObject({
  player_id: NUMBER,
  season: NUMBER,
  week: NUMBER,
  stats: PLAYER_STATS_JSONB_SCHEMA,
});

// ---------------------------------------------------------------------------
// player_season_stats (season-aggregate JSONB blob - a DIFFERENT shape from
// the weekly blob: no gameTeam/gameOpponent, no usage keys, and
// fieldGoalDistances is a summed number here rather than an array)
// ---------------------------------------------------------------------------

const SEASON_STATS_NUMBER_KEYS = [
  'assistedTackle', 'blockedKick', 'defensiveTD', 'extraPoint', 'extraPointMissed',
  'fieldGoal', 'fieldGoalDistances', 'fieldGoalMissed', 'forcedFumble', 'fumbleRecovery',
  'fumbles', 'idpDefensiveTD', 'idpFumbleRecovery', 'idpFumbleReturnYards',
  'idpInterception', 'idpSack', 'idpSackYards', 'idpSafety', 'idpTacklesForLossYards',
  'interceptionReturn', 'interceptions', 'kickReturnYards', 'kickReturns',
  'passDeflection', 'passingTDs', 'passingTwoPt', 'passingYards', 'pointsAllowed',
  'puntReturnYards', 'puntReturns', 'qbHit', 'receivingTDs', 'receivingTwoPt',
  'receivingYards', 'receptions', 'returnTDs', 'rushingTDs', 'rushingTwoPt',
  'rushingYards', 'sack', 'safety', 'soloTackle', 'tacklesForLoss', 'twoPointReturn',
  'yardsAllowed',
];

const SEASON_STATS_JSONB_SCHEMA = subsetObject({
  ...Object.fromEntries(SEASON_STATS_NUMBER_KEYS.map((k) => [k, NUMBER])),
});

const PLAYER_SEASON_STATS_SCHEMA = exactObject({
  player_id: NUMBER,
  season: NUMBER,
  games_played: NUMBER,
  stats: SEASON_STATS_JSONB_SCHEMA,
  fantasy_points: NUMERIC_STRING,
});

// ---------------------------------------------------------------------------
// nfl_games_{season} - identical shape for every captured season, including
// the two captured-as-empty seasons (2022/2023 have zero rows, not a
// different schema)
// ---------------------------------------------------------------------------

const NFL_GAMES_SCHEMA = exactObject({
  season: NUMBER,
  week: NUMBER,
  nfl_team: STRING,
  opponent: STRING,
  kickoff_at: STRING, // ISO 8601, per extract-snapshot's jsonSafe Date->string contract
  game_key: NULLABLE_STRING,
  home_away: NULLABLE_STRING,
  neutral_site: NULLABLE_BOOLEAN,
  venue: NULLABLE_STRING,
  roof: NULLABLE_STRING,
  surface: NULLABLE_STRING,
  latitude: NULLABLE_NUMERIC_STRING,
  longitude: NULLABLE_NUMERIC_STRING,
  rest_days: NULLABLE_NUMBER,
  team_key: STRING,
  opponent_key: STRING,
});

// ---------------------------------------------------------------------------
// orientation_overlay - JS-computed from the pinned games.csv, never written
// to the database
// ---------------------------------------------------------------------------

const ORIENTATION_OVERLAY_SCHEMA = exactObject({
  season: NUMBER,
  week: NUMBER,
  team_key: STRING,
  opponent_key: STRING,
  source_team: STRING,
  home_away: STRING, // 'home' | 'away'
  neutral_site: NULLABLE_BOOLEAN,
  game_id: STRING,
});

// ---------------------------------------------------------------------------
// position_rank / player_name_rank - the two PostgreSQL collation artifacts
// ---------------------------------------------------------------------------

const POSITION_RANK_SCHEMA = exactObject({
  code: STRING,
  rank: NUMERIC_STRING, // bigint from row_number()
});

const PLAYER_NAME_RANK_SCHEMA = exactObject({
  id: NUMBER,
  name: STRING,
  rank: NUMERIC_STRING,
});

// ---------------------------------------------------------------------------
// games_csv - raw provenance rows (2026 rows retained by design; see
// snapshotStore.js). Same seven columns extract-snapshot projects onto the
// provenance store.
// ---------------------------------------------------------------------------

const GAMES_CSV_SCHEMA = exactObject({
  game_id: STRING,
  season: NUMBER,
  game_type: STRING,
  week: NUMBER,
  away_team: STRING,
  home_team: STRING,
  location: STRING,
});

// ---------------------------------------------------------------------------
// oracle_{season}_w{week} - the real generateProjections() output, captured
// verbatim. This is application-code JSON, not a JSONB blob, so its shape is
// as fixed as a struct - 'exact' mode throughout the envelope and its
// `factors` object; only the individual FACTOR sub-objects are 'subset'
// (a factor's own internal fields vary slightly by branch - e.g.
// `dataQuality` carries `reason` OR `reasons` depending which code path
// produced it, and `availability` carries `autoRecommend` only when it
// applies).
// ---------------------------------------------------------------------------

const AVAILABILITY_SCHEMA = subsetObject({
  activeProbability: NULLABLE_NUMBER,
  autoRecommend: BOOLEAN,
  available: BOOLEAN,
  locked: BOOLEAN,
  lockedSlot: Object.freeze({ oneOf: [NULL, STRING, NUMBER] }),
  reason: NULLABLE_STRING,
  status: NULLABLE_STRING,
});

const DATA_QUALITY_SCHEMA = subsetObject({
  level: STRING,
  reason: STRING,
  reasons: ARRAY_OF_STRING,
  residualSource: NULLABLE_STRING,
});

const HOME_AWAY_FACTOR_SCHEMA = subsetObject({
  available: BOOLEAN,
  effect: NUMBER,
  pointsContribution: NULLABLE_NUMBER,
  reason: STRING,
});

const OPPONENT_FACTOR_SCHEMA = subsetObject({
  allowedPerGame: NUMBER,
  available: BOOLEAN,
  effect: NUMBER,
  games: NUMBER,
  leagueAveragePerGame: NUMBER,
  opponentTeam: NULLABLE_STRING,
  pointsContribution: NULLABLE_NUMBER,
  reason: STRING,
});

const RECENT_PRODUCTION_FACTOR_SCHEMA = subsetObject({
  available: BOOLEAN,
  effectiveGames: NUMBER,
  expectedOpportunities: NULLABLE_NUMBER,
  games: NUMBER,
  opportunityEfficiency: NULLABLE_NUMBER,
  opportunityValue: NULLABLE_NUMBER,
  perGame: NUMBER,
  pointsBaselinePerGame: NUMBER,
  pointsContribution: NUMBER,
  usageBlendWeight: NUMBER,
  usageGames: NUMBER,
  usedPositionBaseline: BOOLEAN,
  usedPriorSeason: BOOLEAN,
});

const ROLE_FACTOR_SCHEMA = subsetObject({
  available: BOOLEAN,
  note: STRING,
  pointsContribution: NULLABLE_NUMBER,
});

const VERSUS_OPPONENT_FACTOR_SCHEMA = subsetObject({
  available: BOOLEAN,
  effect: NUMBER,
  meetings: NUMBER,
  pointsContribution: NULLABLE_NUMBER,
  reason: STRING,
});

const WEATHER_FACTOR_SCHEMA = subsetObject({
  available: BOOLEAN,
  effect: NUMBER,
  pointsContribution: NULLABLE_NUMBER,
  reason: STRING,
  roof: NULLABLE_STRING,
});

const FACTORS_SCHEMA = exactObject({
  availability: AVAILABILITY_SCHEMA,
  dataQuality: DATA_QUALITY_SCHEMA,
  expertConsensus: NULL, // not yet implemented in free_baseline_v3.1 - always null
  homeAway: Object.freeze({ oneOf: [NULL, HOME_AWAY_FACTOR_SCHEMA] }),
  opponent: Object.freeze({ oneOf: [NULL, OPPONENT_FACTOR_SCHEMA] }),
  recentProduction: Object.freeze({ oneOf: [NULL, RECENT_PRODUCTION_FACTOR_SCHEMA] }),
  role: Object.freeze({ oneOf: [NULL, ROLE_FACTOR_SCHEMA] }),
  versusOpponent: Object.freeze({ oneOf: [NULL, VERSUS_OPPONENT_FACTOR_SCHEMA] }),
  weather: Object.freeze({ oneOf: [NULL, WEATHER_FACTOR_SCHEMA] }),
});

const PROJECTION_SCHEMA = exactObject({
  activeProbability: NULLABLE_NUMBER,
  confidence: STRING,
  confidenceReasons: ARRAY_OF_STRING,
  effectiveGames: NUMBER,
  factors: FACTORS_SCHEMA,
  mean: NULLABLE_NUMBER,
  median: NULLABLE_NUMBER,
  modelVersion: STRING,
  p10: NULLABLE_NUMBER,
  p25: NULLABLE_NUMBER,
  p75: NULLABLE_NUMBER,
  p90: NULLABLE_NUMBER,
  playerId: NUMBER,
  position: STRING,
  sampleSize: NUMBER,
  unavailableReason: NULLABLE_STRING,
});

const ORACLE_SCHEMA = exactObject({
  season: NUMBER,
  week: NUMBER,
  player_id: NUMBER,
  projection: PROJECTION_SCHEMA,
});

// ---------------------------------------------------------------------------
// Dispatch: exact dataset names, plus the two parametrized families
// ---------------------------------------------------------------------------

const FIXED_NAME_SCHEMAS = Object.freeze({
  players: PLAYERS_SCHEMA,
  player_stats: PLAYER_STATS_SCHEMA,
  player_season_stats: PLAYER_SEASON_STATS_SCHEMA,
  orientation_overlay: ORIENTATION_OVERLAY_SCHEMA,
  position_rank: POSITION_RANK_SCHEMA,
  player_name_rank: PLAYER_NAME_RANK_SCHEMA,
  games_csv: GAMES_CSV_SCHEMA,
});

const NFL_GAMES_NAME = /^nfl_games_\d{4}$/;
const ORACLE_NAME = /^oracle_\d{4}_w\d{1,2}$/;

/** Every dataset name this snapshot is known to produce must resolve to a schema. */
function schemaForDataset(datasetName) {
  const name = String(datasetName);
  if (Object.prototype.hasOwnProperty.call(FIXED_NAME_SCHEMAS, name)) return FIXED_NAME_SCHEMAS[name];
  if (NFL_GAMES_NAME.test(name)) return NFL_GAMES_SCHEMA;
  if (ORACLE_NAME.test(name)) return ORACLE_SCHEMA;
  throw new Error(
    `schemaForDataset: no closed-schema allowlist is registered for dataset ${JSON.stringify(name)} - ` +
    'a dataset the snapshot manifest lists but this file does not name is refused rather than let ' +
    'through unchecked'
  );
}

/** Every schema this file defines, by a stable representative name - for the
 * two self-checks below and for schema-level tests. Not a dataset dispatch
 * table (nfl_games_* and oracle_* collapse to one representative each). */
const ALL_SCHEMAS_BY_LABEL = Object.freeze({
  players: PLAYERS_SCHEMA,
  player_stats: PLAYER_STATS_SCHEMA,
  player_season_stats: PLAYER_SEASON_STATS_SCHEMA,
  nfl_games: NFL_GAMES_SCHEMA,
  orientation_overlay: ORIENTATION_OVERLAY_SCHEMA,
  position_rank: POSITION_RANK_SCHEMA,
  player_name_rank: PLAYER_NAME_RANK_SCHEMA,
  games_csv: GAMES_CSV_SCHEMA,
  oracle: ORACLE_SCHEMA,
});

/**
 * Structural proof of the first binding ruling: `external_id` is declared in
 * `players` and nowhere else. Runs at module load (below) so a future edit
 * that added the key to any other schema fails IMMEDIATELY, at require time,
 * rather than waiting for a row to trip it during a real packaging run.
 */
function assertExternalIdOnlyInPlayers(schemasByLabel = ALL_SCHEMAS_BY_LABEL) {
  for (const [label, schema] of Object.entries(schemasByLabel)) {
    if (label === 'players') continue;
    const keys = collectDeclaredKeys(schema);
    if (keys.has('external_id')) {
      throw new Error(
        `publicationSchema: dataset schema "${label}" declares external_id, which the Gate-3 ` +
        'sanitization review approved ONLY in players'
      );
    }
  }
  return true;
}

/**
 * Structural proof of the second binding ruling: `injury_detail` is an
 * explicitly-named field on the players schema (not something merely
 * permitted by a wildcard - this schema format has no wildcard to permit it
 * through).
 */
function assertInjuryDetailExplicitlyAllowlisted(playersSchema = PLAYERS_SCHEMA) {
  if (!Object.prototype.hasOwnProperty.call(playersSchema.fields, 'injury_detail')) {
    throw new Error(
      'publicationSchema: players schema does not explicitly declare injury_detail - it is retained ' +
      'for fidelity only when named on the allowlist, never by inheritance'
    );
  }
  return true;
}

assertExternalIdOnlyInPlayers();
assertInjuryDetailExplicitlyAllowlisted();

/**
 * The row-level twin of `assertExternalIdOnlyInPlayers`. That function proves
 * the SCHEMA never declares `external_id` outside players, which is what
 * makes `assertClosedSchema` reject a stray one as "an unexpected key" - but
 * a schema-shaped proof is one layer, and this ruling is explicit enough in
 * the user's review to earn a second, independent one: a direct recursive
 * walk of the ACTUAL captured rows (every nested object and array, exactly
 * like `secretScan`'s walk), refusing on the literal key `external_id`
 * appearing ANYWHERE in a non-players dataset, regardless of what any schema
 * does or does not currently declare.
 */
function assertNoExternalIdOutsidePlayers(datasetName, rows) {
  if (datasetName === 'players') return { dataset: datasetName, ok: true, checked: 0 };
  if (!Array.isArray(rows)) throw new Error('assertNoExternalIdOutsidePlayers requires an array of rows');
  const violations = [];
  const walk = (value, path) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (typeof value === 'object') {
      if (Object.prototype.hasOwnProperty.call(value, 'external_id')) violations.push(path);
      for (const key of Object.keys(value)) walk(value[key], `${path}.${key}`);
    }
  };
  rows.forEach((row, i) => walk(row, `$[${i}]`));
  if (violations.length > 0) {
    const sample = violations.slice(0, 5).join(', ');
    throw new Error(
      `external_id found in dataset ${datasetName} at ${sample}${violations.length > 5 ? ', ...' : ''} - ` +
      'the Gate-3 sanitization review approved external_id ONLY in players'
    );
  }
  return { dataset: datasetName, ok: true, checked: rows.length };
}

module.exports = {
  schemaForDataset,
  ALL_SCHEMAS_BY_LABEL,
  FIXED_NAME_SCHEMAS,
  NFL_GAMES_NAME,
  ORACLE_NAME,
  PLAYERS_SCHEMA,
  PLAYER_STATS_SCHEMA,
  PLAYER_SEASON_STATS_SCHEMA,
  NFL_GAMES_SCHEMA,
  ORIENTATION_OVERLAY_SCHEMA,
  POSITION_RANK_SCHEMA,
  PLAYER_NAME_RANK_SCHEMA,
  GAMES_CSV_SCHEMA,
  ORACLE_SCHEMA,
  PROJECTION_SCHEMA,
  FACTORS_SCHEMA,
  assertExternalIdOnlyInPlayers,
  assertInjuryDetailExplicitlyAllowlisted,
  assertNoExternalIdOutsidePlayers,
};
