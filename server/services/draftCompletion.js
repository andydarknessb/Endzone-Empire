// season.service and waiver.service are required as module objects so their
// seams stay mockable from the caller suites (pick.service.test mocks
// generateRegularSeason); neither requires back into the draft path, so these
// top-level requires close no cycle (#789 ruling 5). draft.service supplies
// DraftError (ADR 0008) and never requires this module back.
const seasonService = require('./season.service');
const waiverService = require('./waiver.service');
const lineupService = require('./lineup.service');
const { openingWeek } = require('./openingWeek.service');
const { appendLifecycleActivity, COMPLETE } = require('./draftActivity');
const { DraftError } = require('./draftError');

/**
 * Draft completion: the one write that hands a finished Draft over to Season
 * operations (#789). Assembled from fragments on two paths across three modules
 * before this, it now runs in one place on the caller's transaction.
 *
 * The Pick clock keeps the status flip (ADR 0018): `onSlotTaken` (the final
 * live Pick, and an all-keeper start) sets
 * `draft_status = 'complete'` and clear the deadline in their atomic statements
 * BEFORE calling here. completeDraft verifies that flip first and refuses with a
 * DraftError(500) if it is missing - the enforcement that replaced the warning
 * comment in season.service (#789 ruling 2). First, it writes the League's Opening
 * week (ADR 0071): current_season and current_week, so the steps below read the
 * opened week. Then, in order (#789 ruling 1): it
 * opens the post-draft blanket waiver window (one spelling, in the waiver
 * module), seeds every team's waiver priority from reverse draft order (the
 * order the blanket window's claims resolve in; without it the season starts
 * with NULL priorities), generates the regular-season schedule (the #194 phase
 * gate passes because the flip is already visible on this client), seeds every
 * team's current-week lineup from its full post-draft roster (#1569 -
 * `benchAcquiredPlayer`'s first-ever seed upstream only ever saw the team's
 * roster as it stood on their FIRST pick, over-and-over leaving every later
 * pick benched all season; this seed overwrites those per-pick rows with a
 * legal lineup over the finished roster, `lineupService.seedDraftedLineups`,
 * a no-op for a best-ball league), and appends the COMPLETE lifecycle entry.
 *
 * Returns the completion entry so both callers can broadcast it after COMMIT, as
 * they do today.
 */
async function completeDraft(client, { leagueId }) {
  const statusResult = await client.query(
    `SELECT "id", "draft_status", "current_season", "current_week", "best_ball", "roster_slots", "regular_season_weeks"
     FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  const league = statusResult.rows[0];
  if (!league || league.draft_status !== 'complete') {
    throw new DraftError(
      500,
      `completeDraft requires draft_status = 'complete' on league ${leagueId} ` +
        `(the caller's clock flips it first); saw ${league ? `'${league.draft_status}'` : 'no league row'}`
    );
  }

  // Opening week (ADR 0071): the League's season and week are written here, so the
  // schedule and the lineup seed below read the opened week, never the stale row.
  const opening = await openingWeek(client, { regularSeasonWeeks: league.regular_season_weeks });
  await client.query(
    `UPDATE "leagues" SET "current_season" = $1, "current_week" = $2, "updated_at" = now() WHERE "id" = $3`,
    [opening.season, opening.week, leagueId]
  );

  await waiverService.openPostDraftWaiverWindow(client, { leagueId });
  await waiverService.seedWaiverPriorityFromDraftOrder(client, { leagueId });
  await seasonService.generateRegularSeason({ leagueId }, client);
  await lineupService.seedDraftedLineups(client, {
    league: { ...league, current_season: opening.season, current_week: opening.week },
  });
  return appendLifecycleActivity(client, { leagueId, kind: COMPLETE, team: null });
}

module.exports = { completeDraft };
