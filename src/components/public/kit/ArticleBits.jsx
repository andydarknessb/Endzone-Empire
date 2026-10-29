import React from 'react';
import { Box } from '@mui/material';

/**
 * Inline article decoration: the callout and the small labels the Darkness
 * Report articles used to declare per file. A writer imports these instead of
 * copying a local Pill, Chip, Note or Tag, so a change lands in one place and
 * every article follows the same type floor (13px labels, radius tokens only).
 */

// A callout the reader should not miss: the lines-as-of note and the legend.
export const Note = ({ title, tone = 'var(--warning)', children }) => (
  <Box
    role="note"
    sx={{
      my: 3, p: 2, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)',
      border: '1px solid', borderColor: tone,
      fontSize: '0.97rem', lineHeight: 1.6,
    }}
  >
    <Box sx={{ fontSize: '0.8125rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: tone, mb: 0.5 }}>{title}</Box>
    {children}
  </Box>
);

// A position or verdict badge, e.g. the Start/Sit column label on a player row.
export const Pill = ({ children, color }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-block', minWidth: '2.6em', textAlign: 'center', px: 0.75, mr: 0.75,
      borderRadius: 'var(--radius-pill, 999px)', border: '1px solid', borderColor: color, color,
      fontSize: '0.8125rem', fontWeight: 800, letterSpacing: '0.04em', lineHeight: 1.7, verticalAlign: 'middle',
    }}
  >
    {children}
  </Box>
);

// A quieter label for roster state; the default tone is the start/sit article's.
export const Chip = ({ children, tone = 'var(--text-muted)', soft }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-block', px: 1.1, py: 0.2, borderRadius: 'var(--radius-pill, 999px)',
      bgcolor: soft ? 'var(--accent-soft)' : 'var(--surface-sunken)', color: tone, fontWeight: 800,
      fontSize: '0.8125rem', letterSpacing: '0.03em',
    }}
  >
    {children}
  </Box>
);

// Tackle floor or big play, the two ways an IDP stream pays.
export const Tag = ({ kind }) => (
  <Pill color={kind === 'T' ? 'var(--success)' : 'var(--warning)'}>
    {kind === 'T' ? 'Tackles' : kind === 'BP' ? 'Big play' : 'Both'}
  </Pill>
);
