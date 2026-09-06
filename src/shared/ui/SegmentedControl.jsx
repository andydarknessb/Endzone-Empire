import React, { useCallback, useEffect, useId, useRef } from 'react';
import { Box } from '@mui/material';

/**
 * A segmented control: one selected option among a few, as a radio group on
 * `dash-surface2` with the selected segment raised onto `dash-surface`. The
 * week picker and the Standard / Scoreboard view toggle compose this (ADR
 * 0031, #891).
 *
 * Part of `shared/ui` (ADR 0020): paints only `dash-*` tokens. Each option is
 * a real `role="radio"` button, checked when its value equals `value`, so a
 * screen reader hears the group and its selection and arrow keys move between
 * options the way a radio group does. `options` are `{ value, label, icon? }`;
 * `onChange` receives the clicked option's value. `fill` stretches the
 * segments to the container (the Standard / Scoreboard view toggle). A `ref`
 * reaches the group element, so a composer can move focus to the checked
 * option (the Matchup page does, when another control swaps the view, #903).
 *
 * `scrollable` is the other answer to a narrow row (#916): the segments keep
 * their own width, the group scrolls sideways inside whatever width it is
 * given, and the checked segment is scrolled into view on mount and whenever
 * `value` changes. A season of weeks cannot be stretched into a phone (a flex
 * item's default `min-width: auto` refuses to shrink below its label), so the
 * week picker scrolls its strip instead of widening the page. In that mode
 * the checked segment also takes focus whenever the group already holds it,
 * so an arrow-key walk never scrolls the focus ring out of the row.
 */
const SegmentedControl = React.forwardRef(function SegmentedControl({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  fill = false,
  scrollable = false,
  sx,
  'data-testid': testId = 'segmented-control',
  ...rest
}, ref) {
  const groupId = useId();
  const groupRef = useRef(null);
  const items = options || [];
  const selectedIndex = Math.max(0, items.findIndex((o) => o.value === value));

  // The group element is kept here and handed on to whatever ref the composer
  // passed, so scrolling the checked segment into view never costs the
  // composer its ref (#903 forwards it; #916 reads it).
  const setGroupRef = useCallback((node) => {
    groupRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  // Scrollable: the strip is wider than its row, so the checked segment is
  // brought into view on mount and on every change of `value`. jsdom does not
  // implement `scrollIntoView` at all (a test stubs it), so the guard is what
  // keeps the picker rendering under the suite and in any browser without it.
  //
  // Arrow keys move the checked option without moving DOM focus, so a couple
  // of presses (or a wrap from the last option back to the first) can scroll
  // the focused segment out of the row with the focus ring still on it, which
  // a keyboard user cannot see (WCAG 2.4.7). So when the group already holds
  // focus the checked segment takes it, after the centring scroll and with no
  // second scroll of its own. The containment guard is what keeps a mount, or
  // a pick made with the mouse elsewhere on the page, from stealing focus.
  useEffect(() => {
    if (!scrollable) return;
    const group = groupRef.current;
    const checked = group?.querySelector('[role="radio"][aria-checked="true"]');
    if (!checked) return;
    if (typeof checked.scrollIntoView === 'function') {
      checked.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
    if (group.contains(document.activeElement) && document.activeElement !== checked) {
      checked.focus({ preventScroll: true });
    }
  }, [scrollable, value]);

  const move = (delta) => {
    if (!items.length) return;
    const next = (selectedIndex + delta + items.length) % items.length;
    onChange?.(items[next].value);
  };

  return (
    <Box
      ref={setGroupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      sx={{
        display: fill || scrollable ? 'flex' : 'inline-flex',
        width: fill ? '100%' : undefined,
        // Scrollable: the group takes the width its row gives it and scrolls
        // its own overflow, so nothing here can widen the page. The scrollbar
        // is hidden (the strip is swiped, and the checked segment is scrolled
        // into view) and `overscroll-behavior-x` keeps that swipe off the page
        // behind it.
        minWidth: scrollable ? 0 : undefined,
        maxWidth: scrollable ? '100%' : undefined,
        overflowX: scrollable ? 'auto' : undefined,
        overscrollBehaviorX: scrollable ? 'contain' : undefined,
        scrollbarWidth: scrollable ? 'none' : undefined,
        ...(scrollable ? { '&::-webkit-scrollbar': { display: 'none' } } : null),
        gap: '2px',
        p: '3px',
        backgroundColor: 'var(--dash-surface2)',
        border: '1px solid var(--dash-line)',
        borderRadius: '9px',
        ...sx,
      }}
      {...rest}
    >
      {items.map((option, index) => {
        const checked = option.value === value;
        return (
          <Box
            key={String(option.value)}
            component="button"
            type="button"
            role="radio"
            aria-checked={checked}
            id={`${groupId}-${index}`}
            tabIndex={checked || (selectedIndex === -1 && index === 0) ? 0 : -1}
            onClick={() => onChange?.(option.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            }}
            sx={{
              flex: scrollable ? '0 0 auto' : (fill ? '1 1 0' : 'none'),
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              height: 30,
              px: fill && !scrollable ? 0 : '14px',
              border: 0,
              borderRadius: '7px',
              cursor: 'pointer',
              font: 'inherit',
              fontSize: '13px',
              fontWeight: 600,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              color: checked ? 'var(--dash-ink)' : 'var(--dash-dim)',
              backgroundColor: checked ? 'var(--dash-surface)' : 'transparent',
              boxShadow: checked ? 'var(--shadow-1)' : 'none',
              '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
            }}
          >
            {option.icon ? <Box component="span" aria-hidden="true" sx={{ display: 'flex' }}>{option.icon}</Box> : null}
            <span>{option.label}</span>
          </Box>
        );
      })}
    </Box>
  );
});

export default SegmentedControl;
