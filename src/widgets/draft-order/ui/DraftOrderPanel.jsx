import React, { useId } from 'react';
import {
  Box, Chip, Paper, Tooltip, Typography,
} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { teamsInDraftOrder } from '../../../lib/draftTurns';
import { isTeamOnTheClock } from '../../../lib/onTheClock';
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
        <Typography id={helpId} variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
          Automatic picks use the best available player by ADP. This also turns on after two missed picks.
        </Typography>
      )}
      <Box
        component="ul"
        role="list"
        sx={{ display: 'flex', flexDirection: 'column', gap: 1, listStyle: 'none', p: 0, m: 0 }}
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
                ...(isViewer ? {
                  bgcolor: 'var(--accent-soft)',
                  borderLeft: '3px solid var(--accent)',
                  borderRadius: 'var(--radius-sm)',
                  pl: 0.625,
                } : {}),
              }}
            >
              <Typography variant="body2" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
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
                {onClock && <AccessTimeIcon aria-label="On the clock" fontSize="small" sx={{ flex: '0 0 auto' }} />}
                {isViewer && <Chip size="small" variant="outlined" label="You" />}
                {team.autodraft && !canToggle && <Chip size="small" color="warning" label="AUTO" />}
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
    <Paper component="section" aria-labelledby={headingId} sx={{ p: 2, mb: 3 }}>
      <Typography id={headingId} variant="h6" component="h2" sx={{ mb: 0.5 }}>
        Draft order
      </Typography>
      {content}
    </Paper>
  );
}
