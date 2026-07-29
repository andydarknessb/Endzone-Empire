'use strict';

/**
 * The MECHANICAL mappings sealed by the preregistration, derived from the
 * Phase-0 scripted inspection reports and from the app's own vocabularies -
 * never from an outcome.
 *
 * Three mappings live here, each with an exhaustive domain and a fail-closed
 * default, so a source that grows a new code stops the run instead of being
 * silently swept into whichever bucket happened to be the else-branch:
 *
 *   1. roster status code -> cohort class (active / reserve / off-roster);
 *   2. injury `report_status` -> the app's `injury_status` vocabulary
 *      (projectionModel.js availabilityFor, :754);
 *   3. roster position code -> the six fantasy positions.
 *
 * The observed vocabularies are recorded here verbatim so that a later source
 * revision introducing a new value is caught by `assertKnownVocabulary`
 * against the inspection report, not discovered by a wrong answer.
 *
 * No database, no network, no production import (`server/services/*` all reach
 * `server/modules/pool` transitively, so nothing under `server/services` may be
 * required from this tree during Phase 0).
 */

/**
 * Roster status codes observed across roster_weekly_2024 + roster_weekly_2025,
 * with the league description code (`status_description_abbr`) that dominates
 * each one in those exact bytes. The description column is CORROBORATION; the
 * `status` column is the authority, exactly as the plan requires ("roster
 * source is authority").
 */
const ROSTER_STATUS_VOCABULARY = Object.freeze({
  ACT: { class: 'active', meaning: 'Active roster', dominantDescription: 'A01' },
  INA: { class: 'active', meaning: 'On the active roster, inactive for that game', dominantDescription: 'A01/I01' },
  RES: { class: 'reserve', meaning: 'Reserve list (injured, PUP, NFI, suspended)', dominantDescription: 'R01' },
  RET: { class: 'reserve', meaning: 'Reserve/Retired', dominantDescription: 'R02' },
  EXE: { class: 'reserve', meaning: 'Exempt list', dominantDescription: 'E02' },
  E01: { class: 'reserve', meaning: 'Exempt/Commissioner permission', dominantDescription: 'E01' },
  DEV: { class: 'off_roster', meaning: 'Practice squad (development)', dominantDescription: 'P01' },
  CUT: { class: 'off_roster', meaning: 'Released or waived', dominantDescription: 'W03' },
  TRD: { class: 'off_roster', meaning: 'Traded away', dominantDescription: 'P01/P07' },
  TRC: { class: 'off_roster', meaning: 'Trade or claim processed', dominantDescription: 'P06/P07' },
});

/**
 * COHORT MEMBERSHIP. Both codes denote membership on the club's 53-man
 * active/inactive list for that week.
 *
 * INA is IN the cohort deliberately. Dropping game-day inactives would keep
 * only players who actually dressed, which is precisely the survivorship
 * cohort this whole rebuild exists to eliminate; a manager holding an inactive
 * player faces a real start/sit decision and the model has to eat the zero.
 */
const ACTIVE_ROSTER_STATUSES = Object.freeze(['ACT', 'INA']);

/**
 * THE IR-EQUIVALENT SIGNAL, excluded from the primary cohort. 2025's injury
 * reports carry no IR designation at all (statuses are blank/Q/D/O), so the
 * reserve-list roster status is the only IR-equivalent signal either season
 * has.
 */
const RESERVE_ROSTER_STATUSES = Object.freeze(['RES', 'RET', 'EXE', 'E01']);

/** Not on the club's active or reserve list that week. Excluded and counted. */
const OFF_ROSTER_STATUSES = Object.freeze(['DEV', 'CUT', 'TRD', 'TRC']);

/**
 * INJURY REPORT STATUS -> the app's injury_status vocabulary.
 *
 * The app's vocabulary is exactly {null, 'Q', 'D', 'O', 'IR'}
 * (projectionModel.js availabilityFor). Note the two ends of it:
 *   - `Note` is a 2024-only value (6 rows) whose report text states the player
 *     has NO game status ("Fully expected to play. No game status."), so it
 *     maps to null, the same as a blank. This is the source describing itself,
 *     not a judgement call.
 *   - `IR` is deliberately UNREACHABLE from injury reports. No injury report in
 *     either season carries it; IR-equivalence comes from the reserve roster
 *     status instead, and conflating the two would invent a signal.
 */
const INJURY_REPORT_STATUS_MAP = Object.freeze({
  '': null,
  Out: 'O',
  Doubtful: 'D',
  Questionable: 'Q',
  Note: null,
});

/** The app injury_status values this mapping may ever produce. */
const APP_INJURY_STATUSES = Object.freeze([null, 'Q', 'D', 'O']);

/**
 * Roster position code -> fantasy position. roster_weekly's position codes are
 * the coarse set (DB/DL/LB/OL rather than CB/S/DE/DT); only five of them are
 * fantasy-scoring positions here, and DEF is synthesized per team-week rather
 * than read from any roster row.
 */
const ROSTER_POSITION_VOCABULARY = Object.freeze([
  'DB', 'DL', 'K', 'LB', 'LS', 'OL', 'P', 'QB', 'RB', 'TE', 'WR',
]);

const FANTASY_ROSTER_POSITIONS = Object.freeze(['QB', 'RB', 'WR', 'TE', 'K']);
const SYNTHESIZED_POSITIONS = Object.freeze(['DEF']);
const FANTASY_POSITIONS = Object.freeze([...FANTASY_ROSTER_POSITIONS, ...SYNTHESIZED_POSITIONS]);

/**
 * The 32 team codes both nflverse files use. Two of them differ from the
 * app's spellings (the app normalizes through `fn_normalize_nfl_team` /
 * `normalizeTeamKey`): nflverse writes `LA` where the app writes `LAR`, and
 * `WAS` where Tank01 writes `WSH`. Recorded here as a Phase-0 finding; the
 * actual normalization runs through the production function in Phase 1, never
 * a copy of it.
 */
const NFLVERSE_TEAM_CODES = Object.freeze([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB',
  'HOU', 'IND', 'JAX', 'KC', 'LA', 'LAC', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
  'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
]);

const KNOWN_TEAM_CODE_DIVERGENCES = Object.freeze({ LA: 'LAR', WAS: 'WSH' });

/**
 * Pure: normalize one raw CSV field. The pinned injury and roster files
 * contain whitespace-only placeholders - a literal newline plus four spaces -
 * in `position` and `practice_status`, so "blank" has to mean "blank after
 * trimming" or 12 injury rows would carry a position named "\n    ".
 */
function normalizeSourceField(value) {
  if (value == null) return '';
  return String(value).trim();
}

/** Fail-closed: roster status code -> 'active' | 'reserve' | 'off_roster'. */
function classifyRosterStatus(rawStatus) {
  const code = normalizeSourceField(rawStatus);
  const entry = ROSTER_STATUS_VOCABULARY[code];
  if (!entry) {
    throw new Error(
      `unknown roster status code "${code}" - the sealed vocabulary is ` +
      `[${Object.keys(ROSTER_STATUS_VOCABULARY).sort().join(', ')}]; ` +
      'a new code is a plan amendment, not a default'
    );
  }
  return entry.class;
}

/** Fail-closed: injury report_status -> app injury_status (null | Q | D | O). */
function mapInjuryReportStatus(rawStatus) {
  const value = normalizeSourceField(rawStatus);
  if (!Object.prototype.hasOwnProperty.call(INJURY_REPORT_STATUS_MAP, value)) {
    throw new Error(
      `unknown injury report_status "${value}" - the sealed vocabulary is ` +
      `[${Object.keys(INJURY_REPORT_STATUS_MAP).map((k) => (k === '' ? '<blank>' : k)).sort().join(', ')}]`
    );
  }
  return INJURY_REPORT_STATUS_MAP[value];
}

/** Fail-closed: is this roster position code one of the fantasy positions? */
function isFantasyRosterPosition(rawPosition) {
  const code = normalizeSourceField(rawPosition);
  if (code === '') return false;
  if (!ROSTER_POSITION_VOCABULARY.includes(code)) {
    throw new Error(
      `unknown roster position code "${code}" - the sealed vocabulary is ` +
      `[${ROSTER_POSITION_VOCABULARY.join(', ')}]`
    );
  }
  return FANTASY_ROSTER_POSITIONS.includes(code);
}

/**
 * Fail-closed: assert an inspection report's observed value list introduces no
 * value the sealed vocabulary does not cover. This is how a later source
 * revision is caught: run the inspection, feed its value counts in here.
 */
function assertKnownVocabulary(observedValues, knownValues, { label = 'vocabulary', allowBlank = true } = {}) {
  const known = new Set(knownValues);
  const unknown = [...new Set(observedValues.map(normalizeSourceField))]
    .filter((v) => !(allowBlank && v === ''))
    .filter((v) => !known.has(v))
    .sort();
  if (unknown.length > 0) {
    throw new Error(`${label}: source carries value(s) the sealed mapping does not cover: ${unknown.join(', ')}`);
  }
  return true;
}

module.exports = {
  ROSTER_STATUS_VOCABULARY,
  ACTIVE_ROSTER_STATUSES,
  RESERVE_ROSTER_STATUSES,
  OFF_ROSTER_STATUSES,
  INJURY_REPORT_STATUS_MAP,
  APP_INJURY_STATUSES,
  ROSTER_POSITION_VOCABULARY,
  FANTASY_ROSTER_POSITIONS,
  SYNTHESIZED_POSITIONS,
  FANTASY_POSITIONS,
  NFLVERSE_TEAM_CODES,
  KNOWN_TEAM_CODE_DIVERGENCES,
  normalizeSourceField,
  classifyRosterStatus,
  mapInjuryReportStatus,
  isFantasyRosterPosition,
  assertKnownVocabulary,
};
