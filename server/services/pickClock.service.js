const pool = require('../modules/pool');
const { teamForPick } = require('./draftOrder.service');
const ioRegistry = require('../modules/io');
const draftEvents = require('../modules/draftEvents');
const { broadcastRosterAvailability } = require('../modules/rosterAvailabilityBroadcast');
const { lastCompletedNflSeason } = require('./nflSeason.service');
const bestAvailable = require('./bestAvailable.service');

/**
 * The Pick clock (CONTEXT.md), one owner. Every way a turn begins or a Pick
 * clock re-arms goes through a named event here, and every event arms by the
 * ONE policy below: an Autodraft team gets the short delay (floored at one
 * second, even in an untimed league), a timed team gets the full pick time, an
 * untimed non-autodrafting team gets no clock. Resume grants the policy clock,
 * never the time remaining at pause: pausing forgives elapsed time (ADR 0018).
 *
 * This module is the only writer of `leagues.pick_deadline_at` and, for the
 * turn-advancing events, of `leagues.current_pick`. A direct UPDATE of either
 * column outside it is a defect (ADR 0018). Every event takes the caller's own
 * transaction `client` (the league row already locked FOR UPDATE by the caller)
 * and performs its turn-advance and clock-arm as a single atomic statement, so
 * an observer never sees a new turn without its clock.
 *
 * The module also OWNS EXPIRY (#600): the sweep entry point below is the only
 * thing that concludes a clock expired, and the Autopick act it drives (queue
 * first, then best available, with the snipe retry) and the consecutive-timeout
 * streak live here too. The clock re-arm on a committed autopick still rides the
 * pick-landed event through draft.service.draftPlayer, so expiry and arming
 * share the one policy. draft.service is required lazily inside autoPick because
 * it requires this module in turn (ADR 0018); a top-level require would capture
 * its partial exports during the cycle.
 */

const AUTODRAFT_DELAY_FLOOR = 1;

// Defensive bound on draftPlayer() attempts after a snipe - not a ranking cutoff.
const AUTOPICK_CANDIDATE_LIMIT = 25;

/**
 * Pure: seconds on the clock for the next pick, or null for "no clock". An
 * autodrafting team always gets the short autodraft delay (even in an otherwise
 * untimed draft, and never below one second); everyone else gets the league
 * pick clock, which is null when the league is untimed or the draft is over.
 * This is the single spelling of the arming policy every event consults.
 */
function nextPickClockSeconds({ draftComplete, nextTeamAutodraft, pickTimeSeconds, autodraftDelaySeconds }) {
  if (draftComplete) return null;
  if (nextTeamAutodraft) return Math.max(AUTODRAFT_DELAY_FLOOR, autodraftDelaySeconds || AUTODRAFT_DELAY_FLOOR);
  return pickTimeSeconds > 0 ? pickTimeSeconds : null;
}

/**
 * The policy above, plus the offline rule: an offline draft never arms a
 * deadline regardless of a team's autodraft flag or the league's configured
 * pick clock, because its picks only ever land via commissioner entry. `league`
 * carries draft_type, pick_time_seconds and autodraft_delay_seconds.
 */
function clockSecondsFor({ draftComplete, onClockAutodraft, league }) {
  if (league.draft_type === 'offline') return null;
  return nextPickClockSeconds({
    draftComplete,
    nextTeamAutodraft: onClockAutodraft,
    pickTimeSeconds: league.pick_time_seconds,
    autodraftDelaySeconds: league.autodraft_delay_seconds,
  });
}

/**
 * Draft started: the pending -> active (or, on an all-keeper start, pending ->
 * complete) transition. Fixes draft_rounds at this instant (ADR 0005) and, on
 * the active branch, arms the first open pick's clock from the policy seconds
 * the start plan resolved. This is the one statement that advances current_pick
 * and arms the deadline together for the start event.
 */
async function onDraftStarted(client, { leagueId, complete, currentPick, clockSeconds, rounds }) {
  if (complete) {
    // Every roster slot was pre-filled by keepers: no live pick is possible, so
    // the draft is complete before it began. No clock, and the waiver window
    // opens exactly as it would on the final live pick.
    await client.query(
      `UPDATE "leagues"
         SET "draft_status" = 'complete', "current_pick" = $2, "updated_at" = now(),
             "draft_autostart_failed" = false, "pick_deadline_at" = NULL,
             "draft_rounds" = $3,
             "waivers_clear_at" = now() + make_interval(hours => "waiver_period_hours")
       WHERE "id" = $1`,
      [leagueId, currentPick, rounds]
    );
    return null;
  }
  const result = await client.query(
    `UPDATE "leagues"
       SET "draft_status" = 'active', "current_pick" = $2, "updated_at" = now(),
           "draft_autostart_failed" = false,
           "draft_rounds" = $4,
           "pick_deadline_at" = CASE
             WHEN $3::int IS NULL THEN NULL
             ELSE now() + make_interval(secs => $3::int)
           END
     WHERE "id" = $1
     RETURNING "pick_deadline_at"`,
    [leagueId, currentPick, clockSeconds, rounds]
  );
  return result.rows[0] ? result.rows[0].pick_deadline_at : null;
}

/**
 * Pick landed: advance the turn to the next open pick (or, on the final pick,
 * to the completed state) and arm the next team's clock, in one statement so
 * the turn advance and clock arm stay atomic (ADR 0018). draft_status rides the
 * same statement because the final pick's advance IS the completion; the
 * completion side effects the caller runs afterward depend on that status being
 * set first (#194). `nextTeam` is the resolved team now on the clock (null once
 * the draft completes); `league` carries the clock settings.
 */
async function onPickLanded(client, { leagueId, nextPick, draftStatus, draftComplete, nextTeam, league }) {
  const clockSeconds = clockSecondsFor({
    draftComplete,
    onClockAutodraft: nextTeam ? nextTeam.autodraft : false,
    league,
  });
  const result = await client.query(
    `UPDATE "leagues"
       SET "current_pick" = $1, "draft_status" = $2, "updated_at" = now(),
           "pick_deadline_at" = CASE
             WHEN $4::int IS NULL THEN NULL
             ELSE now() + make_interval(secs => $4::int)
           END
     WHERE "id" = $3
     RETURNING "pick_deadline_at"`,
    [nextPick, draftStatus, leagueId, clockSeconds]
  );
  return result.rows[0].pick_deadline_at;
}

/** Paused: the draft is paused, so the clock is cleared. Pausing forgives elapsed time. */
async function onPaused(client, { leagueId }) {
  const result = await client.query(
    `UPDATE "leagues" SET "pick_deadline_at" = NULL, "updated_at" = now()
     WHERE "id" = $1 RETURNING "pick_deadline_at"`,
    [leagueId]
  );
  return result.rows[0] ? result.rows[0].pick_deadline_at : null;
}

/**
 * Resumed: arm the on-the-clock team's policy clock, never the time remaining at
 * pause (ADR 0018). This is the fix for the resume freeze: an autodrafting team
 * gets the short delay even in an untimed league (never NULL) and the short
 * delay in a timed league (never the full pick clock). Resolves the on-clock
 * team from the same rotation the rest of the draft uses, then arms without
 * advancing the turn (the same team stays on the clock through a pause).
 */
async function onResumed(client, { leagueId }) {
  const leagueResult = await client.query(
    `SELECT "current_pick", "draft_type", "draft_rotation", "draft_order_overrides",
            "pick_time_seconds", "autodraft_delay_seconds"
       FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  const league = leagueResult.rows[0];
  if (!league) return null;
  const teamsResult = await client.query(
    `SELECT "id", "autodraft", "draft_position" FROM "teams"
       WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
    [leagueId]
  );
  const onClock = teamForPick(league.current_pick, teamsResult.rows, {
    rotation: league.draft_rotation,
    overrides: league.draft_order_overrides,
  });
  const clockSeconds = clockSecondsFor({
    draftComplete: false,
    onClockAutodraft: onClock ? onClock.autodraft : false,
    league,
  });
  return armInPlace(client, { leagueId, clockSeconds });
}

/**
 * Autodraft toggled on for the team on the clock: arm the short autodraft delay
 * right away, so an absent owner's pick fires promptly. The team is autodrafting
 * by definition here (the caller only reaches this for enabling on the on-clock
 * team of an active, unpaused draft), so the policy resolves to the delay.
 * `league` carries the clock settings.
 */
async function onAutodraftToggled(client, { leagueId, league }) {
  // The team is autodrafting by definition here, so the policy resolves to the
  // short delay (floored at one second) for a timed or untimed league. It goes
  // through clockSecondsFor like every other event so there is one spelling
  // (ADR 0018): an offline draft arms no clock, matching the five siblings
  // rather than diverging (spec #598 user story 7). The toggle route reaches
  // this with an active offline draft (no draft_type guard on that path), so
  // `league` MUST carry draft_type or the offline rule would silently not apply.
  const clockSeconds = clockSecondsFor({ draftComplete: false, onClockAutodraft: true, league });
  return armInPlace(client, { leagueId, clockSeconds });
}

/**
 * Pick undone (commissioner undo): rewind current_pick to the earliest undone
 * pick's own slot and re-arm the team now on the clock by the policy, in one
 * statement. `onClockAutodraft` is that team's autodraft flag, resolved by the
 * caller from the rewound pick; `league` carries the clock settings.
 */
async function onPickUndone(client, { leagueId, newCurrentPick, onClockAutodraft, league }) {
  const clockSeconds = clockSecondsFor({ draftComplete: false, onClockAutodraft, league });
  const result = await client.query(
    `UPDATE "leagues"
       SET "current_pick" = $1, "updated_at" = now(),
           "pick_deadline_at" = CASE
             WHEN $3::int IS NULL THEN NULL
             ELSE now() + make_interval(secs => $3::int)
           END
     WHERE "id" = $2
     RETURNING "pick_deadline_at"`,
    [newCurrentPick, leagueId, clockSeconds]
  );
  return result.rows[0] ? result.rows[0].pick_deadline_at : null;
}

/**
 * Clear the clock without advancing the turn: a destructive reset back to
 * pending has no team on the clock and no deadline. (Commissioner correction
 * clears its own clock inside draft.service.js and is deliberately left
 * unchanged, #599.)
 */
async function clearClock(client, { leagueId }) {
  await client.query(
    `UPDATE "leagues" SET "pick_deadline_at" = NULL, "updated_at" = now() WHERE "id" = $1`,
    [leagueId]
  );
  return null;
}

/** The shared re-arm-in-place statement for the events that keep the same team on the clock. */
async function armInPlace(client, { leagueId, clockSeconds }) {
  const result = await client.query(
    `UPDATE "leagues"
       SET "updated_at" = now(),
           "pick_deadline_at" = CASE
             WHEN $2::int IS NULL THEN NULL
             ELSE now() + make_interval(secs => $2::int)
           END
     WHERE "id" = $1
     RETURNING "pick_deadline_at"`,
    [leagueId, clockSeconds]
  );
  return result.rows[0] ? result.rows[0].pick_deadline_at : null;
}

// --- Expiry: the Autopick act and the sweep (#600, ADR 0018) -----------------

/**
 * Order candidates for one team's autopick: its own queue first (by the team's
 * stated rank), then best available (CONTEXT.md) - ADP, then last completed
 * season's points, then name. Never database id. Shared with the Draft Sim's
 * pool via bestAvailable.service.js's compareBestAvailable. Internal to this
 * module: the ordering contracts are exercised through the sweep interface
 * (server/test/pickClock.sweep.test.js), not a test-only export (ADR 0018).
 */
function compareAutopickCandidates(a, b) {
  const aQueued = a.queue_rank != null;
  const bQueued = b.queue_rank != null;
  if (aQueued !== bQueued) return aQueued ? -1 : 1;
  if (aQueued) return a.queue_rank - b.queue_rank;
  return bestAvailable.compareBestAvailable(a, b);
}

/**
 * Server-side auto-pick for an expired clock: the team on the clock drafts
 * automatically - first eligible player from its pre-draft queue, otherwise
 * best available (CONTEXT.md). The committed pick re-arms the next team's clock
 * through draft.service.draftPlayer -> onPickLanded, so expiry never writes the
 * deadline directly; it goes through the same arming policy as every other event.
 *
 * Candidate selection and the pick itself are separate transactions, so a
 * candidate can be sniped in between - draftPlayer's own validation catches that
 * (409) and we simply try the next candidate.
 */
async function autoPick({ leagueId }) {
  // draft.service requires this module (ADR 0018), so it is required at call time
  // rather than at module load to avoid capturing its partial exports mid-cycle.
  const draftService = require('./draft.service');

  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league || league.draft_status !== 'active' || league.draft_paused) return null;
  // Expiry guard, and the timer-vs-sweep dedupe (#601, ADR 0018): only an
  // actually-elapsed clock autopicks. The hybrid runs two firing paths - the
  // in-process timer and the backstop sweep - so the same deadline can reach
  // here twice (a double-fired timer, or a sweep straggler that arrives after
  // the timer already advanced the turn). The second firing reads the NEXT
  // team's freshly-armed clock, which is null or still in the future, and
  // declines here. Without this check that second firing would autopick the
  // next team early, committing a second Pick off one expiry. A null deadline
  // (untimed non-autodrafting turn, or a completed draft) is likewise not an
  // expiry and never autopicks.
  const deadline = league.pick_deadline_at;
  if (deadline == null || msUntilDeadline(deadline) > 0) return null;

  const teamsResult = await pool.query(
    `SELECT "id", "owner_id", "autodraft" FROM "teams"
     WHERE "league_id" = $1 ORDER BY "draft_position" NULLS LAST, "id"`,
    [leagueId]
  );
  const teams = teamsResult.rows;
  if (teams.length === 0) return null;
  const onTheClock = teamForPick(league.current_pick, teams, {
    rotation: league.draft_rotation,
    overrides: league.draft_order_overrides,
  });
  if (!onTheClock) return null;
  // A pick fired by an expired clock is a "timeout" only when the team isn't
  // already autodrafting on purpose.
  const wasTimeout = !onTheClock.autodraft;

  const lastSeason = await lastCompletedNflSeason();
  const candidatesRes = await pool.query(
    `SELECT "players"."id", "players"."name", "players"."adp",
            "draft_queue"."rank" AS "queue_rank",
            "season_points"."fantasy_points" AS "last_season_points"
     FROM "players"
     LEFT JOIN "team_players" ON "team_players"."player_id" = "players"."id"
       AND "team_players"."league_id" = $1
     LEFT JOIN "draft_queue" ON "draft_queue"."player_id" = "players"."id"
       AND "draft_queue"."team_id" = $2
     LEFT JOIN "player_season_stats" "season_points"
       ON "season_points"."player_id" = "players"."id" AND "season_points"."season" = $3
     WHERE "team_players"."id" IS NULL`,
    [leagueId, onTheClock.id, lastSeason]
  );
  const candidates = [...candidatesRes.rows]
    .sort(compareAutopickCandidates)
    .slice(0, AUTOPICK_CANDIDATE_LIMIT);

  for (const candidate of candidates) {
    try {
      const outcome = await draftService.draftPlayer({
        leagueId,
        userId: onTheClock.owner_id,
        playerId: candidate.id,
        auto: true,
      });
      // The worker has no local Socket.IO server. Publish there; the API-side
      // relay emits the same room events that the in-process path emits below.
      await emitDraftEvent(leagueId, 'draft:picked', { ...outcome, auto: true });
      if (outcome.draftComplete) {
        // An autopick can be the Pick that ends the draft; its completion
        // lifecycle entry (#437) rides to the combined feed on draft:activity
        // through the same cross-process relay.
        if (outcome.completion) {
          await emitDraftEvent(leagueId, 'draft:activity', outcome.completion);
        }
        await broadcastRosterAvailability(leagueId);
        await emitDraftEvent(leagueId, 'draft:complete', { leagueId });
      }
      // After a genuine timeout, track the streak and flip autodraft on once it
      // crosses the threshold, so a persistently-absent owner stops stalling.
      if (wasTimeout) {
        const bumped = await pool.query(
          `UPDATE "teams" SET "consecutive_timeouts" = "consecutive_timeouts" + 1
           WHERE "id" = $1 RETURNING "consecutive_timeouts"`,
          [onTheClock.id]
        );
        if (draftService.shouldAutoEnableAutodraft(bumped.rows[0].consecutive_timeouts)) {
          await pool.query(`UPDATE "teams" SET "autodraft" = true WHERE "id" = $1`, [onTheClock.id]);
          await broadcastDraftState(leagueId);
        }
      }
      return outcome;
    } catch (err) {
      if (err.statusCode === 409) continue; // sniped or cap-blocked - next candidate
      throw err;
    }
  }
  return null; // nothing draftable (roster full etc.) - leave the clock alone
}

/** Re-broadcast the full draft state so clients refresh AUTO badges + the clock. */
async function broadcastDraftState(leagueId) {
  const io = ioRegistry.getIo();
  if (!io) {
    await draftEvents.publishDraftEvent({ leagueId, event: 'draft:state' });
    return;
  }
  try {
    const { getDraftState } = require('../modules/draftSocket');
    io.to(`league:${leagueId}`).emit('draft:state', await getDraftState(leagueId));
  } catch (err) {
    console.error('draft state broadcast failed:', err.message);
  }
}

async function emitDraftEvent(leagueId, event, payload) {
  const io = ioRegistry.getIo();
  if (io) {
    io.to(`league:${leagueId}`).emit(event, payload);
    return;
  }
  const message = { leagueId, event };
  if (payload !== undefined) message.payload = payload;
  await draftEvents.publishDraftEvent(message);
}

// --- Hybrid expiry: in-process timers beside the stored deadline (#601) -------

/**
 * Armed in-process expiry timers, keyed by league id. The stored deadline on
 * the league row stays the authoritative fact (restart-proof, multi-process
 * safe); beside it the worker arms a timer so an expiry fires within about a
 * second of zero instead of on the next backstop poll (ADR 0018). Timers live
 * only in the process that armed them - the worker, where the sweep and the
 * autopick chain both run. A worker restart loses the Map, which is exactly why
 * the backstop sweep still exists: it re-arms timers for future deadlines and
 * autopicks any that already elapsed while the process was down.
 */
const expiryTimers = new Map();

/**
 * Milliseconds from now until `deadline` (a Date or timestamp): positive while
 * the clock is still running, zero or negative once it has elapsed. The one
 * spelling of the clock-elapsed comparison, shared by the arming math, the
 * sweep's due split, and the expiry guard.
 */
function msUntilDeadline(deadline) {
  return new Date(deadline).getTime() - Date.now();
}

/**
 * Arm (or re-arm) the in-process timer for one league's deadline. Re-arming is
 * idempotent: the previous timer for the league is always cleared first, so a
 * refresh from a later sweep does not stack a second timer. A null deadline
 * cancels without arming. The timer is unref'd so a pending expiry never keeps
 * the worker alive on its own.
 */
function armExpiryTimer(leagueId, deadline) {
  cancelExpiryTimer(leagueId);
  if (deadline == null) return;
  const fireInMs = Math.max(0, msUntilDeadline(deadline));
  const timer = setTimeout(() => {
    // This handle has fired and is spent. Drop it from the registry before
    // autopicking so the Map holds only live timers: if the autopick declines
    // (autoPick returns null and re-arms nothing) no stale handle is left
    // behind, and if it commits, its re-arm installs a fresh entry.
    expiryTimers.delete(leagueId);
    fireExpiryTimer(leagueId);
  }, fireInMs);
  if (typeof timer.unref === 'function') timer.unref();
  expiryTimers.set(leagueId, timer);
}

/** Cancel one league's armed timer if it has one. */
function cancelExpiryTimer(leagueId) {
  const timer = expiryTimers.get(leagueId);
  if (timer) {
    clearTimeout(timer);
    expiryTimers.delete(leagueId);
  }
}

/**
 * Tear down every armed timer. The scheduler calls this on stop so a test run
 * or a worker shutdown cannot leak a late Autopick from a timer that outlived
 * the interval that would have fed it (#601).
 */
function cancelAllExpiryTimers() {
  for (const timer of expiryTimers.values()) clearTimeout(timer);
  expiryTimers.clear();
}

/**
 * A fired timer autopicks its league, then re-arms itself for the turn the pick
 * advanced to, so a full Autodraft run moves at the short delay per pick rather
 * than waiting for the next backstop poll. autoPick's own guard makes this
 * safe against a racing sweep: whichever path commits first advances the turn,
 * and the other declines (a future or null next deadline). A null outcome
 * (nothing due, sniped off every candidate, or nothing draftable) arms nothing.
 */
async function fireExpiryTimer(leagueId) {
  try {
    const outcome = await autoPick({ leagueId });
    if (outcome) armExpiryTimer(leagueId, outcome.pickDeadlineAt);
  } catch (err) {
    console.error('draft clock timer fire failed for league %s:', leagueId, err.message);
  }
}

/**
 * Sweep entry point (the scheduler's thin caller), demoted to a backstop by the
 * hybrid (ADR 0018). Every ~10s it reads each active, unpaused draft that has a
 * stored deadline and either:
 *   - autopicks it, if the deadline has already elapsed. This is the restart
 *     and lost-timer path: a deadline that passed while the worker was down (or
 *     whose in-process timer was never armed or was dropped) is recovered here
 *     rather than stalling until a timer that does not exist fires.
 *   - arms (or refreshes) an in-process timer for it, if the deadline is still
 *     in the future, so the fast path fires it on time. Re-arming is idempotent.
 * The autopick's committed next deadline is armed at once so the chain does not
 * wait a full poll for its own next pick. The whole sweep is CONTAINED so a
 * thrown query cannot escape into the worker's interval callback and take the
 * draft clock down for minutes (#600); one bad league is caught inside the loop
 * so it cannot abort the others. The leagues table is small, so scanning every
 * active deadline each pass needs no new index (#601).
 */
async function processExpiredPickClocks() {
  const outcomes = [];
  try {
    const active = await pool.query(
      `SELECT "id", "pick_deadline_at" FROM "leagues"
       WHERE "draft_status" = 'active' AND "draft_paused" = false
         AND "pick_deadline_at" IS NOT NULL`
    );
    for (const row of active.rows) {
      if (msUntilDeadline(row.pick_deadline_at) <= 0) {
        try {
          const outcome = await autoPick({ leagueId: row.id });
          if (outcome) {
            outcomes.push({ leagueId: row.id, playerId: outcome.player.id });
            armExpiryTimer(row.id, outcome.pickDeadlineAt);
          }
        } catch (err) {
          console.error('auto-pick failed for league %s:', row.id, err.message);
        }
      } else {
        armExpiryTimer(row.id, row.pick_deadline_at);
      }
    }
  } catch (err) {
    // Contain the sweep: log and return what we have so the NEXT interval tick
    // still runs, instead of the rejection escaping to the caller and killing
    // the draft-clock loop (#600).
    console.error('draft clock sweep failed:', err.message);
  }
  return outcomes;
}

module.exports = {
  nextPickClockSeconds,
  clockSecondsFor,
  onDraftStarted,
  onPickLanded,
  onPaused,
  onResumed,
  onAutodraftToggled,
  onPickUndone,
  clearClock,
  autoPick,
  processExpiredPickClocks,
  armExpiryTimer,
  cancelExpiryTimer,
  cancelAllExpiryTimers,
};
