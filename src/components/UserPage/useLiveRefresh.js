import { useEffect, useRef } from 'react';

const VISIBLE_THROTTLE_MS = 30 * 1000;

/**
 * Game-day refresh (spec #2315, ruling 5): while `active` and the tab is
 * visible, calls `onTick` every `intervalMs`. A hidden tab skips its ticks;
 * when it is shown again it refreshes once, but only if the last tick or
 * refresh was at least 30 s ago, and the interval restarts from that refresh so
 * two ticks never land back to back. Returns nothing.
 */
export function useLiveRefresh({ active, intervalMs = 60000, onTick }) {
  // The latest callback, so a new closure each render never restarts the timer.
  const tick = useRef(onTick);
  useEffect(() => { tick.current = onTick; });

  useEffect(() => {
    if (!active) return undefined;
    let last = Date.now();
    let timer;
    const run = () => {
      last = Date.now();
      tick.current();
    };
    const arm = () => {
      clearInterval(timer);
      timer = setInterval(() => { if (!document.hidden) run(); }, intervalMs);
    };
    const onVisibility = () => {
      if (document.hidden || Date.now() - last < VISIBLE_THROTTLE_MS) return;
      run();
      arm();
    };
    arm();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, intervalMs]);
}

export default useLiveRefresh;
