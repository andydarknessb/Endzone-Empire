import PropTypes from 'prop-types';
import useCountdownTicking from '../../hooks/useCountdownTicking';
import { remainingAt } from '../../lib/onTheClock';

// Align each repaint to the deadline's true whole-second boundary (the ms left
// until the next whole second), so the digits - and the banner's urgency pulse,
// which starts on the render that first shows 0:10 - change on the deadline's
// own boundaries rather than drifting from the phase this happened to mount at.
const boundaryDelay = (remainingMs) => ((remainingMs % 1000) + 1000) % 1000 || 1000;

/**
 * The one per-second re-render in the draft room (#754, A2). It owns the
 * countdown tick off a fixed `deadlineAt` (epoch ms) and hands the whole-second
 * `remaining` to its render callback. The store holds no per-second field, so
 * mounting this leaf - and nothing above it - is what re-renders each second;
 * the rest of the room (the pool, the board, the rail) does not (see the
 * isolation test in DraftBoard.test.jsx).
 *
 * `remaining` is 0 once the deadline has passed, which is the derived "expired"
 * display (A1): a running clock at 0:00, urgent, with no separate stored state.
 */
function PickClock({ deadlineAt, children }) {
  // Ticks and re-renders this leaf; the value is re-read from `deadlineAt` below
  // through the same single floor (remainingAt) the rest of the app uses.
  useCountdownTicking(deadlineAt, undefined, { nextDelay: boundaryDelay });
  return children(remainingAt(deadlineAt, Date.now()));
}

PickClock.propTypes = {
  deadlineAt: PropTypes.number.isRequired,
  // Given the whole-second `remaining`, returns what to render (the timer text,
  // and any urgency styling the mounting surface wants around it).
  children: PropTypes.func.isRequired,
};

export default PickClock;
