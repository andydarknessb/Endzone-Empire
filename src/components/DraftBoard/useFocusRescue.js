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
 * Any change to `signal` is the trigger, but whether the TRACKER is flushed by
 * that change depends on where the caller spreads the handlers, and the two
 * callers differ:
 *  - the RAIL spreads them on a subtree that actually unmounts when its control
 *    vanishes. Focus cannot be HELD inside a subtree that is absent, so every
 *    trip through absence leaves the tracker null and a false -> true edge finds
 *    it null and moves nothing.
 *  - the ROOM spreads them on the wrapper of BOTH arrangements, one of which is
 *    ALWAYS mounted, so a flip never unmounts the tracked wrapper. The tracker is
 *    therefore NOT flushed by the arrangement change; it is cleared only by a
 *    real focus move out (onBlur with a truthy relatedTarget, below) or by a
 *    rescue firing. A held element can outlive the focus that set it and persist
 *    until the next flip - see the onBlur note for the one edge that this leaves.
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
 * the change. It is handed the element that HELD focus (now detached) and
 * returns the element to focus - or an ORDERED LIST of candidates, tried in turn
 * until one actually takes focus. A caller returns the same control if it is
 * rendered again (identified by a stable id that survives the remount, since a
 * generated React id does not) then a fixed landmark: an element that is found
 * but not focusable makes `.focus()` a silent no-op, and without the ordered
 * fallback the landmark would never run and focus would be stranded on `<body>`,
 * the exact failure this hook removes. A falsy value, or a list whose candidates
 * are all absent or unfocusable, leaves focus where the browser put it.
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
      const resolved = resolveTarget(held);
      const candidates = Array.isArray(resolved) ? resolved : [resolved];
      for (let i = 0; i < candidates.length; i += 1) {
        const target = candidates[i];
        if (target) {
          target.focus();
          // A found-but-unfocusable element makes focus() a silent no-op, so
          // only stop once focus ACTUALLY landed on it; otherwise fall through
          // to the next candidate rather than leaving focus on <body>.
          if (document.activeElement === target) break;
        }
      }
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
    //
    // KNOWN, DELIBERATE OVER-TRIGGER: focus lost to nothing is not only an
    // unmount - a click on empty space also blurs with a null relatedTarget - so
    // if the person focuses inside the subtree, clicks away to `<body>`, and only
    // THEN the signal changes, this keeps the held element and the rescue pulls
    // focus back to where they just were rather than leaving it on `<body>`. That
    // is benign (it returns them to the control they were last in) and it is left
    // unchased on purpose: every clean way to tell an unmount from a click-away
    // either cannot separate them at rescue time (the held element is gone in
    // both cases, `document.activeElement` is `<body>` in both) or adds a
    // microtask/rAF that races the synchronous flip commit this hook is built to
    // land inside. Simple and correct for the real cases beats complex for this
    // one. Do not "fix" it into an async check.
    onBlur: (event) => { if (event.relatedTarget) heldEl.current = null; },
  };
}
