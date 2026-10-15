import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { PixelArrow, PixelWarn } from './Icons';
import { Frame } from './Frame';
import { pixelSx } from './homeType';

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
  fill: { backgroundColor: 'var(--home-accent)', border: '2px solid var(--home-accent)', color: 'var(--home-on-accent)' },
  ghost: { backgroundColor: 'transparent', border: '2px solid var(--home-ink)', color: 'var(--home-ink)' },
  quiet: { backgroundColor: 'transparent', border: '2px solid transparent', color: 'var(--home-dim)' },
};

const DISABLED_SX = { '&[disabled], &[aria-disabled="true"]': { opacity: 0.5, cursor: 'not-allowed' } };

/**
 * Square 44px button: fill (the page's one filled action), ghost, or quiet. A
 * `to` makes it a router link. `disabled` is the native attribute on a button;
 * a link gets aria-disabled and swallows the click, so it does not navigate.
 */
export function HomeButton({
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
export function HomeLink({
  to, href, ariaLabel, onBoard = false, children,
}) {
  const sx = {
    minHeight: '44px',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 10px',
    fontSize: '15px',
    fontWeight: 600,
    color: onBoard ? 'var(--home-board-ink)' : 'var(--home-ink)',
    textDecoration: 'underline',
    textDecorationThickness: '2px',
    textUnderlineOffset: '5px',
    textDecorationColor: onBoard ? 'var(--home-board-dim)' : 'var(--home-dim)',
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
        border: '2px solid var(--home-accent)',
        color: 'var(--home-accent)',
        ...pixelSx(16),
        lineHeight: 1,
      }}
    >
      <Box component="span" aria-hidden="true" sx={{ width: '8px', height: '8px', backgroundColor: 'var(--home-accent)' }} />
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
        <PixelWarn color="var(--home-danger)" />
        <Box>
          <Box sx={pixelSx(16)}>{title}</Box>
          <Box sx={{ fontSize: '15px', color: 'var(--home-dim)', mt: '4px' }}>{body}</Box>
        </Box>
      </Box>
      <HomeButton variant="ghost" onClick={onRetry} ariaLabel={retryAriaLabel}>Try again</HomeButton>
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
        backgroundColor: 'var(--home-skel)',
      }}
    />
  );
}

const DEFINITIONS = [
  ['Projected', "Each lineup's points from Endzone Forecast, our projection engine."],
  ['Win probability', "Your chance to win the matchup from both lineups' projected finals. It sharpens as games finish."],
  ['Confidence', "In a Confidence pick'em, each pick carries a number from 1 up to that week's game count, each used once. A right pick earns that many points."],
];

/** The "What the numbers mean" disclosure. */
export function NumbersHelp() {
  return (
    <Box
      component="details"
      sx={{
        fontSize: '14px',
        color: 'var(--home-dim)',
        position: 'relative',
        '& > summary': { listStyle: 'none' },
        '& > summary::-webkit-details-marker': { display: 'none' },
      }}
    >
      <Box
        component="summary"
        sx={{
          cursor: 'pointer',
          minHeight: '44px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '10px',
          fontWeight: 600,
          color: 'var(--home-ink)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M1 1h14v14H1zM3 3v10h10V3zM7 4h2v2H7zM7 7h2v5H7z" fill="currentColor" fillRule="evenodd" />
        </svg>
        What the numbers mean
      </Box>
      <Box
        component="dl"
        sx={{
          m: '4px 0 0',
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: 'max-content 1fr' },
          gap: '6px 16px',
          maxWidth: '760px',
        }}
      >
        {DEFINITIONS.map(([term, text]) => (
          <React.Fragment key={term}>
            <Box component="dt" sx={{ fontWeight: 600, color: 'var(--home-ink)' }}>{term}</Box>
            <Box component="dd" sx={{ m: 0 }}>{text}</Box>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
}
