import React, { useCallback, useEffect, useId, useRef } from 'react';
import { Box } from '@mui/material';
import { PixelArrow } from './playselect/Icons';

/**
 * A segmented control: one selected option among a few, as a radio group on
 * `ps-*` tokens with the selected segment in Play blue. The
 * week picker and the Standard / Scoreboard view toggle compose this (ADR
 * 0031, #891).
 *
 * Part of `shared/ui` (ADR 0020): paints `ps-*` tokens (below). Each option is
 * a real `role="radio"` button, checked when its value equals `value`, so a
 * screen reader hears the group and its selection.
 *
 * Keyboard model (the WAI-ARIA APG radio-group pattern, #933): the group is one
 * tab stop, carried by the checked option, or by the first option when nothing
 * is checked so the group never leaves the tab sequence (the week picker's
 * "All" state, #928). An arrow key walks from the option that holds focus, moves
 * DOM focus onto its neighbour, and reports that neighbour as the pick (which
 * unchecks the option left behind and checks the neighbour), so the checked
 * option and the single tab stop are always the same button. This holds
 * identically whether the group scrolls or not.
 *
 * `options` are `{ value, label, describedBy? }` (`describedBy` is an element id the radio
 * is described by, for a count that is not part of its name); `onChange` receives the picked
 * option's value. `fill` stretches the segments to the container (the Standard
 * / Scoreboard view toggle). A `ref` reaches the group element, so a composer
 * can move focus to the checked option (the Matchup page does, when another
 * control swaps the view, #903).
 *
 * `scrollable` is the other answer to a narrow row (#916): the segments keep
 * their own width, the group scrolls sideways inside whatever width it is
 * given, and the checked segment is scrolled into view on mount and whenever
 * `value` changes. A season of weeks cannot be stretched into a phone (a flex
 * item's default `min-width: auto` refuses to shrink below its label), so the
 * week picker scrolls its strip instead of widening the page. In that mode the
 * checked segment also takes focus whenever the group already holds it but has
 * drifted off it, so a change of the checked segment never leaves the focus
 * ring scrolled out of the row.
 *
 * ADR 0067, spec #2334 ruling 3: square
 * 44px segments, the checked one in Play blue with an arrow so the state is not colour alone, and Home /
 * End jump to the first / last option. Roles, names, the one tab stop and the arrow keys follow the radio-group pattern.
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
  // Which option is checked, or -1 if the composer handed the group a value no
  // option carries (the week picker's "All" state). The `tabIndex` expression
  // reads this unfloored form so a group with nothing checked can still tell it
  // has no checked option and fall its one tab stop to the first segment (#928).
  // The arrow keys do not read it: a roving move walks from the option that
  // holds focus, not from `value` (#933), so there is no second, floored index.
  const checkedIndex = items.findIndex((o) => o.value === value);

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
  // A scrolled strip is only a few segments wide, so a change of `value` can
  // leave a focused-but-now-unchecked segment scrolled out of the row with the
  // focus ring still on it, which a keyboard user cannot see (WCAG 2.4.7). So
  // when the group already holds focus the checked segment takes it, after the
  // centring scroll and with no second scroll of its own. Under a roving arrow
  // move (#933) focus is already on the checked segment by the time this runs,
  // so it is a no-op there; the containment guard is what keeps a mount, or a
  // pick made with the mouse elsewhere on the page, from stealing focus.
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

  // A roving move: walk from the option that holds focus (`fromIndex`, the
  // segment the arrow key fired on), carry DOM focus onto the neighbour, then
  // report it as the pick. Focusing before `onChange` means the checked option
  // and the group's single tab stop are the same button once the composer
  // re-renders, on the non-scrollable path (#933) as much as the scrollable one.
  // This assumes the composer adopts the reported value, which every current
  // composer does: the week picker, the view toggle, and CommissionerTools'
  // reception-preset and lineup-template controls. The lineup-template one is the
  // subtle case, its value derived by matching slot shape, but its onChange writes
  // the picked template's slots, so the derived value still becomes the pick. A
  // composer that rejected the value would leave focus off the checked option, so
  // a controlled group must let the arrow keys move the selection, as APG requires.
  // `preventScroll` keeps the browser's default focus-scroll from firing before
  // the scrollable effect above re-centres the checked segment (a double scroll);
  // that effect then sees focus already on the checked segment and does not move
  // it a second time. In the non-scrollable modes nothing scrolls, so it is inert.
  const move = (fromIndex, delta) => {
    if (!items.length) return;
    const next = (fromIndex + delta + items.length) % items.length;
    const target = groupRef.current?.querySelectorAll('[role="radio"]')[next];
    if (target) target.focus({ preventScroll: true });
    onChange?.(items[next].value);
  };

  // Home / End: focus the end option, then report it as the pick, as an arrow move does.
  const jump = (index) => {
    const target = groupRef.current?.querySelectorAll('[role="radio"]')[index];
    if (target) target.focus({ preventScroll: true });
    onChange?.(items[index].value);
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
        // A scrolling strip clips its own overflow, so it pads by the 7px focus halo plus a pixel.
        gap: 0,
        p: scrollable ? '8px' : '2px',
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
            aria-describedby={option.describedBy}
            id={`${groupId}-${index}`}
            tabIndex={checked || (checkedIndex === -1 && index === 0) ? 0 : -1}
            onClick={() => onChange?.(option.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(index, 1); }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(index, -1); }
              if (e.key === 'Home') { e.preventDefault(); jump(0); }
              if (e.key === 'End') { e.preventDefault(); jump(items.length - 1); }
            }}
            sx={{
              flex: scrollable ? '0 0 auto' : (fill ? '1 1 0' : 'none'),
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              minHeight: 44,
              px: fill && !scrollable ? '12px' : '14px',
              ml: index ? '-2px' : 0,
              boxSizing: 'border-box',
              border: `2px solid ${checked ? 'var(--ps-play)' : 'var(--ps-ink)'}`,
              borderRadius: 0,
              cursor: 'pointer',
              font: 'inherit',
              fontSize: '15px',
              fontWeight: 600,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              color: checked ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
              backgroundColor: checked ? 'var(--ps-play)' : 'transparent',
              // The segments overlap by 2px; the checked one sits on top so its edge is whole.
              ...(checked ? { position: 'relative', zIndex: 1 } : null),
            }}
          >
            {checked ? <PixelArrow /> : null}
            <span>{option.label}</span>
          </Box>
        );
      })}
    </Box>
  );
});

export default SegmentedControl;
