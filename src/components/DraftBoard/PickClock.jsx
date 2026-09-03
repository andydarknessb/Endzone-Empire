import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { Box, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import useCountdownTicking, { alignedToSecond } from '../../hooks/useCountdownTicking';
import { OVERDUE_AFTER_MS, formatRemaining, isUrgent, remainingSeconds } from '../../lib/onTheClock';

// Subtle pulse for the timer once time is running low. Starts on the render
// that first shows the urgent count and, because every tick lands on the
// second boundary (alignedToSecond), each later digit change lands on the
// opacity-1 keyframe of this cycle rather than mid-fade.
const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.55; }
  100% { opacity: 1; }
`;

// The one string a room shows once a clock is Overdue. Sentence case, no
// em-dash (house style), and deliberately NOT a claim that autopick is running:
// the room cannot know that, only that the server now owns the next move.
export const OVERDUE_MESSAGE = 'Waiting on the server';

/**
 * The pick clock's ticking leaf: the ONE component in a Draft room (or the
 * presenter) that re-renders every second (#754 amendments A2). It takes the
 * deadline, owns its own tick, and renders `m:ss`; the store above it holds
 * the deadline and never a per-second field, so a tick reaches nothing else.
 *
 * Expired vs Overdue (#769). "Expired" is the ordinary moment the deadline
 * passes: digits sit at `0:00`, urgent, while the server advances the clock -
 * moments on the timer path, up to 10s on an API-armed clock (#614). "Overdue"
 * is expired for longer than OVERDUE_AFTER_MS and still undischarged: the pulse
 * means "act now" and nobody in the room can act on a clock the server owns, so
 * urgency ends and the leaf says the room is waiting. A SECOND countdown, to
 * `deadlineAt + OVERDUE_AFTER_MS`, provides that flag: the store never holds it
 * (#754 A1) and the hook stops at zero by contract (Countdown depends on that),
 * so a second `useCountdownTicking` reaching zero - never a bare setTimeout,
 * never a hook change - is the transition (#769 ruling 1). `onOverdue` fires
 * once at the crossing so the banner can announce it a single time.
 *
 * Tabular digits so a changing count never reflows its neighbours; the urgency
 * pulse is off under prefers-reduced-motion, with the urgent colour carrying
 * the signal.
 *
 * In the room it stays OUT of the banner's aria-live region: the count changes
 * every second and would be read out every second (#445 AC3), so the room's
 * single once-per-turn announcement of the Overdue copy is the banner's job
 * (#769 ruling 4), not this leaf's. The presenter keeps its own, pre-existing
 * live-region posture around it and inherits the copy under the digits.
 *
 * `onUrgent` fires ONCE per turn, at the crossing into the urgent window
 * (issue #787 ruling item 2). It hands the Draft assistant the urgent edge this
 * leaf ALREADY computes for its own pulse (`showUrgent`), so the assistant adds
 * no second ticking leaf and no second urgency reading - the same reuse the
 * Overdue announcement makes of `onOverdue`. It is keyed to the deadline (#816),
 * so a new turn's clock can cross and fire again; a clock that mounts already
 * urgent fires on that first render, and a clock that arrives already urgent
 * right after one that was also already urgent still fires for the new turn.
 */
function PickClock({
  deadlineAt, prefix = null, variant = 'h1', onOverdue = null, onUrgent = null,
}) {
  const remainingMs = useCountdownTicking(deadlineAt, { nextDelay: alignedToSecond });
  const overdueRemainingMs = useCountdownTicking(deadlineAt + OVERDUE_AFTER_MS, {
    nextDelay: alignedToSecond,
    onExpire: onOverdue ?? undefined,
  });

  const remaining = remainingSeconds(remainingMs);
  const overdue = overdueRemainingMs <= 0;
  // Overdue drops the urgency signal entirely: the pulse said "act now" and no
  // one in the room can, so it and the error colour end while the digits stay.
  const showUrgent = isUrgent(remaining) && !overdue;

  // The once-per-turn urgent edge, off the same window `showUrgent` uses for
  // the pulse. A single effect compares the deadline it last fired for
  // against the current `deadlineAt` (#816): it fires when this turn is
  // inside the urgent window and isn't the turn already fired for.
  //
  // It deliberately does NOT trust the render's `showUrgent` for the firing
  // CHECK (the "fire on the true/false/true edge" shape this replaces): after
  // a deadline swap, `useCountdownTicking`'s `remainingMs` state still holds
  // the OUTGOING turn's value for one render, until that hook's own effect
  // (keyed on the new `deadlineAt`) catches up. Two consecutive
  // already-urgent deadlines both read `true` straight through that stale
  // render with no edge to see - that's the #816 bug. The mirror case is why
  // reading `showUrgent` in the BODY over-fires instead: a turn that is
  // genuinely NOT yet urgent can transiently inherit the outgoing turn's
  // stale `true` on that same render and must not fire on it. So the check is
  // re-derived straight from `deadlineAt` and `Date.now()` - always accurate
  // for the CURRENT turn, never lagged by that hook's own state - rather than
  // from `remaining`/`showUrgent`.
  //
  // `showUrgent` still belongs in the DEPS array below, though, even though
  // the body never reads it: it's the only dep that changes mid-turn, when
  // ticking crosses into urgency without `deadlineAt` or `onUrgent` changing.
  // Drop it and a turn that starts non-urgent never re-checks and never
  // fires. No lint rule catches that (eslint is clean on this file today), so
  // this sentence is the only guard - keep the dep even though it looks
  // unused inside the effect.
  const lastFiredDeadlineRef = useRef(null);
  useEffect(() => {
    const freshRemaining = remainingSeconds(deadlineAt - Date.now());
    const freshOverdue = deadlineAt + OVERDUE_AFTER_MS - Date.now() <= 0;
    const isCurrentlyUrgent = isUrgent(freshRemaining) && !freshOverdue;
    if (isCurrentlyUrgent && lastFiredDeadlineRef.current !== deadlineAt) {
      lastFiredDeadlineRef.current = deadlineAt;
      onUrgent?.();
    }
  }, [deadlineAt, showUrgent, onUrgent]);

  return (
    <Box sx={{ flexShrink: 0, textAlign: prefix ? 'left' : 'right' }}>
      <Typography
        variant={variant}
        component="div"
        data-testid="draft-clock"
        sx={{
          fontWeight: 'bold',
          lineHeight: 1.1,
          fontVariantNumeric: 'tabular-nums',
          color: showUrgent ? 'error.main' : 'text.primary',
          animation: showUrgent ? `${pulse} 1s ease-in-out infinite` : 'none',
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        {prefix ? `${prefix} ` : ''}
        {formatRemaining(remaining)}
      </Typography>
      {overdue ? (
        <Typography
          variant="caption"
          component="div"
          data-testid="draft-clock-overdue"
          sx={{ color: 'text.secondary', fontWeight: 'normal', lineHeight: 1.2 }}
        >
          {OVERDUE_MESSAGE}
        </Typography>
      ) : null}
    </Box>
  );
}

PickClock.propTypes = {
  deadlineAt: PropTypes.number.isRequired,
  prefix: PropTypes.string,
  variant: PropTypes.string,
  onOverdue: PropTypes.func,
  onUrgent: PropTypes.func,
};

export default PickClock;
