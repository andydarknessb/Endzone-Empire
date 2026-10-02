/**
 * The one writer of `player_stats`, and the one place that decides what a Stat
 * line becomes (#1760, spec #1758). Every feed path (Live box, Final box,
 * nflverse week apply, nflverse snaps, nflverse correction) lands here, so:
 *
 *  - `storedStatLine({ source, fresh, prior })` is the pure policy. One
 *    ownership table over four sources says which stat keys each owns, whether
 *    it replaces the line or patches it, and whether it may create one.
 *  - `upsertPlayerStats` runs that policy and stores the result. The stored
 *    `fantasy_points` is always the default-rules score of the stored `stats`:
 *    the funnel computes it and never accepts one from the caller. A row whose
 *    points disagree with its stats can therefore only reach the table from
 *    outside the application, which is what playerStatsIntegrity.service scans
 *    for.
 *
 * Sources:
 *  - `box`                 replace, may create. The Live box and the Final box.
 *  - `nflverse-correction` replace, may create. The Tue/Wed pass and the backfill.
 *  - `nflverse-week`       patch, creates only from a non-zero per-defender
 *                          yardage value. The finalization patch and the
 *                          current-week pass.
 *  - `nflverse-snaps`      patch, never creates.
 *
 * A replace-kind source is authoritative for the keys it owns (an owned key the
 * fresh line does not carry is removed) and carries every key it does not own
 * from the prior line. A patch-kind source writes its owned keys onto the prior
 * line and leaves the rest alone. Fresh keys a source does not own are ignored;
 * the cross-check tests (server/test/statKeyOwnership.test.js) fail when a
 * builder emits one, so a new key has to be added here on purpose.
 *
 * The key lists are hand-kept and this module stays a leaf, requiring only the
 * scoring rules: it cannot import the builders (nflverseSync requires the box
 * apply, which requires this), so the tests read the builders instead.
 *
 * `db` is a pool or a checked-out transaction client (ADR 0033); the funnel
 * issues at most one statement and owns no transaction of its own.
 */

// Per-player keys the Live box and the Final box produce (tank01BoxSource and
// espnBoxSource, zeros included) and the team-defense aggregate keys. The last
// two are ESPN-only (its return-yardage columns); the Tank01 box has no field
// for them. kickReturnYards is removed by a box that lacks it (the old carry
// list never held it); idpInterceptionReturnYards is on BOX_KEEP_IF_ABSENT.
const BOX_PLAYER_KEYS = [
  'passingYards', 'passingTDs', 'interceptions', 'rushingYards', 'rushingTDs',
  'receivingYards', 'receivingTDs', 'receptions', 'fumbles', 'fieldGoal', 'fieldGoalMissed',
  'extraPoint', 'extraPointMissed', 'returnTDs', 'puntReturns', 'puntReturnYards',
  'soloTackle', 'assistedTackle', 'idpSack', 'idpInterception', 'forcedFumble', 'idpFumbleRecovery',
  'passDeflection', 'qbHit', 'tacklesForLoss', 'idpDefensiveTD', 'twoPointReturn',
  'fieldGoalDistances', 'passingTDLengths', 'rushingTDLengths', 'receivingTDLengths',
  'kickReturnYards', 'idpInterceptionReturnYards',
];
// Owned by the box (ESPN writes it) but also patched by nflverse's finalization
// pass, and the old carry list kept it: a box line without it (any Tank01 box)
// leaves the stored value alone instead of removing it.
const BOX_KEEP_IF_ABSENT = ['idpInterceptionReturnYards'];
const BOX_TEAM_DEFENSE_KEYS = [
  'sack', 'interceptionReturn', 'fumbleRecovery', 'defensiveTD', 'safety', 'blockedKick',
  'pointsAllowed', 'yardsAllowed',
];

// The snap keys nflverse's snap_counts feed writes.
const SNAP_KEYS = [
  'usageOffenseSnaps', 'usageOffenseSnapPct', 'usageDefenseSnaps', 'usageDefenseSnapPct',
];

// The per-defender figures the finalization patch adds (yardage, and the safety
// count that rides with it; only these can create a line) and the share/EPA
// columns from the same combined weekly file (#1706).
const WEEK_YARDAGE_KEYS = [
  'idpSackYards', 'idpTacklesForLossYards', 'idpFumbleReturnYards', 'idpInterceptionReturnYards',
  'idpSafety',
];
const WEEK_SHARE_EPA_KEYS = [
  'usageTargetShare', 'usageAirYardsShare', 'usageWopr', 'epaPassing', 'epaRushing', 'epaReceiving',
];
// Who the line was earned for and against (nflverse spelling). The finalization
// pass owns them too, so a box-written line is self-describing the night
// nflverse has it rather than only once the Tue/Wed correction runs.
const WEEK_TEAM_KEYS = ['gameTeam', 'gameOpponent'];
const WEEK_KEYS = [...WEEK_YARDAGE_KEYS, ...WEEK_SHARE_EPA_KEYS, ...WEEK_TEAM_KEYS];

// Everything the wholesale nflverse rewrite emits (normalizeNflversePlayerStats
// and buildDstStatUpdates). Not the TD-length lists (play-by-play only) and not
// the snap keys (their own feed): a correction carries those from the prior line.
const CORRECTION_KEYS = [
  'gameTeam', 'gameOpponent',
  'usagePassAttempts', 'usageCompletions', 'usageCarries', 'usageTargets', 'usageAirYards',
  'passingYards', 'passingTDs', 'interceptions', 'passingTwoPt',
  'rushingYards', 'rushingTDs', 'rushingTwoPt',
  'receivingYards', 'receivingTDs', 'receptions', 'receivingTwoPt',
  'fumbles', 'fieldGoal', 'fieldGoalMissed', 'fieldGoalDistances', 'extraPoint', 'extraPointMissed',
  'returnTDs', 'puntReturns', 'puntReturnYards', 'kickReturns', 'kickReturnYards',
  'soloTackle', 'assistedTackle', 'idpSack', 'idpInterception', 'forcedFumble', 'idpFumbleRecovery',
  'passDeflection', 'qbHit', 'tacklesForLoss', 'idpDefensiveTD', 'twoPointReturn',
  'idpSackYards', 'idpTacklesForLossYards', 'idpFumbleReturnYards', 'idpInterceptionReturnYards', 'idpSafety',
  ...WEEK_SHARE_EPA_KEYS,
  ...BOX_TEAM_DEFENSE_KEYS,
];

const unique = (list) => [...new Set(list)];

/**
 * The ownership table. `kind` is how the source writes (`replace` or `patch`),
 * `keys` what it owns, `creates` when it may write a line with no prior:
 * `always`, `never`, or `yardage` (only when one of `createFrom` is non-zero,
 * writing just the owned keys not in `stripOnCreate`).
 */
const STAT_KEY_OWNERSHIP = {
  box: {
    kind: 'replace',
    keys: unique([...BOX_PLAYER_KEYS, ...BOX_TEAM_DEFENSE_KEYS]),
    creates: 'always',
    keepIfAbsent: BOX_KEEP_IF_ABSENT,
  },
  'nflverse-correction': { kind: 'replace', keys: unique(CORRECTION_KEYS), creates: 'always' },
  'nflverse-week': {
    kind: 'patch',
    keys: WEEK_KEYS,
    creates: 'yardage',
    createFrom: WEEK_YARDAGE_KEYS,
    stripOnCreate: WEEK_SHARE_EPA_KEYS,
  },
  'nflverse-snaps': { kind: 'patch', keys: SNAP_KEYS, creates: 'never' },
};

/** The fresh line's owned keys that carry a value (undefined counts as absent). */
function pickOwned(fresh, keys) {
  const out = {};
  for (const key of keys) {
    if (fresh && fresh[key] !== undefined) out[key] = fresh[key];
  }
  return out;
}

/**
 * Pure: what `source`'s `fresh` line makes of the Stat line, given the `prior`
 * stored line (null/undefined when no row exists). Returns `{ stats }`, or null
 * when the source writes nothing (a patch that may not create, with no prior).
 * Neither input is mutated.
 */
function storedStatLine({ source, fresh, prior }) {
  const rule = Object.prototype.hasOwnProperty.call(STAT_KEY_OWNERSHIP, source) ? STAT_KEY_OWNERSHIP[source] : null;
  if (!rule) throw new Error(`storedStatLine: unknown stat line source ${JSON.stringify(source)}`);
  const hasPrior = prior !== null && prior !== undefined;

  if (rule.kind === 'replace') {
    const owned = new Set(rule.keys);
    const carried = {};
    if (hasPrior) {
      for (const [key, value] of Object.entries(prior)) {
        if (!owned.has(key)) carried[key] = value;
      }
    }
    // Fresh keys first, carried keys after: the same key order the stored line
    // has always had (the carried and owned sets never overlap).
    const stats = { ...pickOwned(fresh, rule.keys), ...carried };
    // Owned keys the source may leave out without removing them (keepIfAbsent).
    for (const key of rule.keepIfAbsent || []) {
      if (stats[key] === undefined && hasPrior && prior[key] !== undefined) stats[key] = prior[key];
    }
    return { stats };
  }

  // patch
  if (hasPrior) return { stats: { ...prior, ...pickOwned(fresh, rule.keys) } };
  if (rule.creates === 'never') return null;
  if (rule.creates === 'always') return { stats: pickOwned(fresh, rule.keys) };
  const canCreate = rule.createFrom.some((key) => fresh && typeof fresh[key] === 'number' && fresh[key] !== 0);
  if (!canCreate) return null;
  const strip = new Set(rule.stripOnCreate);
  return { stats: pickOwned(fresh, rule.keys.filter((key) => !strip.has(key))) };
}

/**
 * Write one Player-week's Stat line as `source` sees it. Resolves to
 * `{ stats, fantasyPoints }` (the stored line and its default-rules score), or
 * null, with no statement issued, when the policy writes nothing.
 */
async function upsertPlayerStats(db, { playerId, season, week, source, fresh, prior }) {
  const stored = storedStatLine({ source, fresh, prior });
  if (stored === null) return null;
  const { stats } = stored;
  // Lazy: scoring.service is the caller of this module on the Live/Final box
  // path, so a load-time require would be a cycle.
  const { calculateFantasyPoints } = require('./scoringRules');
  const fantasyPoints = calculateFantasyPoints(stats);
  await db.query(
    `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("player_id", "season", "week")
     DO UPDATE SET "stats" = EXCLUDED."stats", "fantasy_points" = EXCLUDED."fantasy_points"`,
    [playerId, season, week, JSON.stringify(stats), fantasyPoints]
  );
  return { stats, fantasyPoints };
}

module.exports = { upsertPlayerStats, storedStatLine, STAT_KEY_OWNERSHIP };
