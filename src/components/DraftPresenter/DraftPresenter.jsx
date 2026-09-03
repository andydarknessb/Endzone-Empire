import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { Alert, Box, Container, Paper, Stack, Typography } from '@mui/material';
import DraftBoardMatrix from '../DraftBoard/DraftBoardMatrix';
import PickClock from '../DraftBoard/PickClock';
import { deriveOnTheClock } from '../../lib/onTheClock';
import DraftActivityEntry from '../DraftBoard/DraftActivityEntry';
import { draftRounds } from '../../lib/rosterShape';
import { teamNameLabel, feedEntryKey } from '../../lib/teamIdentity';

// Presenter links are intentionally anonymous: do not use apiClient here,
// because its 401 interceptor can attempt an authenticated token refresh.
const presenterClient = axios.create();

function presenterError(error) {
  return error?.response?.data?.error || 'Unable to load this draft board.';
}

function DraftPresenter() {
  const { token } = useParams();
  const [draftState, setDraftState] = useState(null);
  const [activity, setActivity] = useState([]);
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

  // The presenter-safe Draft activity feed (#438) is a SEPARATE, best-effort
  // request: a hiccup fetching it must never blank the board, which is the
  // primary surface. The endpoint reads Draft activity alone (never chat), so
  // what lands here is already Team-only Pick and lifecycle facts.
  const loadActivity = useCallback(async () => {
    try {
      const response = await presenterClient.get(`/api/draft/board/${encodeURIComponent(token)}/activity`);
      setActivity(Array.isArray(response.data) ? response.data : []);
    } catch {
      // Leave the last good feed in place; the board stands on its own.
    }
  }, [token]);

  useEffect(() => {
    loadBoard();
    loadActivity();
    const poll = window.setInterval(() => {
      loadBoard();
      loadActivity();
    }, 5000);
    return () => window.clearInterval(poll);
  }, [loadBoard, loadActivity]);

  // Newest-first for a live glance board: the endpoint returns oldest-first
  // (the same ascending chronology the Draft room reads), so reverse a copy.
  const activityNewestFirst = useMemo(() => [...activity].reverse(), [activity]);

  const picksNewestFirst = useMemo(
    () => [...(draftState?.picks || [])].sort((a, b) => b.pick_number - a.pick_number),
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

  const { league, teams } = draftState;
  const isActive = league.draft_status === 'active';
  // The same On-the-clock value the room derives (#754), off this page's
  // polled snapshot: derived once per poll, never per second. The PickClock
  // leaf below owns the tick, so this page does not repaint on it.
  const onTheClock = deriveOnTheClock({
    team: draftState.onTheClock,
    deadlineAt: league.pick_deadline_at ? Date.parse(league.pick_deadline_at) : null,
    paused: !!league.draft_paused,
    active: isActive,
  });

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
                {onTheClock.team ? `${onTheClock.team.teamName} is on the clock` : league.draft_status}
              </Typography>
            </Box>
            {onTheClock.state === 'running' ? (
              // This is the per-pick clock, not the Draft's own schedule, so
              // it is the room's PickClock leaf (one m:ss vocabulary, #754),
              // not the schedule Countdown: no milestone announcer, no
              // timezone/calendar detail.
              <PickClock deadlineAt={onTheClock.deadlineAt} prefix="Time remaining:" variant="h6" />
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
            draftRounds={draftRounds(league)}
            readOnly
            // This page's own heading order is h1 (above) then h3 (the
            // on-the-clock status) then h4 ("Recent picks" below) - not
            // something issue #121 owns fixing. Keep the matrix's title at
            // its own pre-existing level here (out of the h1-h3-h4 chain
            // entirely) rather than accepting the default h2, which would
            // sit awkwardly between the h3 and h4 already on this page.
            titleComponent="h6"
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
                      Pick {pick.pick_number} · {teamNameLabel(pick.teamName)}
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

          <Paper component="section" aria-labelledby="draft-activity-heading" sx={{ p: { xs: 2, md: 3 } }}>
            <Typography id="draft-activity-heading" variant="h4" sx={{ fontSize: { xs: '1.4rem', md: '2rem' }, mb: 2 }}>
              Draft activity
            </Typography>
            {activityNewestFirst.length === 0 ? (
              <Typography sx={{ color: 'text.secondary' }}>No draft activity yet.</Typography>
            ) : (
              // A live, scrollable log of the authoritative Draft events (#438),
              // rendered with the SAME event line the Draft room uses so a
              // presenter and a member read a Pick or a lifecycle change the
              // same way. It carries no chat, no composer and no moderation.
              <Box aria-live="polite" sx={{ maxHeight: 420, overflowY: 'auto' }}>
                {activityNewestFirst.map((entry) => (
                  <DraftActivityEntry key={feedEntryKey(entry)} entry={entry} />
                ))}
              </Box>
            )}
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}

export default DraftPresenter;
