import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { useDraftAssistant, SCROLLBACK_LIMIT } from './useDraftAssistant';
import { DRAFT_ASSISTANT_KEY } from '../lib/draftAssistantPreference';
import { TRIGGERS, fillTemplate, POLK_HIGH_LEGEND_LINES } from '../lib/draftAssistant';

// rng() => 0 always draws the FIRST remaining index of a trigger's pool
// (lineFor.js's drawIndex), so successive draws for ONE trigger from ONE stable
// generator are deterministic: pool[0], then pool[1], and so on.
const firstDraw = () => 0;

const stealFacts = { trigger: TRIGGERS.PICK_STEAL, player: { name: 'Steal Star' }, pickNumber: 20 };
const stealLine = (i) => fillTemplate(POLK_HIGH_LEGEND_LINES[TRIGGERS.PICK_STEAL][i], stealFacts);

// The hook is the folded machinery both venue presenters share (#950). These
// cover that machinery by rendering the hook rather than two full presenters.
// This does NOT reduce the venue suites to trigger gates alone: each still
// asserts its own display bindings (the toggle-to-panel-visibility wiring), and
// SimAssistantPanel.test.jsx keeps #786's presenter-level clear-on-toggle-off
// accessibility guard - it renders the real PoliteRegion end to end, a
// different claim from this hook's `announcement === ''`. That split is
// intentional and complete; the Sim's clear-on-off case is not leftover.
const strictWrapper = ({ children }) => <React.StrictMode>{children}</React.StrictMode>;

beforeEach(() => {
  window.localStorage.clear();
});

describe('useDraftAssistant (#950 folded machinery)', () => {
  it('caps the scrollback at SCROLLBACK_LIMIT, newest first, dropping the oldest', () => {
    const { result } = renderHook(() => useDraftAssistant({ rng: firstDraw }));

    act(() => {
      for (let n = 0; n < SCROLLBACK_LIMIT + 1; n += 1) {
        result.current.pushLine(stealFacts, { spoken: false });
      }
    });

    // Red-tell for criterion 4's cap deletion: removing the `.slice(0,
    // SCROLLBACK_LIMIT)` in pushLine (or raising the limit) makes this length
    // assertion fail - SCROLLBACK_LIMIT + 1 lines would all survive.
    const { scrollback } = result.current;
    expect(scrollback).toHaveLength(SCROLLBACK_LIMIT);
    // Newest first: the last push (id SCROLLBACK_LIMIT + 1) leads, and the very
    // first push (id 1) has fallen off the end.
    expect(scrollback[0].id).toBe(SCROLLBACK_LIMIT + 1);
    expect(scrollback[scrollback.length - 1].id).toBe(2);
    expect(scrollback.some((entry) => entry.id === 1)).toBe(false);
  });

  it("persists the toggle per device and reads it back on a fresh mount", () => {
    const { result: firstResult } = renderHook(() => useDraftAssistant());
    // Nothing stored: off.
    expect(firstResult.current.assistantOn).toBe(false);

    act(() => firstResult.current.toggleAssistant());

    // Red-tell for criterion 4's toggle deletion: dropping the
    // writeDraftAssistantOn call in toggleAssistant leaves storage untouched, so
    // both the persisted-string assertion and the fresh-mount read below fail.
    expect(firstResult.current.assistantOn).toBe(true);
    expect(window.localStorage.getItem(DRAFT_ASSISTANT_KEY)).toBe('1');

    // A brand new mount (a different device session, or a reload) reads the
    // stored choice back as its initial state.
    const { result: secondResult } = renderHook(() => useDraftAssistant());
    expect(secondResult.current.assistantOn).toBe(true);
  });

  it('clears the announcement the moment the toggle goes off, so a stale line cannot re-surface', () => {
    window.localStorage.setItem(DRAFT_ASSISTANT_KEY, '1');
    const { result } = renderHook(() => useDraftAssistant({ rng: firstDraw }));
    expect(result.current.assistantOn).toBe(true);

    act(() => result.current.pushLine(stealFacts, { spoken: true }));
    expect(result.current.announcement).toBe(stealLine(0));

    act(() => result.current.toggleAssistant()); // -> off
    // Red-tell: removing the clear-on-toggle-off effect leaves the old line in
    // the region, so this equality (to '') fails.
    expect(result.current.announcement).toBe('');
  });

  it('announces a line only when spoken, never when silent, while recording both', () => {
    window.localStorage.setItem(DRAFT_ASSISTANT_KEY, '1');
    const { result } = renderHook(() => useDraftAssistant({ rng: firstDraw }));

    // A silent push (a browse/pool line): recorded in the scrollback, but the
    // region stays empty - a browse line is never spoken (ruling item 4). The
    // assertions are decoupled from which pool line is drawn (that is the
    // generator case's job), so this mutant reddens only here.
    act(() => result.current.pushLine(stealFacts, { spoken: false }));
    expect(result.current.scrollback).toHaveLength(1);
    expect(result.current.scrollback[0].text).not.toBe(''); // a line WAS recorded
    expect(result.current.announcement).toBe(''); // ...but nothing was spoken

    // A spoken push: recorded AND announced with exactly the line it recorded.
    // Red-tell: dropping the `if (spoken)` guard in pushLine makes the silent
    // push above announce too, so the `announcement === ''` assertion fails.
    act(() => result.current.pushLine(stealFacts, { spoken: true }));
    expect(result.current.scrollback).toHaveLength(2);
    expect(result.current.announcement).toBe(result.current.scrollback[0].text);
  });

  it('keeps one stable line generator across re-renders, even under StrictMode (criterion 3)', () => {
    const { result, rerender } = renderHook(
      () => useDraftAssistant({ rng: firstDraw }),
      { wrapper: strictWrapper }
    );

    // A re-render between the two pushes: the generator must survive it. Any
    // generator recreated per render (an unguarded render-body assignment, or
    // otherwise dropping the once-only useState creation) would reset its "no
    // repeat until exhausted" tracker every render, so both pushes would redraw
    // pool[0] and the two lines would be identical. This is criterion 3's
    // red-tell: with one stable generator the draws are pool[0] then pool[1].
    act(() => result.current.pushLine(stealFacts, { spoken: false }));
    rerender();
    act(() => result.current.pushLine(stealFacts, { spoken: false }));

    const { scrollback } = result.current;
    expect(scrollback).toHaveLength(2);
    // Newest first: second push (pool[1]) leads, first push (pool[0]) trails.
    expect(scrollback[0].text).toBe(stealLine(1));
    expect(scrollback[1].text).toBe(stealLine(0));
    expect(scrollback[0].text).not.toBe(scrollback[1].text);
  });
});
