// season.service and waiver.service are required as module objects so their
// seams stay mockable from the caller suites (pick.service.test mocks
// generateRegularSeason); neither requires back into the draft path, so these
// top-level requires close no cycle (#789 ruling 5). draft.service supplies
// DraftError (ADR 0008) and never requires this module back.
const seasonService = require('./season.service');
const waiverService = require('./waiver.service');
const { appendLifecycleActivity, COMPLETE } = require('./draftActivity');
const { DraftError } = require('./draft.service');

/**
 * Draft completion: the one write that hands a finished Draft over to Season
 * operations (#789). Assembled from fragments on two paths across three modules
 * before this, it now runs in one place on the caller's transaction.
 *
 * The Pick clock keeps the status flip (ADR 0018): `onPickLanded` (the final
 * live Pick) and `onDraftStarted` (an all-keeper start) set
 * `draft_status = 'complete'` and clear the deadline in their atomic statements
 * BEFORE calling here. completeDraft verifies that flip first and refuses with a
 * DraftError(500) if it is missing - the enforcement that replaced the warning
 * comment in season.service (#789 ruling 2). Then, in order (#789 ruling 1): it
 * opens the post-draft blanket waiver window (one spelling, in the waiver
 * module), generates the regular-season schedule (the #194 phase gate passes
 * because the flip is already visible on this client), and appends the COMPLETE
 * lifecycle entry.
 *
 * Returns the completion entry so both callers can broadcast it after COMMIT, as
 * they do today.
 */
async function completeDraft(client, { leagueId }) {
  const statusResult = await client.query(
    `SELECT "draft_status" FROM "leagues" WHERE "id" = $1`,
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

  await waiverService.openPostDraftWaiverWindow(client, { leagueId });
  await seasonService.generateRegularSeason({ leagueId }, client);
  return appendLifecycleActivity(client, { leagueId, kind: COMPLETE, team: null });
}

module.exports = { completeDraft };
