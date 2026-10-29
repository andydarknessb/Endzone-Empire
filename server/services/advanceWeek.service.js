const pool = require('../modules/pool');
const season = require('./season.service');
const settleFollowUpSvc = require('./settleFollowUp.service');
const { seasonOperationsAvailable, SEASON_BEFORE_DRAFT_MESSAGE } = require('./leaguePhase');

/**
 * Advance week, in its one order (ADR 0054): settle and finalize the week in
 * one transaction, announce and seed after its commit, then start the Settle
 * follow-up.
 *
 * Returns `{ scored, advance, followUp }`. `followUp` is the follow-up's promise,
 * never awaited here: it is display data, never worth failing (or delaying) the
 * week advance over. A rejection is logged with league and week and goes no
 * further. There is no retry table: the next Advance re-judges pending Called
 * shots (`judgeCalledShots` selects `week <= N`).
 *
 * `expectedWeek` is the week the commissioner saw when confirming; a league that
 * has moved on since is refused 409 before scoring (absent: old bundles, no check).
 *
 * Throws a SeasonError (409) for a league whose draft is not finished, before
 * the transaction opens (#194); finalizeWeekAndAdvance refuses it again under
 * the League lock, before any scoring.
 */
async function advanceWeek({ leagueId, expectedWeek }) {
  const leagueResult = await pool.query(
    `SELECT "current_season", "current_week", "pickem_only", "draft_status", "season_status"
     FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  if (!seasonOperationsAvailable(leagueResult.rows[0])) {
    throw new season.SeasonError(409, SEASON_BEFORE_DRAFT_MESSAGE);
  }
  const { current_season, current_week } = leagueResult.rows[0];
  if (expectedWeek != null && Number(expectedWeek) !== Number(current_week)) {
    throw new season.SeasonError(409, `week ${expectedWeek} was already advanced`);
  }
  // The score of record, so SETTLE semantics rather than the live path (#190):
  // the week as played, with no re-materialization and no join to whatever the
  // roster looks like now. Settled inside finalize's own transaction, under the
  // League lock, so a live re-score can never become the score of record (spec
  // #2602); it still scores BEFORE the final flag, since the playoff bracket is
  // seeded from computeStandings over these very scores.
  // week: a double click, retry or stale confirm is refused 409 under the lock, before any scoring.
  const { scored, ...advance } = await season.finalizeWeekAndAdvance({
    leagueId,
    week: expectedWeek ?? current_week,
    settle: true,
  });
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
