const axios = require('axios');
const pool = require('../modules/pool');
const { isTransientDatabaseError } = require('../modules/dbRetry');
const { tank01Get } = require('../modules/tank01Client');
const { materializeLineup, optimalLineup, parseLineupSettings, POSITION_GROUPS } = require('./lineup.service');
const { getIo } = require('../modules/io');
const { fantasySideWhereSql } = require('./leagueType');

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

function rapidApiClient() {
  if (!process.env.RAPID_API_KEY || !process.env.RAPID_API_HOST) {
    const err = new Error('RAPID_API_KEY / RAPID_API_HOST not configured');
    err.statusCode = 503;
    throw err;
  }
  return axios.create({
    baseURL: `https://${process.env.RAPID_API_HOST}`,
    headers: {
      'X-RapidAPI-Key': process.env.RAPID_API_KEY,
      'X-RapidAPI-Host': process.env.RAPID_API_HOST,
    },
    timeout: 15000,
  });
}

/**
 * Unwrap a Tank01 response. Every endpoint answers with
 * { statusCode, body } — the payload lives in `body`. Tolerates a raw
 * payload too, in case the envelope ever disappears.
 */
function tank01Body(data) {
  if (data && typeof data === 'object' && 'body' in data) return data.body;
  return data;
}

/**
 * Map one Tank01 box-score playerStats entry to our flat stat names.
 * Tank01 groups stats into Passing/Rushing/Receiving/Kicking/Defense
 * category objects with string values; missing categories mean zero.
 */
function normalizeTank01Stats(entry) {
  const num = (...values) => {
    for (const value of values) {
      const parsed = Number(String(value ?? '').replace(/,/g, ''));
      if (Number.isFinite(parsed) && String(value ?? '') !== '') return parsed;
    }
    return 0;
  };
  const e = entry || {};
  const passing = e.Passing || {};
  const rushing = e.Rushing || {};
  const receiving = e.Receiving || {};
  const kicking = e.Kicking || {};
  const defense = e.Defense || {};
  // Tank01 nests the return specialist's own punt-return line under
  // "Punting" (alongside a punter's punting line) rather than a dedicated
  // "Returns" category — there is no equivalent kickoff-return category
  // anywhere in the box score response (confirmed empty across a full
  // season sample), so kick returns have no real source to detect from.
  const punting = e.Punting || {};
  return {
    passingYards: num(passing.passYds),
    passingTDs: num(passing.passTD),
    interceptions: num(passing.int),
    rushingYards: num(rushing.rushYds),
    rushingTDs: num(rushing.rushTD),
    receivingYards: num(receiving.recYds),
    receivingTDs: num(receiving.recTD),
    receptions: num(receiving.receptions),
    // Tank01 has reported fumblesLost under Defense and at the top level
    // across versions — accept either.
    fumbles: num(defense.fumblesLost, e.fumblesLost),
    fieldGoal: num(kicking.fgMade),
    // Misses derived from attempts-minus-made; a missing attempts field
    // yields 0 rather than a negative.
    fieldGoalMissed: Math.max(num(kicking.fgAttempts) - num(kicking.fgMade), 0),
    extraPoint: num(kicking.xpMade),
    extraPointMissed: Math.max(num(kicking.xpAttempts) - num(kicking.xpMade), 0),
    returnTDs: num(punting.puntReturnTD),
    puntReturns: num(punting.puntReturns),
    puntReturnYards: num(punting.puntReturnYds),
    // Tank01 has no kickoff-return category at all (see the comment above),
    // so kickReturnYards has no live source; the nflverse finalization /
    // backfill passes are the only place it can come from.
  };
}

/**
 * Map one Tank01 box-score playerStats entry's "Defense" category to our IDP
 * scoring keys (individual defenders — DP roster slots). Confirmed live
 * field names: totalTackles, soloTackles, sacks, defensiveInterceptions
 * (+ interceptionTDs), forcedFumbles, fumblesRecovered, passDeflections,
 * qbHits, tfl, twoPointConversionReturn, defTD. Sack/TFL/fumble-return/
 * INT-return YARDAGE has no Tank01 field at all — those score 0 here and are
 * filled in later by nflverseSync.service.js's post-game finalization pass.
 * `defTD - interceptionTDs` is scored as the generic defensiveTD bucket
 * (fumble-or-blocked-kick-return TD, per the roster/scoring plan — Tank01
 * doesn't separate those two, and individual blocked-kick attribution isn't
 * scored at all); the interception itself already carries the full value of
 * a pick regardless of whether it was returned for a score.
 */
function normalizeTank01IdpStats(entry) {
  const num = (value) => {
    const parsed = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const d = (entry && entry.Defense) || {};
  const totalTackles = num(d.totalTackles);
  const soloTackles = num(d.soloTackles);
  return {
    soloTackle: soloTackles,
    assistedTackle: Math.max(totalTackles - soloTackles, 0),
    idpSack: num(d.sacks),
    idpInterception: num(d.defensiveInterceptions),
    forcedFumble: num(d.forcedFumbles),
    idpFumbleRecovery: num(d.fumblesRecovered),
    passDeflection: num(d.passDeflections),
    qbHit: num(d.qbHits),
    tacklesForLoss: num(d.tfl),
    idpDefensiveTD: Math.max(num(d.defTD) - num(d.interceptionTDs), 0),
    twoPointReturn: num(d.twoPointConversionReturn),
  };
}

/**
 * Pure: scan a box score's play-by-play list (fetched with playByPlay=true)
 * and extract, per player, arrays of made-FG distances and TD-play
 * yardages by category — the raw material for the FG-distance and
 * TD-length-bonus scoring tiers. Confirmed live shapes:
 *   - a made FG's own play carries playerStats[id].Kicking.{fgMade, fgYds}
 *   - a TD play carries playerStats[id].{Passing.passTD+passYds |
 *     Rushing.rushTD+rushYds | Receiving.recTD+recYds} on the SAME play, so
 *     that category's yardage on a scoring play equals the score's length.
 * Nothing here infers yardage from play-text descriptions.
 */
function extractPlayByPlayBonusStats(plays) {
  const num = (value) => {
    const parsed = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const byPlayer = new Map();
  const bucket = (playerId) => {
    if (!byPlayer.has(playerId)) {
      byPlayer.set(playerId, {
        fieldGoalDistances: [], passingTDLengths: [], rushingTDLengths: [], receivingTDLengths: [],
      });
    }
    return byPlayer.get(playerId);
  };
  for (const play of Array.isArray(plays) ? plays : []) {
    const playerStats = play && play.playerStats;
    if (!playerStats) continue;
    for (const [playerId, ps] of Object.entries(playerStats)) {
      if (ps.Kicking && ps.Kicking.fgMade === '1') {
        const yds = num(ps.Kicking.fgYds);
        if (yds != null) bucket(playerId).fieldGoalDistances.push(yds);
      }
      if (ps.Passing && ps.Passing.passTD === '1') {
        const yds = num(ps.Passing.passYds);
        if (yds != null) bucket(playerId).passingTDLengths.push(yds);
      }
      if (ps.Rushing && ps.Rushing.rushTD === '1') {
        const yds = num(ps.Rushing.rushYds);
        if (yds != null) bucket(playerId).rushingTDLengths.push(yds);
      }
      if (ps.Receiving && ps.Receiving.recTD === '1') {
        const yds = num(ps.Receiving.recYds);
        if (yds != null) bucket(playerId).receivingTDLengths.push(yds);
      }
    }
  }
  return byPlayer;
}

/**
 * Map one side of Tank01's box-score "DST" object (team-level defensive
 * aggregate — sacks/interceptions/fumble recoveries/defensive TDs summed
 * across every individual defender) to our scoring-rule stat names. This is
 * the only source for team-defense stats: Tank01's player list has no
 * individual "DEF" entries, so a rostered DEF unit's fantasy points come
 * entirely from this aggregate rather than from any single player's line.
 *
 * `opponentTeamStats` is the OPPOSING side's `box.teamStats[side]` entry —
 * confirmed live, `blockedFG`/`blockedXP`/`blockedPunt` are reported on a
 * team's OWN teamStats line as kicks of THEIRS that got blocked, so credit
 * for a block belongs to the opponent's defense.
 */
function normalizeTank01DstStats(dstSide, opponentTeamStats) {
  const num = (value) => {
    const parsed = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const d = dstSide || {};
  const opp = opponentTeamStats || {};
  return {
    sack: num(d.sacks),
    interceptionReturn: num(d.defensiveInterceptions),
    fumbleRecovery: num(d.fumblesRecovered),
    defensiveTD: num(d.defTD),
    safety: num(d.safeties),
    blockedKick: num(opp.blockedFG) + num(opp.blockedXP) + num(opp.blockedPunt),
    pointsAllowed: num(d.ptsAllowed),
    yardsAllowed: num(d.ydsAllowed),
  };
}

// Full NFL team name -> Tank01 abbreviation, used only to match a league's
// seeded/rostered DEF-unit player (stored with either a full name or an
// abbreviation in nfl_team) against the live box score's teamAbv.
const NFL_TEAM_NAME_TO_ABBR = {
  'ARIZONA CARDINALS': 'ARI', 'ATLANTA FALCONS': 'ATL', 'BALTIMORE RAVENS': 'BAL',
  'BUFFALO BILLS': 'BUF', 'CAROLINA PANTHERS': 'CAR', 'CHICAGO BEARS': 'CHI',
  'CINCINNATI BENGALS': 'CIN', 'CLEVELAND BROWNS': 'CLE', 'DALLAS COWBOYS': 'DAL',
  'DENVER BRONCOS': 'DEN', 'DETROIT LIONS': 'DET', 'GREEN BAY PACKERS': 'GB',
  'HOUSTON TEXANS': 'HOU', 'INDIANAPOLIS COLTS': 'IND', 'JACKSONVILLE JAGUARS': 'JAX',
  'KANSAS CITY CHIEFS': 'KC', 'LAS VEGAS RAIDERS': 'LV', 'LOS ANGELES CHARGERS': 'LAC',
  'LOS ANGELES RAMS': 'LAR', 'MIAMI DOLPHINS': 'MIA', 'MINNESOTA VIKINGS': 'MIN',
  'NEW ENGLAND PATRIOTS': 'NE', 'NEW ORLEANS SAINTS': 'NO', 'NEW YORK GIANTS': 'NYG',
  'NEW YORK JETS': 'NYJ', 'PHILADELPHIA EAGLES': 'PHI', 'PITTSBURGH STEELERS': 'PIT',
  'SAN FRANCISCO 49ERS': 'SF', 'SEATTLE SEAHAWKS': 'SEA', 'TAMPA BAY BUCCANEERS': 'TB',
  'TENNESSEE TITANS': 'TEN', 'WASHINGTON COMMANDERS': 'WAS',
};

/** A players.nfl_team value (full name or already-an-abbreviation) -> Tank01 abbreviation. */
function normalizeTeamAbbr(nflTeam) {
  const raw = String(nflTeam || '').trim();
  if (!raw) return null;
  if (/^[A-Z]{2,3}$/.test(raw)) return raw;
  return NFL_TEAM_NAME_TO_ABBR[raw.toUpperCase()] || null;
}

/** 'SAN FRANCISCO 49ERS' -> 'San Francisco 49ers'. */
function titleCase(str) {
  return str.split(' ').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

/**
 * Pure: which of the 32 NFL teams (from NFL_TEAM_NAME_TO_ABBR, the same list
 * syncWeekStats already uses to match box-score DST aggregates) don't yet
 * have a DEF row, given the nfl_team values of the DEF rows that already
 * exist. Matches by abbreviation via normalizeTeamAbbr, so it's correct
 * regardless of whether an existing row stores a full name or an
 * abbreviation, and unresolvable/empty values are simply ignored.
 */
function missingTeamDefenses(existingNflTeams) {
  const existingAbbrs = new Set(
    (existingNflTeams || []).map((t) => normalizeTeamAbbr(t)).filter(Boolean)
  );
  const missing = [];
  for (const [fullNameUpper, abbr] of Object.entries(NFL_TEAM_NAME_TO_ABBR)) {
    if (existingAbbrs.has(abbr)) continue;
    missing.push(titleCase(fullNameUpper));
  }
  return missing;
}

/**
 * Backfill any of the 32 NFL teams missing a rosterable DEF (team defense)
 * unit. Unlike every other position, DEF units can't be discovered through
 * syncPlayers — Tank01's player list never returns individual DEF entries
 * (see normalizeTank01DstStats) — so they're seeded directly from the same
 * 32-team list syncWeekStats matches box scores against. Idempotent: safe to
 * re-run, since missingTeamDefenses skips any team that already has a row.
 */
async function syncTeamDefenses() {
  const existing = await pool.query(`SELECT "nfl_team" FROM "players" WHERE "position" = 'DEF'`);
  const missing = missingTeamDefenses(existing.rows.map((r) => r.nfl_team));
  let inserted = 0;
  for (const name of missing) {
    try {
      await pool.query(
        `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, 'DEF', $1)`,
        [name]
      );
      inserted += 1;
    } catch (err) {
      console.error('DEF backfill failed for %s:', name, err.message);
    }
  }
  return { teamsInserted: inserted, totalDefTeams: existing.rows.length + inserted };
}

/**
 * Stat keys that ONLY nflverse can produce, so a Tank01 box-score apply — whose
 * upsert replaces the whole stats jsonb — must carry them forward instead of
 * silently erasing them.
 *
 * Three groups, all written by nflverseSync.service:
 *  - usage*: per-week opportunity/role columns (attempts, completions, carries,
 *    targets, air yards) from the combined weekly file. Unscored; the projection
 *    engine reads them as features, and their PRESENCE is the signal that role
 *    data exists at all, so a wipe reads as "we never knew", not "he sat".
 *  - gameTeam/gameOpponent: the team a stat line was earned for and against.
 *  - idp*Yards/idpSafety: the finalization patch (see nflverseSync's
 *    buildStatUpdates) — per-defender yardage Tank01's live feed has no field
 *    for at all.
 *
 * Deliberately NOT here: anything Tank01 does produce. This list is only for
 * keys the live feed cannot regenerate, so carrying them can never mask a stat
 * correction.
 *
 * Lives in scoring.service (not nflverseSync) because nflverseSync already
 * requires this module; the reverse direction would be a require cycle.
 */
const NFLVERSE_ONLY_STAT_KEYS = [
  'usagePassAttempts',
  'usageCompletions',
  'usageCarries',
  'usageTargets',
  'usageAirYards',
  'gameTeam',
  'gameOpponent',
  'idpSackYards',
  'idpTacklesForLossYards',
  'idpFumbleReturnYards',
  'idpInterceptionReturnYards',
  'idpSafety',
];

/**
 * Pure: the subset of `keys` that are actually PRESENT on `source`, as a new
 * object, or null when there are none (or no source at all).
 *
 * "Present" means the property exists with a value other than undefined. An
 * explicit null IS carried: null is data here ("we looked and the column was
 * absent"), and the whole point of these keys is that a missing value must stay
 * missing rather than becoming 0. Never invents a key that isn't on the source.
 */
function pickPresentKeys(source, keys) {
  if (!source || typeof source !== 'object') return null;
  const out = {};
  let found = 0;
  for (const key of keys || []) {
    if (source[key] !== undefined) {
      out[key] = source[key];
      found += 1;
    }
  }
  return found > 0 ? out : null;
}

/**
 * Pure: a fresh stat line with carried keys filled in underneath it.
 *
 * Fresh always wins: a carried value is written only where the fresh object has
 * no defined value for that key, so a live Tank01 pull (including a stat
 * correction that lowers a number) can never be overridden by a stale carry.
 * Written as an explicit fill rather than `{ ...carried, ...fresh }` because
 * that spread would let an explicitly-undefined fresh key clobber a real
 * carried value.
 */
function mergeCarriedStats(fresh, carried) {
  const merged = { ...fresh };
  if (!carried) return merged;
  for (const [key, value] of Object.entries(carried)) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

// Stat keys that represent a discrete, animatable "play" (a touchdown or a
// smaller impact play), mapped to the event type the live UI renders and
// whether it's touchdown-caliber (full-screen cutscene territory) or a
// lighter moment (flash-banner territory on the retro scoreboard only).
// Detection keys off the stat itself incrementing — never a fantasy-point
// jump — so a stat correction that moves points without a new play never
// fires an animation.
const PLAY_STAT_EVENTS = {
  passingTDs: { type: 'passing', isTouchdown: true },
  rushingTDs: { type: 'rushing', isTouchdown: true },
  receivingTDs: { type: 'receiving', isTouchdown: true },
  defensiveTD: { type: 'defensive', isTouchdown: true },
  returnTDs: { type: 'return', isTouchdown: true },
  fieldGoal: { type: 'fieldGoal', isTouchdown: false },
  extraPoint: { type: 'extraPoint', isTouchdown: false },
  sack: { type: 'sack', isTouchdown: false },
  interceptionReturn: { type: 'interception', isTouchdown: false },
  fumbleRecovery: { type: 'fumble', isTouchdown: false },
  puntReturns: { type: 'puntReturn', isTouchdown: false },
};

/**
 * Pure: diff a player's previous vs. new stat line and return one typed play
 * event per tracked stat that increased. Yardage and other untracked stat
 * changes produce nothing. `prevStats` null/undefined is treated as all-zero
 * (first observation of the week) — so re-running a sync with unchanged stats
 * yields no events (idempotent), but a genuinely new play does.
 */
function detectScoringEvents(prevStats, newStats) {
  const prev = prevStats || {};
  const next = newStats || {};
  const events = [];
  for (const [statKey, { type, isTouchdown }] of Object.entries(PLAY_STAT_EVENTS)) {
    const before = Number(prev[statKey]) || 0;
    const after = Number(next[statKey]) || 0;
    if (after > before) {
      events.push({ type, statKey, tdDelta: after - before, isTouchdown });
    }
  }
  return events;
}

/**
 * Every lookup table a box-score apply needs for one (season, week), loaded
 * once and reused across the week's games.
 */
async function loadWeekMaps({ season, week }) {
  const knownPlayers = await pool.query(
    `SELECT "id", "external_id", "name", "position", "nfl_team"
     FROM "players" WHERE "external_id" IS NOT NULL`
  );
  const idByExternal = new Map(
    knownPlayers.rows.map((r) => [String(r.external_id), r.id])
  );
  const metaById = new Map(knownPlayers.rows.map((r) => [r.id, r]));

  // Team-defense (DEF slot) units have no external_id — Tank01's player list
  // never reports them as individual entries — so they're matched by team
  // abbreviation against the box score's separate team-level DST aggregate
  // instead of by id, below.
  const defPlayers = await pool.query(
    `SELECT "id", "name", "nfl_team" FROM "players" WHERE "position" = 'DEF'`
  );
  const defByAbbr = new Map();
  for (const row of defPlayers.rows) {
    const abbr = normalizeTeamAbbr(row.nfl_team);
    if (abbr) defByAbbr.set(abbr, row);
  }

  // Prior stats for this week, so we can diff for new touchdowns.
  const priorStats = await pool.query(
    `SELECT "player_id", "stats" FROM "player_stats"
     WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );
  const prevById = new Map(priorStats.rows.map((r) => [r.player_id, r.stats]));

  // This week's real-game opponents, keyed by nfl_team, for the defender sprite.
  const schedule = await pool.query(
    `SELECT "nfl_team", "opponent" FROM "nfl_games"
     WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );
  const opponentByTeam = new Map(schedule.rows.map((r) => [r.nfl_team, r.opponent]));

  return { idByExternal, metaById, defByAbbr, prevById, opponentByTeam };
}

/**
 * Ingest ONE Tank01 box score into player_stats — every player in the game
 * whose external_id we know, plus both team-defense aggregates.
 *
 * Extracted from syncWeekStats so a single box-score fetch can serve more than
 * one purpose: gameRecap.generateForGame now calls this with the box score it
 * already fetched for the recap, which is what eliminates the duplicate
 * final-game fetch (~69 calls/month of pure waste).
 *
 * Returns the typed touchdown events (`plays`) detected by diffing each
 * player's prior stored stats against this pull, decorated with the scoring
 * player's real NFL team and that week's opponent so the live UI can render a
 * team-accurate cutscene. Only genuine TD-stat increments produce a play, so a
 * re-sync or a stat correction never fabricates one.
 *
 * @param {object} args
 * @param {object} args.box   unwrapped Tank01 /getNFLBoxScore body
 * @param {object} args.maps  from loadWeekMaps({ season, week })
 */
async function applyGameBoxScore({ box, season, week, maps }) {
  const { idByExternal, metaById, defByAbbr, prevById, opponentByTeam } = maps;
  const playerStats = (box && box.playerStats) || {};
  const bonusByPlayer = extractPlayByPlayBonusStats(box && box.allPlayByPlay);
  let updated = 0;
  const plays = [];

  for (const entry of Object.values(playerStats)) {
    const playerId = idByExternal.get(String(entry && entry.playerID));
    if (!playerId) continue; // not in our pool
    const prev = prevById.get(playerId);
    // This upsert replaces the stats jsonb wholesale, so anything only nflverse
    // can supply has to ride across from the stored row or it's gone until the
    // next backfill. Merged BEFORE points are computed and before the row is
    // written, so the stored fantasy_points always describes the stored stats.
    const stats = mergeCarriedStats(
      {
        ...normalizeTank01Stats(entry),
        ...normalizeTank01IdpStats(entry),
        ...(bonusByPlayer.get(String(entry.playerID)) || {}),
      },
      pickPresentKeys(prev, NFLVERSE_ONLY_STAT_KEYS)
    );
    const points = calculateFantasyPoints(stats);
    const events = detectScoringEvents(prev, stats);
    if (events.length > 0) {
      const meta = metaById.get(playerId) || {};
      const pointsDelta =
        Math.round((points - calculateFantasyPoints(prev || {})) * 100) / 100;
      for (const ev of events) {
        plays.push({
          playerId,
          name: meta.name,
          position: meta.position,
          nflTeam: meta.nfl_team,
          opponent: opponentByTeam.get(meta.nfl_team) || null,
          type: ev.type,
          tdDelta: ev.tdDelta,
          pointsDelta,
          isTouchdown: ev.isTouchdown,
        });
      }
    }
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("player_id", "season", "week")
       DO UPDATE SET "stats" = EXCLUDED."stats", "fantasy_points" = EXCLUDED."fantasy_points"`,
      [playerId, season, week, JSON.stringify(stats), points]
    );
    // Keep the diff baseline current so a re-apply of the same box score (the
    // recap path following a live sync) can't re-fire the same touchdown.
    prevById.set(playerId, stats);
    updated += 1;
  }

  // Team-defense scoring: Tank01's box score carries one aggregate DST
  // line per side (sacks/interceptions/fumble recoveries/defensive TDs
  // summed across every individual defender) rather than per-defender
  // stats we could roster — this is the only real source for a DEF
  // unit's fantasy points.
  const dst = (box && box.DST) || {};
  const teamStats = (box && box.teamStats) || {};
  for (const side of ['home', 'away']) {
    const dstSide = dst[side];
    const abbr = dstSide && dstSide.teamAbv ? String(dstSide.teamAbv).toUpperCase() : null;
    const defPlayer = abbr ? defByAbbr.get(abbr) : null;
    if (!defPlayer) continue; // no rostered DEF unit for this team in our pool
    const opponentSide = side === 'home' ? 'away' : 'home';
    const prev = prevById.get(defPlayer.id);
    // Same wholesale-replace hazard as the player loop above: a DST row
    // backfilled from nflverse carries gameTeam/gameOpponent that Tank01's
    // aggregate has no equivalent for.
    const stats = mergeCarriedStats(
      normalizeTank01DstStats(dstSide, teamStats[opponentSide]),
      pickPresentKeys(prev, NFLVERSE_ONLY_STAT_KEYS)
    );
    const points = calculateFantasyPoints(stats);
    const events = detectScoringEvents(prev, stats);
    if (events.length > 0) {
      const pointsDelta =
        Math.round((points - calculateFantasyPoints(prev || {})) * 100) / 100;
      for (const ev of events) {
        plays.push({
          playerId: defPlayer.id,
          name: defPlayer.name,
          position: 'DEF',
          nflTeam: abbr,
          opponent: opponentByTeam.get(abbr) || null,
          type: ev.type,
          tdDelta: ev.tdDelta,
          pointsDelta,
          isTouchdown: ev.isTouchdown,
        });
      }
    }
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("player_id", "season", "week")
       DO UPDATE SET "stats" = EXCLUDED."stats", "fantasy_points" = EXCLUDED."fantasy_points"`,
      [defPlayer.id, season, week, JSON.stringify(stats), points]
    );
    prevById.set(defPlayer.id, stats);
    updated += 1;
  }

  return { updated, plays };
}

/**
 * Pure: which of a week's games still need a box-score fetch.
 *
 * This is the second-biggest quota saving in the app. The old loop box-scored
 * every game in the week on every ~30-minute pass, so a finished 1pm game was
 * re-fetched for the rest of the afternoon (~350 calls/Sunday). Now:
 *  - `scheduled` games have no stats yet — never fetch
 *  - `final` games already ingested (final_stats_synced_at set) — never again
 *  - `in_progress` games, and finals not yet ingested, are the only fetches
 *
 * @param {Array<{tank01_game_id: string, game_status: string, final_stats_synced_at: ?Date}>} rows
 * @returns {Array<{gameId: string, status: string, isFinal: boolean}>}
 */
function gamesNeedingBoxScore(rows) {
  const out = [];
  for (const row of rows || []) {
    const gameId = row.tank01_game_id;
    if (!gameId) continue;
    const status = row.game_status;
    if (status === 'scheduled') continue;
    if (status === 'final' && row.final_stats_synced_at) continue;
    out.push({ gameId, status, isFinal: status === 'final' });
  }
  return out;
}

/**
 * Fetch a week's real-world stats from Tank01: a box score per game that still
 * needs one (see gamesNeedingBoxScore) — every player in those games whose
 * external_id we know gets a player_stats upsert.
 *
 * The week's game list comes from live_game_states, which the live engine keeps
 * fresh for free off ESPN, so the old always-on `/getNFLGamesForWeek` call is
 * now only a fallback for a week we have no live rows for.
 *
 * Returns typed touchdown events (`plays`) for the live UI — see
 * applyGameBoxScore.
 */
async function syncWeekStats({ season, week, pauseMs = 0, api }) {
  const stateRes = await pool.query(
    `SELECT "tank01_game_id", "game_status", "final_stats_synced_at"
       FROM "live_game_states" WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  );

  let targets;
  if (stateRes.rows.length > 0) {
    targets = gamesNeedingBoxScore(stateRes.rows);
  } else {
    // No live rows for this week (a historical week, or the engine hasn't run
    // yet): fall back to one counted schedule call and treat every game as
    // needing a fetch.
    const gamesResponse = await tank01Get('/getNFLGamesForWeek', {
      params: { week, seasonType: 'reg', season },
      transport: api, // tests inject; uncounted when present
    });
    const games = tank01Body(gamesResponse.data) || [];
    if (!Array.isArray(games)) {
      return { season, week, playersUpdated: 0, gamesProcessed: 0, gamesSkipped: 0, plays: [] };
    }
    targets = games
      .filter((g) => g && g.gameID)
      .map((g) => ({ gameId: String(g.gameID), status: null, isFinal: false }));
  }

  const gamesSkipped = Math.max(stateRes.rows.length - targets.length, 0);
  if (targets.length === 0) {
    return { season, week, playersUpdated: 0, gamesProcessed: 0, gamesSkipped, plays: [] };
  }

  const maps = await loadWeekMaps({ season, week });

  let updated = 0;
  let gamesProcessed = 0;
  const plays = [];
  for (const target of targets) {
    try {
      // Backfill callers pace the box-score calls to stay under the provider's
      // per-second rate limit; live callers leave this at 0.
      if (pauseMs > 0 && gamesProcessed > 0) {
        await new Promise((resolve) => setTimeout(resolve, pauseMs));
      }
      const boxResponse = await tank01Get('/getNFLBoxScore', {
        params: { gameID: target.gameId, playByPlay: 'true', fantasyPoints: 'false' },
        transport: api,
      });
      const box = tank01Body(boxResponse.data) || {};
      gamesProcessed += 1;
      const result = await applyGameBoxScore({ box, season, week, maps });
      updated += result.updated;
      plays.push(...result.plays);
      // A final game's stats are now in: never fetch this box score again.
      if (target.isFinal) await markFinalStatsSynced(target.gameId);
    } catch (err) {
      // Correction-route retries are safe because every stat write is an
      // upsert. Do not hide pool starvation as a single skipped NFL game.
      if (isTransientDatabaseError(err)) throw err;
      console.error('Stat sync failed for game %s:', target.gameId, err.message);
    }
  }
  return { season, week, playersUpdated: updated, gamesProcessed, gamesSkipped, plays };
}

/**
 * Stamp a finalized game as stat-ingested. Idempotent, and deliberately
 * separate from the recap row: a recap can be regenerated without re-spending a
 * box-score call, and a stat re-sync (admin/correction route) can clear the
 * stamp if it ever needs to.
 */
async function markFinalStatsSynced(tank01GameId) {
  await pool.query(
    `UPDATE "live_game_states" SET "final_stats_synced_at" = now(), "updated_at" = now()
      WHERE "tank01_game_id" = $1`,
    [tank01GameId]
  );
}

/** Map a RapidAPI injury designation to our badge codes (Q/D/O/IR). */
function normalizeInjuryStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return null;
  if (s.includes('injured reserve') || /\bir\b/.test(s)) return 'IR';
  if (s.includes('question')) return 'Q';
  if (s.includes('doubt')) return 'D';
  if (s.includes('out')) return 'O';
  return null;
}

/**
 * Injury sync: Tank01's player list carries each player's current injury
 * designation, so one getNFLPlayerList call refreshes everyone. Players with
 * no current designation are cleared back to healthy. Player-row locks make
 * overlapping manual/scheduled syncs observe transitions exactly once; IR
 * flag rows commit with the designation updates before best-effort push.
 */
async function syncInjuries({ api = tank01Get } = {}) {
  const response = await api('/getNFLPlayerList');
  const entries = tank01Body(response.data) || [];
  if (!Array.isArray(entries)) {
    const err = new Error('unexpected getNFLPlayerList response shape');
    err.statusCode = 502;
    throw err;
  }
  const injuryByExternal = new Map();
  for (const entry of entries) {
    if (!entry || entry.playerID == null) continue;
    const injury = entry.injury || {};
    injuryByExternal.set(String(entry.playerID), {
      status: normalizeInjuryStatus(injury.designation),
      detail: injury.description ? String(injury.description).slice(0, 255) : null,
    });
  }

  const client = await pool.connect();
  let irFlags;
  let updated = 0;
  try {
    await client.query('BEGIN');
    const playersResult = await client.query(
      `SELECT "id", "external_id", "injury_status"
         FROM "players" WHERE "external_id" IS NOT NULL
         FOR UPDATE`
    );
    const transitions = [];
    for (const player of playersResult.rows) {
      const injury = injuryByExternal.get(String(player.external_id));
      if (!injury) continue; // not in the feed — leave untouched
      await client.query(
        `UPDATE "players" SET "injury_status" = $1, "injury_detail" = $2 WHERE "id" = $3`,
        [injury.status, injury.detail, player.id]
      );
      transitions.push({
        playerId: player.id,
        previousDesignation: player.injury_status,
        currentDesignation: injury.status,
      });
      updated += 1;
    }
    const { flagRecoveredIrStashes } = require('./irPolicy.service');
    irFlags = await flagRecoveredIrStashes(client, transitions);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  try {
    const { sendIrFlagPushes } = require('./irPolicy.service');
    await sendIrFlagPushes(irFlags);
  } catch (error) {
    console.error('IR flag push failed:', error.message);
  }
  return { playersUpdated: updated, irFlags: irFlags.length };
}

/**
 * Pure: the stable identifier both per-team rows of one NFL game share.
 * Deliberately spelled the way nflverse spells its own `game_id`
 * (`2026_03_BUF_MIA`, season_week_away_home), so a Tank01-synced week and an
 * nflverse-backfilled week produce the SAME key for the same game and a
 * per-game lookup (weather, venue) never fans out to two half-games.
 * Returns null when any component is missing.
 */
function buildGameKey({ season, week, away, home }) {
  const w = Number(week);
  if (!Number.isFinite(Number(season)) || !Number.isInteger(w) || !away || !home) return null;
  return `${Number(season)}_${String(w).padStart(2, '0')}_${away}_${home}`;
}

/**
 * Pure: one Tank01 game entry -> { home, away, kickoffAt } (team
 * abbreviations; null when the entry is missing anything load-bearing).
 * Home/away orientation was always present in the feed and previously
 * discarded — it is carried through now so nfl_games can record which side of
 * the game each row is.
 */
function normalizeTank01Game(entry) {
  if (!entry || !entry.home || !entry.away) return null;
  const epoch = Number(entry.gameTime_epoch);
  if (!Number.isFinite(epoch) || epoch <= 0) return null;
  return { home: entry.home, away: entry.away, kickoffAt: new Date(epoch * 1000) };
}

/**
 * Pull the real NFL schedule into nfl_games — one row per team per week,
 * keyed by Tank01 team abbreviations (matching players.nfl_team from
 * syncPlayers) — powering lineup locks and bye detection. One
 * getNFLGamesForWeek call per regular-season week; idempotent upserts.
 */
async function syncSchedule({ season }) {
  let upserted = 0;
  for (let week = 1; week <= 18; week++) {
    try {
      const response = await tank01Get('/getNFLGamesForWeek', {
        params: { week, seasonType: 'reg', season },
      });
      const games = tank01Body(response.data) || [];
      if (!Array.isArray(games)) continue;
      for (const entry of games) {
        const game = normalizeTank01Game(entry);
        if (!game) continue;
        const gameKey = buildGameKey({ season, week, away: game.away, home: game.home });
        for (const [team, opponent, side] of [
          [game.home, game.away, 'home'],
          [game.away, game.home, 'away'],
        ]) {
          // game_key/home_away are additive: Tank01 carries no venue, roof,
          // surface or rest data, so those columns are left exactly as they
          // are (an nflverse schedule pass fills them in).
          await pool.query(
            `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at", "game_key", "home_away")
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT ("season", "week", "nfl_team")
             DO UPDATE SET "opponent" = EXCLUDED."opponent", "kickoff_at" = EXCLUDED."kickoff_at",
                           "game_key" = EXCLUDED."game_key", "home_away" = EXCLUDED."home_away"`,
            [season, week, team, opponent, game.kickoffAt, gameKey, side]
          );
          upserted += 1;
        }
      }
    } catch (err) {
      console.error('schedule sync failed for week %s:', week, err.message);
    }
  }
  return { season, gamesUpserted: upserted };
}

// Fantasy-relevant positions — Tank01's full player list includes every
// position (OL, C, G, ...); only these are useful in a lineup. Individual
// defenders (DL/LB/DB group members — DE/DT/NT/LB/ILB/OLB/CB/S/FS/SS) are
// included so DP-enabled leagues can roster them; they keep their specific
// Tank01 position for display (see lineup.service.js's POSITION_GROUPS,
// which expands DL/LB/DB slot eligibility to match).
const FANTASY_POSITIONS = new Set([
  'QB', 'RB', 'WR', 'TE', 'K', 'PK', 'DEF',
  ...POSITION_GROUPS.DL, ...POSITION_GROUPS.LB, ...POSITION_GROUPS.DB,
]);

// Individual-defender position codes as stored on players rows (Tank01's
// specific codes, not the DL/LB/DB roster-group keys).
const IDP_POSITIONS = [...POSITION_GROUPS.DL, ...POSITION_GROUPS.LB, ...POSITION_GROUPS.DB];

// Every position whose season rollups come from our own player_stats weeklies
// rather than the Sleeper season sync (which covers offense/K only). Safe to
// pass to syncPlayerSeasonStats({ positions }) — Sleeper never writes rows for
// these positions, so a scoped upsert cannot clobber a Sleeper rollup.
const DEFENSIVE_POSITIONS = ['DEF', ...IDP_POSITIONS];

/**
 * Resolve a headshot URL for a Tank01 player entry. Prefer the provider's own
 * `espnHeadshot` URL when present; otherwise build the public ESPN headshot
 * URL from the player's `espnID` (a stable, keyed pattern). Returns null when
 * neither is available, so the UI falls back to an initials avatar.
 */
function resolveHeadshotUrl(entry) {
  const provided = entry && entry.espnHeadshot;
  if (provided && String(provided).startsWith('http')) return String(provided);
  const espnId = entry && entry.espnID;
  if (espnId != null && /^\d+$/.test(String(espnId))) {
    return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  }
  return null;
}

/**
 * Normalize one entry from Tank01's getNFLPlayerList into our player shape.
 * Returns null for entries missing an id, name, or position, and for
 * non-fantasy positions. Tank01 calls kickers 'PK' — stored as 'K' to match
 * our slot eligibility. Also carries a resolved headshot URL and jersey
 * number (both null when the feed omits them).
 */
function normalizePlayerEntry(entry) {
  const externalId = entry && entry.playerID;
  const name = entry && entry.longName;
  let position = entry && entry.pos && String(entry.pos).toUpperCase();
  if (position === 'PK') position = 'K';
  if (!externalId || !name || !position || !FANTASY_POSITIONS.has(position)) return null;
  const jersey = entry.jerseyNum != null && String(entry.jerseyNum) !== ''
    ? String(entry.jerseyNum).slice(0, 8)
    : null;
  return {
    externalId: String(externalId),
    name,
    position,
    nflTeam: entry.team ? String(entry.team) : null,
    photoUrl: resolveHeadshotUrl(entry),
    jerseyNumber: jersey,
  };
}

/**
 * Discover and refresh the NFL player pool from Tank01's getNFLPlayerList —
 * a single call covering the whole league. Upserts by external_id (safe to
 * re-run; existing players get their name/position/team refreshed, new ones
 * are inserted). Not on the scheduler — trigger from the admin dashboard or
 * POST /api/scoring/sync-players.
 */
async function syncPlayers({ season }) {
  const response = await tank01Get('/getNFLPlayerList');
  const entries = tank01Body(response.data) || [];
  if (!Array.isArray(entries)) {
    const err = new Error('unexpected getNFLPlayerList response shape');
    err.statusCode = 502;
    throw err;
  }
  let upserted = 0;
  let skipped = 0;
  for (const raw of entries) {
    const parsed = normalizePlayerEntry(raw);
    if (!parsed) {
      skipped += 1;
      continue;
    }
    try {
      await pool.query(
        `INSERT INTO "players" ("external_id", "name", "position", "nfl_team", "photo_url", "jersey_number")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("external_id")
         DO UPDATE SET "name" = EXCLUDED."name", "position" = EXCLUDED."position",
                       "nfl_team" = EXCLUDED."nfl_team",
                       -- keep an existing headshot/jersey if a later feed omits it
                       "photo_url" = COALESCE(EXCLUDED."photo_url", "players"."photo_url"),
                       "jersey_number" = COALESCE(EXCLUDED."jersey_number", "players"."jersey_number")`,
        [parsed.externalId, parsed.name, parsed.position, parsed.nflTeam, parsed.photoUrl, parsed.jerseyNumber]
      );
      upserted += 1;
    } catch (err) {
      console.error('player sync: upsert failed for external_id %s:', parsed.externalId, err.message);
    }
  }
  return { season, playersUpserted: upserted, skippedNonFantasy: skipped };
}

/**
 * Pure: sum an array of weekly stat objects into one season total. Every
 * numeric stat key is added up; `games` counts the rows (weeks played).
 * Non-numeric / unknown values are ignored.
 */
function aggregateSeasonStats(weeklyStats) {
  const totals = {};
  let games = 0;
  for (const raw of weeklyStats || []) {
    let stats = raw;
    if (typeof stats === 'string') {
      try { stats = JSON.parse(stats); } catch { stats = null; }
    }
    if (!stats || typeof stats !== 'object') continue;
    games += 1;
    for (const [key, value] of Object.entries(stats)) {
      const n = Number(value);
      if (Number.isFinite(n)) totals[key] = Math.round(((totals[key] || 0) + n) * 100) / 100;
    }
  }
  return { games, stats: totals };
}

/**
 * Pure: assemble the player quick-view summary payload from already-fetched
 * rows. Kept free of DB access so it's unit-testable.
 *   - player:      the players row
 *   - weeklyRows:  player_stats rows [{ season, week, stats }] (any order)
 *   - seasonRows:  player_season_stats rows [{ season, games_played, stats }]
 *   - rules:       scoring rules to price every stat line under
 *   - byeWeek:     precomputed bye week (number) or null
 *   - currentSeasonYear: the league's current season (default 2026)
 * currentSeason holds this-season weekly lines (null before any are played);
 * previousSeasons lists every completed season (< current) from the rollups,
 * newest first, points RE-SCORED under `rules`. `fantasy` is the draft-facing
 * summary: ADP, last completed season's total, and a projected point total for
 * the upcoming season (that season's per-game pace over a 17-game slate).
 */
// Fewest completed-season games we'll extrapolate a projection from — below
// this the per-game pace is too noisy to scale to a full season.
const MIN_PROJECTION_GAMES = 4;

/**
 * True when a stats object carries team-defense tier stats. The teamDefense
 * pointsAllowed/yardsAllowed rules are per-game tier tables, so a season
 * AGGREGATE of such stats must never go through calculateFantasyPoints —
 * it would tier-match the season total once instead of once per week.
 * Self-describing (keyed off the stats themselves), so callers don't need
 * the player's position on hand.
 */
function hasTeamDefenseTiers(stats) {
  return !!stats && typeof stats === 'object'
    && ('pointsAllowed' in stats || 'yardsAllowed' in stats);
}

/**
 * Guarded full-season projection: the most recent completed season's per-game
 * pace under `rules`, extrapolated over a 17-game slate. Returns null when the
 * sample is too small (< MIN_PROJECTION_GAMES) or there's no prior season, so
 * the draft board and the quick-view report the same number for a player.
 */
function projectSeasonPoints({ seasonRows = [], rules = SCORING_RULES, currentSeasonYear = 2026 }) {
  const currentYear = Number(currentSeasonYear) || 2026;
  const lastCompleted = [...seasonRows]
    .filter((r) => r.season < currentYear)
    .sort((a, b) => b.season - a.season)[0];
  if (!lastCompleted) return null;
  const games = Number(lastCompleted.games_played) || 0;
  if (games < MIN_PROJECTION_GAMES) return null;
  // DEF rollups can't be scored as aggregates (see hasTeamDefenseTiers) — use
  // the stored weekly-summed season total instead. Accepted deviation: that
  // total is under default rules, so custom league DEF tiers don't move it.
  const seasonTotal = hasTeamDefenseTiers(lastCompleted.stats)
    ? Number(lastCompleted.fantasy_points)
    : calculateFantasyPoints(lastCompleted.stats, rules);
  const perGame = seasonTotal / games;
  if (!perGame || !Number.isFinite(perGame)) return null;
  return Math.round(perGame * 17 * 10) / 10;
}

function buildPlayerSummary({
  player,
  weeklyRows = [],
  seasonRows = [],
  rules = SCORING_RULES,
  byeWeek = null,
  currentSeasonYear = 2026,
  // { season, rank, groupSize } from getSeasonPositionRank, or null. Passed in
  // (not queried here) so this builder stays pure over its row inputs.
  posRank = null,
}) {
  const currentYear = Number(currentSeasonYear) || 2026;

  const weekly = [...weeklyRows]
    .filter((r) => r.season === currentYear)
    .sort((a, b) => a.week - b.week)
    .map((r) => ({
      week: r.week,
      stats: r.stats,
      fantasy_points: calculateFantasyPoints(r.stats, rules),
    }));
  const currentPoints = Math.round(weekly.reduce((s, w) => s + w.fantasy_points, 0) * 100) / 100;
  const currentSeason = weekly.length === 0 ? null : {
    season: currentYear,
    weekly,
    games: weekly.length,
    points: currentPoints,
    perGame: Math.round((currentPoints / weekly.length) * 10) / 10,
  };

  const previousSeasons = [...seasonRows]
    .filter((r) => r.season < currentYear)
    .sort((a, b) => b.season - a.season)
    .map((r) => {
      // A DEF rollup can't be scored as an aggregate (see hasTeamDefenseTiers);
      // price its weekly lines individually so the per-game tiers land once per
      // game, under this league's own rules. Falls back to aggregate scoring
      // only when we hold no weeklies for that season.
      const seasonWeeklies = hasTeamDefenseTiers(r.stats)
        ? weeklyRows.filter((w) => w.season === r.season)
        : [];
      const points = seasonWeeklies.length
        ? Math.round(seasonWeeklies.reduce((sum, w) => sum + calculateFantasyPoints(w.stats, rules), 0) * 100) / 100
        : calculateFantasyPoints(r.stats, rules);
      const games = Number(r.games_played) || 0;
      return {
        season: r.season,
        games,
        stats: r.stats,
        points,
        perGame: games ? Math.round((points / games) * 10) / 10 : 0,
      };
    });

  // Draft-facing fantasy summary. Projection extrapolates the most recent
  // completed season's per-game pace across a full 17-game slate — but only
  // from a large enough sample; a 1-2 game season would inflate wildly, so we
  // report no projection there rather than a misleading one.
  const lastCompleted = previousSeasons[0] || null;
  const adp = player.adp != null && Number.isFinite(Number(player.adp)) ? Number(player.adp) : null;
  const canProject = lastCompleted && lastCompleted.games >= MIN_PROJECTION_GAMES && lastCompleted.perGame;
  const fantasy = {
    adp,
    posRank: posRank ? posRank.rank : null,
    posRankOf: posRank ? posRank.groupSize : null,
    posRankSeason: posRank ? posRank.season : null,
    previousSeasonYear: lastCompleted ? lastCompleted.season : null,
    previousSeasonTotal: lastCompleted ? lastCompleted.points : null,
    projectionSeason: currentYear,
    projectedPoints: canProject ? Math.round(lastCompleted.perGame * 17 * 10) / 10 : null,
  };

  return {
    player: {
      id: player.id,
      name: player.name,
      position: player.position,
      nfl_team: player.nfl_team,
      jersey_number: player.jersey_number,
      external_id: player.external_id,
      injury_status: player.injury_status,
      injury_detail: player.injury_detail,
      news: player.news,
      photo_url: player.photo_url,
      adp,
      bye_week: byeWeek,
    },
    fantasy,
    currentSeason,
    previousSeasons,
  };
}

/**
 * Backfill / refresh season-level totals in player_season_stats by rolling up
 * every completed prior season's weekly rows in player_stats. "Prior" means
 * strictly before `currentSeason` (defaults to the newest league's current
 * season, else 2026). Idempotent — re-running recomputes and upserts each
 * (player, season). The stored fantasy_points uses the default scoring rules;
 * the summary API recomputes points from `stats` under a league's own rules.
 *
 * This is a one-time/on-demand job (admin dashboard or POST
 * /api/scoring/backfill-seasons), not on the scheduler. Seasons for which we
 * have no weekly data simply produce no rows, so players without prior-season
 * history degrade gracefully to the dialog's "no data" state.
 *
 * WARNING: an unscoped run upserts EVERY player:season pair and would clobber
 * the richer Sleeper-sourced offense/K rollups. Pass
 * `positions: DEFENSIVE_POSITIONS` (or run
 * scripts/backfill-defense-season-stats.js) to roll up DEF/IDP only — Sleeper
 * never writes rows for those positions, so the scoped upsert is safe.
 */
async function syncPlayerSeasonStats({ currentSeason, positions } = {}) {
  let cutoff = Number(currentSeason);
  if (!Number.isInteger(cutoff)) {
    // Pick'em-only leagues are excluded from the derived cutoff: their
    // current_season is seeded from the NFL schedule at creation and can
    // reach the next season before any fantasy league rolls over, which
    // would widen "strictly before" into a season whose offense/K rollups
    // are still Sleeper-sourced (the clobber the WARNING above forbids).
    const r = await pool.query(
      `SELECT MAX("current_season") AS s FROM "leagues" WHERE ${fantasySideWhereSql()}`
    );
    cutoff = r.rows[0] && r.rows[0].s != null ? Number(r.rows[0].s) : 2026;
  }

  const scoped = Array.isArray(positions) && positions.length > 0;
  const weekly = scoped
    ? await pool.query(
        `SELECT "ps"."player_id", "ps"."season", "ps"."stats", "ps"."fantasy_points"
         FROM "player_stats" "ps"
         JOIN "players" "p" ON "p"."id" = "ps"."player_id"
         WHERE "ps"."season" < $1 AND "p"."position" = ANY($2)
         ORDER BY "ps"."player_id", "ps"."season"`,
        [cutoff, positions]
      )
    : await pool.query(
        `SELECT "player_id", "season", "stats", "fantasy_points" FROM "player_stats"
         WHERE "season" < $1
         ORDER BY "player_id", "season"`,
        [cutoff]
      );

  // Group weekly rows by player+season.
  const byKey = new Map();
  for (const row of weekly.rows) {
    const key = `${row.player_id}:${row.season}`;
    if (!byKey.has(key)) byKey.set(key, { playerId: row.player_id, season: row.season, rows: [] });
    byKey.get(key).rows.push(row);
  }

  let upserted = 0;
  for (const { playerId, season, rows } of byKey.values()) {
    const { games, stats } = aggregateSeasonStats(rows.map((r) => r.stats));
    // Sum the stored weekly points rather than scoring the aggregate: the
    // teamDefense pointsAllowed/yardsAllowed rules are per-game tier tables,
    // so scoring a season total tier-matches once instead of once per week.
    // For linear categories the two are identical under default rules.
    const points = Math.round(rows.reduce((sum, r) => {
      // Careful: Number(null) is 0, which would silently score a missing week
      // as zero instead of recomputing it.
      const weekPoints = r.fantasy_points == null ? NaN : Number(r.fantasy_points);
      return sum + (Number.isFinite(weekPoints) ? weekPoints : calculateFantasyPoints(r.stats));
    }, 0) * 100) / 100;
    try {
      await pool.query(
        `INSERT INTO "player_season_stats" ("player_id", "season", "games_played", "stats", "fantasy_points")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("player_id", "season")
         DO UPDATE SET "games_played" = EXCLUDED."games_played",
                       "stats" = EXCLUDED."stats",
                       "fantasy_points" = EXCLUDED."fantasy_points"`,
        [playerId, season, games, JSON.stringify(stats), points]
      );
      upserted += 1;
    } catch (err) {
      console.error('season-stat backfill failed for player %s season %s:', playerId, season, err.message);
    }
  }
  return { cutoffSeason: cutoff, seasonsUpserted: upserted };
}

/**
 * A player's rank among the same literal position code (CB ranks against CB,
 * not the DB group) by stored season fantasy_points, from player_season_stats.
 * The stored points are the app-default (half-PPR) values — for DEF they're
 * weekly-summed, so ranking on them never re-scores a season aggregate against
 * the per-game pointsAllowed/yardsAllowed tiers. One number regardless of any
 * client scoring-format toggle.
 *
 * Returns { rank, groupSize } or null when the player has no rollup row for
 * that season. Ties share a rank (RANK(), not ROW_NUMBER()).
 */
async function getSeasonPositionRank(playerId, position, season) {
  if (!position || !Number.isInteger(Number(season))) return null;
  const result = await pool.query(
    `SELECT "rank", "group_size" FROM (
       SELECT "pss"."player_id",
              RANK() OVER (ORDER BY "pss"."fantasy_points" DESC) AS "rank",
              COUNT(*) OVER ()::int AS "group_size"
       FROM "player_season_stats" "pss"
       JOIN "players" "p" ON "p"."id" = "pss"."player_id"
       WHERE "p"."position" = $2 AND "pss"."season" = $3
     ) "ranked" WHERE "player_id" = $1`,
    [playerId, position, season]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { rank: Number(row.rank), groupSize: Number(row.group_size) };
}

/**
 * Generate round-robin head-to-head pairings for a league week (idempotent —
 * skips if matchups already exist). Odd team counts give one team a bye.
 */
async function generateMatchups({ leagueId, season, week }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT 1 FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 LIMIT 1`,
      [leagueId, season, week]
    );
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return { created: 0, reason: 'matchups already exist for this week' };
    }
    const teamsResult = await client.query(
      `SELECT "id" FROM "teams" WHERE "league_id" = $1 ORDER BY "id"`,
      [leagueId]
    );
    const ids = teamsResult.rows.map((r) => r.id);
    if (ids.length < 2) {
      await client.query('ROLLBACK');
      return { created: 0, reason: 'need at least 2 teams' };
    }
    // Circle-method round robin, rotated by week for variety
    const rotation = week % Math.max(1, ids.length - 1);
    const fixed = ids[0];
    const rest = ids.slice(1);
    const rotated = rest.slice(rotation).concat(rest.slice(0, rotation));
    const order = [fixed, ...rotated];
    let created = 0;
    for (let i = 0; i < Math.floor(order.length / 2); i++) {
      const home = order[i];
      const away = order[order.length - 1 - i];
      await client.query(
        `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id")
         VALUES ($1, $2, $3, $4, $5)`,
        [leagueId, season, week, home, away]
      );
      created += 1;
    }
    await client.query('COMMIT');
    return { created };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The players in this team's (season, week) lineup who were acquired AFTER
 * their NFL game for that week kicked off — the settle pass's one exclusion.
 *
 * "Acquired" is `team_players.created_at`, which is the time THIS team got
 * him on every path: every acquisition INSERTs a roster row, and since #197
 * a trade deletes and re-inserts rather than moving one, so the column means
 * what its name says. Deliberately NOT `lineup_entries.created_at`, which
 * records when the week was first materialized by whichever call got there
 * first, and can be long after the player joined the roster.
 *
 * All three joins are inner, and each absence is a deliberate "not excluded":
 * - no `team_players` row: he is no longer on the roster. Since #197 his
 *   current-week row only survives a removal if his game had already kicked
 *   off, so a row still here means he was on the roster at kickoff and his
 *   points are the team's. This is the post-game drop the issue is about.
 * - no `nfl_games` row: a bye, or a schedule not synced yet. There is no
 *   kickoff for him to be after, so nothing is excluded — the same reading
 *   `lockedNflTeams` gives an empty schedule ("nothing is locked").
 *
 * KNOWN LIMIT, shared with the lock rule and deliberately not fixed here.
 * The `nfl_team` join is raw equality, exactly as `lineup.service`'s
 * `lockedNflTeams` compares and as #197's cleanup migration joins. But
 * `nfl_games` keys teams by Tank01 abbreviation while `players.nfl_team`
 * holds FULL TEAM NAMES for DEF units, and the two vocabularies also differ
 * on alias codes (Tank01's WSH vs. WAS) — see `bye.service.computeByeWeeks`,
 * which had to reach for `fn_normalize_nfl_team()` on both sides for exactly
 * this reason. So a DEF unit matches no game row here and is never excluded.
 *
 * Normalizing ONLY here would be worse than leaving it. A DEF is never
 * `locked` either, so `removeLineupEntries` always deletes his current-week
 * row on a drop, post-game included: fixing the acquisition half alone would
 * leave the drop half broken and the two halves disagreeing about the same
 * player. The fix belongs in one place, on `lockedNflTeams` and this query
 * together, which is a change to #197's family rather than to #190's scope.
 * If you normalize one of these, normalize all of them.
 */
async function playersAcquiredAfterKickoff(client, { teamId, season, week }) {
  const result = await client.query(
    `SELECT "lineup_entries"."player_id" FROM "lineup_entries"
     JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
     JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
       AND "team_players"."player_id" = "lineup_entries"."player_id"
     JOIN "nfl_games" ON "nfl_games"."season" = "lineup_entries"."season"
       AND "nfl_games"."week" = "lineup_entries"."week"
       AND "nfl_games"."nfl_team" = "players"."nfl_team"
     WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
       AND "lineup_entries"."week" = $3
       AND "team_players"."created_at" > "nfl_games"."kickoff_at"`,
    [teamId, season, week]
  );
  return new Set(result.rows.map((r) => r.player_id));
}

/**
 * Score every matchup for a league week: each team's score is the sum of its
 * STARTERS' fantasy points for that week (bench and IR don't count), computed
 * from raw stats under the LEAGUE'S scoring rules. Lineups are materialized
 * first so teams that never touched theirs still get their carried-forward
 * (or default-bench) lineup. Transactional per league.
 *
 * THREE populations, not two. Which one a call gets is decided by the week's
 * finality and by the `settle` option, never inferred from anything else:
 *
 * - LIVE (an open week, no `settle`): materialize first, then join
 *   team_players, the CURRENT roster — a player dropped mid-week stops
 *   scoring immediately. This is the scheduler's in-flight path, the manual
 *   POST /league/:id/score route, and any re-score of a week still open.
 * - SETTLE (an open week, `settle: true`): the week AS PLAYED. No
 *   materialize and no roster join — the population is the week's existing
 *   lineup_entries rows — minus any player whose roster row was created
 *   AFTER his NFL game for that week kicked off. Only advance-week asks for
 *   this, to compute the score of record before finalizing (#190).
 *   Consequence worth knowing: a team with NO rows for the week scores 0
 *   here, where the live path would have materialized a carried-forward
 *   lineup for it first. That is the price of not re-materializing, and
 *   re-materializing is the whole bug - it is what hands a post-game
 *   acquisition a row. In practice the week is already materialized by
 *   then: the scheduler live-scores every league whose week has had a
 *   kickoff in the last 8 hours, and that path does materialize. A week
 *   with no synced schedule and no manager who ever opened his lineup is
 *   the case that reaches 0.
 * - FINAL (`matchups.final`): score straight from that week's
 *   lineup_entries, the historical record, with no exclusion applied at all.
 *   A player traded or dropped SINCE then still counts, and the lineup is
 *   never re-materialized against today's roster (#106). Finality wins over
 *   `settle` so re-scoring a settled week stays idempotent: stat corrections
 *   re-run this and must not move a number that is already the record.
 *
 * Settle and final differ only in the exclusion, and only for the window
 * between the last whistle and the advance: once the week is final, nothing
 * new can reach its lineup_entries anyway (#106 froze materialization), so
 * there is nothing left for the exclusion to catch.
 *
 * Best-ball leagues ignore the slots owners set: the score is the OPTIMAL
 * legal lineup over that week's players (same three population rules),
 * computed server-side every time — there is no lineup to manage.
 */
async function scoreMatchups({ leagueId, season, week, plays = [], settle = false }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    const rules = rulesForLeague(league);
    const matchupsResult = await client.query(
      `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 FOR UPDATE`,
      [leagueId, season, week]
    );
    const teamScore = async (teamId, isFinal) => {
      // Finality wins over `settle`: a final week is already the record.
      const settling = settle && !isFinal;
      const live = !isFinal && !settling;
      if (live) {
        await materializeLineup(client, { leagueId, teamId, season, week });
      }
      const currentRosterJoin = live
        ? `JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
           AND "team_players"."player_id" = "lineup_entries"."player_id"`
        : '';
      const excluded = settling
        ? await playersAcquiredAfterKickoff(client, { teamId, season, week })
        : new Set();
      if (league.best_ball) {
        // Best ball: every active rostered player counts as a candidate; IR
        // occupants remain stashed and do not participate in scoring.
        const r = await client.query(
          `SELECT "lineup_entries"."player_id", "lineup_entries"."slot",
                  "players"."position", "player_stats"."stats"
           FROM "lineup_entries"
           ${currentRosterJoin}
           JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
           LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
             AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
           WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
             AND "lineup_entries"."week" = $3`,
          [teamId, season, week]
        );
        const candidateRows = r.rows
          .filter((row) => row.slot !== 'IR')
          .filter((row) => !excluded.has(row.player_id));
        const candidates = candidateRows.map((row) => ({ playerId: row.player_id, position: row.position }));
        const pointsFor = new Map(
          candidateRows.map((row) => [row.player_id, calculateFantasyPoints(row.stats, rules)])
        );
        const { rosterSlots } = parseLineupSettings(league);
        return optimalLineup(candidates, rosterSlots, pointsFor).total;
      }
      const r = await client.query(
        `SELECT "player_stats"."stats", "lineup_entries"."player_id"
         FROM "lineup_entries"
         ${currentRosterJoin}
         JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
           AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
         WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
           AND "lineup_entries"."week" = $3
           AND "lineup_entries"."slot" NOT IN ('BENCH', 'IR')`,
        [teamId, season, week]
      );
      const total = r.rows
        .filter((row) => !excluded.has(row.player_id))
        .reduce((sum, row) => sum + calculateFantasyPoints(row.stats, rules), 0);
      return Math.round(total * 100) / 100;
    };
    const scored = [];
    for (const matchup of matchupsResult.rows) {
      const homeScore = await teamScore(matchup.home_team_id, matchup.final);
      const awayScore = await teamScore(matchup.away_team_id, matchup.final);
      await client.query(
        `UPDATE "matchups" SET "home_score" = $1, "away_score" = $2 WHERE "id" = $3`,
        [homeScore, awayScore, matchup.id]
      );
      scored.push({
        matchupId: matchup.id,
        homeTeamId: matchup.home_team_id,
        awayTeamId: matchup.away_team_id,
        homeScore,
        awayScore,
      });
    }
    await client.query('COMMIT');
    // Live scoring: push fresh scores to anyone watching this league
    const io = getIo();
    // `plays` (typed touchdown events) rides the same emit that carries fresh
    // scores. It's populated only on the live sync path — the stat-correction
    // path passes none — so a cutscene can never fire from a correction.
    if (io) io.to(`league:${leagueId}`).emit('scores:updated', { leagueId, season, week, scored, plays });
    return { scored };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

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
  syncPlayers,
  syncPlayerSeasonStats,
  getSeasonPositionRank,
  generateMatchups,
  scoreMatchups,
};
