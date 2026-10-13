/**
 * Tank01's box-score vocabulary -> our flat scoring stat keys.
 *
 * Moved here from scoring.service.js by the Box source seam (#1183, ADR 0035)
 * so the Tank01 adapter (tank01BoxSource.js) can require them without a cycle
 * through scoring.service. scoring.service re-exports every function so the
 * existing importers (publicRead.service, nflverseSync.service, the tests)
 * keep their import path. Behaviour is unchanged; the golden in
 * test/boxSource.tank01.test.js pins it.
 */
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
  // The box carries a returner's own lines in two groups: punt returns under
  // "Punting" (alongside a punter's punting line) and kickoff returns under
  // "Kicking" (alongside a kicker's fgMade etc.). Read each by key, never by
  // the presence of the group.
  const punting = e.Punting || {};
  // Two-point conversions ride each category object as string counts (#2244:
  // Allen Passing and Kincaid Receiving in BUF@LAR, Henry Rushing in BAL@ATL),
  // but Tank01 OMITS the field for a player with none. They are emitted only
  // when present, so an absent field leaves the key out and the box write
  // keeps a stored count (playerStatsWrite BOX_KEEP_IF_ABSENT): the ESPN Live
  // box emits none, and a historical --source tank01 backfill must not zero
  // the nflverse counts. A present "0" is a real zero and still emits.
  const twoPt = {};
  for (const [key, value] of [
    ['passingTwoPt', passing.passingTwoPointConversion],
    ['rushingTwoPt', rushing.rushingTwoPointConversion],
    ['receivingTwoPt', receiving.receivingTwoPointConversion],
  ]) {
    if (String(value ?? '').trim() !== '') twoPt[key] = num(value);
  }
  return {
    ...twoPt,
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
    returnTDs: num(punting.puntReturnTD) + num(kicking.kickReturnTD),
    puntReturns: num(punting.puntReturns),
    puntReturnYards: num(punting.puntReturnYds),
    // Kickoff returns come from Kicking.kickReturnYds (#2200); the count
    // (kickReturns) scores nothing, so it is not emitted.
    kickReturnYards: num(kicking.kickReturnYds),
  };
}

/**
 * Map one Tank01 box-score playerStats entry's "Defense" category to our IDP
 * scoring keys (individual defenders — DP roster slots). Confirmed live
 * field names: totalTackles, soloTackles, sacks, defensiveInterceptions
 * (+ interceptionTDs), forcedFumbles, fumblesRecovered, passDeflections,
 * qbHits, tfl, twoPointConversionReturn, defTD. `fumblesRecovered` is NOT
 * mapped: it counts a player falling on his own team's fumble too (Drake Maye,
 * 2026 week 4: 2 own, 0 opponent), so idpFumbleRecovery comes from the ESPN
 * Live box and nflverse, and the box write keeps it when this line lacks it
 * (#2002). The team DST side's fumblesRecovered is opponent-only and stays.
 * Sack/TFL/fumble-return/
 * INT-return YARDAGE has no Tank01 field at all — those score 0 here and are
 * filled in later by nflverseSync.service.js's post-game finalization pass.
 * `defTD` is scored whole as the generic defensiveTD bucket (fumble-,
 * blocked-kick-, or interception-return TD — Tank01 doesn't separate those,
 * and individual blocked-kick attribution isn't scored at all): an
 * interception-return touchdown counts as both `idpInterception` and
 * `idpDefensiveTD`, the same convention the team DEF row already uses for
 * the same play (ruling, issue #1386 — CONTEXT.md **IDP**).
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
    passDeflection: num(d.passDeflections),
    qbHit: num(d.qbHits),
    tacklesForLoss: num(d.tfl),
    idpDefensiveTD: num(d.defTD),
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
 * `ownTeamStats` is this side's OWN `box.teamStats[side]` entry, confirmed
 * live on 4 real games (#2244), `blockedFG`/`blockedXP`/`blockedPunt` count
 * the blocks that team MADE, not its kicks that got blocked, so credit for a
 * block belongs to the defense whose line carries it.
 *
 * `opponentScore` is the OPPOSING side's points on the board (the caller
 * sums it from the box's `lineScore`, since Tank01's `/getNFLBoxScore` has
 * no top-level score field — tank01BoxSource.sideScore) and is what
 * `pointsAllowed` is built from when it's available: Tank01's own
 * `ptsAllowed` field is the opponent's score minus 6 per opposing
 * non-offensive TD (still counting the PAT), which drifts from the
 * full-scoreboard convention (**Points allowed**, CONTEXT.md) that the ESPN
 * and nflverse writers already produce (#1384).
 *
 * `opponentScore` is `null`/`undefined` when the box carries no `lineScore`
 * for that side at all (sideScore's "absent" signal, distinct from a real
 * 0) — `pointsAllowed` then falls back to `d.ptsAllowed` rather than
 * reading a shutout that isn't real. A present `opponentScore`, including a
 * real 0, always wins over `ptsAllowed`.
 *
 * `pointsAllowed` and `yardsAllowed` are omitted from the result (not set to
 * `null`) when their figure is absent: `d.ptsAllowed`/`d.ydsAllowed` missing,
 * null, empty or non-numeric, with no `opponentScore` to use instead for
 * `pointsAllowed`. calculateFantasyPoints (scoringRules.js) skips a key
 * that's not there, so an absent figure scores no tier rather than the
 * best (0-yard/0-point) one `num`'s 0-default would otherwise produce
 * (#1549). A present figure, including a real 0, is kept and scores
 * normally; the key is omitted rather than nulled because `Number(null)`
 * is 0 and would score the best tier again.
 */
function normalizeTank01DstStats(dstSide, ownTeamStats, opponentScore) {
  const num = (value) => {
    const parsed = Number(String(value ?? '').replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  /**
   * Like `num`, but returns undefined (never 0) for an absent/non-numeric
   * figure instead of defaulting it, so the caller can omit the key. Member
   * of the "number-or-absent" family this ticket (#1555) named and fixed:
   * the emptiness test trims before checking, the same rule
   * `server/services/numericPresence.js`'s `isPresentNumber` enforces, so a
   * whitespace-only `ydsAllowed`/`ptsAllowed` (which also comma-strips and
   * `Number()`-coerces to `0`) is treated as absent rather than a real 0.
   */
  const numOrAbsent = (value) => {
    if (value === null || value === undefined || typeof value === 'boolean') return undefined;
    if (String(value).trim() === '') return undefined;
    const parsed = Number(String(value).replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const d = dstSide || {};
  const own = ownTeamStats || {};
  const stats = {
    sack: num(d.sacks),
    interceptionReturn: num(d.defensiveInterceptions),
    fumbleRecovery: num(d.fumblesRecovered),
    defensiveTD: num(d.defTD),
    safety: num(d.safeties),
    blockedKick: num(own.blockedFG) + num(own.blockedXP) + num(own.blockedPunt),
  };
  const pointsAllowed = opponentScore != null ? num(opponentScore) : numOrAbsent(d.ptsAllowed);
  if (pointsAllowed !== undefined) stats.pointsAllowed = pointsAllowed;
  const yardsAllowed = numOrAbsent(d.ydsAllowed);
  if (yardsAllowed !== undefined) stats.yardsAllowed = yardsAllowed;
  return stats;
}

module.exports = {
  normalizeTank01Stats,
  normalizeTank01IdpStats,
  extractPlayByPlayBonusStats,
  normalizeTank01DstStats,
};
