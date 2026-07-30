'use strict';

/**
 * The `buildPriorGames` full-snapshot fail gate.
 *
 * WHAT IT PROVES, AND WHY THE STUDY NEEDS IT.
 *
 * `buildPriorGames` resolves each historical stat line to an opponent and an
 * orientation, and WHICH TEAM a line belongs to is the hard part. Production
 * resolves a current-season row through the player's CURRENT team
 * (`projectionFeatures.js:210`). For a traded player that is wrong for half the
 * season: his September games belong to his old team's schedule. The
 * reconstruction knows better, because the roster file gives the per-week team.
 *
 * So there are two resolutions available - RETAINED (production's: today's
 * team) and CORRECTED (the reconstruction's: that week's team) - and the study
 * has to know whether choosing between them can change a published number. This
 * gate answers that for EVERY evaluated player-week, not a sample:
 *
 *   1. **The points series must be identical.** `points` is
 *      `calculateFantasyPoints(row.stats, rules)`, which does not depend on team
 *      at all, so the two resolutions can only differ in `opponent` and
 *      `isHome`. Comparing the series anyway is cheap and catches the thing
 *      that would actually be catastrophic: the two paths seeing DIFFERENT ROW
 *      SETS. That would mean the reconstruction changed which games exist, not
 *      merely who they were against.
 *
 *   2. **`versusOpponent` must never activate.** This is the real check.
 *      `opponent` feeds exactly one factor, and at the shipped constants that
 *      factor needs two meetings with the same opponent inside one season
 *      (`minMeetings = 2`, `crossSeason = false`). A traded player CAN reach
 *      two - plan rev 11 verified it. If the factor stays inactive for every
 *      evaluated player-week, then the opponent field is never read, the
 *      retained-versus-corrected difference is unobservable, and the
 *      reconstruction is provably safe on this axis. If it activates even once,
 *      the difference is live and the run FAILS.
 *
 * **A failure here is a HALT, not a fallback.** The preregistered remedy is a
 * real resolution seam, and that is a PLAN AMENDMENT for a human to make - not
 * something this code may quietly apply. So the gate throws and says so.
 *
 * Pure: the three production functions it exercises are injected, because
 * nothing in `scripts/backtest` may require `server/services`. The sweep runner
 * passes the real ones; tests pass fakes and the real ones both.
 */

/** Pure: a comparable fingerprint of one prior-games series. */
function pointsSeries(games) {
  return (games || []).map((g) => ({
    season: Number(g.season),
    week: Number(g.week),
    points: g.points,
  }));
}

function seriesKey(series) {
  return series.map((g) => `${g.season}:${g.week}:${g.points}`).join('|');
}

/**
 * Check one evaluated player-week.
 *
 * `retainedTeam` is the team production would resolve through (today's
 * `players.nfl_team`); `correctedTeam` is the reconstruction's per-week team.
 * Both series are built from the SAME stat rows, so any difference in the
 * points series is a defect rather than a finding.
 */
function checkPlayerWeek({
  playerId,
  season,
  week,
  statRows,
  rules,
  opponentByTeamWeek,
  retainedTeam,
  correctedTeam,
  targetOpponent,
  constants,
  buildPriorGames,
  buildVersusOpponentMeetings,
  versusOpponentEffect,
}) {
  const common = { statRows, rules, season, week, opponentByTeamWeek, constants };
  const retained = buildPriorGames({ ...common, playerTeam: retainedTeam });
  const corrected = buildPriorGames({ ...common, playerTeam: correctedTeam });

  const retainedSeries = pointsSeries(retained);
  const correctedSeries = pointsSeries(corrected);
  const identical = seriesKey(retainedSeries) === seriesKey(correctedSeries);

  // The factor is checked on BOTH resolutions: it must be inactive whichever
  // team the opponent was resolved through, or the choice is observable.
  const activations = [];
  for (const [label, games, team] of [
    ['retained', retained, retainedTeam], ['corrected', corrected, correctedTeam],
  ]) {
    const meetings = buildVersusOpponentMeetings({
      priorGames: games, opponent: targetOpponent, season, constants,
    });
    const effect = versusOpponentEffect({
      meetings, constants: constants && constants.versusOpponent,
    });
    if (effect && effect.available === true) {
      activations.push({ resolution: label, team, meetings: effect.meetings, effect: effect.effect });
    }
  }

  return {
    playerId,
    season,
    week,
    identicalPoints: identical,
    retainedSeries,
    correctedSeries,
    traded: retainedTeam !== correctedTeam,
    activations,
  };
}

/**
 * Run the gate over every evaluated player-week and HALT on any violation.
 *
 * Returns a summary when it passes, so the published report can state how many
 * player-weeks were checked and how many of them involved a traded player -
 * "the gate passed" is only meaningful alongside how much it looked at.
 */
function assertPriorGamesGate({
  playerWeeks,
  rules,
  constants,
  buildPriorGames,
  buildVersusOpponentMeetings,
  versusOpponentEffect,
  label = 'buildPriorGames gate',
}) {
  for (const [name, fn] of [
    ['buildPriorGames', buildPriorGames],
    ['buildVersusOpponentMeetings', buildVersusOpponentMeetings],
    ['versusOpponentEffect', versusOpponentEffect],
  ]) {
    if (typeof fn !== 'function') {
      throw new Error(`${label} requires the production ${name} to be injected`);
    }
  }
  if (!Array.isArray(playerWeeks) || playerWeeks.length === 0) {
    // An empty sweep is not a passing sweep. A gate that reports success over
    // nothing is worse than no gate: it produces a green line in the report.
    throw new Error(
      `${label}: no player-weeks to check. The gate covers EVERY evaluated player-week, so an ` +
      'empty set means the caller has not built the cohort yet, not that the check passed.'
    );
  }

  const mismatched = [];
  const activated = [];
  let traded = 0;

  for (const playerWeek of playerWeeks) {
    const result = checkPlayerWeek({
      ...playerWeek,
      rules,
      constants,
      buildPriorGames,
      buildVersusOpponentMeetings,
      versusOpponentEffect,
    });
    if (result.traded) traded++;
    if (!result.identicalPoints) mismatched.push(result);
    if (result.activations.length > 0) activated.push(result);
  }

  if (mismatched.length > 0) {
    const first = mismatched[0];
    throw new Error(
      `${label} FAILED: ${mismatched.length} player-week(s) produce a different points series under ` +
      `the corrected team resolution than under the retained one (first: player ${first.playerId}, ` +
      `${first.season} week ${first.week}, ${first.retainedSeries.length} vs ` +
      `${first.correctedSeries.length} games). Points do not depend on team, so the two paths are ` +
      'seeing different ROWS - the reconstruction has changed which games exist.'
    );
  }

  if (activated.length > 0) {
    const first = activated[0];
    throw new Error(
      `${label} FAILED: versusOpponent ACTIVATED for ${activated.length} player-week(s) (first: ` +
      `player ${first.playerId}, ${first.season} week ${first.week}, ` +
      `${first.activations[0].meetings} meetings under the ${first.activations[0].resolution} ` +
      'resolution). The gate exists because that factor is the only consumer of the opponent field: ' +
      'while it stays inactive, retained-versus-corrected team resolution cannot change a number, ' +
      'and once it activates it can. The preregistered remedy is a real resolution seam, which is a ' +
      'PLAN AMENDMENT for a human to make - this run halts rather than choosing one.'
    );
  }

  return {
    status: 'passed',
    playerWeeksChecked: playerWeeks.length,
    tradedPlayerWeeks: traded,
    detail: 'corrected and retained team resolution agree on points, and versusOpponent never activated',
  };
}

module.exports = {
  pointsSeries,
  seriesKey,
  checkPlayerWeek,
  assertPriorGamesGate,
};
