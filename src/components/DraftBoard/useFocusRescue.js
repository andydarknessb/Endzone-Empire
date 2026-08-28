import { useRef, useEffect, useLayoutEffect } from 'react';

// ---------------------------------------------------------------------------
// Pointer intent (issue #532).
//
// The null-relatedTarget blur below has TWO producers that are indistinguishable
// by DOM state at the instant it fires, and #532 established that empirically
// rather than by assumption (a probe against Chromium and WebKit, both the raw
// DOM primitive and the real Draft room):
//   - CHROMIUM fires the blur BEFORE it detaches the removed node, so
//     `event.target.isConnected` reads TRUE for a real tear-down - identical to
//     a click-away. The obvious "the torn-down element is already detached"
//     distinguisher does NOT hold here.
//   - WEBKIT delivers no focusout to a stable ancestor on removal at all, so
//     there is nothing to read in the first place.
// So isConnected cannot separate the cases in either engine. What DOES differ,
// synchronously, is INTENT: a user click-away to non-focusable content is always
// preceded - in the SAME synchronous event turn - by a pointerdown; a tear-down
// (the room's ResizeObserver-driven pane flip, or a rail control removed by
// another manager's socket event) has no pointerdown behind it.
//
// `pointerGestureActive` is true for the span of ONE pointer gesture (set on
// pointerdown, cleared on pointerup/pointercancel - see ensurePointerListener):
// the click-away's focus move and its null-relatedTarget blur happen on
// pointerdown, so onBlur reads it true; a tear-down blur has no gesture in
// flight and reads it false. The rescue itself stays fully synchronous in the
// layout effect above - there is no timer, microtask or rAF whose firing could
// race the flip commit, so no async race and no painted body-focus frame
// (issue #525 AC3). (A microtask reset was measured and drains BEFORE the blur
// in real browsers, which would have left the fix silently inert - #532.)
//
// WHY THIS IS CORRECT FOR THIS APP, AND NOT UNIVERSALLY: pointer intent is a
// safe distinguisher here only because no user pointerdown can itself tear down a
// tracked subtree. Today that holds because (a) the arrangement is chosen from a
// ResizeObserver measurement - a rotation, resize, window snap or zoom - never
// from an in-app click; (b) the rail's two signals (hasExceptionList,
// hasViewerPicks) are driven by socket state, not by the viewer's pointer; and
// (c) a pointer that moves focus to a real control takes the truthy-relatedTarget
// path below and clears the hold before this branch is ever reached.
//
// WHAT WOULD BREAK IT: add a draggable pane divider / splitter / resizer, or any
// other control whose own pointerdown tears down a subtree a manager is focused
// inside, and this branch will read that tear-down as a click-away, clear the
// hold, and SILENTLY turn the rescue into a no-op for that path. If you are here
// to add a resizable split, you must give the tear-down its own signal that does
// not depend on pointer intent, and cover it with a test - do not rediscover
// this by a bug report.
let pointerGestureActive = false;
let pointerListenerInstalled = false;

function ensurePointerListener() {
  if (pointerListenerInstalled || typeof document === 'undefined') return;
  pointerListenerInstalled = true;
  // The flag is true for the span of ONE pointer gesture: set on pointerdown,
  // cleared when that gesture ends (pointerup/pointercancel). A click-away's
  // focus move - and the null-relatedTarget blur it produces - happens on
  // pointerdown, BEFORE pointerup, so onBlur reads the flag true; a tear-down
  // blur has no gesture in flight and reads it false. This is a gesture window,
  // not a timer: no setTimeout/rAF, so there is nothing whose firing could race
  // the synchronous flip commit (a microtask reset was tried and drains BEFORE
  // the blur in real browsers, which would have made the fix silently inert -
  // #532 measured this). Capture phase so a child that stops propagation is
  // still seen; passive since we only observe the gesture.
  const clear = () => { pointerGestureActive = false; };
  document.addEventListener('pointerdown', () => { pointerGestureActive = true; }, { capture: true, passive: true });
  document.addEventListener('pointerup', clear, { capture: true, passive: true });
  document.addEventListener('pointercancel', clear, { capture: true, passive: true });
}

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

  // One shared document pointerdown listener for every hook instance - pointer
  // intent is a property of the gesture, not of an instance (issue #532).
  useEffect(() => { ensurePointerListener(); }, []);

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
    // another real element - they navigated away, so stop tracking. This leaves
    // outside chrome, dialogs and tabs untouched by any later flip.
    //
    // A blur with NO relatedTarget is focus lost to `<body>`, and it has two
    // producers that the DOM cannot tell apart at this instant (see the pointer
    // intent note at the top of this file for the two-engine probe that
    // established it):
    //   - the tear-down this hook exists to rescue - a real browser drops focus
    //     to `<body>` when the focused control is REMOVED - where the held
    //     element must SURVIVE so the layout effect above, running in that same
    //     commit, can hand focus somewhere deliberate; and
    //   - a user CLICK-AWAY to non-focusable content (a pane background, dead
    //     space, a text selection), where the held element must be INVALIDATED so
    //     a later flip does not yank focus back to where the user deliberately
    //     left it (issue #532).
    // The one thing that separates them synchronously is pointer intent: the
    // click-away's blur fires in the same turn as its pointerdown, so
    // `pointerGestureActive` is true; the tear-down has no pointer behind it, so
    // it is false and the hold survives. jsdom fires no blur on unmount, so the
    // unit tests drive both edges of this branch directly.
    onBlur: (event) => {
      if (event.relatedTarget || pointerGestureActive) heldEl.current = null;
    },
  };
}
