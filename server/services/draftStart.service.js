const pool = require('../modules/pool');
const { meetsMinimum } = require('./leagueSize');
const { DraftError } = require('./draft.service');
const { startPlan } = require('./draftValidation.service');
const { isLeagueCommissioner } = require('./leagueRole.service');
const { assertFantasyLeagueRow } = require('./leagueType');
const { MARKET_FLOOR } = require('./adp.service');
const { appendLifecycleActivity, DRAFT_START } = require('./draftActivity');
// The one Draft room adapter (#745), injected the same way the Pick clock reads
// it: in the WORKER (scheduled autostart) its transport is the Redis emitter, so
// the draft_start activity and the state refresh below are published rather than
// silently dropped the way the old null-`io` registry path dropped them (ADR 0018).
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
// The Pick clock module owns arming (ADR 0018): the draft-started event fixes
// draft_rounds and arms the first open pick's clock in one statement.
const pickClock = require('./pickClock.service');
// The one draft->season handoff (#789), shared with the completing-Pick path.
// Module object so the all-keeper-start suite can mock completeDraft.
const draftCompletion = require('./draftCompletion');

/**
 * Start a league's draft — the single entry point for every "start" trigger
 * (the commissioner's Instant Start button, the socket start event, and the
 * scheduled auto-start) so behavior can't drift between three copies of this
 * logic. `userId: null` means the caller is the scheduler, which bypasses the
 * owner check (there's no acting user).
 *
 * Locks the league row, re-validates via startPlan() (auction 501, stale
 * order-overrides/keepers 409), pre-inserts any keeper picks, and arms the
 * first open pick's clock. Broadcasts the resulting draft:state on success.
 */
async function startDraft({ leagueId, userId = null }) {
  const client = await pool.connect();
  // The lifecycle entries this start committed, broadcast only after COMMIT.
  let committedActivities = [];
  // The deadline the start armed, carried out to the caller (null for a
  // keeper-complete or untimed start). The WORKER's scheduled-autostart caller
  // arms an in-process expiry timer for it (#615); it is deliberately NOT armed
  // here, because startDraft also runs on the manual-start API path, where in
  // production no timer registry exists (ADR 0018).
  let pickDeadlineAt = null;
  try {
    await client.query('BEGIN');

    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    if (!league) throw new DraftError(404, 'league not found');
    // A pick'em-only league has no draft. Checked here, under the lock, so
    // the socket start event and the scheduler cannot bypass the route guard.
    assertFantasyLeagueRow(league);
    if (userId != null && !(await isLeagueCommissioner(client, leagueId, userId))) {
      throw new DraftError(403, 'only the commissioner can start this draft');
    }
    if (league.draft_status !== 'pending') {
      throw new DraftError(409, 'draft already started');
    }

    const teamsResult = await client.query(
      // "name" rides along for the Draft-activity actor snapshot (#437): the
      // draft_start entry attributes the start to the acting commissioner's
      // Team, resolved from this already-loaded list rather than a second read.
      `SELECT "id", "name", "owner_id", "draft_position", "autodraft", "locked" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    // The acting commissioner's Team, or null when there is no manager behind
    // the start (the scheduler passes userId null) or the commissioner holds no
    // team in this league. A null actor is recorded as null, never fabricated
    // (#437 AC5). Only the Team id + name are carried on, never the owner
    // account; activityEntryOf then shapes them under the frozen identity keys.
    const actorRow = userId == null ? null : teams.find((t) => t.owner_id === userId);
    const actorTeam = actorRow ? { id: actorRow.id, name: actorRow.name } : null;
    if (!meetsMinimum(teams.length, league.min_teams)) {
      throw new DraftError(409, `need at least ${league.min_teams} teams to start the draft (currently ${teams.length})`);
    }

    // The market gate (#747, decision 7): refuse to start when fewer than
    // MARKET_FLOOR players carry an ADP. Without a loaded market, autopicks
    // silently fall back to last season's points, so start is refused HERE -
    // where a human is present and can run the sync - for every trigger
    // (manual, socket, and, as a backstop, the scheduler). The scheduler
    // normally refuses earlier with its own 'no_market' action; this is the
    // invariant that also catches a market that thinned after that check.
    const market = await client.query(
      `SELECT COUNT(*)::int AS n FROM "players" WHERE "adp" IS NOT NULL`
    );
    const marketCount = market.rows[0].n;
    if (marketCount < MARKET_FLOOR) {
      throw new DraftError(
        409,
        `The player market has not loaded (${marketCount} of ${MARKET_FLOOR} players carry an ADP), `
          + "so autopicks would fall back to last season's points. "
          + 'Ask your admin to run the ADP sync, then start the draft.'
      );
    }

    let keepers = [];
    if (league.keepers_enabled) {
      const keepersResult = await client.query(
        `SELECT "team_id", "player_id", "draft_round" FROM "keepers" WHERE "league_id" = $1`,
        [leagueId]
      );
      keepers = keepersResult.rows;
    }

    const plan = startPlan(league, teams, keepers);
    if (plan.error) {
      throw new DraftError(plan.error.status, plan.error.message);
    }

    // The one roster-add site that skips rosterCapacity (#97): keepers are
    // bounded by validateKeepers (count and round within the draft roster
    // size, capacity's floor) and only run from draft_status 'pending', so
    // the pre-fill can never exceed capacity by construction.
    for (const keeperPick of plan.keeperPicks) {
      await client.query(
        `INSERT INTO "draft_picks" ("league_id", "team_id", "player_id", "pick_number", "is_keeper")
         VALUES ($1, $2, $3, $4, true)`,
        [leagueId, keeperPick.teamId, keeperPick.playerId, keeperPick.pickNumber + 1]
      );
      await client.query(
        `INSERT INTO "team_players" ("league_id", "team_id", "player_id")
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [leagueId, keeperPick.teamId, keeperPick.playerId]
      );
    }

    if (plan.autodraftAll) {
      await client.query(`UPDATE "teams" SET "autodraft" = true WHERE "league_id" = $1`, [leagueId]);
    }

    // The draft started: append the authoritative draft_start activity from
    // this same transaction (#437 AC1), attributed to the acting commissioner's
    // Team (null for a scheduler start, #437 AC5). Collected and broadcast after
    // COMMIT so a rolled-back start emits nothing.
    const activities = [];
    activities.push(await appendLifecycleActivity(client, { leagueId, kind: DRAFT_START, team: actorTeam }));

    if (plan.firstOpenPick === null) {
      // Every roster slot was pre-filled by keepers — the draft is over before
      // a single live pick, so run the same completion side effects commitPick
      // would have on the final pick. draft_rounds is fixed here too (ADR
      // 0005): a draft that completes without a live pick is still "active or
      // completed" for every later read, so it must not fall through to a
      // live draftRosterSize() recomputation either.
      pickDeadlineAt = await pickClock.onDraftStarted(client, {
        leagueId, complete: true, currentPick: plan.totalPicks, rounds: plan.rounds,
      });
      // The clock flipped draft_status to 'complete' above; the one draft->season
      // handoff runs on this same transaction (#789), opening the waiver window,
      // scheduling the season, and appending the actor-less COMPLETE entry after
      // the start (#437 AC4, AC5). Collected for the post-COMMIT broadcast.
      activities.push(await draftCompletion.completeDraft(client, { leagueId }));
    } else {
      // Fix draft_rounds once, from Draft roster size at this instant (ADR
      // 0005). commitPick's completion check and every other active/completed
      // read use this stored value from here on; none of them call
      // draftRosterSize() again for this league.
      pickDeadlineAt = await pickClock.onDraftStarted(client, {
        leagueId, complete: false, currentPick: plan.firstOpenPick,
        clockSeconds: plan.firstClockSeconds, rounds: plan.rounds,
      });
    }

    await client.query('COMMIT');
    committedActivities = activities;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  // Only after a successful COMMIT, and through the one Draft room adapter
  // (#745), so the WORKER's scheduled autostart publishes these rather than
  // dropping them. stateChanged refreshes the board; each committed lifecycle
  // entry (the start, and on a keeper-filled start the completion) then rides to
  // the combined feed on draft:activity (#437). The adapter reports its own
  // failures and never throws here, so a post-commit transport blip cannot undo
  // a started draft.
  const broadcast = getDraftRoomBroadcast();
  await broadcast.stateChanged(leagueId);
  for (const entry of committedActivities) await broadcast.activityAppended(leagueId, entry);
  return { leagueId, pickDeadlineAt };
}

module.exports = { startDraft };
