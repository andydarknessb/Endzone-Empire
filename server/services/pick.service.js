const pool = require('../modules/pool');
const { teamForPick, nextOpenPickNumber } = require('./draftOrder.service');
// Module object, not destructured: the seam tests mock benchAcquiredPlayer.
const lineupService = require('./lineup.service');
const { isLeagueCommissioner } = require('./leagueRole.service');
const { teamIdentityOf } = require('./teamIdentity');
const { appendPickActivity, appendLifecycleActivity, COMPLETE } = require('./draftActivity');
const { assertFantasyLeagueRow } = require('./leagueType');
const { draftRounds } = require('./rosterShape');
// The Pick clock module owns arming: the only writer of the deadline and the
// current pick (ADR 0018). commitPick advances the turn through its named
// pick-landed event.
const pickClock = require('./pickClock.service');
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
// DraftError is the app-wide draft refusal (ADR 0008) and the roster-acquisition
// checks are shared with draft.service.addFreeAgent (#782 ruling 2). draft.service
// never requires this module back, so this top-level require closes no cycle.
const { DraftError, assertRosterAcquisitionAllowed } = require('./draft.service');

/**
 * A Pick lands in one place (#782, ADR 0025 amendment). `landPick` is the ONE
 * seam every caller reaches for a Pick: the socket handler's `draft:pick`, the
 * Pick clock's autoPick, and the offline-draft bulk route all call it, and it
 * both commits the Pick (the transaction below, moved verbatim from the old
 * `draft.service.draftPlayer`) and, after COMMIT, fans the outcome out to the
 * room through the one Draft room adapter (#745). Before this, each caller
 * re-derived the fan-out and they disagreed - the offline route emitted none of
 * it. Now the fan-out is decided once, here.
 *
 * The post-draft free-agent add is NOT a Pick and does not pass through here: it
 * is draft.service.addFreeAgent, which shares only the roster-acquisition checks
 * (assertRosterAcquisitionAllowed) with this module.
 */

/**
 * Commit a Pick onto a team inside a single database transaction. The league row
 * is locked (SELECT ... FOR UPDATE) so concurrent picks in the same league
 * serialize; unique constraints on (league_id, player_id) are the backstop
 * against double-drafting.
 *
 * Only an ACTIVE draft commits a Pick here (a 409 otherwise): a pending draft has
 * not started, and a completed draft's roster adds are free agency
 * (draft.service.addFreeAgent), not Picks.
 *
 * `byCommissioner` is set by the offline-draft bulk-entry endpoint: the league
 * owner applies the pick to whichever team is on the clock rather than to their
 * own team, and skips the team-lock check (an offline draft is entirely
 * commissioner-driven).
 *
 * Exported so the autopick and socket-payload suites can mock the commit while
 * leaving the real fan-out in landPick to observe; landPick invokes it through
 * the module exports for that reason.
 */
async function commitPick({ leagueId, userId, playerId, auto = false, byCommissioner = false }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new DraftError(404, 'league not found');
    // A pick'em-only league has no draft and no rosters; say so rather than
    // "draft has not started" (its draft_status is 'pending' forever).
    assertFantasyLeagueRow(league);
    if (league.draft_status === 'pending') {
      throw new DraftError(409, 'draft has not started for this league');
    }
    // A Pick lands only in an active draft. A completed draft's roster add is
    // free agency (draft.service.addFreeAgent), never a Pick (#782 ruling 2).
    if (league.draft_status !== 'active') {
      throw new DraftError(409, 'the draft is not active');
    }
    if (byCommissioner && !(await isLeagueCommissioner(client, leagueId, userId))) {
      throw new DraftError(403, 'only the commissioner can enter picks for this draft');
    }

    const teamsResult = await client.query(
      `SELECT "id", "name", "owner_id", "draft_position", "autodraft", "locked" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    const rotationOpts = { rotation: league.draft_rotation, overrides: league.draft_order_overrides };

    let myTeam;
    if (byCommissioner) {
      myTeam = teamForPick(league.current_pick, teams, rotationOpts);
      if (!myTeam) throw new DraftError(409, 'no team is currently on the clock');
    } else {
      // Caller comparison: the drafting manager's own team, found by the
      // caller's own id. Nothing about the league's creator enters here - the
      // commissioner branch above is where a commissioner-shaped power lives,
      // and it authorizes through isLeagueCommissioner.
      myTeam = teams.find((t) => t.owner_id === userId);
      if (!myTeam) throw new DraftError(403, 'not a member of this league');
      // A commissioner-locked team can't add players; the commissioner's own
      // force-add tool bypasses this via a separate path.
      if (myTeam.locked) throw new DraftError(409, 'your team is locked by the commissioner');
      if (league.draft_type === 'offline') {
        throw new DraftError(409, 'this is an offline draft; the commissioner enters every pick');
      }
      // Autopick-type drafts resolve every pick server-side (the Pick clock
      // module's autoPick calls in here with auto: true); a manager has no manual
      // Pick control for one (issue #120) and this is the server-side half of
      // that guarantee, not just a client-side hidden button.
      if (!auto && league.draft_type === 'autopick') {
        throw new DraftError(409, 'this is an autopick draft; picks are made automatically');
      }
    }

    const playerResult = await client.query(
      // nfl_team rides along for the Draft-activity snapshot (#435): the feed's
      // Pick entry shows the player's NFL team, and the activity is written from
      // this same transaction, so the fact is read here rather than re-fetched.
      `SELECT "id", "name", "position", "nfl_team" FROM "players" WHERE "id" = $1`,
      [playerId]
    );
    if (!playerResult.rows[0]) throw new DraftError(404, 'player not found');
    const position = playerResult.rows[0].position;

    // Roster capacity, position caps and the on-waivers gate, shared with the
    // free-agent add path through draft.service (#782 ruling 2). For an active
    // draft the waiver gate is a no-op (it fires only for a completed draft).
    await assertRosterAcquisitionAllowed(client, { league, teamId: myTeam.id, playerId, position });

    let pickNumber = null;
    let draftComplete = false;
    let nextTeamId = null;
    let pickDeadlineAt = null;
    // The Draft-activity entry for this Pick (#435).
    let activity = null;
    // The completion lifecycle entry (#437), set only on the Pick that ends the
    // draft. It is a state transition no manager performed, so it carries no
    // actor Team; the final Pick's own `activity` already attributes the Pick to
    // the drafting Team.
    let completion = null;

    if (league.draft_paused) {
      throw new DraftError(409, 'the draft is paused by the commissioner');
    }
    const onTheClock = teamForPick(league.current_pick, teams, rotationOpts);
    if (!onTheClock || onTheClock.id !== myTeam.id) {
      throw new DraftError(409, 'it is not your turn to pick');
    }
    pickNumber = league.current_pick + 1;
    const pickInsert = await client.query(
      `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number")
       VALUES ($1, $2, $3, $4) RETURNING "id"`,
      [leagueId, myTeam.id, playerId, pickNumber]
    );
    const sourcePickId = pickInsert.rows[0].id;

    // Append the immutable Draft activity for this Pick in the SAME transaction
    // as the Pick (#435 AC1), snapshotting the facts the feed must show and
    // survive a later correction (#435 AC2). The round is derived from the
    // overall Pick number and the team count; `auto` is the authoritative write's
    // own fact, so an autopick is labeled only when it truly occurred (#435 AC3).
    // The row names no feed_seq: the trigger allocates it from the shared
    // per-league sequence.
    const round = Math.floor((pickNumber - 1) / teams.length) + 1;
    activity = await appendPickActivity(client, {
      leagueId,
      team: myTeam,
      player: playerResult.rows[0],
      round,
      pickNumber,
      auto,
      // The draft_picks row this entry represents (#436): coverage and
      // reconciliation match a Pick to its feed entry by this identity, not by
      // pick_number, which undo + re-pick reuses.
      sourcePickId,
    });

    // Rounds are draftRounds(league): fixed once when the draft went active
    // (ADR 0005), NOT a live draftRosterSize() recomputation. Goes through the
    // same helper every other consumer uses so a legacy row the one-time backfill
    // migration hasn't reached yet falls back to the live derivation instead of
    // silently coercing `teams.length * null` to 0.
    const totalPicks = teams.length * draftRounds(league);
    // Keeper picks are pre-inserted at draft start and can occupy any slot, so
    // completion is a count of all picks made, not a comparison against this
    // pick's own (possibly non-terminal) pick_number.
    const pickCountResult = await client.query(
      `SELECT COUNT(*)::int AS n FROM "draft_picks" WHERE "league_id" = $1`,
      [leagueId]
    );
    draftComplete = pickCountResult.rows[0].n >= totalPicks;

    let nextTeam = null;
    let nextPickIndex = null;
    if (!draftComplete) {
      const takenResult = await client.query(
        `SELECT "pick_number" FROM "draft_picks" WHERE "league_id" = $1`,
        [leagueId]
      );
      const takenSet = new Set(takenResult.rows.map((r) => r.pick_number - 1));
      nextPickIndex = nextOpenPickNumber(takenSet, league.current_pick + 1, totalPicks);
      nextTeam = nextPickIndex === null ? null : teamForPick(nextPickIndex, teams, rotationOpts);
    }
    // Advance the turn and arm the next team's clock through the Pick clock
    // module (ADR 0018): the only writer of current_pick and the deadline.
    // draft_status rides that statement because the final pick's advance IS the
    // completion, and the completion side effects below depend on 'complete'
    // being set first (#194).
    pickDeadlineAt = await pickClock.onPickLanded(client, {
      leagueId,
      nextPick: draftComplete ? pickNumber : nextPickIndex,
      draftStatus: draftComplete ? 'complete' : 'active',
      draftComplete,
      nextTeam,
      league,
    });
    // A present owner making their own pick clears any timeout streak.
    if (!auto) {
      await client.query(
        `UPDATE "teams" SET "consecutive_timeouts" = 0 WHERE "id" = $1`,
        [myTeam.id]
      );
    }
    if (draftComplete) {
      // All undrafted players start on waivers for one waiver period
      await client.query(
        `UPDATE "leagues" SET "waivers_clear_at" = now() + make_interval(hours => $1)
         WHERE "id" = $2`,
        [league.waiver_period_hours, leagueId]
      );
      // The season schedule exists the moment the draft ends
      const { generateRegularSeason } = require('./season.service');
      await generateRegularSeason({ leagueId }, client);
      // Record the completion as append-only Draft activity, in the SAME
      // transaction that flips the status to complete (#437 AC4). No actor:
      // completion is a state transition, not an action a manager took. It orders
      // AFTER this final Pick's own activity by the shared sequence.
      completion = await appendLifecycleActivity(client, {
        leagueId,
        kind: COMPLETE,
        team: null,
      });
    } else {
      nextTeamId = nextTeam.id;
    }

    await client.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id")
       VALUES ($1, $2, $3)`,
      [leagueId, myTeam.id, playerId]
    );

    // Every add lands on the bench, never back in an old stash (#94, user story
    // 13) - draft picks included, since the lineup screen has no draft guard and
    // a mid-draft drop leaves rows behind like any other.
    await lineupService.benchAcquiredPlayer(client, { league, teamId: myTeam.id, playerId });

    await client.query('COMMIT');
    // teamName rides beside teamId so the `draft:picked` broadcast built from
    // this outcome can attribute the Pick by Team without a second lookup
    // (#112, parent #108).
    return {
      leagueId,
      ...teamIdentityOf(myTeam),
      player: playerResult.rows[0],
      pickNumber,
      nextTeamId,
      draftComplete,
      pickDeadlineAt,
      // The typed Draft-activity entry for the combined feed (#435), so the
      // `draft:picked` broadcast carries it to the room beside the board update.
      activity,
      // The completion lifecycle entry (#437), set only on the Pick that ends the
      // draft, else null. landPick delivers it on `draft:activity` so the room's
      // feed shows the draft closing beside the final Pick.
      completion,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new DraftError(409, 'player is already rostered in this league');
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The ONE seam every Pick lands through (#782 ruling 1). Commits the Pick
 * (commitPick) and, after COMMIT, fans the outcome out to the room through the
 * one Draft room adapter (#745): `pickLanded` with the payload it builds
 * (`{ ...outcome, auto }`), then - only on the Pick that ended the draft - the
 * completion `activityAppended` (when present), `rosterChanged`, and
 * `draftCompleted`, in that order. The adapter is resolved through
 * getDraftRoomBroadcast() at call time (ADR 0025), the same way the socket
 * handler and the clock resolve it; a test installs a recording broadcast. The
 * fan-out never throws to the caller: each adapter method is delivered-or-reported.
 *
 * commitPick is invoked through the module exports so a test can mock the commit
 * and observe the real fan-out.
 */
async function landPick({ leagueId, userId, playerId, auto = false, byCommissioner = false }) {
  const outcome = await module.exports.commitPick({ leagueId, userId, playerId, auto, byCommissioner });
  const broadcast = getDraftRoomBroadcast();
  await broadcast.pickLanded(leagueId, { ...outcome, auto });
  if (outcome.draftComplete) {
    // The Pick that ended the draft also appended a completion lifecycle entry
    // (#437); deliver it to the room's combined feed on draft:activity beside the
    // draft:complete board signal. A pick that completes without a completion
    // entry (defensive) emits no empty activity.
    if (outcome.completion) await broadcast.activityAppended(leagueId, outcome.completion);
    await broadcast.rosterChanged(leagueId);
    await broadcast.draftCompleted(leagueId);
  }
  return outcome;
}

module.exports = {
  landPick,
  commitPick,
};
