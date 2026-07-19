import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Container, Typography, Alert, Box, Skeleton, useMediaQuery, Tabs, Tab } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Grid from '@mui/material/Unstable_Grid2';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import useDraftSocket from './useDraftSocket';
import usePlayerPool from './usePlayerPool';
import useDraftQueue from './useDraftQueue';
import useDraftAdmin from './useDraftAdmin';
import useTabTitleFlash from './useTabTitleFlash';
import DraftStatusBar from './DraftStatusBar';
import DraftSettingsPanel from './DraftSettingsPanel';
import PlayerPoolTable from './PlayerPoolTable';
import DraftRail from './DraftRail';
import DraftBoardMatrix from './DraftBoardMatrix';

/** Plays a short (~200ms) beep via WebAudio so no audio asset is needed. */
function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.15;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      ctx.close();
    }, 200);
  } catch (err) {
    // Autoplay restrictions or lack of WebAudio support shouldn't break the draft.
  }
}

function DraftBoard() {
  const { leagueId } = useParams();
  const user = useSelector((store) => store.user);
  const notify = useSnackbar();
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));

  const [error, setError] = useState(null);
  // Draft/Board view tab, mirrored into the URL (view=board) alongside the
  // pool-state params usePlayerPool owns. Built off the previous params so
  // switching tabs doesn't clobber filters, and vice versa (see usePlayerPool).
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState(() => (searchParams.get('view') === 'board' ? 'board' : 'draft'));
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (view === 'board') next.set('view', 'board');
      else next.delete('view');
      return next;
    }, { replace: true });
  }, [view, setSearchParams]);

  // Per-user pick chime, default muted, remembered in localStorage. Read via
  // a ref inside the alert-driven effect below so toggling sound mid-turn
  // can't itself retrigger a beep.
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('endzone_draft_sound') === '1');
  const soundOnRef = useRef(soundOn);
  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);
  const toggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev;
      localStorage.setItem('endzone_draft_sound', next ? '1' : '0');
      return next;
    });
  };
  // Player quick-view: only the viewed id is stored. Whether that player has
  // been drafted (and by whom) is derived live from `picks`/`teams` below, so a
  // pick arriving over the socket while the dialog is open surfaces the banner
  // without any extra state — the board keeps updating behind the overlay.
  const [quickViewId, setQuickViewId] = useState(null);

  const pool = usePlayerPool(leagueId);
  const {
    league,
    teams,
    picks,
    onTheClock,
    secondsLeft,
    reconnecting,
    isMyTurn,
    draftComplete,
    onClockAlertOpen,
    dismissOnClockAlert,
    emitPick,
    error: socketError,
  } = useDraftSocket(leagueId, user?.id, { onPickLanded: pool.refetch });
  const { queue, loading: queueLoading, handleQueuePlayer, handleMoveUp, handleMoveDown, handleRemoveFromQueue } =
    useDraftQueue(leagueId, { onError: setError });
  const admin = useDraftAdmin(leagueId, league, { onError: setError });

  useTabTitleFlash(isMyTurn);

  // Plays the pick chime exactly when a new "on the clock" alert opens (the
  // false -> true edge the hook detects), not on every render it stays open.
  useEffect(() => {
    if (onClockAlertOpen && soundOnRef.current) playBeep();
  }, [onClockAlertOpen]);

  const handleDraftPlayer = (playerId) => {
    setError(null);
    const player = pool.availablePlayers.find((p) => p.id === playerId);
    emitPick(playerId, (resp) => {
      if (resp?.error) {
        setError(resp.error);
        notify(resp.error, { severity: 'error' });
      } else {
        notify(`Drafted ${player ? player.name : 'player'}!`);
      }
    });
  };

  const loading = pool.loading || queueLoading;

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }} data-testid="page-skeleton">
        <Skeleton variant="text" width={280} height={48} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={56} sx={{ mb: 3 }} />
        <Grid container spacing={3}>
          <Grid xs={12} md={8}>
            <Skeleton variant="rectangular" height={48} sx={{ mb: 2, borderRadius: 1 }} />
            <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 1 }} />
          </Grid>
          <Grid xs={12} md={4}>
            <Skeleton variant="rectangular" height={160} sx={{ mb: 3, borderRadius: 1 }} />
            <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 1 }} />
          </Grid>
        </Grid>
      </Container>
    );
  }

  const isCommissioner = !!(league && user && league.owner_id === user.id);

  // Derive the "Drafted by X" banner for the open quick-view from live draft
  // state: if the viewed player already appears in the pick history, name the
  // team that took them. Recomputes as picks stream in, so a player drafted
  // while the dialog is open shows the banner without disrupting the board.
  const quickViewPick = quickViewId != null ? picks.find((p) => p.player_id === quickViewId) : null;
  const quickViewDraftedBy = quickViewPick ? teams.find((t) => t.id === quickViewPick.team_id)?.name || null : null;

  // Season Proj isn't server-sortable (derived per league), so sort that column
  // client-side over the currently loaded list. Drafted rows only appear when
  // the "Hide drafted" toggle is off.
  const draftedIds = new Set(picks.map((p) => p.player_id));
  const displayPlayers =
    pool.sort === 'proj'
      ? [...pool.availablePlayers].sort((a, b) => {
          const av = a.projected_points ?? -Infinity;
          const bv = b.projected_points ?? -Infinity;
          return pool.dir === 'desc' ? bv - av : av - bv;
        })
      : pool.availablePlayers;

  // Context actions for the quick-view: Draft / Queue the currently-viewed
  // available player, mirroring the row buttons. Hidden once the player is
  // drafted (the "Drafted by" banner covers that case).
  const quickViewAvail = pool.availablePlayers.find((p) => p.id === quickViewId);
  const quickViewActions =
    quickViewAvail && !quickViewDraftedBy
      ? [
          {
            label: 'Draft',
            variant: 'contained',
            disabled: !!league?.draft_paused,
            onClick: () => {
              handleDraftPlayer(quickViewAvail.id);
              setQuickViewId(null);
            },
          },
          {
            label: queue.some((p) => p.id === quickViewAvail.id) ? 'Queued' : 'Queue',
            variant: 'outlined',
            disabled: queue.some((p) => p.id === quickViewAvail.id),
            onClick: () => handleQueuePlayer(quickViewAvail),
          },
        ]
      : [];

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <LeagueBreadcrumb />
      {(error || socketError) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || socketError}
        </Alert>
      )}
      {draftComplete && (
        <Alert severity="success" sx={{ mb: 2 }} data-testid="draft-complete-alert">
          Draft complete!
        </Alert>
      )}

      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          {league?.name || 'Draft Board'}
        </Typography>
        <DraftStatusBar
          league={league}
          onTheClock={onTheClock}
          secondsLeft={secondsLeft}
          reconnecting={reconnecting}
          isMyTurn={isMyTurn}
          soundOn={soundOn}
          toggleSound={toggleSound}
          isCommissioner={isCommissioner}
          onRandomizeOrder={admin.handleRandomizeOrder}
          onTogglePause={admin.handleTogglePause}
          onClockAlertOpen={onClockAlertOpen}
          onCloseOnClockAlert={dismissOnClockAlert}
        />
        {league?.draft_status === 'pending' && isCommissioner && (
          <DraftSettingsPanel
            pickTimeSeconds={admin.pickTimeSeconds}
            onPickTimeSecondsChange={admin.setPickTimeSeconds}
            autodraftDelaySeconds={admin.autodraftDelaySeconds}
            onAutodraftDelaySecondsChange={admin.setAutodraftDelaySeconds}
            onSubmit={admin.handleSaveDraftSettings}
            saving={admin.settingsSaving}
          />
        )}
      </Box>

      <Tabs
        value={view}
        onChange={(e, next) => setView(next)}
        sx={{ mb: 3, minHeight: 40, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab label="Draft" value="draft" sx={{ minHeight: 40 }} />
        <Tab label="Board" value="board" sx={{ minHeight: 40 }} />
      </Tabs>

      {view === 'board' ? (
        <DraftBoardMatrix
          teams={teams}
          picks={picks}
          onTheClock={onTheClock}
          rosterLimit={league?.roster_limit}
          onOpenQuickView={setQuickViewId}
        />
      ) : (
        <Grid container spacing={3}>
          <Grid xs={12} md={8} order={{ xs: 2, md: 1 }}>
            <PlayerPoolTable
              searchInput={pool.searchInput}
              onSearchInputChange={pool.setSearchInput}
              positionFilter={pool.positionFilter}
              onPositionFilterChange={pool.handlePositionFilterChange}
              hideDrafted={pool.hideDrafted}
              onHideDraftedChange={pool.setHideDrafted}
              sort={pool.sort}
              dir={pool.dir}
              onSort={pool.handleSort}
              search={pool.search}
              displayPlayers={displayPlayers}
              draftedIds={draftedIds}
              isMyTurn={isMyTurn}
              draftPaused={!!league?.draft_paused}
              onTheClockName={onTheClock ? onTheClock.name : null}
              queue={queue}
              onDraft={handleDraftPlayer}
              onQueue={handleQueuePlayer}
              onOpenQuickView={setQuickViewId}
              hasMore={pool.hasMore}
              loadingMore={pool.loadingMore}
              onLoadMore={pool.loadMore}
            />
          </Grid>

          <Grid xs={12} md={4} order={{ xs: 1, md: 2 }}>
            <DraftRail
              queue={queue}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onRemoveFromQueue={handleRemoveFromQueue}
              onDraft={handleDraftPlayer}
              isMyTurn={isMyTurn}
              draftPaused={!!league?.draft_paused}
              teams={teams}
              onTheClock={onTheClock}
              isCommissioner={isCommissioner}
              userId={user?.id}
              draftStatus={league?.draft_status}
              onToggleAutodraft={admin.handleToggleAutodraft}
              picks={picks}
              isXs={isXs}
              onOpenQuickView={setQuickViewId}
            />
          </Grid>
        </Grid>
      )}

      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
        leagueId={Number(leagueId)}
        draftedBy={quickViewDraftedBy}
        playerIds={displayPlayers.map((p) => p.id)}
        onNavigate={setQuickViewId}
        actions={quickViewActions}
      />
    </Container>
  );
}

export default DraftBoard;
