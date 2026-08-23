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
import useMyRoster from './useMyRoster';
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
import DraftPickConfirmDialog from './DraftPickConfirmDialog';
import { pickActionExists, pickTemporarilyUnavailable, PICK_UNAVAILABLE_EXPLANATION } from './pickAvailability';
import { assignRosterSlots } from '../../lib/rosterAssignment';
import { turnSummaryFor, pickLabelFor } from '../../lib/draftTurns';
import { draftRounds } from '../../lib/rosterShape';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';
import { teamNameLabel } from '../../lib/teamIdentity';

// The Draft page's one landmark structure: a single <main>, named by the
// league-name H1 inside it, that the App-level skip link (see App.jsx)
// targets directly. Shared by both the loading skeleton and the loaded view
// so the skip link's destination exists throughout the page's lifecycle.
const DRAFT_MAIN_ID = 'draft-main-content';
const DRAFT_H1_ID = 'draft-league-name';

/**
 * Everything the roster panel needs, derived from live draft state. A plain
 * function rather than a hook: the only place it can be called is below this
 * component's loading early-return, where hooks are not allowed.
 *
 * Returns null when there is nothing honest to show - before the first
 * draft:state frame, or for a spectator with no team in the league.
 */
function rosterViewFor({ league, teams, picks, viewerTeamId }) {
  const rosterSlots = Array.isArray(league?.roster_slots) ? league.roster_slots : [];
  const myTeam = viewerTeamId == null ? null : teams.find((team) => team.teamId === viewerTeamId) || null;
  if (!myTeam || rosterSlots.length === 0) return null;

  // Mirrors the server's ORDER BY "draft_position" NULLS LAST, "id". The id
  // tie-break is load-bearing, not cosmetic: with two null draft_positions,
  // (a ?? Infinity) - (b ?? Infinity) is NaN, and a comparator returning NaN is
  // unspecified behaviour rather than merely unstable.
  const ordered = [...teams].sort((a, b) => {
    const ap = a.draft_position == null ? Infinity : a.draft_position;
    const bp = b.draft_position == null ? Infinity : b.draft_position;
    return ap === bp ? a.teamId - b.teamId : ap - bp;
  });
  const teamIds = ordered.map((team) => team.teamId);
  // Rounds are Draft rounds (ADR 0005): the live-derived draft roster size
  // while pending, or the fixed value once the draft is active/complete.
  // Mirrors draft.service.js.
  const rounds = draftRounds(league);

  const myPicks = picks
    .filter((pick) => pick.teamId === myTeam.teamId)
    .map((pick) => ({
      pickNumber: pick.pick_number,
      pickLabel: pickLabelFor(pick.pick_number - 1, teamIds.length),
      playerId: pick.player_id,
      name: pick.name,
      position: pick.position,
      nflTeam: pick.nfl_team,
      // Neither flag is on both socket payloads: draft:state carries is_keeper
      // but no autopick flag, draft:picked carries one but no is_keeper.
      // Each renders when the data happens to be there.
      auto: !!pick.auto,
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
      teamId: myTeam.teamId,
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
      picks: myPicks, rosterSlots, benchCount, irCount, irDraftable: false,
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
  // The medium breakpoint already established by this route's own Grid
  // (players/rail switch order there at `md`) - issue #122 reuses it as the
  // one place desktop's dual-scroll shell and mobile's single-scroll tabs
  // diverge. Defaults to false when matchMedia is unavailable (jsdom unit
  // tests), so every existing desktop-shaped assertion is unaffected unless a
  // test explicitly opts into mobile via the matchMedia mock convention.
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [error, setError] = useState(null);
  // Draft/Board view tab, mirrored into the URL (view=board) alongside the
  // pool-state params usePlayerPool owns. Built off the previous params so
  // switching tabs doesn't clobber filters, and vice versa (see usePlayerPool).
  const [searchParams, setSearchParams] = useSearchParams();
  // Three logical views: 'players' (the default), 'draft' (the rail) and
  // 'board'. Desktop collapses 'players'/'draft' into one dual-pane workspace
  // (issue #122 acceptance criterion 1) - only 'board' swaps out the whole
  // region there. Below the medium breakpoint each is its own tab/single
  // scroll region, in the persistent Players/Board/Draft order the
  // acceptance criteria name.
  const [view, setView] = useState(() => {
    const requested = searchParams.get('view');
    return requested === 'board' || requested === 'draft' ? requested : 'players';
  });
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (view === 'players') next.delete('view');
      else next.set('view', view);
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
  // A manual Pick awaiting the focused confirmation dialog: { id, name } |
  // null. Every manual-Pick surface (pool row, Quick View, queue quick-draft)
  // routes through requestDraftPlayer below instead of committing directly,
  // so none of them can skip the confirmation (#120 acceptance criterion 3).
  const [pendingPick, setPendingPick] = useState(null);

  const pool = usePlayerPool(leagueId);
  const myRoster = useMyRoster(leagueId);
  // useDraftSocket registers its socket listeners once per leagueId (not
  // per render), so the `onPickLanded` it calls must stay stable in
  // identity while still seeing this render's `teams`/`user` - a ref holds
  // the actual logic, refreshed every render below, while the function
  // passed into the hook itself never changes.
  const pickLandedRef = useRef(() => {});
  const {
    league,
    teams,
    picks,
    onTheClock,
    viewerTeamId,
    secondsLeft,
    reconnecting,
    isMyTurn,
    draftComplete,
    onClockAlertOpen,
    dismissOnClockAlert,
    emitPick,
    error: socketError,
  } = useDraftSocket(leagueId, {
    onPickLanded: (data) => pickLandedRef.current(data),
  });
  useEffect(() => {
    pickLandedRef.current = (data) => {
      pool.refetch();
      // Only refetch the caller's own roster when THIS pick actually landed
      // on it - every other team's pick in the draft leaves it unchanged, and
      // a full snake draft can be 150+ picks. Both sides are Team IDs, so the
      // comparison no longer has to route through a team lookup by account.
      if (viewerTeamId != null && data?.teamId === viewerTeamId) myRoster.refetchRoster();
    };
  });
  const { queue, loading: queueLoading, handleQueuePlayer, handleMoveUp, handleMoveDown, handleRemoveFromQueue } =
    useDraftQueue(leagueId, { onError: setError });
  const admin = useDraftAdmin(leagueId, league, { onError: setError });

  useTabTitleFlash(isMyTurn);

  // Plays the pick chime exactly when a new "on the clock" alert opens (the
  // false -> true edge the hook detects), not on every render it stays open.
  useEffect(() => {
    if (onClockAlertOpen && soundOnRef.current) playBeep();
  }, [onClockAlertOpen]);

  // Shared by every lookup below: the rail's quick-draft button targets
  // queue[0], which can be a player the current pool filters/paging don't
  // currently include, so the pool is checked first and the queue is the
  // fallback rather than the other way around.
  const findKnownPlayer = (playerId) =>
    pool.availablePlayers.find((p) => p.id === playerId) || queue.find((p) => p.id === playerId);

  const handleDraftPlayer = (playerId) => {
    setError(null);
    const player = findKnownPlayer(playerId);
    emitPick(playerId, (resp) => {
      if (resp?.error) {
        setError(resp.error);
        notify(resp.error, { severity: 'error' });
      } else {
        notify(`Drafted ${player ? player.name : 'player'}!`);
      }
    });
  };

  // Opens the focused confirmation dialog instead of committing straight
  // away - the single seam every manual-Pick surface below calls through.
  const requestDraftPlayer = (playerId) => {
    const player = findKnownPlayer(playerId);
    setPendingPick({ id: playerId, name: player ? player.name : 'this player' });
  };

  const confirmDraftPlayer = () => {
    if (!pendingPick) return;
    const { id } = pendingPick;
    setPendingPick(null);
    setQuickViewId(null);
    // Re-check against the LATEST live state rather than trusting whatever
    // was true when the dialog opened: it can sit open across a turn
    // change (the clock expired and autodraft took the pick), a pause, or
    // the draft ending, none of which touch `pendingPick` itself.
    const canManualPickNow = pickActionExists({ draftStatus: league?.draft_status, draftType: league?.draft_type });
    const stillAvailable = canManualPickNow && !pickTemporarilyUnavailable({ isMyTurn, draftPaused: !!league?.draft_paused });
    if (!stillAvailable) {
      notify(PICK_UNAVAILABLE_EXPLANATION, { severity: 'error' });
      return;
    }
    handleDraftPlayer(id);
  };

  const cancelDraftPlayer = () => setPendingPick(null);

  const loading = pool.loading || queueLoading;

  if (loading) {
    return (
      <Container
        component="main"
        id={DRAFT_MAIN_ID}
        tabIndex={-1}
        maxWidth="xl"
        data-testid="page-skeleton"
        sx={{
          py: 4,
          // App.jsx gives the desktop Draft route a fixed-height, non-
          // scrolling shell (issue #122) whether or not this skeleton is
          // what's currently mounted inside it. Match that height so the
          // skeleton fills it instead of being clipped by the shell's own
          // overflow: hidden, with its own overflow: auto as a safety net
          // if a very short window ever makes it taller than that anyway -
          // it scrolls in place rather than vanishing.
          height: { md: '100%' },
          overflow: { md: 'auto' },
        }}
      >
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

  // Deliberately still an account comparison, and the one on this page (#113).
  // It asks "am I this league's commissioner", not "which of these Teams is
  // me", and it compares the viewer's OWN account id against a league column
  // rather than reading another manager's identity. It cannot be expressed in
  // Team identity yet either: the draft:state snapshot carries no
  // ownerTeamId - only league detail does - because a broadcast cannot carry a
  // viewer-relative field. See #178, which owns both halves of that: the
  // is_commissioner operand is always undefined here (the snapshot is a bare
  // SELECT * on leagues), so a co-commissioner silently gets no controls.
  const isCommissioner = !!(league && user && (league.is_commissioner || league.owner_id === user.id));
  const rosterView = rosterViewFor({ league, teams, picks, viewerTeamId });

  // Derive the "Drafted by X" banner for the open quick-view from live draft
  // state: if the viewed player already appears in the pick history, name the
  // team that took them. Recomputes as picks stream in, so a player drafted
  // while the dialog is open shows the banner without disrupting the board.
  // A Pick now names its own Team (#113), so this no longer resolves a bare
  // team_id against the teams list to find a name to show.
  const quickViewPick = quickViewId != null ? picks.find((p) => p.player_id === quickViewId) : null;
  const quickViewDraftedBy = quickViewPick ? teamNameLabel(quickViewPick.teamName) : null;

  const draftedIds = new Set(picks.map((p) => p.player_id));
  const displayPlayers = pool.availablePlayers;

  // Bye overlap (see PlayerPoolTable): which of the caller's OWN rostered
  // players share a Bye week, keyed by that week. A neutral roster fact for
  // the pool to surface next to a candidate's Bye - never computed against
  // other teams' rosters, and never phrased as risk/severity.
  const byeOverlapByWeek = new Map();
  for (const rosterPlayer of myRoster.roster) {
    const week = rosterPlayer.bye_week;
    if (week == null) continue;
    if (!byeOverlapByWeek.has(week)) byeOverlapByWeek.set(week, []);
    byeOverlapByWeek.get(week).push({ id: rosterPlayer.id, name: rosterPlayer.name });
  }

  // Context actions for the quick-view: Draft / Queue the currently-viewed
  // available player, mirroring the row buttons - same rules, same shared
  // confirmation dialog. Hidden once the player is drafted (the "Drafted by"
  // banner covers that case), and Draft itself is omitted entirely (not just
  // disabled) whenever no manual Pick control exists in this draft's status/
  // type at all (#120 acceptance criteria 1-2, 5).
  const quickViewAvail = pool.availablePlayers.find((p) => p.id === quickViewId);
  const canManualPick = pickActionExists({ draftStatus: league?.draft_status, draftType: league?.draft_type });
  const pickUnavailable = canManualPick && pickTemporarilyUnavailable({ isMyTurn, draftPaused: !!league?.draft_paused });
  const quickViewActions =
    quickViewAvail && !quickViewDraftedBy
      ? [
          ...(canManualPick
            ? [
                {
                  label: 'Draft',
                  variant: 'contained',
                  color: 'success',
                  unavailableReason: pickUnavailable ? PICK_UNAVAILABLE_EXPLANATION : null,
                  onClick: () => requestDraftPlayer(quickViewAvail.id),
                },
              ]
            : []),
          {
            label: queue.some((p) => p.id === quickViewAvail.id) ? 'Queued' : 'Queue',
            variant: 'outlined',
            disabled: queue.some((p) => p.id === quickViewAvail.id),
            onClick: () => handleQueuePlayer(quickViewAvail),
          },
        ]
      : [];

  // Shared by every PlayerPoolTable render below - built once instead of
  // duplicated between the desktop and mobile branches.
  const playerPoolProps = {
    searchInput: pool.searchInput,
    onSearchInputChange: pool.setSearchInput,
    positionFilter: pool.positionFilter,
    onPositionFilterChange: pool.handlePositionFilterChange,
    hideDrafted: pool.hideDrafted,
    onHideDraftedChange: pool.setHideDrafted,
    byeWeeksFilter: pool.byeWeeksFilter,
    onByeWeeksFilterChange: pool.handleByeWeeksFilterChange,
    sort: pool.sort,
    dir: pool.dir,
    onSort: pool.handleSort,
    search: pool.search,
    displayPlayers,
    draftedIds,
    draftStatus: league?.draft_status,
    draftType: league?.draft_type,
    isMyTurn,
    draftPaused: !!league?.draft_paused,
    queue,
    onDraft: requestDraftPlayer,
    onQueue: handleQueuePlayer,
    onOpenQuickView: setQuickViewId,
    hasMore: pool.hasMore,
    loadingMore: pool.loadingMore,
    onLoadMore: pool.loadMore,
    byeOverlapByWeek,
  };
  // Shared by every DraftRail render below likewise.
  const draftRailProps = {
    queue,
    onMoveUp: handleMoveUp,
    onMoveDown: handleMoveDown,
    onRemoveFromQueue: handleRemoveFromQueue,
    onDraft: requestDraftPlayer,
    isMyTurn,
    draftPaused: !!league?.draft_paused,
    teams,
    onTheClock,
    isCommissioner,
    viewerTeamId,
    draftStatus: league?.draft_status,
    draftType: league?.draft_type,
    onToggleAutodraft: admin.handleToggleAutodraft,
    onToggleReady: admin.handleToggleReady,
    picks,
    isXs,
    onOpenQuickView: setQuickViewId,
    rosterView,
  };

  // Desktop only ever shows two tabs (Draft = the dual-pane workspace,
  // Board); mobile's three swap the Draft/Players split for its own single-
  // region tabs, in the Players/Board/Draft order the acceptance criteria
  // name. One shared list (rather than a differently-ordered Tab JSX per
  // breakpoint) keeps that ordering the single source of truth.
  const tabDefs = isMobile
    ? [
        { value: 'players', label: 'Players' },
        { value: 'board', label: 'Board' },
        { value: 'draft', label: 'Draft' },
      ]
    : [
        { value: 'draft', label: 'Draft' },
        { value: 'board', label: 'Board' },
      ];

  return (
    <Container
      component="main"
      id={DRAFT_MAIN_ID}
      tabIndex={-1}
      aria-labelledby={DRAFT_H1_ID}
      maxWidth="xl"
      sx={{
        py: { xs: 4, md: 2 },
        // Desktop viewport-height shell (issue #122 acceptance criterion 1):
        // the chrome below keeps its natural size (flexShrink: 0) and only
        // the final board/workspace region grows to fill what's left, so
        // nothing here needs the page itself to scroll. Below the medium
        // breakpoint this is a plain block - the page scrolls as the single
        // region acceptance criterion 3 asks for.
        display: { md: 'flex' },
        flexDirection: { md: 'column' },
        height: { md: '100%' },
        minHeight: { md: 0 },
        overflow: { md: 'hidden' },
      }}
    >
      <Box sx={{ flexShrink: { md: 0 } }}>
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
            <Typography id={DRAFT_H1_ID} variant="h4" component="h1">
              {league?.name || 'Draft Board'}
            </Typography>
            {isCommissioner && (league?.draft_status === 'pending' || league?.draft_status === 'active') && (
              <Tooltip title="Draft settings">
                <IconButton aria-label="Draft settings" onClick={() => setSettingsOpen(true)} sx={MIN_TOUCH_TARGET_SX}>
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
              <Countdown
                variant="full"
                date={league.draft_date}
                timeZone={league.draft_timezone}
                leagueId={league.id}
                leagueName={league.name}
              />
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

      </Box>

      {/* NOT inside either flexShrink wrapper Box above/below, on purpose:
          sticky positioning is bounded by its containing block, and that
          block is whichever ancestor box actually renders it - a wrapper
          added only for flex-shrink bookkeeping still counts, and one sized
          to just the header chrome would cap LiveDraftBanner's "stuck" travel
          at that short height, releasing it almost as soon as the page
          scrolls at all. It needs a containing block that spans the whole
          scrollable page - this Container itself - so it stays pinned while
          mobile's single page-scroll region scrolls underneath it. On
          desktop nothing above it ever scrolls (issue 122's non-scrolling
          shell), so the banner just sits in place - visible on every tab,
          satisfying acceptance criterion 5 for mobile and trivially for
          desktop. */}
      <LiveDraftBanner league={league} onTheClock={onTheClock} secondsLeft={secondsLeft} isMyTurn={isMyTurn} />

      <Box sx={{ flexShrink: { md: 0 } }}>
        <Tabs
          // Desktop only ever shows two tabs (Draft = the dual-pane
          // workspace, Board); a 'players'-tagged URL/state still resolves
          // to the same Draft tab there since desktop never mounts 'players'
          // on its own. Mobile's three tabs use `view` directly - it only
          // ever holds one of their three values.
          value={isMobile ? view : (view === 'board' ? 'board' : 'draft')}
          onChange={(e, next) => setView(next)}
          aria-label="Draft view"
          sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          {tabDefs.map((tab) => (
            <Tab key={tab.value} label={tab.label} value={tab.value} sx={MIN_TOUCH_TARGET_SX} />
          ))}
        </Tabs>
      </Box>

      {view === 'board' ? (
        <Box sx={{ flex: { md: '1 1 auto' }, minHeight: { md: 0 }, overflow: { md: 'auto' } }}>
          <DraftBoardMatrix
            teams={teams}
            picks={picks}
            onTheClock={onTheClock}
            draftRounds={draftRounds(league)}
            onOpenQuickView={setQuickViewId}
          />
        </Box>
      ) : isMobile ? (
        view === 'players' ? (
          <PlayerPoolTable {...playerPoolProps} isMobile />
        ) : (
          <DraftRail {...draftRailProps} />
        )
      ) : (
        // Desktop dual-scroll workspace (issue #122 acceptance criterion 1):
        // players and the Draft rail each get their own bounded, scrollable
        // region instead of the whole page scrolling underneath them.
        <Box sx={{ display: 'flex', flexDirection: 'row', gap: 3, flex: '1 1 auto', minHeight: 0 }}>
          <Box sx={{ flexBasis: '66.666%', minWidth: 0, height: '100%' }}>
            <PlayerPoolTable {...playerPoolProps} />
          </Box>
          <Box
            component="section"
            aria-label="Draft rail"
            tabIndex={0}
            sx={{ flexBasis: '33.333%', minWidth: 0, height: '100%', overflowY: 'auto' }}
          >
            <DraftRail {...draftRailProps} queueStickyTop={8} queueMaxHeight="45vh" />
          </Box>
        </Box>
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

      <DraftPickConfirmDialog
        open={pendingPick != null}
        playerName={pendingPick?.name}
        onConfirm={confirmDraftPlayer}
        onCancel={cancelDraftPlayer}
      />
    </Container>
  );
}

export default DraftBoard;
