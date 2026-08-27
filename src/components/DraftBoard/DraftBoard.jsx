import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Container, Typography, Alert, Box, Skeleton, useMediaQuery, Tabs, Tab,
  ToggleButton, ToggleButtonGroup, IconButton, Tooltip,
} from '@mui/material';
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
import ReadinessAnnouncer from './ReadinessAnnouncer';
import PickAnnouncer from './PickAnnouncer';
import DraftBoardMatrix from './DraftBoardMatrix';
import PickHistory from './PickHistory';
import DraftDayControls from './DraftDayControls';
import DraftPickConfirmDialog from './DraftPickConfirmDialog';
import DraftRoomChat from './DraftRoomChat';
import useContainerWidth, { draftPaneLayout } from './useContainerWidth';
import { pickActionExists, pickTemporarilyUnavailable, PICK_UNAVAILABLE_EXPLANATION } from './pickAvailability';
import { upcomingTeamsFor } from './upcomingTeams';
import { viewerPicksFor } from './viewerPicks';
import { assignRosterSlots } from '../../lib/rosterAssignment';
import {
  turnSummaryFor, pickLabelFor, teamsInDraftOrder, draftOrderIsSettled,
} from '../../lib/draftTurns';
import { draftRounds } from '../../lib/rosterShape';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';
import { teamNameLabel } from '../../lib/teamIdentity';
import { readDraftSoundOn, writeDraftSoundOn } from './draftSoundPreference';

// The Draft page's one landmark structure: a single <main>, named by the
// league-name H1 inside it, that the App-level skip link (see App.jsx)
// targets directly. Shared by both the loading skeleton and the loaded view
// so the skip link's destination exists throughout the page's lifecycle.
const DRAFT_MAIN_ID = 'draft-main-content';
const DRAFT_H1_ID = 'draft-league-name';

// The Draft room's four views, in the order the narrow tab bar shows them (Chat
// first, the centerpiece the room opens on). One list, so the valid-view guard,
// the default and the tab bar all read the same set and cannot drift.
const DRAFT_VIEWS = ['chat', 'players', 'board', 'draft'];

// The tab and its panel reference each other by id (#445 AC1): the selected Tab
// carries aria-controls pointing at the panel, and the panel is aria-labelledby
// the Tab, so a screen reader names the region by the tab a manager chose.
const draftTabId = (view) => `draft-tab-${view}`;
const draftTabPanelId = (view) => `draft-tabpanel-${view}`;

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

  // Base Draft order, and the question of whether it is settled, both come
  // from src/lib/draftTurns.js, which owns everything else about order and
  // carries the sync obligation against the server's own ordering. Keeping a
  // hand-copy here is what let this and the Upcoming strip start to disagree.
  const ordered = teamsInDraftOrder(teams);
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
  const orderKnown = draftOrderIsSettled({ league, orderedTeams: ordered, rounds });

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
  // No `useSelector((store) => store.user)` here any more, and that absence is
  // the point (#178, ahead of #115): with the commissioner flag arriving on
  // the join acknowledgement, the Draft room reads the signed-in account for
  // nothing at all. Every question it asks about a manager - which Team is
  // mine, whose turn is it, may I use this control - is answered by the
  // server, by Team ID or by a per-viewer flag.
  const notify = useSnackbar();
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  // The wide-vs-narrow arrangement is chosen from the Draft room's own
  // available CONTAINER width, not a window media query (#444 acceptance
  // criterion 3): wide shows three side-by-side panes (Players/Board, Chat,
  // rail), narrow collapses them to tabs. This supersedes the #122/#123
  // `useMediaQuery(down('md'))` split. Unknown/zero width (a first paint, or a
  // layout-free unit-test environment) reads as `panes` - the three-pane
  // arrangement is the default until a real measurement proves the container
  // narrow, so nothing flashes and desktop-shaped tests need no width mock.
  const [layoutRef, containerWidth] = useContainerWidth();
  const isNarrow = draftPaneLayout(containerWidth) === 'tabs';

  const [error, setError] = useState(null);
  // Draft/Board view tab, mirrored into the URL (view=board) alongside the
  // pool-state params usePlayerPool owns. Built off the previous params so
  // switching tabs doesn't clobber filters, and vice versa (see usePlayerPool).
  const [searchParams, setSearchParams] = useSearchParams();
  // Four logical views: 'chat' (the default centerpiece), 'players', 'board'
  // and 'draft' (the rail). On a wide container Chat is always the centre pane
  // and the rail is always the right pane, so `view` there only chooses the
  // LEFT pane (Players unless it is 'board'); on a narrow container `view` is
  // the selected tab among Chat/Players/Board/Draft, with Chat the default the
  // room opens on (#444 acceptance criteria 1-2). 'chat' is the default so the
  // conversation is the centerpiece a manager lands on.
  const [view, setView] = useState(() => {
    const requested = searchParams.get('view');
    return DRAFT_VIEWS.includes(requested) ? requested : 'chat';
  });
  // Whether the manager has chosen a view themselves - an explicit ?view= in
  // the URL when the page opened, or a tab click since. Only while they have
  // not does the completed-draft default below get to move them.
  const viewChosenRef = useRef(searchParams.get('view') != null);
  useEffect(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (view === 'chat') next.delete('view');
      else next.set('view', view);
      return next;
    }, { replace: true });
  }, [view, setSearchParams]);

  // The optional on-the-clock chime (#445 AC5/AC6), default muted, remembered
  // per device. Read via a ref inside the alert-driven effect below so toggling
  // sound mid-turn can't itself retrigger a beep. Storage is guarded in
  // draftSoundPreference so a private-mode throw degrades to muted rather than
  // breaking the room.
  const [soundOn, setSoundOn] = useState(readDraftSoundOn);
  const soundOnRef = useRef(soundOn);
  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);
  const toggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev;
      writeDraftSoundOn(next);
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
  // identity while still seeing this render's `teams`/`viewerTeamId` - a ref
  // holds the actual logic, refreshed every render below, while the function
  // passed into the hook itself never changes.
  const pickLandedRef = useRef(() => {});
  // The newest live committed Pick, for the room-level Pick announcer (#513).
  // Set from the live-only onPickLanded seam below, never from draft:state, so
  // initial Pick history and reconnect snapshots are not spoken as new Picks.
  // Each landed Pick is a fresh payload object, so its identity changes and the
  // announcer's effect fires exactly once per Pick.
  const [lastPick, setLastPick] = useState(null);
  const {
    // The room's one authenticated session, so league chat can ride it here
    // rather than opening a second connection (#433). draft:join has already
    // put it in the `league:${id}` room chat broadcasts to.
    socket,
    league,
    teams,
    picks,
    onTheClock,
    viewerTeamId,
    // Whether this viewer may act as commissioner HERE, decided by the server
    // and answered on the per-viewer join acknowledgement (#178; the hook's
    // header has the rest of the why). Read it ALONE: the old
    // `league.owner_id === user.id` fallback beside it is deliberately gone,
    // because #115 took `owner_id` off this snapshot (#344) and a fallback
    // comparing against an absent field just goes quiet - every viewer, the
    // owner included, would lose the controls with nothing failing to say so.
    isCommissioner,
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
      // Announce every live committed Pick at ROOM level (#513): the payload is
      // a fresh object per Pick, so handing it to state advances the announcer
      // by one Pick and no more. This fires for every team's Pick, the viewer's
      // own included - a committed Pick is worth confirming.
      setLastPick(data);
      // Only refetch the caller's own roster when THIS pick actually landed
      // on it - every other team's pick in the draft leaves it unchanged, and
      // a full snake draft can be 150+ picks. Both sides are Team IDs, so the
      // comparison no longer has to route through a team lookup by account.
      if (viewerTeamId != null && data?.teamId === viewerTeamId) myRoster.refetchRoster();
    };
  });
  // A completed draft OPENS on the Board (issue #123 acceptance criterion 4):
  // it is a record rather than a workspace, and the record is the Board plus
  // the chronological Pick history inside it. draft_status is unknown until
  // the first draft:state frame lands, which is why this is an effect rather
  // than part of `view`'s initial state.
  //
  // This is the ONE intentional exception to #444's "the room opens on Chat"
  // default, and it is narrow-tab and wide-pane alike: a finished draft's point
  // is its record, so a narrow room lands on the Board tab and a wide room
  // shows the Board in the left pane. Chat is still one tab / one toggle away.
  // A live (pending/active) draft is unaffected and opens on Chat as usual.
  //
  // ONLY on the first frame, which is the whole of the rule. Keying this on
  // draft_status alone made it fire mid-session too, because useDraftSocket
  // flips the status to complete in place when the draftComplete frame
  // arrives - so a manager watching the board fill would have had the
  // workspace swapped out from under them at the final pick, the moment they
  // were most engaged with it. viewChosenRef does not save them either: it is
  // seeded from the `view` query parameter, and the URL effect above DELETES
  // that parameter for the default tab, so anyone who opened a bare URL and
  // never clicked a tab carries a false ref all session. A view someone has
  // been reading for an hour was never "picked", and relocating them is the
  // failure this guard was supposed to prevent rather than an edge of it.
  const firstStatusSeenRef = useRef(false);
  useEffect(() => {
    const status = league?.draft_status;
    if (!status || firstStatusSeenRef.current) return;
    firstStatusSeenRef.current = true;
    if (viewChosenRef.current) return;
    if (status !== 'complete') return;
    setView('board');
  }, [league?.draft_status]);

  const {
    queue,
    loading: queueLoading,
    writeError: queueWriteError,
    handleQueuePlayer,
    handleMoveUp,
    handleMoveDown,
    handleRemoveFromQueue,
  } = useDraftQueue(leagueId, { onError: setError });
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

  // #322 same-pass check: this component renders two Container
  // component="main" elements (here, and again below the loading branch),
  // but they are exclusive branches of the same `if (loading) return ...`
  // conditional - never both mounted at once - so they are not the
  // duplicate-landmark defect #322 fixed on Nav's two `nav` landmarks.
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

  const rosterView = rosterViewFor({ league, teams, picks, viewerTeamId });
  // Draft rounds (ADR 0005): derived while pending, the frozen snapshot once
  // the draft is active or complete. One call, shared by everything below
  // that needs to know how long this draft is.
  const rounds = draftRounds(league);
  const isComplete = league?.draft_status === 'complete';

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
    queueError: queueWriteError,
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
    isXs,
    onOpenQuickView: setQuickViewId,
    rosterView,
    // The next three picks after the one on the clock, for the active rail's
    // compact Upcoming strip. Empty for a draft whose order is not settled.
    upcoming: upcomingTeamsFor({ league, teams, picks, rounds }),
    // The same order read viewer-relatively: which of the picks still to come
    // are this manager's own. Empty on the same conditions, plus for a
    // spectator holding no Team here.
    viewerPicks: viewerPicksFor({
      league, teams, picks, rounds, viewerTeamId,
    }),
  };

  // The combined League chat + Draft activity feed (#435/#437/#442), wired to
  // the room's own session (#433). It is the Draft room's centerpiece (#444):
  // its own centre pane on a wide container and its own Chat tab, selected
  // first, on a narrow one - no longer a panel tucked at the bottom of the
  // rail. Rendered only once the socket exists; before draft:join lands there
  // is nothing for it to ride.
  const chatFeed = socket ? (
    <DraftRoomChat
      socket={socket}
      leagueId={Number(leagueId)}
      viewerTeamId={viewerTeamId}
      canModerate={isCommissioner}
    />
  ) : null;

  // Board is the team-by-round matrix; Pick history is the chronological view
  // of the same committed Picks, collapsible inside it rather than a second
  // panel of its own (CONTEXT.md: Draft board; issue #123 acceptance
  // criterion 5). Both are handed the one `picks` array the socket maintains,
  // so the two views cannot disagree about what was drafted.
  const boardWithHistory = (
    <>
      <DraftBoardMatrix
        teams={teams}
        picks={picks}
        onTheClock={onTheClock}
        draftRounds={rounds}
        onOpenQuickView={setQuickViewId}
      />
      <PickHistory
        picks={picks}
        slotTags={rosterView ? rosterView.slotTags : null}
        onOpenQuickView={setQuickViewId}
        // A completed draft's record is what the page is for, so it opens
        // read rather than folded away.
        defaultExpanded={isComplete}
      />
    </>
  );

  // On a wide container the LEFT pane holds Players or Board; `view` chooses
  // which, and anything that is not the Board is Players (the working pool a
  // manager drafts from is the sensible default the room opens on). Chat and
  // the rail have panes of their own on a wide container, so a 'chat' or
  // 'draft' `view` inherited from a narrow session still leaves the Players
  // pool on the left here rather than an empty column.
  const leftPane = view === 'board' ? 'board' : 'players';

  // The one place a manager's own view choice is recorded, shared by the wide
  // left-pane toggle and the narrow tab bar so the two controls cannot drift.
  // Marking the choice is what stops the completed-draft default (above) from
  // relocating them afterwards.
  const chooseView = (next) => {
    viewChosenRef.current = true;
    setView(next);
  };

  // The four narrow tabs, in the Chat/Players/Board/Draft order acceptance
  // criterion 2 names, with Chat first so it is the tab the room opens on.
  // Built from DRAFT_VIEWS so their order and the valid-view guard cannot drift;
  // every view's label is just its capitalized name.
  const tabDefs = DRAFT_VIEWS.map((value) => ({
    value,
    label: value[0].toUpperCase() + value.slice(1),
  }));

  // The three side-by-side panes of a wide container (#444 acceptance
  // criterion 1): Players/Board on the left, the largest Chat/activity feed in
  // the centre, and the status-dependent rail on the right. Each is its own
  // named, focusable, bounded scrolling region so the panes scroll
  // independently and the shell itself never scrolls (the On the clock banner
  // and chrome above them stay put). The left pane's name follows its current
  // content; the pool and the board matrix each carry their own inner region
  // (Available Players / Draft Board), so the left column is a plain scroll box
  // rather than a second landmark around them.
  const panesLayout = (
    <Box sx={{ display: 'flex', flexDirection: 'row', gap: 2, flex: '1 1 auto', minHeight: 0 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', flexBasis: '37%', minWidth: 0, height: '100%' }}>
        <Box sx={{ flexShrink: 0, mb: 1 }}>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={leftPane}
            onChange={(e, next) => {
              // null is a click on the already-selected button; keep the pane
              // rather than clearing it.
              if (!next) return;
              chooseView(next);
            }}
            aria-label="Left pane"
          >
            <ToggleButton value="players" sx={MIN_TOUCH_TARGET_SX}>Players</ToggleButton>
            <ToggleButton value="board" sx={MIN_TOUCH_TARGET_SX}>Board</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {leftPane === 'board' ? (
            <Box sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>{boardWithHistory}</Box>
          ) : (
            <PlayerPoolTable {...playerPoolProps} />
          )}
        </Box>
      </Box>
      <Box
        component="section"
        // "Chat", not "League chat", on purpose: this pane wraps the League
        // Chat region that ChatConversation names, and a name containing
        // "League chat" would collide with it under substring accessible-name
        // matching, leaving two regions a "League Chat" query cannot tell apart.
        aria-label="Chat and Draft activity"
        sx={{ flexBasis: '41%', minWidth: 0, height: '100%', overflowY: 'auto' }}
      >
        {chatFeed}
      </Box>
      <Box
        component="section"
        aria-label="Draft rail"
        tabIndex={0}
        sx={{ flexBasis: '22%', minWidth: 0, height: '100%', overflowY: 'auto' }}
      >
        <DraftRail {...draftRailProps} queueStickyTop={8} queueMaxHeight="45vh" />
      </Box>
    </Box>
  );

  // A narrow container shows one region at a time behind the tabs. Chat is a
  // tab of its own here (selected first), the pool switches to its card list,
  // and the rail is plain page-scrolling content rather than a bounded region.
  const narrowRegion = view === 'chat'
    ? chatFeed
    : view === 'players'
      ? <PlayerPoolTable {...playerPoolProps} isMobile />
      : view === 'board'
        ? boardWithHistory
        : <DraftRail {...draftRailProps} />;

  return (
    <Container
      component="main"
      id={DRAFT_MAIN_ID}
      ref={layoutRef}
      tabIndex={-1}
      aria-labelledby={DRAFT_H1_ID}
      maxWidth="xl"
      sx={{
        py: isNarrow ? 4 : 2,
        // Wide-container viewport-height shell (#444 acceptance criterion 1,
        // carried over from #122): the chrome keeps its natural size
        // (flexShrink: 0) and only the pane region grows to fill what's left,
        // so the three panes scroll independently and nothing here scrolls the
        // page. On a narrow container this is a plain block and the page
        // scrolls as the single-region acceptance criterion asks. The switch
        // is the measured container width, not a window breakpoint.
        ...(isNarrow ? {} : {
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
        }),
      }}
    >
      <Box sx={{ flexShrink: 0 }}>
        {/* The Draft room's one readiness announcement (issue #164). It lives
            here, in the chrome every tab renders, rather than in the rail:
            below the medium breakpoint only the active tab's region is
            mounted, so a live region inside the rail was destroyed and
            rebuilt on every tab switch and stopped being a region assistive
            technology was observing. Visually hidden - the rail still shows
            the same sentence to sighted managers, without a live region of
            its own. */}
        <ReadinessAnnouncer
          teams={teams}
          viewerTeamId={viewerTeamId}
          draftStatus={league?.draft_status}
        />
        {/* The Draft room's room-level Pick announcer (#513). It lives here, in
            the chrome every tab renders, so a committed Pick is announced on the
            Players, Board and Draft tabs too - not only while Chat is mounted -
            and once, since the Chat-scoped feed announcer no longer speaks Picks
            (feedAnnouncement.js). Fed by the live-only onPickLanded seam, so
            initial history and reconnect snapshots are never replayed. Visually
            hidden; the visible board already shows the Pick to sighted managers. */}
        <PickAnnouncer pick={lastPick} />
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
            onClockAlertOpen={onClockAlertOpen}
            onCloseOnClockAlert={dismissOnClockAlert}
          />
          {isCommissioner && league?.draft_status === 'active' && (
            <DraftDayControls
              league={league}
              picks={picks}
              onTogglePause={admin.handleTogglePause}
              onCorrect={admin.handleCorrectPick}
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

      {/* Tabs are a narrow-container affordance only: a wide container shows the
          three panes at once, so it needs no tab bar (and #444 forbids a
          permanent old-layout switch). The tabs drive `view` directly across
          all four values Chat/Players/Board/Draft. */}
      {isNarrow && (
        <Box sx={{ flexShrink: 0 }}>
          <Tabs
            value={view}
            onChange={(e, next) => chooseView(next)}
            aria-label="Draft view"
            sx={{ mb: 3, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            {tabDefs.map((tab) => (
              <Tab
                key={tab.value}
                label={tab.label}
                value={tab.value}
                id={draftTabId(tab.value)}
                // Only the selected tab's panel is rendered (one region at a time
                // on a narrow container, #444), so only the selected tab may point
                // aria-controls at a panel that exists; the others would dangle.
                aria-controls={tab.value === view ? draftTabPanelId(tab.value) : undefined}
                sx={MIN_TOUCH_TARGET_SX}
              />
            ))}
          </Tabs>
        </Box>
      )}

      {/* On a narrow container the single visible region is the selected tab's
          panel (#445 AC1): role="tabpanel", named by its Tab (aria-labelledby)
          and pointed at by that Tab's aria-controls, and focusable (tabIndex 0)
          so the standard tabs keyboard flow reaches it - selecting a tab keeps
          focus on the tab, and one Tab press moves into the panel. On a wide
          container there are no tabs; the three panes are each their own named
          region (panesLayout) and no tabpanel wraps them. */}
      {isNarrow ? (
        <Box
          role="tabpanel"
          id={draftTabPanelId(view)}
          aria-labelledby={draftTabId(view)}
          tabIndex={0}
          sx={{ minWidth: 0 }}
        >
          {narrowRegion}
        </Box>
      ) : panesLayout}

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
