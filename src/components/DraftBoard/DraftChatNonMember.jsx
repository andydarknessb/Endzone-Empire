import React from 'react';
import { Alert } from '@mui/material';

/**
 * The Draft room's chat surface for an AUTHORITATIVE non-member (#534 AC3): one
 * explicit message, and deliberately nothing else - no log, no composer, no Send
 * control, no moderation affordance, and no combined-feed request (there is no
 * feed hook here to issue one). It stands in for DraftRoomChat whenever the
 * membership tri-state is NON_MEMBER: a viewer who joined and was refused
 * NOT_A_MEMBER, or a confirmed member removed mid-draft (chat:send / feed 403).
 *
 * The copy is user-facing, so it stays within the house no-em-dash style. It
 * names the fact plainly rather than the cause; whether the viewer never held a
 * Team or lost one mid-draft, the surface they get is the same.
 */
function DraftChatNonMember() {
  return (
    <Alert severity="info" data-testid="draft-chat-non-member">
      League chat is available to league members only.
    </Alert>
  );
}

export default DraftChatNonMember;
