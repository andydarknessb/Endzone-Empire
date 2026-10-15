import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { PixelArrow, PixelWarn } from './Icons';
import { Frame } from './Frame';
import { pixelSx } from './type';

const BTN = {
  minHeight: '44px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '10px',
  padding: '0 16px',
  boxSizing: 'border-box',
  borderRadius: 0,
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  textDecoration: 'none',
  cursor: 'pointer',
};

const VARIANT = {
  fill: { backgroundColor: 'var(--ps-accent)', border: '2px solid var(--ps-accent)', color: 'var(--ps-on-accent)' },
  ghost: { backgroundColor: 'transparent', border: '2px solid var(--ps-ink)', color: 'var(--ps-ink)' },
  quiet: { backgroundColor: 'transparent', border: '2px solid transparent', color: 'var(--ps-dim)' },
};

const DISABLED_SX = { '&[disabled], &[aria-disabled="true"]': { opacity: 0.5, cursor: 'not-allowed' } };

/**
 * Square 44px button: fill (the page's one filled action), ghost, or quiet. A
 * `to` makes it a router link. `disabled` is the native attribute on a button;
 * a link gets aria-disabled and swallows the click, so it does not navigate.
 */
export function PsButton({
  variant = 'ghost', to, onClick, ariaLabel, children, type = 'button', disabled = false,
}) {
  const sx = { ...BTN, ...VARIANT[variant], ...DISABLED_SX };
  const arrow = variant === 'fill' ? <PixelArrow /> : null;
  if (to) {
    return (
      <Box
        component={RouterLink}
        to={to}
        onClick={disabled ? (event) => event.preventDefault() : onClick}
        aria-label={ariaLabel}
        aria-disabled={disabled ? 'true' : undefined}
        tabIndex={disabled ? -1 : undefined}
        sx={sx}
      >
        {children}
        {arrow}
      </Box>
    );
  }
  return (
    <Box component="button" type={type} onClick={onClick} aria-label={ariaLabel} disabled={disabled} sx={sx}>
      {children}
      {arrow}
    </Box>
  );
}

/** A 44px link target: Ink with a 2px Dim underline offset 5px; Board ink and dim on a scoreboard tile. */
export function PsLink({
  to, href, ariaLabel, onBoard = false, children,
}) {
  const sx = {
    minHeight: '44px',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 10px',
    fontSize: '15px',
    fontWeight: 600,
    color: onBoard ? 'var(--ps-board-ink)' : 'var(--ps-ink)',
    textDecoration: 'underline',
    textDecorationThickness: '2px',
    textUnderlineOffset: '5px',
    textDecorationColor: onBoard ? 'var(--ps-board-dim)' : 'var(--ps-dim)',
  };
  return to
    ? <Box component={RouterLink} to={to} aria-label={ariaLabel} sx={sx}>{children}</Box>
    : <Box component="a" href={href} aria-label={ariaLabel} sx={sx}>{children}</Box>;
}

/** The live state: a 2px Accent outline, Accent pixel text, a square 8px dot. */
export function LiveChip({ children = 'Live' }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 10px',
        border: '2px solid var(--ps-accent)',
        color: 'var(--ps-accent)',
        ...pixelSx(16),
        lineHeight: 1,
      }}
    >
      <Box component="span" aria-hidden="true" sx={{ width: '8px', height: '8px', backgroundColor: 'var(--ps-accent)' }} />
      {children}
    </Box>
  );
}

/** A failed load: the danger double frame, a warn icon, and a way to retry. */
export function ErrorPanel({
  title, body, onRetry, retryAriaLabel,
}) {
  return (
    <Frame
      component="div"
      tone="danger"
      role="alert"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px 20px',
        padding: '16px 20px',
      }}
    >
      <Box sx={{ display: 'flex', gap: '12px', alignItems: 'flex-start', minWidth: 0 }}>
        <PixelWarn color="var(--ps-danger)" />
        <Box>
          <Box sx={pixelSx(16)}>{title}</Box>
          <Box sx={{ fontSize: '15px', color: 'var(--ps-dim)', mt: '4px' }}>{body}</Box>
        </Box>
      </Box>
      <PsButton variant="ghost" onClick={onRetry} ariaLabel={retryAriaLabel}>Try again</PsButton>
    </Frame>
  );
}

/** A loading block in Skel; hidden from assistive tech. */
export function Skel({ width, height }) {
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={{
        display: 'block',
        width,
        height: typeof height === 'number' ? `${height}px` : height,
        backgroundColor: 'var(--ps-skel)',
      }}
    />
  );
}
