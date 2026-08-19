/**
 * League settings: the commissioner-editable configuration of a league (its
 * name, size limits, roster shape, scoring rules, season and playoff
 * structure, waiver and trade rules, and draft setup), as written by
 * PUT /api/league/:id. See CONTEXT.md: League settings, Draft-frozen setting,
 * Administrative setting, Fantasy-only setting.
 *
 * Ownership rule, stated once: League phase owns WHEN the draft-freeze
 * applies (leaguePhase.frozenSettingKeys / settingsUnfrozenWhereSql); league
 * type owns WHETHER a league is pick'em-only (leagueType); this module owns
 * WHICH CLASS each setting is in. A setting is draft-frozen exactly when it is
 * in leaguePhase.DRAFT_FROZEN_SETTING_KEYS (that list is the cross-side
 * contract with the client twin and is never restated here); it is
 * fantasy-only when its registry row says so (FANTASY_ONLY_SETTING_KEYS is
 * the fantasy-only rows in the order the refusal names them, and is owned
 * here). Both invariants are checked once, when this module loads.
 *
 * Interface (spec #71):
 *   parseSettingsPatch(body) -> { value } | { error }     (pure, this file, PR 1)
 *   updateLeagueSettings(db, { leagueId, userId, patch }) (PR 2, #73)
 *
 * parseSettingsPatch reproduces the route handler's shape validation
 * byte-for-byte and in the same order (the first failing key's message wins),
 * then derives the request facts the write path needs. It never throws on bad
 * input; it answers { error } for a 400 and { value } otherwise.
 */

const { DRAFT_FROZEN_SETTING_KEYS } = require('./leaguePhase');
const { POSITION_KEYS, validateAuctionSettings } = require('./draftValidation.service');
const { POSITION_GROUPS } = require('./lineup.service');
const { SCORING_PRESETS, SCORING_RULES, isValidTierArray } = require('./scoring.service');

/* ------------------------------------------------------------------ *
 * Shared rules and constants                                          *
 * ------------------------------------------------------------------ */

/** The IDP group keys a slot's eligiblePositions may target (see lineup.service POSITION_GROUPS). */
const DP_GROUP_KEYS = Object.freeze(Object.keys(POSITION_GROUPS));

// Slot names allow spaces/hyphens/slashes after the first character (so
// "IDP FLEX" or "W/R/T" work); BENCH and IR are reserved by the lineup
// engine (lineup.service.js treats them as always-eligible pseudo-slots).
const SLOT_KEY_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_ /-]{0,19}$/;
const RESERVED_SLOT_KEYS = Object.freeze(['BENCH', 'IR']);

const VALID_DRAFT_TYPES = Object.freeze(['snake', 'auction', 'autopick', 'offline']);
const VALID_DRAFT_ROTATIONS = Object.freeze(['snake', 'linear']);

const intInRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

const validSlotMap = (map, allowedKeys) =>
  map && typeof map === 'object' && !Array.isArray(map) &&
  Object.entries(map).every(
    ([key, count]) => allowedKeys.includes(key) && Number.isInteger(count) && count >= 0 && count <= 10
  );

// Returns a specific human-readable problem, or null when valid (one
// catch-all message made every mistake look like a position typo).
function rosterSlotsError(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 'rosterSlots must be a non-empty array of slots';
  if (arr.length > 20) return 'rosterSlots cannot have more than 20 slot rows';
  for (let i = 0; i < arr.length; i++) {
    const s = arr[i];
    const label = s && typeof s.key === 'string' && s.key.trim() ? `slot "${s.key}"` : `slot ${i + 1}`;
    if (!s || typeof s !== 'object') return `${label} must be an object`;
    if (typeof s.key !== 'string' || !SLOT_KEY_PATTERN.test(s.key)) {
      return `${label}: name must be 1-20 characters using letters, numbers, spaces, hyphens, slashes, or underscores (it cannot start with a space)`;
    }
    if (RESERVED_SLOT_KEYS.includes(s.key.trim().toUpperCase())) {
      return `${label}: "${s.key}" is reserved for the bench/IR system`;
    }
    if (!Number.isInteger(s.count) || s.count < 0 || s.count > 10) {
      return `${label}: count must be a whole number between 0 and 10`;
    }
    if (!Array.isArray(s.eligiblePositions) || s.eligiblePositions.length === 0) {
      return `${label}: pick at least one eligible position`;
    }
    const bad = s.eligiblePositions.find((p) => !POSITION_KEYS.includes(p));
    if (bad !== undefined) return `${label}: unknown position "${bad}" (allowed: ${POSITION_KEYS.join('/')})`;
  }
  if (new Set(arr.map((s) => s.key)).size !== arr.length) {
    return 'slot names must be unique; for two of the same slot, raise that slot\'s count instead';
  }
  return null;
}

// A "DP-type" slot is one whose eligibility is entirely within the IDP
// groups; their combined starting count is capped at 3 (base + up to 2 more).
function rosterSlotsRule(rosterSlots) {
  const slotsError = rosterSlotsError(rosterSlots);
  if (slotsError) return slotsError;
  const dpSlotTotal = rosterSlots
    .filter((s) => s.eligiblePositions.every((p) => DP_GROUP_KEYS.includes(p)))
    .reduce((sum, s) => sum + s.count, 0);
  if (dpSlotTotal > 3) return 'combined DP-eligible starting slots cannot exceed 3 (base + up to 2 additional)';
  return null;
}

// scoringRules is a nested { category: { statKey: number | tierArray } }
// shape mirroring SCORING_RULES (see scoring.service.js). Every category
// and leaf key must already exist in the defaults; a leaf is either a
// finite bounded number (plain rate) or, for a tiered stat (FG distance,
// points/yards allowed), a well-formed tier array. Unknown categories/keys
// are rejected here rather than silently dropped, since this is the point
// a commissioner finds out about a typo; rulesForLeague()'s silent-drop
// behavior is the defense-in-depth fallback for anything that slips past.
function scoringRulesRule(scoringRules) {
  const validCategory = (category, custom) =>
    custom && typeof custom === 'object' && !Array.isArray(custom) &&
    Object.entries(custom).every(([key, value]) => {
      if (!(key in category)) return false;
      if (Array.isArray(category[key])) return isValidTierArray(value);
      return Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 50;
    });
  const valid = scoringRules && typeof scoringRules === 'object' && !Array.isArray(scoringRules) &&
    Object.entries(scoringRules).every(
      ([cat, custom]) => cat in SCORING_RULES && validCategory(SCORING_RULES[cat], custom)
    );
  return valid
    ? null
    : 'scoringRules must be a nested { category: { statKey: number|tierArray } } object matching the known scoring schema (rates |value| <= 50; tiers well-formed and non-overlapping)';
}

// draftDate / keeperLockAt: undefined = leave as-is, null = clear, string = set.
const dateRule = (field, { mustBeFuture }) => (v) => {
  if (v === null) return null;
  const parsed = new Date(v);
  if (Number.isNaN(parsed.getTime())) return `${field} must be a valid date or null`;
  if (mustBeFuture && parsed.getTime() <= Date.now()) return `${field} must be in the future or null`;
  return null;
};

const rangeRule = (lo, hi, message) => (v) => (intInRange(v, lo, hi) ? null : message);
const nullableRangeRule = (lo, hi, message) => (v) => (v === null || intInRange(v, lo, hi) ? null : message);
const booleanRule = (message) => (v) => (typeof v === 'boolean' ? null : message);
const enumRule = (values, message) => (v) => (values.includes(v) ? null : message);

/* ------------------------------------------------------------------ *
 * The registry                                                        *
 * ------------------------------------------------------------------ */

/**
 * One row per wire key of PUT /api/league/:id, in the order the handler has
 * always validated them (the first failing key's message is the 400). Rows:
 *   key          wire name (camelCase)
 *   column       the leagues column it writes (documentation until the UPDATE
 *                is generated from here; see #71 Out of Scope)
 *   validate     (value) -> error string | null, run only when the key is
 *                present in the body (value !== undefined). Rows without one
 *                are not shape-checked here: name (#66), and the size limits,
 *                which are checked against the live team count by the write
 *                path (leagueSize.editSizeError).
 *   fantasyOnly  refused outright for a pick'em-only league (default true;
 *                only name and the size limits are not)
 *   size         a size limit: draft-frozen like the rest of the draft setup,
 *                but not fantasy-only (a pick'em league has a size too)
 *   draftFrozen  derived, never stated: leaguePhase.DRAFT_FROZEN_SETTING_KEYS
 */
const SETTINGS = Object.freeze([
  { key: 'draftDate', column: 'draft_date', validate: dateRule('draftDate', { mustBeFuture: true }) },
  { key: 'rosterSlots', column: 'roster_slots', validate: rosterSlotsRule },
  {
    key: 'positionCaps', column: 'position_caps',
    validate: (v) => (validSlotMap(v, POSITION_KEYS) ? null : `positionCaps must map ${POSITION_KEYS.join('/')} to integers 0-10`),
  },
  // Cap of 8 matches the NFL.com range (their default is 6-7 bench spots).
  { key: 'benchSlots', column: 'bench_slots', validate: rangeRule(0, 8, 'benchSlots must be an integer between 0 and 8') },
  { key: 'dpEnabled', column: 'dp_enabled', validate: booleanRule('dpEnabled must be a boolean') },
  { key: 'irSlots', column: 'ir_slots', validate: rangeRule(0, 5, 'irSlots must be an integer between 0 and 5') },
  { key: 'waiverType', column: 'waiver_type', validate: enumRule(['priority', 'faab'], "waiverType must be 'priority' or 'faab'") },
  { key: 'waiverPeriodHours', column: 'waiver_period_hours', validate: rangeRule(0, 168, 'waiverPeriodHours must be an integer between 0 and 168') },
  { key: 'faabBudget', column: 'faab_budget', validate: rangeRule(0, 1000, 'faabBudget must be an integer between 0 and 1000') },
  { key: 'tradeDeadlineWeek', column: 'trade_deadline_week', validate: nullableRangeRule(1, 18, 'tradeDeadlineWeek must be an integer between 1 and 18 (or null)') },
  { key: 'tradeReviewHours', column: 'trade_review_hours', validate: rangeRule(0, 168, 'tradeReviewHours must be an integer between 0 and 168') },
  { key: 'tradeVetoVotes', column: 'trade_veto_votes', validate: rangeRule(0, 20, 'tradeVetoVotes must be an integer between 0 and 20') },
  {
    key: 'scoringPreset', column: 'scoring_preset',
    validate: (v) => (SCORING_PRESETS[v] ? null : `scoringPreset must be one of ${Object.keys(SCORING_PRESETS).join(', ')}`),
  },
  { key: 'scoringRules', column: 'scoring_rules', validate: scoringRulesRule },
  { key: 'regularSeasonWeeks', column: 'regular_season_weeks', validate: rangeRule(1, 17, 'regularSeasonWeeks must be an integer between 1 and 17') },
  { key: 'playoffTeams', column: 'playoff_teams', validate: rangeRule(2, 8, 'playoffTeams must be an integer between 2 and 8') },
  { key: 'playoffConsolation', column: 'playoff_consolation', validate: booleanRule('playoffConsolation must be a boolean') },
  { key: 'pickTimeSeconds', column: 'pick_time_seconds', validate: rangeRule(0, 3600, 'pickTimeSeconds must be an integer between 0 and 3600 (0 = untimed)') },
  { key: 'autodraftDelaySeconds', column: 'autodraft_delay_seconds', validate: rangeRule(1, 60, 'autodraftDelaySeconds must be an integer between 1 and 60') },
  { key: 'draftType', column: 'draft_type', validate: enumRule(VALID_DRAFT_TYPES, `draftType must be one of ${VALID_DRAFT_TYPES.join(', ')}`) },
  { key: 'draftRotation', column: 'draft_rotation', validate: enumRule(VALID_DRAFT_ROTATIONS, `draftRotation must be one of ${VALID_DRAFT_ROTATIONS.join(', ')}`) },
  {
    key: 'draftOrderOverrides', column: 'draft_order_overrides',
    validate: (v) => (v === null || (typeof v === 'object' && !Array.isArray(v))
      ? null
      : 'draftOrderOverrides must be an object keyed by round number, or null'),
  },
  { key: 'keepersEnabled', column: 'keepers_enabled', validate: booleanRule('keepersEnabled must be a boolean') },
  {
    key: 'keeperCount', column: 'keeper_count',
    validate: (v) => (Number.isInteger(v) && v >= 0 ? null : 'keeperCount must be a non-negative integer'),
  },
  { key: 'auctionSettings', column: 'auction_settings', validate: (v) => (v === null ? null : validateAuctionSettings(v)) },
  { key: 'keeperLockAt', column: 'keeper_lock_at', validate: dateRule('keeperLockAt', { mustBeFuture: false }) },
  // Not shape-checked here (see the table above).
  { key: 'name', column: 'name', fantasyOnly: false },
  { key: 'minTeams', column: 'min_teams', fantasyOnly: false, size: true },
  { key: 'maxTeams', column: 'max_teams', fantasyOnly: false, size: true },
].map((row) => Object.freeze({
  fantasyOnly: true,
  size: false,
  ...row,
  draftFrozen: DRAFT_FROZEN_SETTING_KEYS.includes(row.key),
})));

const SETTING_BY_KEY = Object.freeze(Object.fromEntries(SETTINGS.map((row) => [row.key, row])));

// Load-time invariant: the phase contract and the registry name the same
// draft-frozen keys. A key in one and not the other is a programming error,
// so fail loudly here rather than mis-classify a request later.
for (const key of DRAFT_FROZEN_SETTING_KEYS) {
  if (!SETTING_BY_KEY[key]) {
    throw new Error(`leagueSettings: leaguePhase.DRAFT_FROZEN_SETTING_KEYS names "${key}" but the settings registry has no row for it`);
  }
}

/**
 * The fantasy-only keys outside DRAFT_FROZEN_SETTING_KEYS, in the order the
 * refusal names them (after the draft-frozen ones): the administrative
 * fantasy settings (waivers, trades) plus scoringPreset, which is not itself
 * a draft-frozen key but materializes the frozen scoringRules, so a
 * post-draft preset save is still refused. This list is an ORDER, stated
 * because refusal order is not validation order; the registry rows are the
 * fact of record, and the invariant below holds the two together.
 */
const FANTASY_ONLY_NOT_FROZEN_KEYS = Object.freeze([
  'scoringPreset', 'waiverType', 'waiverPeriodHours', 'faabBudget',
  'tradeDeadlineWeek', 'tradeReviewHours', 'tradeVetoVotes',
]);
{
  const fromRows = SETTINGS.filter((row) => row.fantasyOnly && !row.draftFrozen).map((row) => row.key);
  const listed = [...FANTASY_ONLY_NOT_FROZEN_KEYS];
  if (fromRows.length !== listed.length || fromRows.some((key) => !listed.includes(key))) {
    throw new Error(`leagueSettings: FANTASY_ONLY_NOT_FROZEN_KEYS (${listed.join(', ')}) must name exactly the registry rows that are fantasy-only and not draft-frozen (${fromRows.join(', ')})`);
  }
}

/**
 * The settings a pick'em-only league refuses outright, in the order the 409
 * names them: the fantasy-only draft-frozen keys (every draft-frozen key but
 * the size limits), then the fantasy-only keys that are not draft-frozen.
 * Owned here; league type owns only whether the league is pick'em-only.
 */
const FANTASY_ONLY_SETTING_KEYS = Object.freeze([
  ...DRAFT_FROZEN_SETTING_KEYS.filter((key) => SETTING_BY_KEY[key].fantasyOnly),
  ...FANTASY_ONLY_NOT_FROZEN_KEYS,
]);

/* ------------------------------------------------------------------ *
 * parseSettingsPatch                                                  *
 * ------------------------------------------------------------------ */

/**
 * Pure. Validate a PUT /api/league/:id body and derive the request facts the
 * write path needs. `{ error }` carries the exact 400 message the handler
 * has always sent for the first offending key; `{ value }` carries the
 * normalized patch under the handler's own names:
 *
 *   - every wire key as sent (undefined when absent), except: draftDate and
 *     keeperLockAt arrive as `<key>Provided` + `<key>Value` (ISO string or
 *     null); draftOrderOverrides and auctionSettings arrive as sent plus a
 *     `<key>Provided` flag (null is a deliberate clear); tradeDeadlineWeek
 *     arrives as sent plus tradeDeadlineWeekProvided (its write is tri-state,
 *     #65); minTeams / maxTeams arrive as newMin / newMax (Number or null;
 *     bounds are the write path's job, via leagueSize.editSizeError, because
 *     they depend on the live team count); and scoringPreset / scoringRules
 *     are not passed raw at all, only as the pair below;
 *   - effectiveRules / effectivePreset: a preset is a prefilled full rule
 *     set and explicit scoringRules win; custom rules mark the league
 *     'custom', a preset stores its own name;
 *   - frozenRequested: the draft-frozen keys this request touches, in
 *     DRAFT_FROZEN_SETTING_KEYS order (whether they are locked RIGHT NOW is a
 *     phase question answered once the row is read). A preset counts as
 *     touching scoringRules because it materializes rules;
 *   - fantasyOnlyRequested: the fantasy-only keys this request touches, in
 *     FANTASY_ONLY_SETTING_KEYS order, naming what the caller actually sent
 *     (scoringPreset, not the derived rules);
 *   - the provided flags and the write path's switches: rosterCompositionChanged
 *     (roster_limit is derived from starters + bench + IR and recomputed when
 *     any of those change), schedulingNonAuction (writing a non-null draft
 *     date without also setting the type relies on the current type staying
 *     non-auction; the status read can go stale if a concurrent request
 *     converts the league to auction, so the UPDATE re-checks the type
 *     atomically. An explicit draftType wins outright, and draftType ===
 *     'auction' clears the date, so neither needs the guard),
 *     keeperSettingsProvided, auctionSettingsProvided and
 *     rowLockSettingsProvided (keeper or auction settings present: the write
 *     path reads the row FOR UPDATE inside a transaction).
 */
function parseSettingsPatch(body) {
  // One read per key, like the handler's single destructure used to be: a
  // body is a plain JSON object, but snapshotting keeps that a fact rather
  // than an assumption. Spread, not Object.assign: spread defines own data
  // properties, so a JSON body carrying a "__proto__" key stays inert (as it
  // was for the destructure), whereas Object.assign would invoke the setter
  // and re-point the snapshot's prototype at attacker-supplied settings. A
  // non-object body is an empty patch.
  const input = { ...body };
  // roster_limit is derived (starters + bench + IR), not settable directly.
  if (input.rosterLimit !== undefined) {
    return {
      error: 'rosterLimit is computed automatically from rosterSlots + benchSlots + irSlots and cannot be set directly',
    };
  }
  for (const row of SETTINGS) {
    if (!row.validate || input[row.key] === undefined) continue;
    const error = row.validate(input[row.key]);
    if (error) return { error };
  }

  const {
    name, rosterSlots, positionCaps, benchSlots, dpEnabled, irSlots,
    waiverType, waiverPeriodHours, faabBudget,
    tradeDeadlineWeek, tradeReviewHours, tradeVetoVotes,
    scoringPreset, scoringRules, regularSeasonWeeks, playoffTeams, playoffConsolation,
    pickTimeSeconds, minTeams, maxTeams, draftDate, autodraftDelaySeconds,
    draftType, draftRotation, draftOrderOverrides, auctionSettings,
    keepersEnabled, keeperCount, keeperLockAt,
  } = input;

  const draftDateProvided = draftDate !== undefined;
  const draftDateValue = draftDateProvided && draftDate !== null ? new Date(draftDate).toISOString() : null;
  const keeperLockAtProvided = keeperLockAt !== undefined;
  const keeperLockAtValue = keeperLockAtProvided && keeperLockAt !== null ? new Date(keeperLockAt).toISOString() : null;
  const newMax = maxTeams === undefined ? null : Number(maxTeams);
  const newMin = minTeams === undefined ? null : Number(minTeams);

  const effectiveRules = scoringRules !== undefined
    ? scoringRules
    : scoringPreset !== undefined
      ? SCORING_PRESETS[scoringPreset]
      : undefined;
  const effectivePreset = scoringRules !== undefined
    ? 'custom'
    : scoringPreset !== undefined
      ? scoringPreset
      : undefined;

  const requested = (key) => (key === 'scoringRules' ? effectiveRules !== undefined : input[key] !== undefined);
  const frozenRequested = DRAFT_FROZEN_SETTING_KEYS.filter(requested);
  const fantasyOnlyRequested = FANTASY_ONLY_SETTING_KEYS.filter((key) => input[key] !== undefined);

  const keeperSettingsProvided = keepersEnabled !== undefined || keeperCount !== undefined;
  const auctionSettingsProvided = auctionSettings !== undefined;
  const draftOrderOverridesProvided = draftOrderOverrides !== undefined;

  return {
    value: {
      name, rosterSlots, positionCaps, benchSlots, dpEnabled, irSlots,
      waiverType, waiverPeriodHours, faabBudget,
      tradeDeadlineWeek, tradeReviewHours, tradeVetoVotes,
      regularSeasonWeeks, playoffTeams, playoffConsolation,
      pickTimeSeconds, autodraftDelaySeconds,
      draftType, draftRotation, draftOrderOverrides, auctionSettings,
      keepersEnabled, keeperCount,
      draftDateProvided, draftDateValue,
      keeperLockAtProvided, keeperLockAtValue,
      tradeDeadlineWeekProvided: tradeDeadlineWeek !== undefined,
      newMin, newMax,
      effectiveRules, effectivePreset,
      frozenRequested, fantasyOnlyRequested,
      rosterCompositionChanged: rosterSlots !== undefined || benchSlots !== undefined || irSlots !== undefined,
      schedulingNonAuction: draftDateProvided && Boolean(draftDateValue) && draftType === undefined,
      keeperSettingsProvided,
      auctionSettingsProvided,
      draftOrderOverridesProvided,
      rowLockSettingsProvided: keeperSettingsProvided || auctionSettingsProvided,
    },
  };
}

module.exports = {
  SETTINGS,
  FANTASY_ONLY_NOT_FROZEN_KEYS,
  FANTASY_ONLY_SETTING_KEYS,
  DP_GROUP_KEYS,
  parseSettingsPatch,
};
