import React from 'react';
import { Box, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { MAX_CHAT_CHARS, CHAT_CHARS_WARNING, characterCount } from './chatLimits';

/**
 * The League chat composer's character counter (#486).
 *
 * Two nodes, one purpose. A VISIBLE indicator shows the live count against the
 * limit, counted in Unicode code points so the number a manager sees is the
 * number the server's limit and the varchar(500) column enforce (see chatLimits).
 * It is associated with the input via `aria-describedby` (the caller wires the
 * `indicatorId`), so a screen reader hears the count on focus and on demand
 * without it being a live region that speaks on every keystroke.
 *
 * A separate, persistent, visually hidden `role="status"` / `aria-live="polite"`
 * region announces at THRESHOLDS only, following ReadinessAnnouncer (#164) and
 * CountdownAnnouncer (#117). Its text is derived from which band the remaining
 * count is in - clear, warning, or at/over the limit - and nothing else, so two
 * keystrokes inside one band render an identical text node and assistive tech
 * announces nothing between them. The node is always mounted (this component is
 * rendered whenever the composer is), never mounted or unmounted as the count
 * changes, which is what keeps a real threshold crossing from landing on a
 * region nothing was observing.
 *
 * Nothing here blocks typing or sending past the limit: over the limit the
 * indicator shows the overage in the error color and the announcer says the
 * limit is reached, but the server stays the single enforcement point.
 */

// Which band a remaining count falls in - the SINGLE source of truth both the
// visible color and the spoken announcement read, so the two can never cross at
// different counts (e.g. the color still saying "near" while the announcer says
// "reached"). 'limit' is remaining <= 0, so reaching exactly the limit counts as
// the limit, matching the AC ("when the limit is reached or exceeded"); it is
// tested first because it is also <= the warning threshold.
function bandFor(remaining) {
  if (remaining <= 0) return 'limit';
  if (remaining <= CHAT_CHARS_WARNING) return 'warning';
  return 'clear';
}

// The polite announcement for a band, identical across keystrokes within one
// band so a screen reader hears it once per crossing, not once per keystroke.
// The clear band returns the empty string: nothing to announce, and an empty
// text node keeps the region mounted and silent rather than unmounting it.
const ANNOUNCEMENT = {
  limit: `You have reached the ${MAX_CHAT_CHARS} character message limit.`,
  warning: `Approaching the ${MAX_CHAT_CHARS} character message limit.`,
  clear: '',
};

// The indicator color for a band. Error at or over the limit, warning as it is
// approached; both derived from the same band as the announcement above.
const BAND_COLOR = {
  limit: 'error.main',
  warning: 'warning.main',
  clear: 'text.secondary',
};

function ComposerCharacterCount({ text = '', indicatorId }) {
  const count = characterCount(text);
  const remaining = MAX_CHAT_CHARS - count;
  const band = bandFor(remaining);
  // The color carries the state a sighted manager reads at a glance; the
  // announcer carries the same band for others.
  const color = BAND_COLOR[band];

  return (
    <>
      {/* The glyph "{count} / 500" is a fine glanceable indicator, but this
          element is also the input's aria-describedby target, and read bare a
          screen reader says "0 slash 500" with no unit. Name the unit in the
          element's TEXT CONTENT (not an aria-label): a bare span maps to the
          generic role, on which ARIA 1.2 prohibits aria-label and browsers
          increasingly prune it, which would silently drop the unit and leave the
          description at "0 / 500". Visually hidden text content works
          unconditionally and is the same idiom ReadinessAnnouncer and
          CountdownAnnouncer use for "terse visible, verbose spoken". The visible
          glyph lives in its own inner span so it stays exactly "{count} / 500",
          while the whole element's text content - the accessible description - is
          "{count} / 500 characters". */}
      <Typography
        id={indicatorId}
        component="span"
        variant="caption"
        sx={{ color, whiteSpace: 'nowrap' }}
      >
        <Box component="span" data-testid="composer-char-count">
          {count} / {MAX_CHAT_CHARS}
        </Box>
        <Box component="span" sx={visuallyHidden}> characters</Box>
      </Typography>
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {ANNOUNCEMENT[band]}
      </Box>
    </>
  );
}

export default ComposerCharacterCount;
