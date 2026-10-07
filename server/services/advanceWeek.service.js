const pool = require('../modules/pool');
const matchupScoring = require('./matchupScoring.service');
const season = require('./season.service');
const settleFollowUpSvc = require('./settleFollowUp.service');
const { seasonOperationsAvailable, SEASON_BEFORE_DRAFT_MESSAGE } = require('./leaguePhase');

/**
 * Advance week, in its one order (ADR 0054): score the week, then finalize and
 * advance, then start the Settle follow-up.
 *
 * Returns `{ scored, advance, followUp }`. `followUp` is the follow-up's promise,
 * never awaited here: it is display data, never worth failing (or delaying) the
 * week advance over. A rejection is logged with league and week and goes no
 * further. There is no retry table: the next Advance re-judges pending Called
 * shots (`judgeCalledShots` selects `week <= N`).
 *
 * Throws a SeasonError (409) for a league whose draft is not finished, BEFORE
 * the week is scored (#194): finalizeWeekAndAdvance refuses too, but it runs
 * second, so a gate only there would answer 409 with a full week of scores
 * already written.
 */
async function advanceWeek({ leagueId }) {
  const leagueResult = await pool.query(
    `SELECT "current_season", "current_week", "pickem_only", "draft_status", "season_status"
     FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  if (!seasonOperationsAvailable(leagueResult.rows[0])) {
    throw new season.SeasonError(409, SEASON_BEFORE_DRAFT_MESSAGE);
  }
  const { current_season, current_week } = leagueResult.rows[0];
  // The score of record, so SETTLE semantics rather than the live path (#190):
  // the week as played, with no re-materialization and no join to whatever the
  // roster looks like now. Pinned to the (season, week) read above, never to
  // current_week afterwards - finalizeWeekAndAdvance moves it. Score still
  // comes BEFORE finalize: finalize seeds the playoff bracket from
  // computeStandings over these very scores.
  const { scored } = await matchupScoring.scoreMatchups({
    leagueId,
    season: current_season,
    week: current_week,
    settle: true,
  });
  const advance = await season.finalizeWeekAndAdvance({ leagueId });
  const followUp = settleFollowUpSvc.settleFollowUp({
    leagueId,
    season: current_season,
    week: current_week, // the week just finalized
    mode: 'advance',
    // The one decider of season completion: the Advance that completes the
    // season defers no Called shot (nothing later will judge it). Only true is
    // sent; absent means false all the way down to judgeCalledShots.
    ...(advance.seasonStatus === 'complete' && { seasonComplete: true }),
  }).catch((err) => {
    console.error('settle follow-up failed for league %s week %s:', leagueId, current_week, err.message);
  });
  return { scored, advance, followUp };
}

module.exports = { advanceWeek };
