import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Button, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import apiClient from '../../api/apiClient';
import Countdown from '../Countdown/Countdown';

function draftStatus(draft) {
  if (draft.draft_status === 'active') return { label: 'Live now', color: 'error' };
  if (draft.draft_date) return { label: 'Scheduled', color: 'primary' };
  return { label: 'Needs scheduling', color: 'warning' };
}

function DraftCentralCard() {
  const [drafts, setDrafts] = useState([]);

  useEffect(() => {
    let active = true;

    apiClient.get('/api/draft/mine')
      .then((response) => {
        const commissionerDrafts = Array.isArray(response.data)
          ? response.data.filter(
              (draft) => Number.isFinite(Number(draft?.picks_made)) && Number.isFinite(Number(draft?.team_count))
            )
          : [];
        if (active) setDrafts(commissionerDrafts);
      })
      // Draft Central is supplementary to My Leagues. Do not replace the
      // established league list with an error if this overview is unavailable.
      .catch(() => {
        if (active) setDrafts([]);
      });

    return () => {
      active = false;
    };
  }, []);

  if (drafts.length === 0) return null;

  return (
    <Paper component="section" aria-labelledby="draft-central-heading" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
      <Typography id="draft-central-heading" variant="h5" component="h2" sx={{ mb: 2, fontWeight: 'bold' }}>
        Draft Central
      </Typography>
      <Stack spacing={2}>
        {drafts.map((draft) => {
          const picksMade = Number(draft.picks_made) || 0;
          const totalPicks = (Number(draft.roster_limit) || 0) * (Number(draft.team_count) || 0);
          const progress = totalPicks > 0 ? Math.min(100, (picksMade / totalPicks) * 100) : 0;
          const status = draftStatus(draft);

          return (
            <Box key={draft.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2}>
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Typography variant="h6" noWrap>{draft.name}</Typography>
                    <Chip size="small" label={status.label} color={status.color} />
                    {draft.draft_status === 'pending' && draft.draft_date && (
                      <Countdown variant="chip" date={draft.draft_date} />
                    )}
                  </Stack>
                  {totalPicks > 0 ? (
                    <Box sx={{ mt: 1.5 }}>
                      <LinearProgress
                        aria-label={`Draft progress for ${draft.name}`}
                        variant="determinate"
                        value={progress}
                      />
                      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                        {picksMade} / {totalPicks} picks
                      </Typography>
                    </Box>
                  ) : (
                    <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
                      Draft progress is available after teams join.
                    </Typography>
                  )}
                </Box>
                <Stack direction="row" spacing={1} alignSelf={{ xs: 'flex-start', sm: 'center' }}>
                  <Button component={Link} to={`/league/${draft.id}/draft`} variant="contained">
                    Draft Room
                  </Button>
                  <Button component={Link} to={`/league/${draft.id}/draft-settings`} variant="outlined">
                    Settings
                  </Button>
                </Stack>
              </Stack>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}

export default DraftCentralCard;
