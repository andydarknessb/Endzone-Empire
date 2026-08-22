/**
 * League settings: what a commissioner can edit about a league (its
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
 *   parseSettingsPatch(body) -> { value } | { error }            (pure)
 *   updateLeagueSettings(db, { leagueId, userId, patch }) -> row  (the write)
 *   LeagueSettingsError { statusCode, message, code? }            (its refusal)
 *
 * parseSettingsPatch reproduces the route handler's shape validation
 * byte-for-byte and in the same order (the first failing key's message wins),
 * then derives the request facts the write path needs. It never throws on bad
 * input; it answers { error } for a 400 and { value } otherwise.
 *
 * updateLeagueSettings takes that { value } as `patch` and owns the state
 * half: the status read, the post-read guards, the keeper clear, the UPDATE
 * and the after-commit notification. Transaction rule: it connect()s a client
 * and runs BEGIN only when the patch carries keeper or auction settings
 * (patch.rowLockSettingsProvided, the FOR UPDATE read); otherwise every
 * statement runs on the pool directly with no transaction. Thrown-error
 * contract: it refuses by throwing LeagueSettingsError (statusCode, message,
 * and code only for the pick'em refusal) after rolling back, so call it only
 * where the surrounding catch renders `error.statusCode`, the same rule
 * leagueMembership.requireMember states; anything else propagates after the same
 * rollback and release.
 */

const { DRAFT_FROZEN_SETTING_KEYS, frozenSettingKeys, settingsUnfrozenWhereSql } = require('./leaguePhase');
const {
  POSITION_KEYS, validateAuctionSettings, keeperSettingsPlan, positionCapsFeasible,
} = require('./draftValidation.service');
const { validateOrderOverrides, isPermutationOf } = require('./draftOrder.service');
const { draftRosterSize } = require('./rosterShape');
const { commissionerPredicate } = require('./leagueRole.service');
const { editSizeError } = require('./leagueSize');
const { PICKEM_ONLY_CODE, isPickemOnly } = require('./leagueType');
const { isValidIanaTimeZone } = require('../modules/ianaTimeZones');
// Held as the module, not a destructured function: the notification is
// looked up at call time so a test can mock activity.service's export.
const activityService = require('./activity.service');
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
      // A rate must BE a number (#69): coercion accepted true/null/''/[5] and
      // stored the raw value, so the JSON did not match what the 400 promises.
      return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 50;
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

// draftTimezone: undefined = leave as-is, null = clear, string = set to a
// validated IANA zone. Nullable like draftDate/keeperLockAt, but never a
// mustBeFuture check (a zone has no direction in time).
const draftTimezoneRule = (v) => {
  if (v === null) return null;
  return isValidIanaTimeZone(v) ? null : 'draftTimezone must be a valid IANA time zone name (e.g. "America/New_York") or null';
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
 *                are not shape-checked here: the size limits,
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
  { key: 'draftTimezone', column: 'draft_timezone', validate: draftTimezoneRule },
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
    // hasOwnProperty, not a truthy lookup (#70): 'constructor' / '__proto__'
    // found Object / Object.prototype on the prototype chain, so the name was
    // stored and rendered while JSON.stringify of the "rules" (a function)
    // quietly kept the old ones via COALESCE.
    validate: (v) => (Object.prototype.hasOwnProperty.call(SCORING_PRESETS, v)
      ? null
      : `scoringPreset must be one of ${Object.keys(SCORING_PRESETS).join(', ')}`),
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
  // Future like draftDate (#67): a past lock would lock keepers the moment it
  // is saved, which is never what a commissioner meant. null still clears.
  { key: 'keeperLockAt', column: 'keeper_lock_at', validate: dateRule('keeperLockAt', { mustBeFuture: true }) },
  // Validated like POST / plus the column's varchar(120) cap (#66): before
  // this row existed, '' / 0 / false were silent no-ops via the write path's
  // COALESCE and 12345 or {} went straight to node-pg.
  {
    key: 'name', column: 'name', fantasyOnly: false,
    validate: (v) => (typeof v === 'string' && v.trim().length > 0 && v.length <= 120
      ? null
      : 'name must be a non-empty string of at most 120 characters'),
  },
  // Not shape-checked here (see the table above).
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
 *     null); draftTimezone arrives as draftTimezoneProvided + draftTimezone
 *     itself (a validated IANA name or null; #116 — draft date and timezone
 *     are one coherent scheduling change, so clearing the date alongside a
 *     non-null zone is a parse-time error, and the write path force-clears
 *     an untouched zone when the date clears); draftOrderOverrides and
 *     auctionSettings arrive as sent plus a `<key>Provided` flag (null is a
 *     deliberate clear); tradeDeadlineWeek arrives as sent plus
 *     tradeDeadlineWeekProvided (its write is tri-state, #65); minTeams /
 *     maxTeams arrive as newMin / newMax (Number or null; bounds are the
 *     write path's job, via leagueSize.editSizeError, because they depend on
 *     the live team count); and scoringPreset / scoringRules are not passed
 *     raw at all, only as the pair below;
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
    pickTimeSeconds, minTeams, maxTeams, draftDate, draftTimezone, autodraftDelaySeconds,
    draftType, draftRotation, draftOrderOverrides, auctionSettings,
    keepersEnabled, keeperCount, keeperLockAt,
  } = input;

  const draftDateProvided = draftDate !== undefined;
  const draftDateValue = draftDateProvided && draftDate !== null ? new Date(draftDate).toISOString() : null;
  const draftTimezoneProvided = draftTimezone !== undefined;
  // Draft date and timezone are one coherent scheduling change (#116 AC2): a
  // request that clears the date while also setting a zone is contradictory
  // (which one wins?), so it is refused outright rather than one silently
  // overriding the other. Clearing the date force-clears an untouched zone
  // too (AC5); that half needs no guard here since it is not a conflict, only
  // the write path's job (it must read the CURRENT date/zone to apply it).
  if (draftDateProvided && draftDateValue === null && draftTimezoneProvided && draftTimezone !== null) {
    return { error: 'draftTimezone cannot be set in the same request that clears draftDate' };
  }
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
  // The frozen refusal names what the caller SENT (#70): a preset materializes
  // rules into the frozen scoringRules request, but the message should say
  // scoringPreset when that is what arrived. Aligned index-for-index with
  // frozenRequested; the SQL guard and the phase rule keep using the keys.
  const frozenRequestedNames = frozenRequested.map(
    (key) => (key === 'scoringRules' && scoringRules === undefined ? 'scoringPreset' : key)
  );
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
      draftTimezoneProvided, draftTimezone: draftTimezone === undefined ? null : draftTimezone,
      keeperLockAtProvided, keeperLockAtValue,
      tradeDeadlineWeekProvided: tradeDeadlineWeek !== undefined,
      newMin, newMax,
      effectiveRules, effectivePreset,
      frozenRequested, frozenRequestedNames, fantasyOnlyRequested,
      rosterCompositionChanged: rosterSlots !== undefined || benchSlots !== undefined || irSlots !== undefined,
      schedulingNonAuction: draftDateProvided && Boolean(draftDateValue) && draftType === undefined,
      keeperSettingsProvided,
      auctionSettingsProvided,
      draftOrderOverridesProvided,
      rowLockSettingsProvided: keeperSettingsProvided || auctionSettingsProvided,
    },
  };
}

/* ------------------------------------------------------------------ *
 * updateLeagueSettings                                                *
 * ------------------------------------------------------------------ */

/**
 * A refusal from updateLeagueSettings: `statusCode` is the HTTP status the
 * adapter renders, `message` the body's `error`, and `code` is set only for
 * the pick'em refusal (PICKEM_ONLY_CODE, the client's signal to redirect).
 */
class LeagueSettingsError extends Error {
  constructor(statusCode, message, extra = {}) {
    super(message);
    this.name = 'LeagueSettingsError';
    this.statusCode = statusCode;
    Object.assign(this, extra);
  }
}

/**
 * The state half of PUT /api/league/:id: read the league's status (FOR
 * UPDATE when the patch carries keeper or auction settings), run the
 * post-read guards (the keeper plan included), clear keepers when the plan
 * says so, write the UPDATE with its two spliced WHERE guards, disambiguate
 * a zero-row result, COMMIT, and only then notify the league of a
 * (re)scheduled draft.
 *
 * `db` is the pool (duck-typed `query` + `connect`). Transaction rule: when
 * patch.rowLockSettingsProvided, `connect()` a client, BEGIN, and run every
 * statement on it; otherwise every statement runs on `db` directly and there
 * is no BEGIN/COMMIT at all. Either way the statements are the same text in
 * the same order (the status read gains FOR UPDATE on the transaction path,
 * nothing else differs), so a fake pool observes one sequence per patch.
 *
 * Thrown-error contract: refuses by throwing LeagueSettingsError (after
 * ROLLBACK when a transaction is open); any other error ROLLBACKs the same
 * way and propagates as-is. Call it only where the surrounding catch renders
 * `error.statusCode` (the rule leagueMembership.requireMember states); a caller
 * that maps every error to 500 would turn a 409 into a 500.
 *
 * Resolves with the updated `leagues` row (RETURNING *).
 */
async function updateLeagueSettings(db, { leagueId, userId, patch }) {
  const {
    name, rosterSlots, positionCaps, benchSlots, dpEnabled, irSlots,
    waiverType, waiverPeriodHours, faabBudget,
    tradeDeadlineWeek, tradeReviewHours, tradeVetoVotes,
    regularSeasonWeeks, playoffTeams, playoffConsolation,
    pickTimeSeconds, autodraftDelaySeconds,
    draftType, draftRotation, draftOrderOverrides, auctionSettings,
    keepersEnabled, keeperCount,
    tradeDeadlineWeekProvided,
    draftDateProvided, draftDateValue, draftTimezoneProvided, draftTimezone,
    keeperLockAtProvided, keeperLockAtValue,
    draftOrderOverridesProvided, auctionSettingsProvided, keeperSettingsProvided,
    rowLockSettingsProvided,
    newMin, newMax, effectiveRules, effectivePreset,
    frozenRequested, frozenRequestedNames, fantasyOnlyRequested, rosterCompositionChanged, schedulingNonAuction,
  } = patch;
  let previousDraftDate = null;
  let transactionClient = null;
  let transactionOpen = false;
  let client = db;
  const rejectUpdate = async (status, error, extra = {}) => {
    if (transactionOpen) {
      // Guarded like the unexpected-error path below (#68): if the ROLLBACK
      // itself fails (connection dropped mid-transaction), the refusal the
      // caller earned must still reach them, not turn into a 500. The
      // connection's death rolls the transaction back anyway.
      transactionOpen = false;
      await transactionClient.query('ROLLBACK').catch((rollbackError) => {
        console.error('Failed to roll back a refused league settings update', rollbackError);
      });
    }
    throw new LeagueSettingsError(status, error, extra);
  };
  try {
    if (rowLockSettingsProvided) {
      transactionClient = await db.connect();
      client = transactionClient;
      await transactionClient.query('BEGIN');
      transactionOpen = true;
    }
    let derivedRosterLimit = null;
    let pendingStatusVerified = false;
    // The status read is also the league-type read: any fantasy-only field
    // forces it so a pick'em-only league can be refused, even for keys (like
    // waiverType) that are never draft-frozen.
    if (frozenRequested.length > 0 || fantasyOnlyRequested.length > 0) {
      const statusResult = await client.query(
        `SELECT "draft_status", "draft_type", "min_teams", "max_teams", "draft_date",
                "roster_slots", "bench_slots", "ir_slots", "position_caps", "roster_limit",
                "keepers_enabled", "keeper_count", "pickem_only", "season_status", "dp_enabled",
                (SELECT COUNT(*)::int FROM "teams" WHERE "teams"."league_id" = "leagues"."id") AS "team_count"
         FROM "leagues" WHERE "id" = $1 AND ${commissionerPredicate(2)}${rowLockSettingsProvided ? ' FOR UPDATE' : ''}`,
        [leagueId, userId]
      );
      const current = statusResult.rows[0];
      previousDraftDate = current ? current.draft_date : null;
      if (current && rosterCompositionChanged) {
        const effectiveSlots = rosterSlots !== undefined ? rosterSlots : current.roster_slots;
        const effectiveBench = benchSlots !== undefined ? benchSlots : current.bench_slots;
        const effectiveIr = irSlots !== undefined ? irSlots : current.ir_slots;
        const starters = effectiveSlots.reduce((sum, s) => sum + s.count, 0);
        derivedRosterLimit = starters + effectiveBench + effectiveIr;
      }
      if (current && isPickemOnly(current) && fantasyOnlyRequested.length > 0) {
        return await rejectUpdate(
          409,
          `these settings do not apply to a pick'em league: ${fantasyOnlyRequested.join(', ')}`,
          { code: PICKEM_ONLY_CODE }
        );
      }
      if (current && frozenRequested.length > 0) {
        const frozenNow = new Set(frozenSettingKeys(current));
        // Named as sent AND actually locked (#70): the as-sent name comes from
        // frozenRequestedNames (scoringPreset, not the materialized
        // scoringRules), the locked filter from the phase rule.
        const lockedRequested = frozenRequestedNames.filter((name, i) => frozenNow.has(frozenRequested[i]));
        if (lockedRequested.length > 0) {
          return await rejectUpdate(409, `these settings are locked once the draft starts: ${lockedRequested.join(', ')}`);
        }
      }
      if (current && draftDateValue && (draftType ?? current.draft_type) === 'auction') {
        return await rejectUpdate(400, 'salary-cap auction drafts cannot be scheduled until live auction support is available');
      }
      // One coherent scheduling change (#116 AC2), the other half: a zone
      // means nothing without an instant. draftDateValue wins when this same
      // request also (re)schedules the draft; otherwise the league needs one
      // already on file.
      if (current && draftTimezoneProvided && draftTimezone !== null) {
        const effectiveDraftDate = draftDateProvided ? draftDateValue : current.draft_date;
        if (!effectiveDraftDate) {
          return await rejectUpdate(400, 'draftTimezone requires a scheduled draftDate');
        }
      }
      pendingStatusVerified = Boolean(current);
      // Size-limit invariants: valid bounds, min <= max, and the cap can't drop
      // below the teams already in the league.
      if (current && (newMin !== null || newMax !== null)) {
        const sizeError = editSizeError({
          newMin, newMax,
          currentMin: current.min_teams,
          currentMax: current.max_teams,
          teamCount: current.team_count,
          pickemOnly: current.pickem_only,
        });
        if (sizeError) return await rejectUpdate(400, sizeError);
      }
      // roster_limit can be null on old rows (#70); fall back to the limit the
      // current shape derives, so the draft roster size never derives from null
      // and validateOrderOverrides never receives null as maxRounds.
      const currentShapeLimit = current
        ? (Array.isArray(current.roster_slots) ? current.roster_slots.reduce((sum, s) => sum + s.count, 0) : 0)
          + (current.bench_slots ?? 0) + (current.ir_slots ?? 0)
        : null;
      const effectiveRosterLimit = derivedRosterLimit ?? current?.roster_limit ?? currentShapeLimit;
      // Both draft bounds below are the DRAFT roster size (starters + bench),
      // not the IR-inclusive roster limit: no draft round is spent on an IR
      // slot (#96), so a league with 1 IR drafts one fewer round and a keeper
      // cannot be assigned to a round that will never be drafted.
      const effectiveIrSlots = irSlots !== undefined ? irSlots : (current?.ir_slots ?? 0);
      const effectiveDraftRosterSize = draftRosterSize({
        rosterLimit: effectiveRosterLimit, irSlots: effectiveIrSlots,
      });
      // Both order guards need the team ids; read them once (#70), even when
      // draftOrderOverrides and a custom-nomination auctionSettings arrive
      // together (two identical SELECTs before).
      let cachedTeamIds = null;
      const readTeamIds = async () => {
        if (cachedTeamIds === null) {
          const teamsResult = await client.query(`SELECT "id" FROM "teams" WHERE "league_id" = $1`, [leagueId]);
          cachedTeamIds = teamsResult.rows.map((team) => team.id);
        }
        return cachedTeamIds;
      };
      if (current && draftOrderOverridesProvided) {
        const overridesError = validateOrderOverrides(draftOrderOverrides, await readTeamIds(), effectiveDraftRosterSize);
        if (overridesError) return await rejectUpdate(400, overridesError);
      }
      if (current && auctionSettingsProvided && auctionSettings?.nominationOrder === 'custom') {
        if (!isPermutationOf(auctionSettings.nominationCustomOrder, await readTeamIds())) {
          return await rejectUpdate(400, 'nominationCustomOrder must list every current team exactly once');
        }
      }
      if (current && keeperCount !== undefined && keeperCount > effectiveDraftRosterSize) {
        return await rejectUpdate(400, `keeperCount cannot exceed the draft roster size (${effectiveDraftRosterSize})`);
      }
      if (current && keeperSettingsProvided) {
        const assignmentResult = await client.query(
          `SELECT "team_id", COUNT(*)::int AS "count" FROM "keepers" WHERE "league_id" = $1 GROUP BY "team_id"`,
          [leagueId]
        );
        const keeperPlan = keeperSettingsPlan({
          currentEnabled: current.keepers_enabled,
          currentCount: current.keeper_count,
          keepersEnabled,
          keeperCount,
          assignmentCounts: assignmentResult.rows,
        });
        if (keeperPlan.error) return await rejectUpdate(409, keeperPlan.error);
        if (keeperPlan.clearAssignments) {
          await client.query(`DELETE FROM "keepers" WHERE "league_id" = $1`, [leagueId]);
        }
      }
      // DP-only slots and dpEnabled must stay consistent (#70 item 3): a
      // slot only defensive players can fill is dead weight in a league
      // that does not score them (the idp scoring category is gated on
      // dp_enabled). Refuse rather than auto-clear: silently dropping slots
      // would mutate roster shape (and the derived roster_limit) the
      // commissioner never asked to change. Checked only when the request
      // touches either field, so a legacy inconsistent row can still edit
      // everything else.
      if (current && (dpEnabled !== undefined || rosterSlots !== undefined)) {
        const effectiveDp = dpEnabled !== undefined ? dpEnabled : current.dp_enabled;
        const dpSlots = rosterSlots !== undefined ? rosterSlots : current.roster_slots;
        const hasDpOnlySlot = Array.isArray(dpSlots) && dpSlots.some(
          (slot) => Array.isArray(slot.eligiblePositions)
            && slot.eligiblePositions.length > 0
            && slot.eligiblePositions.every((position) => DP_GROUP_KEYS.includes(position))
        );
        if (!effectiveDp && hasDpOnlySlot) {
          return await rejectUpdate(400, 'rosterSlots include defensive-player-only slots but dpEnabled is off; enable dpEnabled or remove those slots (one request may change both)');
        }
      }
      // Any change to caps or roster shape must keep every slot fillable:
      // re-run the same Hall's-condition check the draft settings UI warns with.
      if (current && (positionCaps !== undefined || rosterCompositionChanged)) {
        const feasibility = positionCapsFeasible({
          rosterSlots: rosterSlots !== undefined ? rosterSlots : current.roster_slots,
          benchSlots: benchSlots !== undefined ? benchSlots : current.bench_slots,
          irSlots: irSlots !== undefined ? irSlots : current.ir_slots,
          positionCaps: positionCaps !== undefined ? positionCaps : current.position_caps,
        });
        if (!feasibility.feasible) {
          return await rejectUpdate(400, feasibility.errors.join('; '));
        }
      }
    }
    const result = await client.query(
      `UPDATE "leagues"
       SET "name" = COALESCE($1, "name"),
           "roster_limit" = COALESCE($2, "roster_limit"),
           "roster_slots" = COALESCE($3, "roster_slots"),
           "position_caps" = COALESCE($4, "position_caps"),
           "ir_slots" = COALESCE($5, "ir_slots"),
           "bench_slots" = COALESCE($25, "bench_slots"),
           "dp_enabled" = COALESCE($26, "dp_enabled"),
           "waiver_type" = COALESCE($6, "waiver_type"),
           "waiver_period_hours" = COALESCE($7, "waiver_period_hours"),
           "faab_budget" = COALESCE($8, "faab_budget"),
           -- Tri-state like draft_order_overrides / auction_settings / keeper_lock_at
           -- below: absent leaves it, null clears it (null = no deadline), a week
           -- sets it. COALESCE could not tell null from absent (#65). $37 is the
           -- "was it sent" flag appended to the parameter list; $9 stays the value.
           "trade_deadline_week" = CASE WHEN $37::boolean THEN $9::integer ELSE "trade_deadline_week" END,
           "trade_review_hours" = COALESCE($10, "trade_review_hours"),
           "trade_veto_votes" = COALESCE($11, "trade_veto_votes"),
           "scoring_rules" = COALESCE($12, "scoring_rules"),
           "regular_season_weeks" = COALESCE($13, "regular_season_weeks"),
           "playoff_teams" = COALESCE($14, "playoff_teams"),
           "playoff_consolation" = COALESCE($15, "playoff_consolation"),
           "pick_time_seconds" = COALESCE($16, "pick_time_seconds"),
           "scoring_preset" = COALESCE($19, "scoring_preset"),
           "min_teams" = COALESCE($20, "min_teams"),
           "max_teams" = COALESCE($21, "max_teams"),
           "autodraft_delay_seconds" = COALESCE($24, "autodraft_delay_seconds"),
           "draft_date" = CASE
             WHEN $27::text = 'auction' THEN NULL
             WHEN $22 THEN $23
             ELSE "draft_date"
           END,
           -- Draft date and timezone move together (#116 AC2/AC5): clearing
           -- the date (explicitly, or by converting to auction) clears an
           -- untouched zone with it; parseSettingsPatch already refuses a
           -- request that clears the date while also SETTING a non-null
           -- zone, so that combination never reaches here. Otherwise it is
           -- the same tri-state as draft_order_overrides below ($38 = "was
           -- it sent", $39 = the value). A timezone-only edit touches
           -- neither $22 nor $27, so it never trips the reminder reset below.
           "draft_timezone" = CASE
             WHEN $27::text = 'auction' THEN NULL
             WHEN $22 AND $23::timestamptz IS NULL THEN NULL
             WHEN $38::boolean THEN $39::text
             ELSE "draft_timezone"
           END,
           -- Rescheduling resets the reminder/auto-start bookkeeping so the
           -- new time gets a fresh set of reminders. Change-gated like the
           -- notification (#70 item 6): re-posting the identical date must not
           -- rewind the stage and re-send reminders. IS DISTINCT FROM reads the
           -- stored date, so clearing an already-clear date is a no-op too.
           "draft_reminder_stage" = CASE WHEN ($22 AND "draft_date" IS DISTINCT FROM $23::timestamptz) OR $27::text = 'auction' THEN 0 ELSE "draft_reminder_stage" END,
           "draft_autostart_failed" = CASE WHEN ($22 AND "draft_date" IS DISTINCT FROM $23::timestamptz) OR $27::text = 'auction' THEN false ELSE "draft_autostart_failed" END,
           -- draft_type/draft_rotation are Postgres enums; the $27 = 'auction'
           -- comparisons above type the parameter as text, so COALESCE needs an
           -- explicit cast or Postgres rejects text vs enum (the bug that broke
           -- every league update after the enum migration landed).
           "draft_type" = COALESCE($27::draft_type, "draft_type"),
           "draft_rotation" = COALESCE($28::draft_rotation_type, "draft_rotation"),
           "keepers_enabled" = COALESCE($29, "keepers_enabled"),
           "keeper_count" = COALESCE($30, "keeper_count"),
           "draft_order_overrides" = CASE WHEN $31::boolean THEN $32::jsonb ELSE "draft_order_overrides" END,
           "auction_settings" = CASE WHEN $33::boolean THEN $34::jsonb ELSE "auction_settings" END,
           "keeper_lock_at" = CASE WHEN $35::boolean THEN $36::timestamptz ELSE "keeper_lock_at" END,
           "updated_at" = now()
       WHERE "id" = $17 AND ${commissionerPredicate(18)}
         ${frozenRequested.length > 0 ? `AND ${settingsUnfrozenWhereSql()}` : ''}
         ${schedulingNonAuction ? `AND "draft_type" <> 'auction'` : ''}
       RETURNING *`,
      [
        name || null,
        derivedRosterLimit,
        rosterSlots === undefined ? null : JSON.stringify(rosterSlots),
        positionCaps === undefined ? null : JSON.stringify(positionCaps),
        irSlots === undefined ? null : irSlots,
        waiverType === undefined ? null : waiverType,
        waiverPeriodHours === undefined ? null : waiverPeriodHours,
        faabBudget === undefined ? null : faabBudget,
        tradeDeadlineWeek === undefined ? null : tradeDeadlineWeek,
        tradeReviewHours === undefined ? null : tradeReviewHours,
        tradeVetoVotes === undefined ? null : tradeVetoVotes,
        effectiveRules === undefined ? null : JSON.stringify(effectiveRules),
        regularSeasonWeeks === undefined ? null : regularSeasonWeeks,
        playoffTeams === undefined ? null : playoffTeams,
        playoffConsolation === undefined ? null : playoffConsolation,
        pickTimeSeconds === undefined ? null : pickTimeSeconds,
        leagueId,
        userId,
        effectivePreset === undefined ? null : effectivePreset,
        newMin,
        newMax,
        draftDateProvided,
        draftDateValue,
        autodraftDelaySeconds === undefined ? null : autodraftDelaySeconds,
        benchSlots === undefined ? null : benchSlots,
        dpEnabled === undefined ? null : dpEnabled,
        draftType === undefined ? null : draftType,
        draftRotation === undefined ? null : draftRotation,
        keepersEnabled === undefined ? null : keepersEnabled,
        keeperCount === undefined ? null : keeperCount,
        draftOrderOverridesProvided,
        draftOrderOverridesProvided ? (draftOrderOverrides === null ? null : JSON.stringify(draftOrderOverrides)) : null,
        auctionSettingsProvided,
        auctionSettingsProvided ? (auctionSettings === null ? null : JSON.stringify(auctionSettings)) : null,
        keeperLockAtProvided,
        keeperLockAtProvided ? keeperLockAtValue : null,
        tradeDeadlineWeekProvided,
        draftTimezoneProvided,
        draftTimezoneProvided ? draftTimezone : null,
      ]
    );
    if (!result.rows[0]) {
      // The scheduling guard can also zero out the update when the league was
      // converted to auction between our SELECT and UPDATE. Re-read the current
      // type to report the auction conflict distinctly from a draft that started.
      if (schedulingNonAuction && pendingStatusVerified) {
        const recheck = await client.query(
          `SELECT "draft_type" FROM "leagues" WHERE "id" = $1 AND ${commissionerPredicate(2)}`,
          [leagueId, userId]
        );
        if (recheck.rows[0]?.draft_type === 'auction') {
          return await rejectUpdate(409, 'this league was converted to a salary-cap auction; auction drafts cannot be scheduled');
        }
      }
      if (pendingStatusVerified && frozenRequested.length > 0) {
        // The freeze guard zeroed the UPDATE, so the league is past pre-draft
        // NOW and every requested frozen key is locked; name them as sent,
        // the same way the pre-check does (#70).
        return await rejectUpdate(409, `these settings are locked once the draft starts: ${frozenRequestedNames.join(', ')}`);
      }
      return await rejectUpdate(403, 'league not found or you are not the commissioner');
    }
    const changed = draftDateProvided &&
      String(previousDraftDate ? new Date(previousDraftDate).toISOString() : null) !== String(draftDateValue);
    if (transactionOpen) {
      await transactionClient.query('COMMIT');
      transactionOpen = false;
    }
    // The settings update is the source of truth. Activity delivery happens
    // after commit, on the pool (never the released client), and is
    // best-effort so a notification outage cannot turn a persisted schedule
    // into an HTTP 500 response.
    if (changed && draftDateValue) {
      const verb = previousDraftDate ? 'rescheduled' : 'scheduled';
      try {
        void activityService.notifyLeague(db, {
          leagueId,
          type: 'draft_scheduled',
          message: `${result.rows[0].name}'s draft has been ${verb}.`,
          data: { url: `/#/league/${leagueId}`, draftDate: draftDateValue },
        }).catch((notificationError) => {
          console.error('Failed to send draft schedule notification', notificationError);
        });
      } catch (notificationError) {
        console.error('Failed to send draft schedule notification', notificationError);
      }
    }
    return result.rows[0];
  } catch (error) {
    if (transactionOpen) {
      await transactionClient.query('ROLLBACK').catch(() => {});
      transactionOpen = false;
    }
    throw error;
  } finally {
    // The result (or the refusal) is already decided by here; a failing
    // release must not replace it. The handler used to release after it had
    // sent the response, so a throw here surfaced only as an unhandled
    // rejection; now the service runs first, so swallow and log instead.
    if (transactionClient) {
      try {
        transactionClient.release();
      } catch (releaseError) {
        console.error('Failed to release the league settings client', releaseError);
      }
    }
  }
}

module.exports = {
  SETTINGS,
  FANTASY_ONLY_NOT_FROZEN_KEYS,
  FANTASY_ONLY_SETTING_KEYS,
  DP_GROUP_KEYS,
  parseSettingsPatch,
  updateLeagueSettings,
  LeagueSettingsError,
};
