const axios = require('axios');
const pool = require('../modules/pool');
const { materializeLineup, optimalLineup, parseLineupSettings, POSITION_GROUPS } = require('./lineup.service');
const { getIo } = require('../modules/io');

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
  },
  kicking: {
    extraPoint: 1,
    fieldGoal: [
      { min: 0, max: 39, points: 3 },
      { min: 40, max: 49, points: 4 },
      { min: 50, max: null, points: 5 },
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
  passingYards: { path: ['passing', 'yards'] },
  passingTDs: { path: ['passing', 'touchdowns'] },
  interceptions: { path: ['passing', 'interceptions'] },
  passingTwoPt: { path: ['passing', 'twoPointConversions'] },
  passingTDLengths: { path: ['passing', 'tdLengthBonus'], tierMode: 'perValue' },
  rushingYards: { path: ['rushing', 'yards'] },
  rushingTDs: { path: ['rushing', 'touchdowns'] },
  rushingTwoPt: { path: ['rushing', 'twoPointConversions'] },
  rushingTDLengths: { path: ['rushing', 'tdLengthBonus'], tierMode: 'perValue' },
  receivingYards: { path: ['receiving', 'yards'] },
  receivingTDs: { path: ['receiving', 'touchdowns'] },
  receptions: { path: ['receiving', 'reception'] },
  receivingTwoPt: { path: ['receiving', 'twoPointConversions'] },
  receivingTDLengths: { path: ['receiving', 'tdLengthBonus'], tierMode: 'perValue' },
  fumbles: { path: ['misc', 'fumblesLost'] },
  extraPoint: { path: ['kicking', 'extraPoint'] },
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
};

/** True iff `arr` is a well-formed tier list: finite min/points, max is a
 * finite number >= min or null ("and up"), sorted ascending by min, and
 * non-overlapping (each tier's min is past the previous tier's max). */
function isValidTierArray(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 20) return false;
  let prevMax = -Infinity;
  for (const tier of arr) {
    if (!tier || typeof tier !== 'object') return false;
    const { min, max, points } = tier;
    if (!Number.isFinite(Number(min)) || !Number.isFinite(Number(points))) return false;
    if (max !== null && !Number.isFinite(Number(max))) return false;
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

/** Sum a tier array's matching-bucket points for each raw magnitude in `values`. */
function scoreTieredValues(values, tiers) {
  let total = 0;
  for (const raw of Array.isArray(values) ? values : []) {
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    const tier = tiers.find((t) => n >= t.min && (t.max === null || n <= t.max));
    if (tier) total += tier.points;
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
      const tier = ruleValue.find((t) => n >= t.min && (t.max === null || n <= t.max));
      if (tier) score += tier.points;
    } else if (Number.isFinite(Number(ruleValue))) {
      score += n * Number(ruleValue);
    }
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
    extraPoint: num(kicking.xpMade),
    returnTDs: num(punting.puntReturnTD),
    puntReturns: num(punting.puntReturns),
    puntReturnYards: num(punting.puntReturnYds),
  };
}

/**
 * Map one Tank01 box-score playerStats entry's "Defense" category to our IDP
 * scoring keys (individual defenders — DP roster slots). Confirmed live
 * field names: totalTackles, soloTackles, sacks, defensiveInterceptions
 * (+ interceptionTDs), forcedFumbles, fumblesRecovered, passDeflections,
 * qbHits, tfl, twoPointConversionReturn, defTD. Sack/TFL/fumble-return
 * YARDAGE has no Tank01 field at all — those score 0 here and are filled in
 * later by nflverseSync.service.js's post-game finalization pass.
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
 * Fetch a week's real-world stats from Tank01: one getNFLGamesForWeek call,
 * then a box score per game (~16 calls) — every player in those games whose
 * external_id we know gets a player_stats upsert.
 *
 * Returns typed touchdown events (`plays`) detected by diffing each player's
 * prior stored stats against the fresh pull, decorated with the scoring
 * player's real NFL team and that week's opponent so the live UI can render a
 * team-accurate cutscene. Only genuine TD-stat increments produce a play, so a
 * re-sync or a stat correction never fabricates one.
 */
async function syncWeekStats({ season, week }) {
  const api = rapidApiClient();
  const gamesResponse = await api.get('/getNFLGamesForWeek', {
    params: { week, seasonType: 'reg', season },
  });
  const games = tank01Body(gamesResponse.data) || [];
  if (!Array.isArray(games) || games.length === 0) {
    return { season, week, playersUpdated: 0, gamesProcessed: 0, plays: [] };
  }

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

  let updated = 0;
  let gamesProcessed = 0;
  const plays = [];
  for (const game of games) {
    if (!game || !game.gameID) continue;
    try {
      const boxResponse = await api.get('/getNFLBoxScore', {
        params: { gameID: game.gameID, playByPlay: 'true', fantasyPoints: 'false' },
      });
      const box = tank01Body(boxResponse.data) || {};
      const playerStats = box.playerStats || {};
      const bonusByPlayer = extractPlayByPlayBonusStats(box.allPlayByPlay);
      gamesProcessed += 1;
      for (const entry of Object.values(playerStats)) {
        const playerId = idByExternal.get(String(entry && entry.playerID));
        if (!playerId) continue; // not in our pool
        const stats = {
          ...normalizeTank01Stats(entry),
          ...normalizeTank01IdpStats(entry),
          ...(bonusByPlayer.get(String(entry.playerID)) || {}),
        };
        const points = calculateFantasyPoints(stats);
        const prev = prevById.get(playerId);
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
        updated += 1;
      }

      // Team-defense scoring: Tank01's box score carries one aggregate DST
      // line per side (sacks/interceptions/fumble recoveries/defensive TDs
      // summed across every individual defender) rather than per-defender
      // stats we could roster — this is the only real source for a DEF
      // unit's fantasy points.
      const dst = box.DST || {};
      const teamStats = box.teamStats || {};
      for (const side of ['home', 'away']) {
        const dstSide = dst[side];
        const abbr = dstSide && dstSide.teamAbv ? String(dstSide.teamAbv).toUpperCase() : null;
        const defPlayer = abbr ? defByAbbr.get(abbr) : null;
        if (!defPlayer) continue; // no rostered DEF unit for this team in our pool
        const opponentSide = side === 'home' ? 'away' : 'home';
        const stats = normalizeTank01DstStats(dstSide, teamStats[opponentSide]);
        const points = calculateFantasyPoints(stats);
        const prev = prevById.get(defPlayer.id);
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
        updated += 1;
      }
    } catch (err) {
      console.error(`Stat sync failed for game ${game.gameID}:`, err.message);
    }
  }
  return { season, week, playersUpdated: updated, gamesProcessed, plays };
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
 * no current designation are cleared back to healthy.
 */
async function syncInjuries() {
  const api = rapidApiClient();
  const response = await api.get('/getNFLPlayerList');
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

  const playersResult = await pool.query(
    `SELECT "id", "external_id" FROM "players" WHERE "external_id" IS NOT NULL`
  );
  let updated = 0;
  for (const player of playersResult.rows) {
    const injury = injuryByExternal.get(String(player.external_id));
    if (!injury) continue; // not in the feed — leave untouched
    try {
      await pool.query(
        `UPDATE "players" SET "injury_status" = $1, "injury_detail" = $2 WHERE "id" = $3`,
        [injury.status, injury.detail, player.id]
      );
      updated += 1;
    } catch (err) {
      console.error(`Injury sync failed for player ${player.id}:`, err.message);
    }
  }
  return { playersUpdated: updated };
}

/**
 * Pure: one Tank01 game entry -> { home, away, kickoffAt } (team
 * abbreviations; null when the entry is missing anything load-bearing).
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
  const api = rapidApiClient();
  let upserted = 0;
  for (let week = 1; week <= 18; week++) {
    try {
      const response = await api.get('/getNFLGamesForWeek', {
        params: { week, seasonType: 'reg', season },
      });
      const games = tank01Body(response.data) || [];
      if (!Array.isArray(games)) continue;
      for (const entry of games) {
        const game = normalizeTank01Game(entry);
        if (!game) continue;
        for (const [team, opponent] of [[game.home, game.away], [game.away, game.home]]) {
          await pool.query(
            `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at")
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT ("season", "week", "nfl_team")
             DO UPDATE SET "opponent" = EXCLUDED."opponent", "kickoff_at" = EXCLUDED."kickoff_at"`,
            [season, week, team, opponent, game.kickoffAt]
          );
          upserted += 1;
        }
      }
    } catch (err) {
      console.error(`schedule sync failed for week ${week}:`, err.message);
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
  const api = rapidApiClient();
  const response = await api.get('/getNFLPlayerList');
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
      console.error(`player sync: upsert failed for external_id ${parsed.externalId}:`, err.message);
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
  const perGame = calculateFantasyPoints(lastCompleted.stats, rules) / games;
  if (!perGame) return null;
  return Math.round(perGame * 17 * 10) / 10;
}

function buildPlayerSummary({
  player,
  weeklyRows = [],
  seasonRows = [],
  rules = SCORING_RULES,
  byeWeek = null,
  currentSeasonYear = 2026,
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
      const points = calculateFantasyPoints(r.stats, rules);
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
 */
async function syncPlayerSeasonStats({ currentSeason } = {}) {
  let cutoff = Number(currentSeason);
  if (!Number.isInteger(cutoff)) {
    const r = await pool.query(`SELECT MAX("current_season") AS s FROM "leagues"`);
    cutoff = r.rows[0] && r.rows[0].s != null ? Number(r.rows[0].s) : 2026;
  }

  const weekly = await pool.query(
    `SELECT "player_id", "season", "stats" FROM "player_stats"
     WHERE "season" < $1
     ORDER BY "player_id", "season"`,
    [cutoff]
  );

  // Group weekly rows by player+season.
  const byKey = new Map();
  for (const row of weekly.rows) {
    const key = `${row.player_id}:${row.season}`;
    if (!byKey.has(key)) byKey.set(key, { playerId: row.player_id, season: row.season, rows: [] });
    byKey.get(key).rows.push(row.stats);
  }

  let upserted = 0;
  for (const { playerId, season, rows } of byKey.values()) {
    const { games, stats } = aggregateSeasonStats(rows);
    const points = calculateFantasyPoints(stats);
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
      console.error(`season-stat backfill failed for player ${playerId} season ${season}:`, err.message);
    }
  }
  return { cutoffSeason: cutoff, seasonsUpserted: upserted };
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
 * Score every matchup for a league week: each team's score is the sum of its
 * STARTERS' fantasy points for that week (bench and IR don't count), computed
 * from raw stats under the LEAGUE'S scoring rules. Lineups are materialized
 * first so teams that never touched theirs still get their carried-forward
 * (or default-bench) lineup. Transactional per league.
 *
 * Finality changes the semantics so re-scoring is idempotent (stat
 * corrections re-run this for settled weeks):
 * - Live weeks join against team_players, the CURRENT roster — a player
 *   dropped mid-week stops scoring immediately.
 * - Final weeks score straight from that week's lineup_entries, the
 *   historical record: a player traded or dropped SINCE then still counts,
 *   and the lineup is never re-materialized against today's roster.
 *
 * Best-ball leagues ignore the slots owners set: the score is the OPTIMAL
 * legal lineup over that week's players (same live/final population rules),
 * computed server-side every time — there is no lineup to manage.
 */
async function scoreMatchups({ leagueId, season, week, plays = [] }) {
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
      if (!isFinal) {
        await materializeLineup(client, { leagueId, teamId, season, week });
      }
      const currentRosterJoin = isFinal
        ? ''
        : `JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
           AND "team_players"."player_id" = "lineup_entries"."player_id"`;
      if (league.best_ball) {
        // Best ball: every rostered player counts as a candidate; the score
        // is the best legal lineup regardless of the slots stored.
        const r = await client.query(
          `SELECT "lineup_entries"."player_id", "players"."position", "player_stats"."stats"
           FROM "lineup_entries"
           ${currentRosterJoin}
           JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
           LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
             AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
           WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
             AND "lineup_entries"."week" = $3`,
          [teamId, season, week]
        );
        const candidates = r.rows.map((row) => ({ playerId: row.player_id, position: row.position }));
        const pointsFor = new Map(
          r.rows.map((row) => [row.player_id, calculateFantasyPoints(row.stats, rules)])
        );
        const { rosterSlots } = parseLineupSettings(league);
        return optimalLineup(candidates, rosterSlots, pointsFor).total;
      }
      const r = await client.query(
        `SELECT "player_stats"."stats"
         FROM "lineup_entries"
         ${currentRosterJoin}
         JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
           AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
         WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
           AND "lineup_entries"."week" = $3
           AND "lineup_entries"."slot" NOT IN ('BENCH', 'IR')`,
        [teamId, season, week]
      );
      const total = r.rows.reduce((sum, row) => sum + calculateFantasyPoints(row.stats, rules), 0);
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
  normalizeTank01Game,
  normalizeInjuryStatus,
  normalizePlayerEntry,
  resolveHeadshotUrl,
  aggregateSeasonStats,
  buildPlayerSummary,
  projectSeasonPoints,
  detectScoringEvents,
  syncWeekStats,
  syncSchedule,
  syncInjuries,
  syncPlayers,
  syncPlayerSeasonStats,
  generateMatchups,
  scoreMatchups,
};
