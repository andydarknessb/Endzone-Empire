import { useState, useRef, useCallback } from 'react';

/**
 * The container width, in pixels, at or above which the Draft room lays its
 * three panes out side by side; below it, the panes collapse into tabs (issue
 * #444 acceptance criteria 1-3).
 *
 * It is a CONTAINER width, not a viewport width. The Draft room measures the
 * space it actually has - so a room rendered inside a narrower column collapses
 * to tabs even on a wide screen, and a room given the whole page stays in panes
 * - rather than keying off a `useMediaQuery` window breakpoint the way the
 * superseded #122/#123 layout did. 960 leaves each of the three panes a usable
 * width (the centre Chat pane is the widest) at the point they first fit.
 */
export const DRAFT_PANE_MIN_WIDTH = 960;

/**
 * Turn a measured container width into the arrangement the Draft room should
 * use: `'panes'` (wide, three side-by-side regions) or `'tabs'` (narrow, one
 * region at a time).
 *
 * `null` (not yet measured) and `0` (an unmeasurable node - a detached element,
 * or any node in a layout-free environment such as jsdom) both read as
 * `'panes'`. The three-pane arrangement is the default until a real measurement
 * proves the container narrow: a real browser measures before paint, so it
 * never flashes the wrong layout, and the test environment - which never
 * produces a real width - gets the full layout unless a test deliberately
 * supplies a narrow one.
 */
export function draftPaneLayout(width) {
  const narrow = width != null && width > 0 && width < DRAFT_PANE_MIN_WIDTH;
  return narrow ? 'tabs' : 'panes';
}

/**
 * Measure the rendered width of one element and keep it current as the element
 * resizes.
 *
 * Returns `[ref, width]`: attach `ref` (a callback ref) to the element to
 * measure, and read `width` (the element's rendered border-box width in
 * pixels, or `null` before the first measurement). The width is read once
 * synchronously when the ref attaches - inside the commit, before paint, so the
 * first painted frame already has the right value - and then tracked through a
 * ResizeObserver for every later size change. Both paths measure the same box
 * (`getBoundingClientRect().width`) so a resize can never disagree with the
 * initial read by the element's own padding.
 *
 * Where `ResizeObserver` does not exist (jsdom, very old browsers) the width is
 * still measured once on attach; it simply will not update on later resizes,
 * which is the correct graceful degradation for an environment that has no
 * resize events to report anyway.
 */
export default function useContainerWidth() {
  const [width, setWidth] = useState(null);
  const observerRef = useRef(null);

  const ref = useCallback((node) => {
    // A callback ref fires with the new node on attach and with null on detach;
    // in both cases tear down whatever observer the previous node had so one is
    // never left observing a node that is gone.
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;

    setWidth(node.getBoundingClientRect().width);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      // Measure the same box as the attach path above (border-box), rather than
      // the entry's content-box contentRect, so the two readings agree.
      setWidth(node.getBoundingClientRect().width);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return [ref, width];
}
