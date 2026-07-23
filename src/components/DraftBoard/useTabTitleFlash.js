import { useEffect } from 'react';

/** Flashes the tab title while it's the user's pick and the tab is in the
 * background, so they notice from another tab. Stops (and restores the
 * title) on focus/visibility or once it's no longer their turn. */
export default function useTabTitleFlash(isMyTurn) {
  useEffect(() => {
    if (!isMyTurn) return undefined;
    const original = document.title;
    let intervalId = null;
    let flip = false;
    const start = () => {
      if (intervalId) return;
      intervalId = setInterval(() => {
        document.title = flip ? original : '⏰ Your pick!';
        flip = !flip;
      }, 1000);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      document.title = original;
    };
    const onVisibility = () => {
      if (document.hidden) start();
      else stop();
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', stop);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', stop);
      stop();
    };
  }, [isMyTurn]);
}
