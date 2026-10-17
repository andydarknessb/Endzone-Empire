import React from 'react';
import { Box } from '@mui/material';
import { PixelArrow } from '../../shared/ui/playselect/Icons';

const TABS = ['Pending', 'Completed', 'Trade Block'];

/**
 * The Trade Center's sections in the Play-select segmented look (docs/design/league Trades board), as a
 * real tablist: the selected tab is Play blue with an arrow, carries the one tab stop (roving tabindex),
 * and Left/Right/Home/End move and activate. `ref` reaches the tablist, so the page can move focus onto
 * the Pending tab when a card action leaves nothing to land on.
 */
const TradeTabs = React.forwardRef(function TradeTabs({ value, onChange, panelId }, ref) {
  const move = (event, index) => {
    const last = TABS.length - 1;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
    onChange(next);
  };
  return (
    <Box
      ref={ref}
      role="tablist"
      aria-label="Trade Center sections"
      sx={{ display: { xs: 'flex', sm: 'inline-flex' }, alignSelf: 'flex-start', width: { xs: '100%', sm: 'auto' }, p: '2px' }}
    >
      {TABS.map((label, index) => {
        const on = index === value;
        return (
          <Box
            key={label}
            component="button"
            type="button"
            role="tab"
            id={`trade-tab-${index}`}
            aria-selected={on}
            aria-controls={panelId}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(index)}
            onKeyDown={(event) => move(event, index)}
            sx={{
              flex: { xs: '1 1 0', sm: 'none' },
              minWidth: { sm: '140px' },
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              px: { xs: '8px', sm: '16px' },
              ml: index ? '-2px' : 0,
              boxSizing: 'border-box',
              border: `2px solid ${on ? 'var(--ps-play)' : 'var(--ps-ink)'}`,
              borderRadius: 0,
              font: 'inherit',
              fontSize: '15px',
              fontWeight: 600,
              lineHeight: 1,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              color: on ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
              backgroundColor: on ? 'var(--ps-play)' : 'transparent',
              // The tabs overlap by 2px; the selected one sits on top so its edge is whole.
              ...(on ? { position: 'relative', zIndex: 1 } : null),
            }}
          >
            {on ? <PixelArrow /> : null}
            {label}
          </Box>
        );
      })}
    </Box>
  );
});

export default TradeTabs;
