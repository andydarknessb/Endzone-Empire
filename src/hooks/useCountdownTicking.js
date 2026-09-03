import { useEffect, useRef, useState } from 'react';

/**
 * Self-scheduling countdown: repaints itself off a self-rescheduling timeout
 * (not a fixed interval), and returns the raw `remainingMs` (target - now) at
 * each tick. This is the ONLY piece that re-renders every tick, so a consumer
 * that mounts just this leaf keeps its ticking state isolated from the page
 * tree around it (#117 for Countdown; #754 for the draft room's PickClock).
 *
 * `nextDelay(remainingMs)` chooses each tick's own next delay from its own
 * remaining time, so the cadence can adapt as the clock winds down:
 *   - Countdown passes `cadenceFor(tierFor(remaining))`, so a countdown that
 *     starts hours out automatically picks up per-second updates once it
 *     crosses into the seconds tier.
 *   - PickClock passes boundary alignment, so its digits change on the
 *     deadline's true whole-second boundaries rather than drifting from the
 *     phase it happened to mount at.
 * With no `nextDelay` it falls back to a flat one-second cadence.
 *
 * Extracted from Countdown.jsx to src/hooks per #754 (A3) so the draft-room
 * PickClock can share the exact ticking machinery instead of growing a second,
 * subtly different one.
 */
export default function useCountdownTicking(targetTime, onExpire, { nextDelay } = {}) {
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
      const delay = nextDelayRef.current ? nextDelayRef.current(remaining) : 1000;
      timeoutId = setTimeout(tick, delay);
    };

    tick();
    return () => clearTimeout(timeoutId);
  }, [targetTime]);

  return remainingMs;
}
