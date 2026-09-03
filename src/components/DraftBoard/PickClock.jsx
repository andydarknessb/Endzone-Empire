import React from 'react';
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
 */
function PickClock({ deadlineAt, prefix = null, variant = 'h1', onOverdue = null }) {
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
};

export default PickClock;
