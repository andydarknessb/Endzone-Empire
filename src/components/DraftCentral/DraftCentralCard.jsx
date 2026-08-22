import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Button, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import apiClient from '../../api/apiClient';
import Countdown from '../Countdown/Countdown';
import { draftRounds } from '../../lib/rosterShape';

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

  const active = drafts.filter((draft) => draft.draft_status === 'active');
  const scheduled = drafts.filter((draft) => draft.draft_status === 'pending' && draft.draft_date);
  const unscheduled = drafts.filter((draft) => draft.draft_status === 'pending' && !draft.draft_date);
  const focusDraft = active[0] || scheduled[0] || unscheduled[0];
  const picksMade = Number(focusDraft.picks_made) || 0;
  // Rounds are Draft rounds (ADR 0005): the live-derived draft roster size
  // for a scheduled/unscheduled draft, or the fixed value for an active one
  // (not the IR-inclusive roster_limit: the IR slot is never drafted, #96).
  const totalPicks = draftRounds(focusDraft) * (Number(focusDraft.team_count) || 0);
  const progress = totalPicks > 0 ? Math.min(100, (picksMade / totalPicks) * 100) : 0;

  return (
    <Paper component="section" aria-labelledby="draft-central-heading" variant="outlined" sx={{ p: 2, mb: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={2}>
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
            <Typography id="draft-central-heading" variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
              Draft Central
            </Typography>
            {active.length > 0 && <Chip size="small" label={`${active.length} live`} color="error" />}
            {scheduled.length > 0 && <Chip size="small" label={`${scheduled.length} scheduled`} color="primary" />}
            {unscheduled.length > 0 && <Chip size="small" label={`${unscheduled.length} need scheduling`} color="warning" />}
          </Stack>
          {focusDraft.draft_status === 'active' && totalPicks > 0 ? (
            <Box sx={{ mt: 1, maxWidth: 420 }}>
              <LinearProgress aria-label="Current draft progress" variant="determinate" value={progress} />
              <Typography variant="caption" color="text.secondary">{picksMade} / {totalPicks} picks</Typography>
            </Box>
          ) : focusDraft.draft_date ? (
            <Box sx={{ mt: 1 }}>
              <Countdown variant="chip" date={focusDraft.draft_date} timeZone={focusDraft.draft_timezone} />
            </Box>
          ) : null}
        </Box>
        <Button component={Link} to={`/league/${focusDraft.id}/draft`} variant={active.length > 0 ? 'contained' : 'outlined'}>
          {active.length > 0 ? 'Open live draft' : 'Review drafts'}
        </Button>
      </Stack>
    </Paper>
  );
}

export default DraftCentralCard;
