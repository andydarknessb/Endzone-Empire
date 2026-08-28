import React from 'react';
import { Paper, Typography, Alert } from '@mui/material';

// A fixed id, because only ONE League Chat notice is ever mounted at a time and
// it is never mounted beside the member feed, so it cannot collide. It is the
// focus target the room's rescue lands on when a mid-session revocation tears
// the composer or moderation field out from under a member (#534 a11y finding 1).
export const DRAFT_CHAT_NON_MEMBER_ID = 'draft-chat-non-member-section';
const HEADING_ID = 'draft-chat-non-member-heading';

/**
 * The Draft room's League Chat surface for an AUTHORITATIVE non-member (#534
 * AC3): one explicit message, and deliberately nothing else - no log, no
 * composer, no Send control, no moderation affordance, and no combined-feed
 * request (there is no feed hook here to issue one). It stands in for
 * DraftRoomChat whenever membership is NON_MEMBER: a viewer refused NOT_A_MEMBER
 * on join, or a confirmed member removed mid-draft (chat:send / feed 403).
 *
 * It keeps the SAME section + h2 "League Chat" shell the member feed
 * (ChatConversation) uses, for two reasons a bare Alert missed (a11y review):
 *  - the h2 stays in the heading order, so a heading-navigation user still finds
 *    chat where it was rather than a gap (finding 2); and
 *  - the section is a real, named focus target (tabIndex -1 + a stable id), so
 *    when a revocation unmounts the composer the room's focus rescue hands focus
 *    HERE instead of dropping it to <body> (finding 1), the same standard the
 *    room already holds when a commissioner's Hide button is torn out.
 *
 * role="presentation" on the Alert is deliberate (finding 3, following the #519
 * ruling on this very room): MUI's Alert defaults to an ASSERTIVE live region,
 * and this surface is PERSISTENT - on a narrow container it remounts on every
 * Chat -> Players -> Chat tab switch, which would re-assert the notice each time.
 * The one-time, POLITE announcement of the transition lives in the chrome
 * (DraftChatMembershipAnnouncer), so this node only needs to be visible and
 * navigable, never a live region of its own. The copy states an availability
 * rule (no em-dash, house style) rather than blaming the viewer.
 */
function DraftChatNonMember() {
  return (
    <Paper
      component="section"
      id={DRAFT_CHAT_NON_MEMBER_ID}
      tabIndex={-1}
      aria-labelledby={HEADING_ID}
      sx={{ p: 2, mt: 3 }}
    >
      <Typography id={HEADING_ID} variant="h6" component="h2" sx={{ mb: 2 }}>
        League Chat
      </Typography>
      <Alert severity="info" role="presentation" data-testid="draft-chat-non-member">
        League chat is available to league members only.
      </Alert>
    </Paper>
  );
}

export default DraftChatNonMember;
