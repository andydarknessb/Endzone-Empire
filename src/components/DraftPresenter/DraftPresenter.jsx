import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { Alert, Box, Container, Paper, Stack, Typography } from '@mui/material';
import Countdown from '../Countdown/Countdown';
import DraftBoardMatrix from '../DraftBoard/DraftBoardMatrix';
import { draftRosterSize } from '../../lib/rosterShape';

// Presenter links are intentionally anonymous: do not use apiClient here,
// because its 401 interceptor can attempt an authenticated token refresh.
const presenterClient = axios.create();

function presenterError(error) {
  return error?.response?.data?.error || 'Unable to load this draft board.';
}

function DraftPresenter() {
  const { token } = useParams();
  const [draftState, setDraftState] = useState(null);
  const [error, setError] = useState(null);

  const loadBoard = useCallback(async () => {
    try {
      const response = await presenterClient.get(`/api/draft/board/${encodeURIComponent(token)}`);
      setDraftState(response.data);
      setError(null);
    } catch (requestError) {
      setError(presenterError(requestError));
    }
  }, [token]);

  useEffect(() => {
    loadBoard();
    const poll = window.setInterval(loadBoard, 5000);
    return () => window.clearInterval(poll);
  }, [loadBoard]);

  const picksNewestFirst = useMemo(
    () => [...(draftState?.picks || [])].sort((a, b) => b.pick_number - a.pick_number),
    [draftState]
  );
  const teamNames = useMemo(
    () => new Map((draftState?.teams || []).map((team) => [team.id, team.name])),
    [draftState]
  );

  if (!draftState && !error) {
    return (
      <Container sx={{ py: 6 }}>
        <Typography variant="h5">Loading draft board…</Typography>
      </Container>
    );
  }

  if (!draftState) {
    return (
      <Container sx={{ py: 6 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  const { league, teams, onTheClock } = draftState;
  const isActive = league.draft_status === 'active';

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: { xs: 2, md: 4 } }}>
      <Container maxWidth={false} sx={{ maxWidth: 1800 }}>
        <Stack spacing={{ xs: 2, md: 3 }}>
          <Box component="header">
            <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 'bold' }}>
              Draft Presenter
            </Typography>
            <Typography variant="h2" component="h1" sx={{ fontSize: { xs: '2rem', md: '3.25rem' }, fontWeight: 'bold' }}>
              {league.name}
            </Typography>
          </Box>

          <Paper
            component="section"
            role="status"
            aria-live="polite"
            sx={{
              p: { xs: 2, md: 3 }, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 2, flexWrap: 'wrap', border: 2, borderColor: isActive ? 'primary.main' : 'divider',
            }}
          >
            <Box>
              <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 'bold' }}>
                {isActive ? 'On the clock' : 'Draft status'}
              </Typography>
              <Typography variant="h3" sx={{ fontSize: { xs: '1.6rem', md: '2.5rem' }, fontWeight: 'bold' }}>
                {isActive && onTheClock ? `${onTheClock.name} is on the clock` : league.draft_status}
              </Typography>
            </Box>
            {isActive && !league.draft_paused && league.pick_deadline_at ? (
              // This is the per-pick clock, not the Draft's own schedule: no
              // milestone announcer (the surrounding Paper is already one
              // aria-live=polite region) and no timezone/calendar detail.
              <Countdown date={league.pick_deadline_at} prefix="Time remaining:" announce={false} />
            ) : (
              <Typography variant="h6" sx={{ color: league.draft_paused ? 'warning.main' : 'text.secondary' }}>
                {league.draft_paused ? 'Draft paused' : 'No active pick clock'}
              </Typography>
            )}
          </Paper>

          <DraftBoardMatrix
            teams={teams}
            picks={picksNewestFirst}
            onTheClock={onTheClock}
            draftRounds={draftRosterSize(league)}
            readOnly
          />

          <Paper component="section" aria-labelledby="recent-picks-heading" sx={{ p: { xs: 2, md: 3 } }}>
            <Typography id="recent-picks-heading" variant="h4" sx={{ fontSize: { xs: '1.4rem', md: '2rem' }, mb: 2 }}>
              Recent picks
            </Typography>
            {picksNewestFirst.length === 0 ? (
              <Typography sx={{ color: 'text.secondary' }}>No picks have been made.</Typography>
            ) : (
              <Stack direction="row" spacing={2} sx={{ overflowX: 'auto', pb: 0.5 }}>
                {picksNewestFirst.slice(0, 5).map((pick) => (
                  <Box key={pick.pick_number} sx={{ minWidth: { xs: 180, md: 240 } }}>
                    <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                      Pick {pick.pick_number} · {teamNames.get(pick.team_id) || 'Team'}
                    </Typography>
                    <Typography variant="h5" noWrap title={pick.name}>{pick.name}</Typography>
                    <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                      {pick.position}{pick.nfl_team ? ` · ${pick.nfl_team}` : ''}{pick.is_keeper ? ' · Keeper' : ''}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            )}
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}

export default DraftPresenter;
