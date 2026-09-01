import React, { useId } from 'react';
import { Box, Paper, Typography } from '@mui/material';

/**
 * League Dashboard card: a token-themed MUI Paper (surface, hairline border,
 * dashboard radius) with an optional header. The header mirrors the mockup's
 * `.card-h`: an uppercase display-face title, an optional `count` beside it,
 * and an optional `tail` slot pushed to the right.
 *
 * Part of `shared/ui` (ADR 0020): the bottom of the League Dashboard island,
 * composed by every widget and importing nothing above it. Colors come only
 * from `--dash-*` tokens, never literals.
 *
 * The card renders as a landmark `section`. When a `title` is given it is a
 * real heading (level 2 by default, override with `headingLevel`) and labels
 * the section, so a screen-reader user can navigate cards by heading. The body
 * carries no padding of its own, so a widget can lay a flush table or its own
 * padded content inside.
 */
export default function Card({
  title,
  count,
  tail,
  headingLevel = 2,
  component = 'section',
  children,
  sx,
  ...rest
}) {
  const headingId = useId();
  const hasHeader = title != null;

  return (
    <Paper
      component={component}
      elevation={0}
      {...(hasHeader ? { 'aria-labelledby': headingId } : {})}
      sx={{
        backgroundColor: 'var(--dash-surface)',
        border: '1px solid var(--dash-line)',
        borderRadius: 'var(--dash-radius)',
        color: 'var(--dash-ink)',
        backgroundImage: 'none',
        ...sx,
      }}
      {...rest}
    >
      {hasHeader && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            px: 2.25,
            py: 1.75,
            borderBottom: '1px solid var(--dash-line)',
          }}
        >
          <Typography
            id={headingId}
            component={`h${headingLevel}`}
            sx={{
              m: 0,
              fontFamily: 'var(--dash-font-display)',
              fontSize: '17px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--dash-ink)',
            }}
          >
            {title}
          </Typography>
          {/* count and tail are 12px, so they use `dash-dim` (AA_TEXT), not
              the `dash-faint` tier (AA_LARGE) which is below AA for small
              text. See the faint note in tokens.js / tokens.contrast.test.js. */}
          {count != null && (
            <Typography
              component="span"
              sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--dash-dim)' }}
            >
              {count}
            </Typography>
          )}
          {tail != null && (
            <Box
              component="span"
              sx={{ ml: 'auto', fontSize: '12px', color: 'var(--dash-dim)' }}
            >
              {tail}
            </Box>
          )}
        </Box>
      )}
      {children}
    </Paper>
  );
}
