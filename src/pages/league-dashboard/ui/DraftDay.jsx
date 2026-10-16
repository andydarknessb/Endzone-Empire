import React, { useId } from 'react';
import { Box } from '@mui/material';
import {
  Frame, FrameHead, PixelHeading, PsButton,
} from '../../../shared/ui/playselect';
import Countdown from '../../../components/Countdown/Countdown';

/**
 * The pre-draft countdown to the scheduled draft: a primary frame, "Draft Day", with a ghost "Draft
 * Room" button, the countdown in Pixel 32 blocks and the draft's viewer-local schedule (with the add to
 * calendar control). Fantasy only, only before the draft, and only once a draft_date is set. It is the
 * Countdown component's `blocks` look; Countdown keeps its own for the draft room, the draft centre
 * and the league card.
 */
export default function DraftDay({ league, leagueId }) {
  const headingId = useId();
  return (
    <Frame
      labelledBy={headingId}
      data-testid="slot-draft-countdown"
      head={(
        <FrameHead>
          <PixelHeading id={headingId}>Draft Day</PixelHeading>
          <Box component="span" sx={{ marginLeft: 'auto' }}>
            <PsButton variant="ghost" to={`/league/${leagueId}/draft`}>Draft Room</PsButton>
          </Box>
        </FrameHead>
      )}
    >
      <Box sx={{ padding: { xs: '14px', md: '20px' } }}>
        <Countdown
          variant="blocks"
          date={league.draft_date}
          timeZone={league.draft_timezone}
          leagueId={league.id}
          leagueName={league.name}
        />
      </Box>
    </Frame>
  );
}
