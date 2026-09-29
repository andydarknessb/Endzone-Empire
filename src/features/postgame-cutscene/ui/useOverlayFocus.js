import { useEffect, useRef } from 'react';

// The alertdialog focus behaviour of the touchdown cutscene (#911), copied
// deliberately rather than imported: a feature never imports another feature.
// If the two ever need to drift together, promote this to `shared` (ADR 0031).

// Everything inside the overlay a Tab could land on.
export const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Exactly ONE overlay traps focus at a time: the most recently mounted. Two
// pull-backs both refusing to let focus sit outside themselves would bounce it
// between them until the stack blows, so only the top of the stack acts.
const openOverlays = [];

/**
 * Focus in on mount, hold focus while shown, and hand it back to whatever held
 * it when the overlay closes. Returns the overlay ref and the Tab handler.
 *
 * The pull-back effect is declared BEFORE the mount effect so that on unmount
 * its cleanup runs FIRST and the restored focus is not clawed back by an
 * overlay on its way out.
 */
export default function useOverlayFocus() {
  const overlayRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    const self = overlayRef;
    openOverlays.push(self);
    const pullBack = (event) => {
      if (openOverlays[openOverlays.length - 1] !== self) return;
      const overlay = overlayRef.current;
      if (!overlay || !overlay.isConnected || overlay.contains(event.target)) return;
      overlay.focus();
    };
    document.addEventListener('focusin', pullBack);
    return () => {
      document.removeEventListener('focusin', pullBack);
      const at = openOverlays.indexOf(self);
      if (at !== -1) openOverlays.splice(at, 1);
    };
  }, []);

  useEffect(() => {
    const previous = document.activeElement;
    restoreRef.current = previous && previous !== document.body ? previous : null;
    if (overlayRef.current) overlayRef.current.focus();
    return () => {
      const back = restoreRef.current;
      restoreRef.current = null;
      // A restore into a node the page has since dropped would land focus on
      // nothing, which is the failure this exists to prevent.
      if (back && back.isConnected) back.focus();
    };
  }, []);

  /** Tab stays inside the overlay; with nothing focusable it is refused. */
  const trapTab = (event) => {
    const overlay = overlayRef.current;
    const stops = overlay ? Array.from(overlay.querySelectorAll(FOCUSABLE)) : [];
    if (!stops.length) {
      event.preventDefault();
      if (overlay) overlay.focus();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === overlay)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { overlayRef, trapTab };
}
