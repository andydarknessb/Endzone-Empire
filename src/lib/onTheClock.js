// On the clock (CONTEXT.md: "the team whose turn it is to pick, and the timer
// bounding that turn") derived in one place for every draft surface: the room
// socket store, the mock-draft sim status bar, and the public presenter.
//
// Decisions 3 to 5 of issue #754, as amended 2026-09-02 (review candidate #5,
// "one ticking leaf"):
//   - The stored value is { team, state, deadlineAt } and NEVER a per-second
//     field. `state` is one of idle | untimed | running | paused. `expired` is
//     not a stored state - it depends on `now`, so the ticking leaf (PickClock)
//     derives it as `running` with `remaining === 0`. This is what keeps a tick
//     from re-rendering the whole room every second (see the isolation test in
//     DraftBoard.test.jsx and the #754 amendments).
//   - `remaining` is an integer from a single floor in `remainingAt`, null when
//     there is no live deadline and 0 once the deadline has passed.
//   - There is one format, "m:ss" (`formatRemaining`), and one urgency rule
//     (`isUrgent`, keyed off the single exported `URGENT_SECONDS`).
//
// No React import: this is a pure module. The ticking lives in the shared
// countdown hook under src/hooks, called by the PickClock leaf (decision 6/7).

// The one urgency threshold, exported once so the banner and the sim read the
// same number instead of each spelling `<= 10` (decision 4).
export const URGENT_SECONDS = 10;

/**
 * Map a league snapshot to the stored on-the-clock value. No `now` argument:
 * the value the store holds carries no per-second field (A1). `deadlineAt` is
 * epoch ms or null; `paused`/`active` are the league's own booleans.
 *
 * States:
 *   idle     - nobody on the clock (pending or complete): `team` is null.
 *   untimed  - a team is up but there is no live deadline.
 *   running  - a team is up and a deadline is counting down.
 *   paused   - a team is up but the draft is paused (no live timer).
 */
export function deriveOnTheClock({ team, deadlineAt, paused, active }) {
  if (!team) return { team: null, state: 'idle', deadlineAt: null };
  if (paused) return { team, state: 'paused', deadlineAt: null };
  if (active && deadlineAt != null) return { team, state: 'running', deadlineAt };
  return { team, state: 'untimed', deadlineAt: null };
}

/** Whether `teamId` is the team on the clock. Reads the value object's own
 *  `team`, so a null value (or a value with no team) is simply "no". */
export function isTeamOnTheClock(onTheClock, teamId) {
  const clockTeamId = onTheClock?.team?.teamId;
  return clockTeamId != null && teamId != null && clockTeamId === teamId;
}

/** Whole seconds left until `deadlineAt` (epoch ms), never negative; null when
 *  there is no deadline. The single floor that decision 3 asks for. */
export function remainingAt(deadlineAt, now) {
  if (deadlineAt == null) return null;
  return Math.max(0, Math.floor((deadlineAt - now) / 1000));
}

/** Urgency is a fact about the clock, not the viewer (decision 4): true once
 *  `remaining` is at or below the threshold. Null remaining is never urgent. */
export function isUrgent(remaining, threshold = URGENT_SECONDS) {
  return remaining != null && remaining <= threshold;
}

/** The one pick-clock format, "m:ss" (decision 5): 0 -> "0:00", 90 -> "1:30",
 *  600 -> "10:00". Clamps junk and negatives to 0. */
export function formatRemaining(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}
