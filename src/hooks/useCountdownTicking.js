import { useEffect, useRef, useState } from 'react';

const DEFAULT_CADENCE_MS = 1000;

/**
 * Next delay that lands the following tick on the deadline's own whole-second
 * boundary rather than a fixed cadence after this tick. A flat 1000 ms
 * reschedule phase-locks the digits to whenever the component mounted; this
 * phase-locks them to the true second roll-over, so a digit changes exactly
 * when the count does and any animation started on a tick shares that phase
 * (#754 amendments A3). Never 0: a tick that lands dead on the boundary waits
 * a full second for the next one.
 */
export function alignedToSecond(remainingMs) {
  return ((remainingMs % 1000) + 1000) % 1000 || 1000;
}

/**
 * Self-scheduling countdown state: the only thing that re-renders on a tick
 * is the component that calls this hook, so the tree around it is isolated
 * from the per-second repaint (#117's isolation, lifted out of Countdown so
 * the Draft room's pick clock can share it, #754 amendments A3).
 *
 * Each tick chooses its own next delay from its own remaining time through
 * `nextDelay(remainingMs)`, so a caller can run a tiered cadence (Countdown:
 * once a minute far out, once a second under an hour) or align every tick to
 * the second boundary (PickClock, `alignedToSecond`). Ticking stops at zero;
 * `onExpire` fires once there, read through a ref so a changed callback never
 * re-arms the timer.
 *
 * @param {number} targetTime epoch ms
 * @param {object} [options]
 * @param {() => void} [options.onExpire]
 * @param {(remainingMs: number) => number} [options.nextDelay] defaults to a flat 1000 ms
 * @returns {number} milliseconds remaining as of the last tick (may be negative)
 */
export default function useCountdownTicking(targetTime, { onExpire, nextDelay } = {}) {
  const [remainingMs, setRemainingMs] = useState(() => targetTime - Date.now());
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const nextDelayRef = useRef(nextDelay);
  nextDelayRef.current = nextDelay;

  useEffect(() => {
    let timeoutId;

    const tick = () => {
      const remaining = targetTime - Date.now();
      setRemainingMs(remaining);
      if (remaining <= 0) {
        onExpireRef.current?.();
        return;
      }
      const delay = nextDelayRef.current ? nextDelayRef.current(remaining) : DEFAULT_CADENCE_MS;
      timeoutId = setTimeout(tick, delay);
    };

    tick();
    return () => clearTimeout(timeoutId);
  }, [targetTime]);

  return remainingMs;
}
