const { teamForPick } = require('./draftOrder.service');

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
 * Expiry detection is deliberately NOT here yet (spec #598): the existing
 * worker sweep keeps firing autopicks exactly as today. This slice consolidates
 * arming only (#599).
 */

const AUTODRAFT_DELAY_FLOOR = 1;

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
};
