import React from 'react';
import PropTypes from 'prop-types';
import { Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import useCountdownTicking, { alignedToSecond } from '../../hooks/useCountdownTicking';
import { formatRemaining, isUrgent, remainingSeconds } from '../../lib/onTheClock';

// Subtle pulse for the timer once time is running low. Starts on the render
// that first shows the urgent count and, because every tick lands on the
// second boundary (alignedToSecond), each later digit change lands on the
// opacity-1 keyframe of this cycle rather than mid-fade.
const pulse = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.55; }
  100% { opacity: 1; }
`;

/**
 * The pick clock's ticking leaf: the ONE component in a Draft room (or the
 * presenter) that re-renders every second (#754 amendments A2). It takes the
 * deadline, owns its own tick, and renders `m:ss`; the store above it holds
 * the deadline and never a per-second field, so a tick reaches nothing else.
 *
 * Keeps showing `0:00`, urgent, once the deadline has passed and the server
 * has not advanced yet (#614 owns how long that can last). Tabular digits so
 * a changing count never reflows its neighbours; the urgency pulse is off
 * under prefers-reduced-motion, with the urgent colour carrying the signal.
 *
 * In the room it stays OUT of the banner's aria-live region: the count
 * changes every second and would be read out every second (#445 AC3). The
 * presenter keeps its own, pre-existing live-region posture around it.
 */
function PickClock({ deadlineAt, prefix = null, variant = 'h1' }) {
  const remainingMs = useCountdownTicking(deadlineAt, { nextDelay: alignedToSecond });
  const remaining = remainingSeconds(remainingMs);
  const urgent = isUrgent(remaining);

  return (
    <Typography
      variant={variant}
      component="div"
      data-testid="draft-clock"
      sx={{
        fontWeight: 'bold',
        lineHeight: 1.1,
        flexShrink: 0,
        fontVariantNumeric: 'tabular-nums',
        color: urgent ? 'error.main' : 'text.primary',
        animation: urgent ? `${pulse} 1s ease-in-out infinite` : 'none',
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
      }}
    >
      {prefix ? `${prefix} ` : ''}
      {formatRemaining(remaining)}
    </Typography>
  );
}

PickClock.propTypes = {
  deadlineAt: PropTypes.number.isRequired,
  prefix: PropTypes.string,
  variant: PropTypes.string,
};

export default PickClock;
