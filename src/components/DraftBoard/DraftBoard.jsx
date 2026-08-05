import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Container, Typography, Alert, Box, Skeleton, useMediaQuery, Tabs, Tab, IconButton, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import Grid from '@mui/material/Unstable_Grid2';
import SettingsIcon from '@mui/icons-material/Settings';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import Countdown from '../Countdown/Countdown';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import useDraftSocket from './useDraftSocket';
import usePlayerPool from './usePlayerPool';
import useDraftQueue from './useDraftQueue';
import useDraftAdmin from './useDraftAdmin';
import useTabTitleFlash from './useTabTitleFlash';
import DraftStatusBar from './DraftStatusBar';
import DraftSettingsPanel from './DraftSettingsPanel';
import LiveDraftBanner from './LiveDraftBanner';
import PlayerPoolTable from './PlayerPoolTable';
import DraftRail from './DraftRail';
import DraftBoardMatrix from './DraftBoardMatrix';
import DraftDayControls from './DraftDayControls';
import { assignRosterSlots } from '../../lib/rosterAssignment';
import { turnSummaryFor, pickLabelFor } from '../../lib/draftTurns';

/**
 * Everything the roster panel needs, derived from live draft state. A plain
 * function rather than a hook: the only place it can be called is below this
 * component's loading early-return, where hooks are not allowed.
 *
 * Returns null when there is nothing honest to show - before the first
 * draft:state frame, or for a spectator with no team in the league.
 */
function rosterViewFor({ league, teams, picks, userId }) {
  const rosterSlots = Array.isArray(league?.roster_slots) ? league.roster_slots : [];
  const myTeam = teams.find((team) => team.owner_id === userId) || null;
  if (!myTeam || rosterSlots.length === 0) return null;

  // Mirrors the server's ORDER BY "draft_position" NULLS LAST, "id". The id
  // tie-break is load-bearing, not cosmetic: with two null draft_positions,
  // (a ?? Infinity) - (b ?? Infinity) is NaN, and a comparator returning NaN is
  // unspecified behaviour rather than merely unstable.
  const ordered = [...teams].sort((a, b) => {
    const ap = a.draft_position == null ? Infinity : a.draft_position;
    const bp = b.draft_position == null ? Infinity : b.draft_position;
    return ap === bp ? a.id - b.id : ap - bp;
  });
  const teamIds = ordered.map((team) => team.id);
  const rounds = Number(league.roster_limit) || 0;

  const myPicks = picks
    .filter((pick) => pick.team_id === myTeam.id)
    .map((pick) => ({
      pickNumber: pick.pick_number,
      pickLabel: pickLabelFor(pick.pick_number - 1, teamIds.length),
      playerId: pick.player_id,
      name: pick.name,
      position: pick.position,
      nflTeam: pick.nfl_team,
      // Neither flag is on both socket payloads: draft:state carries is_keeper
      // but no autodraft flag, draft:picked carries by.auto but no is_keeper.
      // Each renders when the data happens to be there.
      auto: !!(pick.by && pick.by.auto),
      keeper: !!pick.is_keeper,
    }))
    // The socket reducer stores picks newest-first for the history list.
    .sort((a, b) => a.pickNumber - b.pickNumber);

  // Before the order is set there is no honest next pick to name.
  const positions = ordered.map((team) => team.draft_position);
  const orderKnown = league.draft_status !== 'pending'
    && rounds > 0
    && positions.every((position) => position != null)
    && new Set(positions).size === positions.length;

  const turn = orderKnown
    ? turnSummaryFor({
      teamId: myTeam.id,
      teamIds,
      // leagues.current_pick is ALREADY 0-based - see draft.service.js, which
      // passes it straight to teamForPick and stores current_pick + 1 as the
      // 1-based draft_picks.pick_number.
      fromPick0: Number(league.current_pick) || 0,
      totalPicks: teamIds.length * rounds,
      rotation: league.draft_rotation || 'snake',
      overrides: league.draft_order_overrides || null,
      // Keepers are pre-inserted at future pick numbers and the live draft
      // skips them, so they are not picks this team still has coming.
      takenPickNumbers: new Set(picks.map((pick) => pick.pick_number - 1)),
    })
    : null;

  const benchCount = Number(league.bench_slots) || 0;
  const irCount = Number(league.ir_slots) || 0;

  return {
    rosterSlots,
    benchCount,
    irCount,
    rounds,
    picks: myPicks,
    remainingPicks: turn ? turn.remainingPicks : null,
    nextPickLabel: turn && turn.nextPick ? turn.nextPick.label : null,
    // One assignment feeds the history's slot tags; the panel recomputes the
    // same pure function, which is guaranteed to agree.
    slotTags: assignRosterSlots({
      picks: myPicks, rosterSlots, benchCount, irCount,
    }).byPickNumber,
  };
}

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
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const isCommissioner = !!(league && user && (league.is_commissioner || league.owner_id === user.id));
  const rosterView = rosterViewFor({ league, teams, picks, userId: user?.id });

  // Derive the "Drafted by X" banner for the open quick-view from live draft
  // state: if the viewed player already appears in the pick history, name the
  // team that took them. Recomputes as picks stream in, so a player drafted
  // while the dialog is open shows the banner without disrupting the board.
  const quickViewPick = quickViewId != null ? picks.find((p) => p.player_id === quickViewId) : null;
  const quickViewDraftedBy = quickViewPick ? teams.find((t) => t.id === quickViewPick.team_id)?.name || null : null;

  const draftedIds = new Set(picks.map((p) => p.player_id));
  const displayPlayers = pool.availablePlayers;

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
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h4">{league?.name || 'Draft Board'}</Typography>
          {isCommissioner && (league?.draft_status === 'pending' || league?.draft_status === 'active') && (
            <Tooltip title="Draft settings">
              <IconButton aria-label="Draft settings" onClick={() => setSettingsOpen(true)}>
                <SettingsIcon />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <DraftStatusBar
          league={league}
          onTheClock={onTheClock}
          secondsLeft={secondsLeft}
          reconnecting={reconnecting}
          soundOn={soundOn}
          toggleSound={toggleSound}
          isCommissioner={isCommissioner}
          onRandomizeOrder={admin.handleRandomizeOrder}
          onTogglePause={admin.handleTogglePause}
          onClockAlertOpen={onClockAlertOpen}
          onCloseOnClockAlert={dismissOnClockAlert}
        />
        {isCommissioner && league?.draft_status === 'active' && (
          <DraftDayControls
            league={league}
            picks={picks}
            onUndo={admin.handleUndoPick}
            onReset={admin.handleResetDraft}
            onGetShareLink={admin.handleGetShareLink}
          />
        )}
        {league?.draft_status === 'pending' && league?.draft_date && (
          <Box sx={{ mt: 2 }}>
            <Countdown variant="full" date={league.draft_date} />
          </Box>
        )}
        {isCommissioner && (
          <DraftSettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            pickTimeSeconds={admin.pickTimeSeconds}
            onPickTimeSecondsChange={admin.setPickTimeSeconds}
            autodraftDelaySeconds={admin.autodraftDelaySeconds}
            onAutodraftDelaySecondsChange={admin.setAutodraftDelaySeconds}
            onSubmit={async (e) => {
              await admin.handleSaveDraftSettings(e);
              setSettingsOpen(false);
            }}
            saving={admin.settingsSaving}
            leagueId={leagueId}
            draftStatus={league?.draft_status}
          />
        )}
      </Box>

      {/* Sibling to (not nested in) the header Box above: sticky positioning is
          bounded by the containing block, so LiveDraftBanner needs a containing
          block tall enough to stay pinned while the Grid below scrolls underneath
          it — the short header Box alone isn't tall enough. */}
      <LiveDraftBanner league={league} onTheClock={onTheClock} secondsLeft={secondsLeft} isMyTurn={isMyTurn} />

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
              onToggleReady={admin.handleToggleReady}
              picks={picks}
              isXs={isXs}
              onOpenQuickView={setQuickViewId}
              rosterView={rosterView}
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
