import React from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { initialsFor } from '../../lib/initials';
import { shouldShowStillFrame } from '../../../lib/reducedMotionMedia';
import { positionKey, positionLabel } from '../PosChip';
import { SR_ONLY_SX, pixelSx } from './type';

// League-page marks (DESIGN.md "Tags"): square, 2px bordered, Archivo 13px 700. Nothing here is set
// below 13px, and none of them is a cursor or a filled action.

/** A team's square avatar: its image when it has one, else initials, in a 2px border. Colour is `currentColor`. */
export function TeamMark({
  name, avatarUrl, avatarStaticUrl, size = 28,
}) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const src = (shouldShowStillFrame(reduced, avatarStaticUrl) ? avatarStaticUrl : avatarUrl) || undefined;
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={{
        display: 'inline-grid',
        placeItems: 'center',
        flex: 'none',
        width: `${size}px`,
        height: `${size}px`,
        boxSizing: 'border-box',
        border: '2px solid currentColor',
        overflow: 'hidden',
        fontSize: '13px',
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {src
        ? <Box component="img" src={src} alt="" loading="lazy" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        : initialsFor(name)}
    </Box>
  );
}

const TAG_SX = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
  flex: 'none',
  border: '2px solid var(--ps-rule)',
  color: 'var(--ps-ink)',
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
};

/** An activity kind tag (ADD, DROP, TRADE, WAIVER...): a 2px Rule box, Archivo 13px 700 uppercase. */
export function Tag({ children, full = false, ...rest }) {
  return (
    <Box
      component="span"
      {...rest}
      sx={{
        ...TAG_SX, minWidth: full ? undefined : '72px', width: full ? '100%' : undefined, minHeight: '28px', padding: '4px 8px',
      }}
    >
      {children}
    </Box>
  );
}

/** The "You" badge on the viewer's own team: an in-row badge, Archivo 13px 700. `color` follows its row (Play ink on the Play blue). */
export function YouTag({ color = 'currentColor' }) {
  return (
    <Box
      component="span"
      sx={{
        ...TAG_SX, height: '22px', padding: '0 6px', borderColor: color, color,
      }}
    >
      You
    </Box>
  );
}

/** The "CPU" tag on a CPU-managed team (ADR 0068): the same in-row badge as YouTag; its title spells it out. */
export function CpuTag({ color = 'currentColor' }) {
  return (
    <Box
      component="span"
      data-testid="cpu-badge"
      title="Managed by the CPU"
      sx={{
        ...TAG_SX, height: '22px', padding: '0 6px', borderColor: color, color,
      }}
    >
      CPU
    </Box>
  );
}

/** A position tag: a data encoding, so the border and label take the position's colour (exempt from the Red and Green rules). */
export function PosTag({ position, ...rest }) {
  const key = positionKey(position);
  const color = key === 'flex' ? 'var(--ps-dim)' : `var(--pos-${key})`;
  return (
    <Box
      component="span"
      data-position={key}
      {...rest}
      sx={{
        ...TAG_SX, minWidth: '44px', height: '28px', padding: '0 6px', borderColor: color, color,
      }}
    >
      {positionLabel(position)}
    </Box>
  );
}

const DESIGNATION = {
  Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'Injured reserve',
};

/**
 * An injury tag: outlined for Questionable and Doubtful, a filled Ink "OUT" for Out. Never red. A
 * code the wire does not name still shows, raw, outlined (any non-null status means the feed flagged
 * the player).
 */
export function InjuryTag({ status, ...rest }) {
  const code = String(status || '').trim().toUpperCase();
  if (!code) return null;
  const out = code === 'O' || code === 'IR';
  return (
    <Box
      component="span"
      data-status={code}
      {...rest}
      sx={{
        ...TAG_SX,
        height: '24px',
        minWidth: '24px',
        padding: out || code.length > 1 ? '0 6px' : 0,
        borderColor: 'var(--ps-ink)',
        ...(out ? { backgroundColor: 'var(--ps-ink)', color: 'var(--ps-panel)' } : null),
        lineHeight: 1,
      }}
    >
      <span aria-hidden="true">{out ? code === 'O' ? 'OUT' : 'IR' : code}</span>
      <Box component="span" sx={SR_ONLY_SX}>{`Injury status: ${DESIGNATION[code] || code}`}</Box>
    </Box>
  );
}

/** A status-word chip (phase, Scheduled, Final): Pixel 16 on a 2px Ink border. Neutral: green is for live state only. */
export function StatusChip({ children, onBoard = false }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        flex: 'none',
        padding: '8px 10px',
        border: `2px solid ${onBoard ? 'var(--ps-board-dim)' : 'var(--ps-ink)'}`,
        color: onBoard ? 'var(--ps-board-dim)' : 'var(--ps-ink)',
        ...pixelSx(16),
        lineHeight: 1,
        // One line at every width that holds it; a phone too narrow for "WEEK 18 · IN SEASON" (320) wraps
        // the chip inside its row instead of pushing the page sideways.
        maxWidth: '100%',
        whiteSpace: 'normal',
      }}
    >
      {children}
    </Box>
  );
}
