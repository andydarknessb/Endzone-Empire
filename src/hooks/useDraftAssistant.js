import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { useAnnouncement } from '../components/DraftBoard/useAnnouncement';
import { createLineGenerator } from '../lib/draftAssistant';
import { readDraftAssistantOn, writeDraftAssistantOn } from '../lib/draftAssistantPreference';

/**
 * The Draft assistant's shared MACHINERY, folded out of the two venue
 * presenters that used to each carry their own copy (issue #950, part of the
 * #939 dedupe spec). The Draft room (DraftRoomAssistant.jsx, #787) and the
 * Draft Sim (SimAssistantPanel.jsx, #786) are still one thin presenter per
 * venue (ADR 0027, "venues share primitives, not components"); a hook IS a
 * primitive. The reason to fold is one-machinery-not-two: the two copies had
 * already drifted - the room created its line generator with a lazy useState
 * initializer while the Sim still created it with a render-body ref assignment
 * - and a single shared copy is what stops the machinery from ever diverging
 * again. (The room's lazy-init came from #787/#818-era work; #818 AC3 itself
 * bound only DraftRoomAssistant.jsx, so the Sim's render-body idiom was never a
 * ruling violation, just the un-shared other half.)
 *
 * WHAT IS MACHINERY (owned here): the opt-in toggle and its per-device
 * persistence (draftAssistantPreference), the scrollback list with its
 * SCROLLBACK_LIMIT cap, the single per-draft line generator, the id counter,
 * pushLine (build a line from a facts object, cap the scrollback, optionally
 * speak it), the one polite-region announcement, and the clear-on-toggle-off
 * effect that keeps a stale line from re-surfacing when the region is toggled
 * back on.
 *
 * WHAT IS NOT (stays in each venue): every trigger gate and every fact. Whether
 * a line fires at all, the once-per-turn urgent gate, the turn-boundary reset,
 * the selection cooldown, and the venue-shaped facts builders all remain in the
 * presenter. This hook never decides whether to speak; it only speaks what a
 * presenter hands it. The larger fold, where an engine owns whether a line
 * fires, was considered and rejected (issue #950 "Do, and what NOT to do"):
 * it reverses CONTEXT.md's decide-then-build order.
 */
export const SCROLLBACK_LIMIT = 20;

export function useDraftAssistant({ rng = Math.random } = {}) {
  const [assistantOn, setAssistantOn] = useState(readDraftAssistantOn);
  const [scrollback, setScrollback] = useState([]);
  const [announcement, announce] = useAnnouncement();

  // The one per-draft line generator (#784 ruling 2), created with a lazy
  // useState initializer so REACT owns the storage. Measured under StrictMode
  // in dev (React 18.3.1): the initializer runs TWICE on mount and React
  // retains a single instance; re-renders never re-run it, so the generator is
  // stable, which is what the "no repeat until the pool is exhausted" tracking
  // needs. The reason to prefer useState over a render-body
  // `ref.current = createLineGenerator()` is OWNERSHIP, not call count - both
  // idioms call the factory the same number of times, and the guarded ref form
  // is idempotent today (which is exactly why no test can tell them apart), but
  // a render React discards cannot leave a mutation behind when the value lives
  // in React's own state. That makes this a purity rule enforced by review, not
  // by a gate. This tracking survives every render of one mounted draft and
  // starts fresh for the next.
  const [lineGen] = useState(() => createLineGenerator());
  const nextIdRef = useRef(0);

  const toggleAssistant = useCallback(() => {
    setAssistantOn((prev) => {
      const next = !prev;
      writeDraftAssistantOn(next);
      return next;
    });
  }, []);

  // Clears the permanently-mounted region the moment the toggle goes off, so a
  // later toggle-on never re-shows a stale line before the next real trigger
  // (the #786 idiom StallAnnouncer.jsx also uses). A no-op on an already-empty
  // region.
  useEffect(() => {
    if (!assistantOn) announce('');
  }, [assistantOn, announce]);

  const pushLine = useCallback((facts, { spoken }) => {
    const line = facts ? lineGen(facts, rng) : null;
    if (!line) return;
    nextIdRef.current += 1;
    const id = nextIdRef.current;
    setScrollback((prev) => [{ id, trigger: line.trigger, text: line.text }, ...prev].slice(0, SCROLLBACK_LIMIT));
    if (spoken) announce(line.text);
  }, [lineGen, rng, announce]);

  return {
    assistantOn,
    toggleAssistant,
    scrollback,
    announcement,
    pushLine,
  };
}
