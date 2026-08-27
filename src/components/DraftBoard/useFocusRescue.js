import { useRef, useLayoutEffect } from 'react';

/**
 * Hand focus somewhere deliberate when the subtree a person is focused inside is
 * torn down by a React render, instead of letting the browser drop focus to
 * `<body>` - which restarts the next Tab at the top of the document and
 * announces nothing at all.
 *
 * Two things in the Draft room lose a focusable subtree out from under a
 * manager, and both are assistive-technology-only failures:
 *  - the rail's own vanishing controls (the Readiness exception list when the
 *    last manager declares ready, the picks popover when the viewer's last pick
 *    lands), which come and go in response to what OTHER managers do; and
 *  - the whole region subtree, when the room crosses its pane threshold and the
 *    three side-by-side panes collapse into tabs (or back) - a tablet rotation,
 *    a desktop resize or window snap, or a zoom (#525).
 *
 * `signal` is the value whose CHANGE marks the tear-down/rebuild: the rail
 * passes a boolean `present` (true -> false as its control vanishes); the room
 * passes its `'panes' | 'tabs'` arrangement, which flips across the threshold.
 * Any change to `signal` is the trigger - a false -> true is harmless because
 * focus can only be HELD inside a subtree that is present, so the tracked
 * element is null across a mount and nothing moves.
 *
 * Focus is moved only when it was actually inside the subtree that changed,
 * tracked by the returned focus/blur handlers spread onto that subtree: a
 * manager focused elsewhere (navigation, a dialog, the tabs, another rail
 * panel) must not have focus yanked away, and that is the condition a rescue
 * firing on every arrangement change gets wrong. React's synthetic focus events
 * bubble through the React tree rather than the DOM, so these still see focus
 * land inside a portalled popover.
 *
 * `resolveTarget(heldElement)` chooses where focus goes, called at the moment of
 * the change. It is handed the element that HELD focus (now detached) so a
 * caller can return focus to that same control if it is rendered again -
 * identified by a stable id that survives the remount, since a generated React
 * id does not - and fall back to a fixed landmark otherwise. It returns the
 * element to focus, or a falsy value to leave focus where the browser put it.
 *
 * `useLayoutEffect`, not `useEffect`, so the move lands in the SAME commit as
 * the tear-down/rebuild, with no painted frame in which focus is on nothing.
 */
export default function useFocusRescue(signal, resolveTarget) {
  const heldEl = useRef(null);
  const prevSignal = useRef(signal);

  useLayoutEffect(() => {
    const changed = !Object.is(prevSignal.current, signal);
    prevSignal.current = signal;
    if (changed && heldEl.current) {
      const held = heldEl.current;
      heldEl.current = null;
      const target = resolveTarget(held);
      if (target) target.focus();
    }
  }, [signal, resolveTarget]);

  return {
    onFocus: (event) => { heldEl.current = event.target; },
    // A blur that carries a `relatedTarget` is the person moving focus to
    // another real element - they navigated away, so stop tracking. A blur with
    // no relatedTarget is focus lost to `<body>`, which is exactly what a real
    // browser does when the focused control is REMOVED by the tear-down this
    // hook exists to rescue: keep the held element so the layout effect above,
    // running in that same commit, can still hand focus somewhere deliberate.
    // (jsdom fires no blur on unmount at all, so this branch only bites in a
    // real browser; the unit tests exercise the kept-element path directly.)
    onBlur: (event) => { if (event.relatedTarget) heldEl.current = null; },
  };
}
