import React, { useId } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import {
  Frame, Tag, YouTag, PixelClock, BODY_FONT, pixelSx,
} from '../../../shared/ui/playselect';
import { teamsInDraftOrder } from '../../../lib/draftTurns';
import { isTeamOnTheClock } from '../../../shared/lib/onTheClock';
import AutodraftToggle from '../../../features/autodraft-toggle/ui/AutodraftToggle';

/**
 * Draft order presentation shared by the pending panel and the active
 * Upcoming disclosure. It owns row layout; DraftRail still owns composition.
 */
export default function DraftOrderPanel({
  teams,
  draftStatus,
  viewerTeamId,
  isCommissioner,
  onTheClock,
  onToggleAutodraft,
  embedded = false,
}) {
  const helpId = useId();
  const headingId = useId();
  const orderedTeams = teamsInDraftOrder(teams);

  const content = (
    <>
      {(isCommissioner || viewerTeamId != null) && draftStatus !== 'complete' && (
        <Typography id={helpId} variant="caption" sx={{
          fontFamily: BODY_FONT, color: 'var(--ps-dim)', display: 'block', mb: 1,
        }}
        >
          Automatic picks use the best available player by ADP. This also turns on after two missed picks.
        </Typography>
      )}
      <Box
        component="ul"
        role="list"
        sx={{
          display: 'flex', flexDirection: 'column', listStyle: 'none', p: 0, m: 0, fontFamily: BODY_FONT,
        }}
      >
        {orderedTeams.map((team) => {
          const isViewer = viewerTeamId != null && team.teamId === viewerTeamId;
          const canToggle = (isCommissioner || isViewer) && draftStatus !== 'complete';
          const onClock = isTeamOnTheClock(onTheClock, team.teamId);

          return (
            <Box
              component="li"
              role="listitem"
              key={team.teamId}
              sx={{
                display: 'grid',
                gridTemplateColumns: '2.25rem minmax(0, 1fr) auto',
                alignItems: 'center',
                columnGap: 1,
                minHeight: 44,
                px: 1,
                py: 0.5,
                borderBottom: '2px solid var(--ps-rule)',
                ...(isViewer ? { bgcolor: 'var(--ps-play)', color: 'var(--ps-play-ink)' } : {}),
              }}
            >
              <Typography variant="body2" sx={{ fontFamily: BODY_FONT, color: 'inherit', fontVariantNumeric: 'tabular-nums' }}>
                {team.draft_position != null ? `${team.draft_position}.` : '-'}
              </Typography>
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', flexWrap: 'wrap', minWidth: 0,
                  columnGap: 0.75, rowGap: 0.25,
                }}
              >
                <Tooltip title={team.teamName} describeChild enterDelay={500}>
                  <Typography
                    variant="body2"
                    aria-label={team.teamName}
                    tabIndex={0}
                    sx={{
                      fontFamily: BODY_FONT,
                      minWidth: 0,
                      flex: '1 1 8rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: onClock ? 'bold' : 'normal',
                    }}
                  >
                    {team.teamName}
                  </Typography>
                </Tooltip>
                {onClock && (
                  <Box component="span" role="img" aria-label="On the clock" sx={{ display: 'inline-flex', flex: '0 0 auto' }}>
                    <PixelClock />
                  </Box>
                )}
                {isViewer && <YouTag color="var(--ps-play-ink)" />}
                {team.autodraft && !canToggle && <Tag>AUTO</Tag>}
              </Box>
              {canToggle && (
                <AutodraftToggle
                  teamName={team.teamName}
                  checked={!!team.autodraft}
                  describedBy={helpId}
                  onChange={(enabled) => onToggleAutodraft(team.teamId, enabled)}
                />
              )}
            </Box>
          );
        })}
      </Box>
    </>
  );

  if (embedded) return content;

  return (
    <Frame tier="rule" component="section" labelledBy={headingId} sx={{ p: 2, mb: 3 }}>
      <Box component="h2" id={headingId} sx={{ ...pixelSx(16), m: 0, mb: 1 }}>
        Draft order
      </Box>
      {content}
    </Frame>
  );
}
