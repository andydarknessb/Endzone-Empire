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
 * The card renders as a `section` element. When a `title` is given it becomes
 * a labelled landmark region: the title is a real heading (level 2 by default,
 * override with `headingLevel`) and labels the section, so a screen-reader user
 * can navigate cards by heading. Without a title it is a plain `section` with
 * no accessible name, so it is NOT announced as a landmark (a nameless region
 * would only add noise). The body carries no padding of its own, so a widget
 * can lay a flush table or its own padded content inside.
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
          {/* count and tail are the de-emphasized `dash-faint` tier, which
              clears AA_TEXT on every surface (see tokens.js / the faint note
              in tokens.contrast.test.js), so it is safe for this 12px text. */}
          {count != null && (
            <Typography
              component="span"
              sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--dash-faint)' }}
            >
              {count}
            </Typography>
          )}
          {tail != null && (
            <Box
              component="span"
              sx={{ ml: 'auto', fontSize: '12px', color: 'var(--dash-faint)' }}
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
