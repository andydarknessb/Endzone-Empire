import React from 'react';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';

/**
 * The Draft room's shared polite-region SPAN (#791, ADR 0028): a Box with
 * role="status" / aria-live="polite", styled visuallyHidden, whose text is the
 * `text` prop and nothing else.
 *
 * This is the one thing every Draft-room announcer rendered identically before
 * this ticket - PickAnnouncer (#513), StallAnnouncer (#636/#648), FeedAnnouncer
 * (#445), ReadinessAnnouncer (#164) and DraftChatMembershipAnnouncer (#534) each
 * carried this exact JSX inline. It is a LEAF on purpose: no gating, no state,
 * no effect, no clear path. Whether a region is mounted at all, when its text
 * changes, whether a repeat needs a discriminator, and when it clears - those
 * are per-axis decisions that stay in each announcer (ADR 0028, refusing the
 * architecture review's proposed collapse into one announcements module on the
 * rulings of #513, #636, #648, #653 and #664: mount scope and clear paths are
 * per-axis by design). Do not add props here beyond `text` - a gating prop is
 * exactly the collapse ADR 0028 refused.
 */
function PoliteRegion({ text = '' }) {
  return (
    <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
      {text}
    </Box>
  );
}

export default PoliteRegion;
