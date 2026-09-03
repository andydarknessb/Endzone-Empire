/**
 * On the clock (CONTEXT.md): the team whose turn it is to pick, and the timer
 * bounding that turn. This module is the one place the client derives that
 * composite, so the room, the presenter and the mock draft speak the pick
 * clock the same way (#754).
 *
 * The value object is `{ team, state, deadlineAt }`:
 *
 * - `team` is the wire `{ teamId, teamName }` or null.
 * - `state` is one of `idle` (nobody is up: pending or complete), `untimed`
 *   (a team is up, no deadline), `running` (a team is up against a deadline)
 *   or `paused`.
 * - `deadlineAt` is the epoch-ms deadline while `running`, else null.
 *
 * The store never holds a per-second field (#754 amendments A1). "Expired"
 * (the deadline passed and the server has not advanced yet) and "urgent"
 * depend on `now`, so they are read off `deadlineAt` by the one leaf that
 * ticks (PickClock), through `remainingSeconds` and `isUrgent`, never stored.
 * Storing `remaining` would make every consumer of this object re-render
 * every second, which is the defect the leaf exists to remove.
 *
 * `remaining` is always one floor, here: an integer count of whole seconds
 * left, 0 once the deadline has passed. Urgency is a fact about the clock,
 * not the viewer: `remaining <= URGENT_SECONDS`, with the threshold exported
 * once. One display format everywhere, `m:ss`.
 *
 * No React in here: one pure function set, several callers.
 */

export const URGENT_SECONDS = 10;

const IDLE = Object.freeze({ team: null, state: 'idle', deadlineAt: null });

/**
 * Derive the On-the-clock value from a draft snapshot.
 *
 * @param {object} input
 * @param {{teamId: number, teamName: string}|null} [input.team] the team up
 * @param {number|null} [input.deadlineAt] epoch ms the pick is due, or null
 * @param {boolean} [input.paused] whether the draft is paused
 * @param {boolean} [input.active] whether the draft is active at all
 */
export function deriveOnTheClock({ team = null, deadlineAt = null, paused = false, active = false } = {}) {
  if (!active || !team) return IDLE;
  if (paused) return { team, state: 'paused', deadlineAt: null };
  if (deadlineAt == null) return { team, state: 'untimed', deadlineAt: null };
  return { team, state: 'running', deadlineAt };
}

/**
 * Whole seconds left in `remainingMs` (a deadline minus now), floored, never
 * below 0. The single floor: the PickClock leaf feeds it the hook's remaining
 * milliseconds, and nothing else computes seconds.
 */
export function remainingSeconds(remainingMs) {
  return Math.max(0, Math.floor(remainingMs / 1000));
}

/** Whether a remaining-seconds count is inside the urgency window. */
export function isUrgent(remaining) {
  return remaining != null && remaining <= URGENT_SECONDS;
}

/** Whether `teamId` is the team on the clock. False for a null value, team or id. */
export function isTeamOnTheClock(onTheClock, teamId) {
  const upId = onTheClock?.team?.teamId;
  return upId != null && teamId != null && upId === teamId;
}

/** `m:ss` for a remaining-seconds count: 0 -> "0:00", 90 -> "1:30". */
export function formatRemaining(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
