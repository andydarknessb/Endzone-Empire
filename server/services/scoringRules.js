/**
 * Scoring rules: a league's per-stat point values and the pure pricer that
 * reads them. No database, no HTTP client behind this module — every
 * league-scoped reader that needs to price a stat line imports this module
 * alone (spec #1492, issue #1504: one of the six modules scoring.service.js
 * now re-exports whole).
 */

// Default fantasy scoring rules, grouped by category (NFL.com-style
// defaults) — half-PPR. Tiered stats (FG distance, TD-length bonus,
// points/yards allowed) are arrays of { min, max, points }, sorted ascending
// and non-overlapping; `max: null` means "and up". TD-length and IDP
// yardage-bonus tiers/rates default to all-zero points — the capability to
// score them exists (a commissioner can dial them in from the Scoring
// Settings tab) without changing anyone's score by default, the same way
// `reception` defaults to 0 under the "standard" preset. `idp` scores
// individual defenders (DP roster slots, see lineup.service.js's
// POSITION_GROUPS) — it's inert until a league enables DP. Individual
// blocked-kick attribution has no data source and is intentionally not a
// scored stat anywhere below; `teamDefense.blockedKick` is a team-level stat
// only.
const SCORING_RULES = {
  passing: {
    yards: 0.04,
    yardageBonus: [
      { min: 0, max: 99, points: 0 },
      { min: 100, max: 149, points: 0 },
      { min: 150, max: null, points: 0 },
    ],
    touchdowns: 4,
    interceptions: -2,
    twoPointConversions: 2,
    tdLengthBonus: [
      { min: 0, max: 39, points: 0 },
      { min: 40, max: 49, points: 0 },
      { min: 50, max: null, points: 0 },
    ],
  },
  rushing: {
    yards: 0.1,
    yardageBonus: [
      { min: 0, max: 99, points: 0 },
      { min: 100, max: 149, points: 0 },
      { min: 150, max: null, points: 0 },
    ],
    touchdowns: 6,
    twoPointConversions: 2,
    tdLengthBonus: [
      { min: 0, max: 39, points: 0 },
      { min: 40, max: 49, points: 0 },
      { min: 50, max: null, points: 0 },
    ],
  },
  receiving: {
    yards: 0.1,
    yardageBonus: [
      { min: 0, max: 99, points: 0 },
      { min: 100, max: 149, points: 0 },
      { min: 150, max: null, points: 0 },
    ],
    touchdowns: 6,
    reception: 0.5, // half-PPR
    twoPointConversions: 2,
    tdLengthBonus: [
      { min: 0, max: 39, points: 0 },
      { min: 40, max: 49, points: 0 },
      { min: 50, max: null, points: 0 },
    ],
  },
  misc: {
    fumblesLost: -2,
    // NFL.com-parity return scoring: a kick/punt return TD is worth a
    // touchdown by default; return YARDAGE rates default to 0 (opt-in),
    // matching NFL.com's standard scoring.
    returnTDs: 6,
    puntReturnYards: 0,
    kickReturnYards: 0,
  },
  kicking: {
    extraPoint: 1,
    // Miss penalties default to 0 (NFL.com standard) — commissioners can
    // set them negative.
    extraPointMissed: 0,
    fieldGoalMissed: 0,
    // Five NFL.com-style distance buckets. Same prices as the previous
    // three-tier default (0-39 all paid 3), so historical totals are
    // unchanged — the extra buckets just give commissioners finer control.
    fieldGoal: [
      { min: 0, max: 19, points: 3 },
      { min: 20, max: 29, points: 3 },
      { min: 30, max: 39, points: 3 },
      { min: 40, max: 49, points: 4 },
      { min: 50, max: null, points: 5, pointsPerYardOverMin: 0 },
    ],
  },
  teamDefense: {
    sack: 1,
    interception: 2,
    fumbleRecovery: 2,
    defensiveTD: 6,
    safety: 2,
    blockedKick: 2,
    pointsAllowed: [
      { min: 0, max: 0, points: 10 },
      { min: 1, max: 6, points: 7 },
      { min: 7, max: 13, points: 4 },
      { min: 14, max: 20, points: 1 },
      { min: 21, max: 27, points: 0 },
      { min: 28, max: 34, points: -1 },
      { min: 35, max: null, points: -4 },
    ],
    yardsAllowed: [
      { min: 0, max: 99, points: 10 },
      { min: 100, max: 199, points: 7 },
      { min: 200, max: 299, points: 4 },
      { min: 300, max: 349, points: 1 },
      { min: 350, max: 399, points: 0 },
      { min: 400, max: 449, points: -1 },
      { min: 450, max: 499, points: -3 },
      { min: 500, max: 549, points: -5 },
      { min: 550, max: null, points: -7 },
    ],
  },
  idp: {
    soloTackle: 1,
    assistedTackle: 0.5,
    sack: 2,
    interception: 6,
    forcedFumble: 2,
    fumbleRecovery: 2,
    passDeflection: 1,
    qbHit: 1,
    tacklesForLoss: 1,
    safety: 2,
    defensiveTD: 6,
    twoPointReturn: 2,
    // Yardage bonuses only nflverse's post-game finalization pass can fill
    // in (Tank01's live feed has no per-defender yardage for these) — see
    // nflverseSync.service.js. Default to 0 for the same reason TD-length
    // bonuses do.
    sackYards: 0,
    tacklesForLossYards: 0,
    fumbleReturnYards: 0,
    interceptionReturnYards: 0,
  },
};

// Flat stat-key names carried on player_stats rows -> where their rate/tier
// lives in the rules tree above. `tierMode: 'perValue'` means the stored
// value is an ARRAY of raw magnitudes (e.g. one made-FG's yardage per kick,
// one TD's yardage per scoring play) — each element is tier-matched and
// summed independently, so multiple made kicks/TDs in a game all price
// correctly. Tiers without `perValue` (pointsAllowed/yardsAllowed) treat the
// stored value as a single scalar for the whole game, tier-matched once.
const STAT_KEY_PATHS = {
  passingYards: { path: ['passing', 'yards'], bonusPath: ['passing', 'yardageBonus'] },
  passingTDs: { path: ['passing', 'touchdowns'] },
  interceptions: { path: ['passing', 'interceptions'] },
  passingTwoPt: { path: ['passing', 'twoPointConversions'] },
  passingTDLengths: { path: ['passing', 'tdLengthBonus'], tierMode: 'perValue' },
  rushingYards: { path: ['rushing', 'yards'], bonusPath: ['rushing', 'yardageBonus'] },
  rushingTDs: { path: ['rushing', 'touchdowns'] },
  rushingTwoPt: { path: ['rushing', 'twoPointConversions'] },
  rushingTDLengths: { path: ['rushing', 'tdLengthBonus'], tierMode: 'perValue' },
  receivingYards: { path: ['receiving', 'yards'], bonusPath: ['receiving', 'yardageBonus'] },
  receivingTDs: { path: ['receiving', 'touchdowns'] },
  receptions: { path: ['receiving', 'reception'] },
  receivingTwoPt: { path: ['receiving', 'twoPointConversions'] },
  receivingTDLengths: { path: ['receiving', 'tdLengthBonus'], tierMode: 'perValue' },
  fumbles: { path: ['misc', 'fumblesLost'] },
  returnTDs: { path: ['misc', 'returnTDs'] },
  puntReturnYards: { path: ['misc', 'puntReturnYards'] },
  kickReturnYards: { path: ['misc', 'kickReturnYards'] },
  extraPoint: { path: ['kicking', 'extraPoint'] },
  extraPointMissed: { path: ['kicking', 'extraPointMissed'] },
  fieldGoalMissed: { path: ['kicking', 'fieldGoalMissed'] },
  fieldGoalDistances: { path: ['kicking', 'fieldGoal'], tierMode: 'perValue' },
  sack: { path: ['teamDefense', 'sack'] },
  interceptionReturn: { path: ['teamDefense', 'interception'] },
  fumbleRecovery: { path: ['teamDefense', 'fumbleRecovery'] },
  defensiveTD: { path: ['teamDefense', 'defensiveTD'] },
  safety: { path: ['teamDefense', 'safety'] },
  blockedKick: { path: ['teamDefense', 'blockedKick'] },
  pointsAllowed: { path: ['teamDefense', 'pointsAllowed'] },
  yardsAllowed: { path: ['teamDefense', 'yardsAllowed'] },
  soloTackle: { path: ['idp', 'soloTackle'] },
  assistedTackle: { path: ['idp', 'assistedTackle'] },
  idpSack: { path: ['idp', 'sack'] },
  idpInterception: { path: ['idp', 'interception'] },
  forcedFumble: { path: ['idp', 'forcedFumble'] },
  idpFumbleRecovery: { path: ['idp', 'fumbleRecovery'] },
  passDeflection: { path: ['idp', 'passDeflection'] },
  qbHit: { path: ['idp', 'qbHit'] },
  tacklesForLoss: { path: ['idp', 'tacklesForLoss'] },
  idpSafety: { path: ['idp', 'safety'] },
  idpDefensiveTD: { path: ['idp', 'defensiveTD'] },
  twoPointReturn: { path: ['idp', 'twoPointReturn'] },
  idpSackYards: { path: ['idp', 'sackYards'] },
  idpTacklesForLossYards: { path: ['idp', 'tacklesForLossYards'] },
  idpFumbleReturnYards: { path: ['idp', 'fumbleReturnYards'] },
  idpInterceptionReturnYards: { path: ['idp', 'interceptionReturnYards'] },
};

/** True iff `arr` is a well-formed tier list: finite min/points, max is a
 * finite number >= min or null ("and up"), sorted ascending by min, and
 * non-overlapping (each tier's min is past the previous tier's max). */
function isValidTierArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 20) return false;
  let prevMax = -Infinity;
  for (const tier of arr) {
    if (!tier || typeof tier !== 'object') return false;
    const { min, max, points, pointsPerYardOverMin } = tier;
    if (!Number.isFinite(Number(min)) || !Number.isFinite(Number(points))) return false;
    if (max !== null && !Number.isFinite(Number(max))) return false;
    if (pointsPerYardOverMin !== undefined && !Number.isFinite(Number(pointsPerYardOverMin))) return false;
    if (Number(min) <= prevMax) return false;
    if (max !== null && Number(max) < Number(min)) return false;
    prevMax = max === null ? Infinity : Number(max);
  }
  return true;
}

/** Coerce a validated tier array's fields to numbers (max stays null when unbounded). */
function normalizeTierArray(arr) {
  return arr.map((t) => ({
    min: Number(t.min),
    max: t.max === null ? null : Number(t.max),
    points: Number(t.points),
    ...(t.pointsPerYardOverMin === undefined
      ? {}
      : { pointsPerYardOverMin: Number(t.pointsPerYardOverMin) }),
  }));
}

/** Merge one rule category's custom leaves over its defaults; unknown/invalid leaves are dropped. */
function mergeRuleCategory(defaults, custom) {
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(custom || {})) {
    if (!(key in defaults)) continue;
    if (Array.isArray(defaults[key])) {
      if (isValidTierArray(value)) merged[key] = normalizeTierArray(value);
    } else if (Number.isFinite(Number(value))) {
      merged[key] = Number(value);
    }
  }
  return merged;
}

// League-selectable presets; each is a full rule set based on the defaults,
// varying only the reception rate (PPR-ness).
function withReceptionRate(rate) {
  return { ...SCORING_RULES, receiving: { ...SCORING_RULES.receiving, reception: rate } };
}
const SCORING_PRESETS = {
  standard: withReceptionRate(0),
  half_ppr: withReceptionRate(0.5),
  ppr: withReceptionRate(1),
};

/**
 * A league's effective scoring rules: its scoring_rules jsonb (a nested
 * shape matching SCORING_RULES) merged category-by-category over the
 * defaults (null/missing column = defaults). Unknown categories/keys and
 * malformed tier arrays are dropped, falling back to the default leaf.
 */
function rulesForLeague(league) {
  let custom = league && league.scoring_rules;
  if (typeof custom === 'string') {
    try { custom = JSON.parse(custom); } catch { custom = null; }
  }
  if (!custom || typeof custom !== 'object') return SCORING_RULES;
  const rules = {};
  for (const [category, defaults] of Object.entries(SCORING_RULES)) {
    const customCategory = custom[category];
    rules[category] = customCategory && typeof customCategory === 'object' && !Array.isArray(customCategory)
      ? mergeRuleCategory(defaults, customCategory)
      : { ...defaults };
  }
  return rules;
}

/** Nested rules -> the leaf value at a STAT_KEY_PATHS `path`. */
function ruleValueAt(rules, path) {
  let node = rules;
  for (const key of path) node = node && node[key];
  return node;
}

/** Score one raw magnitude from exactly one matching tier. */
function scoreTieredValue(value, tiers) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const tier = tiers.find((t) => n >= t.min && (t.max === null || n <= t.max));
  if (!tier) return 0;
  const incrementalRate = Number(tier.pointsPerYardOverMin) || 0;
  return Number(tier.points) + Math.max(n - Number(tier.min), 0) * incrementalRate;
}

/** Sum a tier array's matching-bucket points for each raw magnitude in `values`. */
function scoreTieredValues(values, tiers) {
  let total = 0;
  for (const raw of Array.isArray(values) ? values : []) {
    total += scoreTieredValue(raw, tiers);
  }
  return total;
}

/** Pure function: stats object -> fantasy points under the given rules. */
function calculateFantasyPoints(stats, rules = SCORING_RULES) {
  let score = 0;
  for (const [stat, value] of Object.entries(stats || {})) {
    const mapping = STAT_KEY_PATHS[stat];
    if (!mapping) continue;
    const ruleValue = ruleValueAt(rules, mapping.path);
    if (mapping.tierMode === 'perValue') {
      if (Array.isArray(ruleValue)) score += scoreTieredValues(value, ruleValue);
      continue;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    if (Array.isArray(ruleValue)) {
      score += scoreTieredValue(n, ruleValue);
    } else if (Number.isFinite(Number(ruleValue))) {
      score += n * Number(ruleValue);
    }
    const bonusTiers = mapping.bonusPath && ruleValueAt(rules, mapping.bonusPath);
    if (Array.isArray(bonusTiers)) score += scoreTieredValue(n, bonusTiers);
  }
  return Math.round(score * 100) / 100;
}

/**
 * True when a stats object carries team-defense tier stats. The teamDefense
 * pointsAllowed/yardsAllowed rules are per-game tier tables, so a season
 * AGGREGATE of such stats must never go through calculateFantasyPoints —
 * it would tier-match the season total once instead of once per week.
 * Self-describing (keyed off the stats themselves), so callers don't need
 * the player's position on hand.
 *
 * `false` does not mean "not a DEF row": since #1549, normalizeTank01DstStats
 * omits both keys when the feed carried no figure, so a real DEF row can
 * answer false too. That is still safe to send through calculateFantasyPoints
 * whole, for a season aggregate as much as a single week, because of a chain
 * this function does not itself state:
 *   - aggregateSeasonStats (seasonSummary.service.js) writes a key onto a
 *     season total only when some weekly row carried a finite value for it,
 *     so an aggregate missing both keys means every week that fed it was
 *     also missing them — there is no per-game tier hit hiding in the total.
 *   - calculateFantasyPoints only prices the keys present in `stats`, so
 *     with no tier key present there is no tier table to double-match.
 * Any future producer of a season row that does not go through
 * aggregateSeasonStats must preserve this: it must carry a tier key
 * whenever any of the weeks that feed it did, or this guard's safety
 * argument no longer holds for that row.
 */
function hasTeamDefenseTiers(stats) {
  return !!stats && typeof stats === 'object'
    && ('pointsAllowed' in stats || 'yardsAllowed' in stats);
}

module.exports = {
  SCORING_RULES,
  SCORING_PRESETS,
  isValidTierArray,
  rulesForLeague,
  calculateFantasyPoints,
  hasTeamDefenseTiers,
};
