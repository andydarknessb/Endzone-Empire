import React from 'react';
import { Box, Typography, Skeleton } from '@mui/material';

/**
 * The Draft room's League Chat surface while membership is NOT YET KNOWN (#534,
 * a11y finding 4): the join acknowledgement has not decided yet, so there is
 * nothing honest to mount - no log, no composer, and no combined-feed request
 * (AC1). But the branch must not be blank: on a narrow container Chat is the tab
 * the room OPENS ON, so a blank pane is the first thing a mobile manager sees and
 * is indistinguishable from a broken page. This is the "something" that renders
 * instead - a short connecting notice over a skeleton.
 *
 * Deliberately WITHOUT the section + h2 "League Chat" shell the member and
 * non-member surfaces carry: this state is transient on a healthy connection (it
 * lasts only until the ack lands), so it must not put a second "League Chat"
 * heading into the order during that flicker. The heading-stability rule is for
 * the persistent non-member surface, not this momentary one. The notice text is
 * plain static content, not a live region, so a normal fast connect does not
 * announce anything as it passes through.
 */
function DraftChatConnecting() {
  return (
    <Box data-testid="draft-chat-connecting" sx={{ p: 2, mt: 3 }}>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Connecting to League chat.
      </Typography>
      <Skeleton variant="rounded" height={120} />
    </Box>
  );
}

export default DraftChatConnecting;
