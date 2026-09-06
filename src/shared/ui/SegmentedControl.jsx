import React, { useId } from 'react';
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
 * segments to the container (the mobile week picker). A `ref` reaches the
 * group element, so a composer can move focus to the checked option (the
 * Matchup page does, when another control swaps the view, #903).
 */
const SegmentedControl = React.forwardRef(function SegmentedControl({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  fill = false,
  sx,
  'data-testid': testId = 'segmented-control',
  ...rest
}, ref) {
  const groupId = useId();
  const items = options || [];
  const selectedIndex = Math.max(0, items.findIndex((o) => o.value === value));

  const move = (delta) => {
    if (!items.length) return;
    const next = (selectedIndex + delta + items.length) % items.length;
    onChange?.(items[next].value);
  };

  return (
    <Box
      ref={ref}
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      sx={{
        display: fill ? 'flex' : 'inline-flex',
        width: fill ? '100%' : undefined,
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
              flex: fill ? '1 1 0' : 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              height: 30,
              px: fill ? 0 : '14px',
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
