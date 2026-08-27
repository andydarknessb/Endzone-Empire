import React from 'react';
import { Box, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { MAX_CHAT_CHARS, CHAT_CHARS_WARNING, characterCount } from './chatLimits';

/**
 * The League chat composer's character counter (#486).
 *
 * Two nodes, one purpose. A VISIBLE indicator shows the live count against the
 * limit, counted in Unicode code points so the number a manager sees is the
 * number the server clamp and the varchar(500) column enforce (see chatLimits).
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

// The announcement for a given remaining count, derived from its BAND alone so
// it is identical across keystrokes within one band. The limit band (<= 0) is
// also <= the warning threshold, so it is tested first. The clear band returns
// the empty string: there is nothing to announce, and an empty text node keeps
// the region mounted and silent rather than unmounting it.
function announcementFor(remaining) {
  if (remaining <= 0) return `You have reached the ${MAX_CHAT_CHARS} character message limit.`;
  if (remaining <= CHAT_CHARS_WARNING) return `Approaching the ${MAX_CHAT_CHARS} character message limit.`;
  return '';
}

function ComposerCharacterCount({ text = '', indicatorId }) {
  const count = characterCount(text);
  const remaining = MAX_CHAT_CHARS - count;
  const over = remaining < 0;
  const warning = !over && remaining <= CHAT_CHARS_WARNING;
  // House style keeps this brief and numeric; the color carries the state a
  // sighted manager reads at a glance, the announcer carries it for others.
  const color = over ? 'error.main' : warning ? 'warning.main' : 'text.secondary';

  return (
    <>
      <Typography
        id={indicatorId}
        data-testid="composer-char-count"
        component="span"
        variant="caption"
        sx={{ color, whiteSpace: 'nowrap' }}
      >
        {count} / {MAX_CHAT_CHARS}
      </Typography>
      <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
        {announcementFor(remaining)}
      </Box>
    </>
  );
}

export default ComposerCharacterCount;
