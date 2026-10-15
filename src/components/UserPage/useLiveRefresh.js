import { useEffect, useRef } from 'react';

/**
 * Game-day refresh (spec #2315, ruling 5): while `active` and the tab is
 * visible, calls `onTick` every `intervalMs`, and once when the tab becomes
 * visible again. A hidden tab skips its ticks. Returns nothing.
 */
export function useLiveRefresh({ active, intervalMs = 60000, onTick }) {
  // The latest callback, so a new closure each render never restarts the timer.
  const tick = useRef(onTick);
  useEffect(() => { tick.current = onTick; });

  useEffect(() => {
    if (!active) return undefined;
    const run = () => { if (!document.hidden) tick.current(); };
    const timer = setInterval(run, intervalMs);
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
    };
  }, [active, intervalMs]);
}

export default useLiveRefresh;
