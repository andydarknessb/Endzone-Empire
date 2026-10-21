import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { Box, Typography } from '@mui/material';
import {
  ErrorPanel, Frame, LiveChip, PixelHeading, Skel, pixelSx, psRootSx,
} from '../../shared/ui/playselect';
import DraftBoardMatrix from '../DraftBoard/DraftBoardMatrix';
import PickClock from '../DraftBoard/PickClock';
import { deriveOnTheClock } from '../../shared/lib/onTheClock';
import DraftActivityEntry from '../DraftBoard/DraftActivityEntry';
import { draftRounds } from '../../lib/rosterShape';
import { teamNameLabel, feedEntryKey } from '../../shared/lib/teamIdentity';
import { readHttpFailure } from '../../lib/httpFailure';

// Presenter links are intentionally anonymous: do not use apiClient here,
// because its 401 interceptor can attempt an authenticated token refresh.
const presenterClient = axios.create();

function presenterError(error) {
  return readHttpFailure(error).message || 'Unable to load this draft board.';
}

// Body text for a TV: 20px at 1920 wide, scaling with the screen. The room's
// pieces size their own text (14px cells, 15px and 13px activity lines), so the
// frame below hands them this size from outside rather than forking them.
const TV_TEXT = 'clamp(16px, 1.05vw, 24px)';
const TV_SX = {
  fontSize: TV_TEXT,
  '& .MuiTableCell-root, & .MuiTypography-body2, & [data-testid="draft-activity"] > div': { fontSize: 'inherit' },
};

function PresenterRoot({ children }) {
  return (
    <Box
      className="ps-root"
      sx={{ ...psRootSx, minHeight: '100vh', boxSizing: 'border-box', py: { xs: 2, md: 4 }, px: { xs: 2, md: 4 } }}
    >
      <Box sx={{ maxWidth: 1800, mx: 'auto', display: 'grid', gap: { xs: 2, md: 3 } }}>{children}</Box>
    </Box>
  );
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
      <PresenterRoot>
        <Box role="status" aria-label="Loading draft board" sx={{ display: 'grid', gap: 2 }}>
          <Skel width="40%" height={40} />
          <Skel width="100%" height={96} />
          <Skel width="100%" height={360} />
        </Box>
      </PresenterRoot>
    );
  }

  if (!draftState) {
    return (
      <PresenterRoot>
        <ErrorPanel title="Unable to load this draft board" body={error} />
      </PresenterRoot>
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
    <PresenterRoot>
      <Box component="header">
        <Box component="p" sx={{ m: 0, mb: 0.5, fontSize: '15px', fontWeight: 600, color: 'var(--ps-dim)' }}>
          Draft Presenter
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px' }}>
          <PixelHeading level={1}>{league.name}</PixelHeading>
          {isActive && <LiveChip />}
        </Box>
      </Box>

      {/* The room's on-the-clock banner, off this page's polled snapshot: Board
          black, a Pixel 24 turn line and the room's PickClock leaf at Pixel 32. */}
      <Box
        component="section"
        role="status"
        aria-live="polite"
        sx={{
          p: { xs: 1.5, md: 2.5 }, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 2, flexWrap: 'wrap', backgroundColor: 'var(--ps-board)', color: 'var(--ps-board-ink)',
          border: '2px solid', borderColor: isActive ? 'var(--ps-board-live)' : 'var(--ps-board-rule)',
        }}
      >
        <Box sx={{ ...pixelSx(24), fontSize: { xs: '16px', md: '24px' }, overflowWrap: 'anywhere', minWidth: 0 }}>
          {onTheClock.team ? `${onTheClock.team.teamName} is on the clock` : league.draft_status}
        </Box>
        {onTheClock.state === 'running' ? (
          // The per-pick clock, not the Draft's schedule Countdown (one m:ss
          // vocabulary, #754).
          <PickClock deadlineAt={onTheClock.deadlineAt} sx={pixelSx(32)} />
        ) : (
          <Box sx={{ ...pixelSx(16), color: league.draft_paused ? 'var(--ps-board-ink)' : 'var(--ps-board-dim)' }}>
            {league.draft_paused ? 'Draft paused' : 'No active pick clock'}
          </Box>
        )}
      </Box>

      <Box sx={TV_SX}>
        <DraftBoardMatrix
          teams={teams}
          picks={picksNewestFirst}
          onTheClock={onTheClock}
          draftRounds={draftRounds(league)}
          readOnly
        />
      </Box>

      <Frame tier="rule" labelledBy="recent-picks-heading" sx={{ ...TV_SX, p: { xs: 2, md: 3 } }}>
        <Box sx={{ mb: 2 }}>
          <PixelHeading id="recent-picks-heading">Recent picks</PixelHeading>
        </Box>
        {picksNewestFirst.length === 0 ? (
          <Typography sx={{ color: 'var(--ps-dim)', fontSize: 'inherit' }}>No picks have been made.</Typography>
        ) : (
          <Box sx={{ display: 'flex', gap: 3, overflowX: 'auto', pb: 0.5 }}>
            {picksNewestFirst.slice(0, 5).map((pick) => (
              <Box key={pick.pick_number} sx={{ minWidth: { xs: 180, md: 280 } }}>
                <Box sx={{ color: 'var(--ps-dim)' }}>
                  Pick {pick.pick_number} · {teamNameLabel(pick.teamName)}
                </Box>
                <Box title={pick.name} sx={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {pick.name}
                </Box>
                <Box sx={{ color: 'var(--ps-dim)' }}>
                  {pick.position}{pick.nfl_team ? ` · ${pick.nfl_team}` : ''}{pick.is_keeper ? ' · Keeper' : ''}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Frame>

      <Frame tier="rule" labelledBy="draft-activity-heading" sx={{ ...TV_SX, p: { xs: 2, md: 3 } }}>
        <Box sx={{ mb: 2 }}>
          <PixelHeading id="draft-activity-heading">Draft activity</PixelHeading>
        </Box>
        {activityNewestFirst.length === 0 ? (
          <Typography sx={{ color: 'var(--ps-dim)', fontSize: 'inherit' }}>No draft activity yet.</Typography>
        ) : (
          // A live, scrollable log of the authoritative Draft events (#438),
          // rendered with the SAME event line the Draft room uses so a
          // presenter and a member read a Pick or a lifecycle change the same
          // way. It carries no chat, no composer and no moderation.
          <Box aria-live="polite" sx={{ maxHeight: 420, overflowY: 'auto' }}>
            {activityNewestFirst.map((entry) => (
              <DraftActivityEntry key={feedEntryKey(entry)} entry={entry} />
            ))}
          </Box>
        )}
      </Frame>
    </PresenterRoot>
  );
}

export default DraftPresenter;
