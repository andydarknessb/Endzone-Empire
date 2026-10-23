import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box, GlobalStyles, useMediaQuery, useTheme } from '@mui/material';
import { PsButton, Skel, psRootSx } from '../../shared/ui/playselect';
import { useLeague } from '../../hooks/useLeague';
import { useLiveGameStates, useLiveScores, useWeekMatchups, viewerMatchupOf, matchupBoard } from '../../entities/matchup';
import {
  deriveLeaguePhase, LEAGUE_PHASE, computeByeClusters, worstByeCluster, formatInstant, useNow,
} from '../../shared/lib';
import LineupLedger, { gameStatusKind } from '../../widgets/lineup-ledger';
import TeamSummaryStrip from '../../widgets/team-summary-strip';
import MatchupPreview from '../../widgets/matchup-preview';
import StartSitPanel from '../../widgets/start-sit-panel';
import ByeClusterGrid from '../../widgets/bye-cluster';
import { useLineupWrite, useSwapPlayers, isEligibleMove, QuickPickMenu } from '../../features/lineup-write';
import {
  useLedgerSections, useAdvice, adviceGain, ledgerTabCounts, lineupNote, nextKickoff, nextLineupSlot, parseRosterTemplate,
} from '../../entities/roster';
import { useDropPlayer, DropConfirmationDialog } from '../../features/drop-player';
import { LineupNote } from '../../features/bench-what-if';
import PlayerDecisionCard, { myTeam } from '../../widgets/player-decision-card';
import { useLineupLeagues } from './model/useLineupLeagues';
import { useLineupData } from './model/useLineupData';
import { useCalledShot } from './model/useCalledShot';
import { readRequestedSwap, resolveRequestedSwap } from './model/requestedSwap';
import {
  BestBallNotice, ErrorRow, LineupHead, MessageCard, SectionToggles, SwapOffer,
} from './ui/LineupParts';

const MIN_WEEK = 1;
const MAX_WEEK = 18;
const WEEKS = Array.from({ length: MAX_WEEK }, (_, i) => i + 1);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * The Lineup page slice (ADR 0037, #1237; Play-select since ADR 0067 wave 3, spec #2347): replaces the legacy
 * `src/components/LineupScreen` (`LineupScreen`/`TeamLineup`), still mounted
 * at `/team` (App.jsx; the route itself does not change). Composes the
 * lineup-ledger and team-summary-strip widgets, the swap-players and
 * drop-player features, the existing pick-week feature and the existing
 * matchup-preview widget in the rail; every widget reads only `entities` and
 * `shared` (ADR 0020/0029). The page itself owns the one thing two slices
 * both need: the fetched lineup (`model/useLineupData.js`), handed down to
 * both the Ledger and the summary strip rather than each fetching it again.
 *
 * Ticket 6 (#1238) lands the advice tile and the phone Outlook view: the
 * start-sit-panel widget, composed here, whose Apply goes to the one `submit`.
 * Below `sm` one page-owned bottom bar (#1965), "Starters | Bench | Outlook",
 * picks `phoneView`: Starters and Bench show the Ledger's matching section,
 * Outlook shows the rail (start-sit-panel and matchup-preview, otherwise
 * hidden below `md`) in place of the whole roster column. The bar is the
 * page's, not the Ledger's, because it has to stay on screen over either
 * column (a sticky bar inside the roster column goes away with it on Outlook)
 * and the Outlook content is page-composed from widgets the Ledger itself
 * never imports (ADR 0020); the Ledger is controlled (`mobileTab` /
 * `onMobileTabChange`). The bar shares one bottom container with the move
 * strip (#1958), the strip stacked above it: `position: fixed` below `sm`
 * (a sticky bar cannot reach the viewport bottom past the app Footer),
 * sticky from `sm`, where the bar is gone, the strip floats alone and both
 * columns show side by side.
 *
 * Ticket 7 (#1239) stacks the bye-cluster widget's grid into the same
 * Outlook view, under start-sit-panel, computed off `lineup.entries` with no
 * new endpoint (`shared/lib`'s `computeByeClusters`/`worstByeCluster` -
 * promoted there, not kept below the island, since it is domain-meaningful
 * and this page and the bye-cluster widget both reach it, ADR 0031). The
 * page and the widget each call that shared pure function independently
 * (the widget already holds the raw entries and computes its own grid); the
 * page's OWN answer is handed only to the team-summary-strip's attention
 * chip, which has no other way to reach a bye-cluster widget's internals.
 * Hidden entirely on a past week (`isPastWeek` below): a settled week is a
 * record, not an outlook.
 *
 * Deliberately deferred, per the issue's own scope: the live Game cell's
 * full Situation treatment (ticket 9 - this ticket's Game cell shows clock
 * and score only).
 *
 * The player name and the empty-roster "Browse Players" action - both
 * legacy controls this page dropped in an earlier revision with no
 * acceptance criterion authorising either - are restored (formal review
 * finding legacy-controls-dropped-without-a-criterion): the name reopens
 * the Decision card this page now owns (#1240, replacing the earlier
 * `PlayerQuickView` wiring here - that dialog itself is untouched and still
 * serves every other surface), and `emptyRoster` below gates a dedicated
 * empty state distinct from the draft-in-progress one. Team Record/Rank
 * stays dropped: it is reachable elsewhere (the Dashboard's
 * my-team-summary), and restoring it here would be new surface this page's
 * own criteria do not ask for. The per-row Trade control stays dropped too -
 * Trade now lives on the Decision card (#1240 AC2/AC5), not as a second
 * per-row control this page would otherwise need to keep in sync with it.
 *
 * Play-select (ADR 0067 wave 3, spec #2347 ruling 4 and 8):
 *   - One Cursor: on the starting slot that needs the viewer (`nextLineupSlot`: the Out starter, or the
 *     empty slot, whose game locks first), Danger under one hour from the lock; while a move is under way
 *     it is the pressed row instead. Live, that row carries the shared lineup note.
 *   - One Filled Action: the Endzone Forecast's Apply, when a move plan exists. Nothing else on the page is
 *     filled outside a state card whose only action it is.
 *   - The page's game states are the live rows the Matchup entity reads, topped up from the lineup's own
 *     entries (kickoff, and the server's `locked` flag when the realtime channel is quiet), so the cursor
 *     and the note read the same whether or not a live row has landed.
 */
export default function LineupPage() {
  const {
    leagues, selectedLeagueId, setSelectedLeagueId, loading: leaguesLoading, error: leaguesError, refetch: refetchLeagues,
  } = useLineupLeagues();
  const {
    league, teams, viewerTeamId, error: leagueError, refetch: refetchLeague,
  } = useLeague(selectedLeagueId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [week, setWeek] = useState(null);
  // The Decision card (#1240, ADR 0037): which rostered player's card is
  // open, replacing the player quick view on Lineup only (the ruling on the
  // issue thread) - `components/PlayerQuickView` itself is untouched and
  // still serves every other surface.
  const [decisionCardEntryId, setDecisionCardEntryId] = useState(null);
  // #2263: the player the Start/sit card's Compare opens the Decision card
  // beside; null for a plain name click.
  const [decisionCardCompareId, setDecisionCardCompareId] = useState(null);
  const compareSuggestion = (view) => {
    setDecisionCardCompareId(view.sit.playerId);
    setDecisionCardEntryId(view.start.playerId);
  };
  // The phone view (AC5, #1238; #1965): which part of the page a narrow
  // viewport shows - the Ledger's Starters or Bench section, or the rail
  // (Outlook). Irrelevant at `sm` and up, where both columns already show
  // side by side.
  const [phoneView, setPhoneView] = useState('starters');
  // The phone bar's buttons, and which one the Ledger's #1425 auto-switch
  // wants focused once it lands (accessibility risk review finding, #1425) -
  // `null` when the current `phoneView` came from the manager's own bar click.
  const phoneBarButtonRefs = useRef({});
  const pendingBarFocusRef = useRef(null);
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });

  // The tri-state best-ball read (LineupScreen.jsx's own #217 ruling):
  // "loading"/"error" both commit to nothing until the league is genuinely
  // known, so a background revalidation of an already-known league can never
  // demote it back to unsettled.
  // The read's own error decides "error": `loading` is false for the commit before its effect starts the read, and
  // would flash the error row on every normal load.
  const leagueMode = league != null ? (league.best_ball ? 'bestBall' : 'standard') : (leagueError ? 'error' : 'loading');
  const bestBall = leagueMode === 'bestBall';
  const leagueUnsettled = leagueMode === 'loading' || leagueMode === 'error';

  const { lineup, raw, setRaw, loading: lineupLoading, error: lineupError, refetch } = useLineupData({
    leagueId: selectedLeagueId,
    week,
  });

  // The Game cell's placeholder live state (AC2, ADR 0037: clock and score
  // only, no Situation - ticket 9): one Realtime subscription for every
  // distinct NFL game the lineup's own entries name (`gameKey`, #1235),
  // through the Matchup entity's existing `useLiveGameStates` (the same
  // `live_game_states` channel Game Center and Matchup Detail already read)
  // rather than a second live-games mechanism.
  const gameKeys = Array.from(new Set((lineup?.entries || []).map((e) => e.gameKey).filter(Boolean)));
  const liveGames = useLiveGameStates(selectedLeagueId, gameKeys);
  const liveGamesByKey = new Map(liveGames.map((row) => [String(row.tank01_game_id), row]));

  // The finished-game refetch (#1546, ADR 0037 ticket 9): `displayEdgeKind`
  // (widgets/lineup-ledger/lib/edgeLine.js) flips the Edge line's icon from
  // the Realtime row alone, instantly, but the sentence beside
  // it is server text that only refreshes on `GET /api/team/lineup` - so a
  // game going final (or, in either direction, changing state at all) left
  // the old sentence under the new icon until the page next reloaded.
  // `gameStatusKind` (imported above, from the widget's public index per
  // ADR 0020 - #1557) is the same `pre`/`live`/`final` split `gameCell.js`'s
  // own `gameCellView` makes off `liveRow.game_status`; this page no longer
  // keeps its own copy of it. It deliberately leaves out that module's
  // `unavailable` branch, which is a per-ENTRY fact, not a per-GAME one -
  // `gameCellView` alone checks that, above its own call to this function.
  // `seenGameKindsRef` remembers the last kind observed for
  // each `gameKey`; a kind differing from an already-seen one (never the
  // first observation - the initial fetch that seeds it is already fresh)
  // triggers exactly one silent refetch (`{ silent: true }`,
  // `useLineupData.js`), the same silent shape the socket reconnect resync
  // uses (`useLiveScores.js`), so the Ledger never flashes its skeleton for
  // a refresh the manager did not ask for.
  const seenGameKindsRef = useRef(new Map());
  useEffect(() => {
    seenGameKindsRef.current = new Map();
  }, [selectedLeagueId, week]);
  useEffect(() => {
    const seen = seenGameKindsRef.current;
    let changed = false;
    for (const row of liveGames) {
      const key = String(row.tank01_game_id);
      const kind = gameStatusKind(row);
      const prevKind = seen.get(key);
      if (prevKind !== undefined && prevKind !== kind) changed = true;
      seen.set(key, kind);
    }
    if (changed) refetch({ silent: true });
  }, [liveGames, refetch]);

  // Live points (AC2, #1241, ADR 0037 ticket 9): the same scores socket Game
  // Center and Matchup Detail already read, subscribed once here and handed
  // to both the Ledger (a per-player delta patched onto `raw`, below) and
  // the team-summary-strip's live totals (`scoreEvent`, applied by that
  // widget's own model).
  const { scoreEvent } = useLiveScores({ leagueId: selectedLeagueId, setRaw, refetch });

  // The Ledger's rows, built once by the Roster entity off this page's own
  // (optimistic) lineup and shared by the Ledger, the eligibility check and the
  // phone bar's counts (#2146).
  const sections = useLedgerSections(lineup);

  // AC4 (#1425 ruling): "no eligible target anywhere" is a whole-lineup
  // question - every Starter, Bench and IR row, filled or empty, not just
  // the occupied `entries` the swap rules read. Read off the entity's
  // `sections` so this reuses exactly the rows the widget renders and
  // highlights rather than a second copy of the slot-count math, and from
  // `isEligibleMove` (the same exported pure rule `onRowClick` and the
  // Decision card already share) rather than a new copy of the eligibility
  // rule itself.
  const hasEligibleTarget = (candidate) => {
    if (!sections) return false;
    const { starters, bench, ir } = sections;
    return [...starters, ...bench, ...ir].some((row) => {
      if (row.entry && row.entry.playerId === candidate.playerId) return false;
      return isEligibleMove({
        selectedEntry: candidate,
        targetEntry: row.entry,
        targetSlot: row.slotType,
        bestBall,
        leagueUnsettled,
      });
    });
  };

  // Start/sit advice (#1238, ADR 0037): one page-level read shared by the
  // start-sit-panel widget, the team-summary-strip widget's advice tile and
  // the Start/sit card's Apply below - the same "value two widgets both need
  // is passed down by the page" rule `useLineupData` already follows for the
  // lineup itself. Best ball never calls the endpoint at all.
  const advice = useAdvice({ leagueId: selectedLeagueId, week: lineup?.week, bestBall });
  // The Forecast tells the page which suggestions are still showing (a Dismiss hides one), so the Advice tile counts
  // and sums the same moves the plan line above Apply names.
  const [visibleSuggestions, setVisibleSuggestions] = useState(null);
  const stripAdvice = visibleSuggestions && visibleSuggestions.length !== advice.suggestions.length
    ? {
      ...advice,
      suggestions: visibleSuggestions,
      projectedTotal: 0,
      optimalTotal: adviceGain({ suggestions: visibleSuggestions, openSlotFills: advice.openSlotFills }) ?? 0,
    }
    : advice;
  // The one Lineup write (spec #2042): swap, the Start/sit card's Apply, the
  // Bench what-if and the Decision card all hand move plans to its `submit`.
  // It clears the week's cached Matchups list itself when a save lands (#1881), as drop-player does for a roster change.
  // A save that lands, or any queued write that replays, also re-reads the
  // advice (#2262): the plan and the suggestions were made against the lineup
  // the write changed.
  const { submit } = useLineupWrite({
    leagueId: selectedLeagueId,
    raw,
    setRaw,
    onLanded: advice.reload,
    onRejected: () => refetch({ silent: true }),
  });
  const swap = useSwapPlayers({
    submit,
    entries: lineup?.entries || [],
    bestBall,
    leagueUnsettled,
    hasEligibleTarget,
  });
  // A landed drop or undo re-reads the advice too (#2267), since a suggestion
  // may name the dropped player.
  const drop = useDropPlayer({ leagueId: selectedLeagueId, refresh: refetch, onLanded: advice.reload });

  const decisionCardEntry = (lineup?.entries || []).find((e) => e.playerId === decisionCardEntryId) || null;
  // Called shots (#1856): the actions re-read the advice when they land, since
  // the server pins or releases the shot's pair.
  const calledShot = useCalledShot({ leagueId: selectedLeagueId, week: lineup?.week, onChanged: advice.reload });

  // The two teams' Expected finals for the viewed week's Matchup (#1852), for
  // the start/sit card's underdog-or-favorite line: the entity's shared read of
  // the week's matchups (#1872; the summary strip and the matchup-preview
  // widget read the same list, deduped when the weeks coincide), the viewer's
  // row picked by Team id (#112). Best ball shows no card, so it reads nothing.
  // A list that has not loaded, has no row for the viewer, or carries no
  // Expected final (the board states none once the week is settled, played or
  // final; an in-progress starter's is actual plus the rest of its projection)
  // leaves `null` here, which is no line.
  const { matchups } = useWeekMatchups(selectedLeagueId, lineup?.week ?? null, { enabled: !bestBall });
  const viewerMatchup = viewerMatchupOf(matchups, viewerTeamId);
  // The board nulls a settled week's Expected final (#2048), so a played week
  // draws no line even though the server still prices one.
  const board = matchupBoard(viewerMatchup, viewerTeamId);
  const expectedFinals = viewerMatchup
    ? { mine: board.first.expectedFinal, theirs: board.second.expectedFinal }
    : null;

  // The Bench what-if swap (#910), read once and resolved against whichever
  // lineup actually loaded.
  const [requestedSwap, setRequestedSwapState] = useState(() => readRequestedSwap(searchParams));
  const swapOffer = resolveRequestedSwap(requestedSwap, lineup?.entries);
  const consumeRequestedSwap = () => {
    setRequestedSwapState(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('swapOut');
        next.delete('swapIn');
        return next;
      },
      { replace: true }
    );
  };
  const applyRequestedSwap = () => {
    if (!swapOffer) return;
    const { outEntry, inEntry } = swapOffer;
    consumeRequestedSwap();
    submit([
      { playerId: outEntry.playerId, slot: inEntry.slot },
      { playerId: inEntry.playerId, slot: outEntry.slot },
    ]);
  };

  // "All weeks" is not offered on a single-week Lineup (`allWeeks={false}` below), so a week is always a number.
  const changeWeek = (w) => {
    if (typeof w !== 'number') return;
    swap.cancelSelection();
    setWeek(Math.min(MAX_WEEK, Math.max(MIN_WEEK, w)));
  };

  const currentWeekValue = lineup ? week ?? lineup.week ?? MIN_WEEK : null;
  const viewerTeam = viewerTeamId != null && Array.isArray(teams) ? teams.find((t) => t.teamId === viewerTeamId) : null;
  const phase = deriveLeaguePhase(league);
  const draftInProgress = phase === LEAGUE_PHASE.PRE_DRAFT || phase === LEAGUE_PHASE.DRAFTING;
  const canDropEntry = () => Boolean(lineup && lineup.week != null && lineup.week === lineup.currentWeek);
  const emptyRoster = !lineupLoading && lineup != null && lineup.entries.length === 0;

  // The Bye cluster grid (#1239, AC5): "past weeks show no grid (the week as
  // played has no outlook)" - a week strictly before the league's current
  // week is a settled record, never an outlook. `worstCluster` is computed
  // here, not inside team-summary-strip, because that widget cannot reach
  // the bye-cluster widget's own internals (a widget may not import
  // another widget's - ADR 0020/0029); it calls the SAME shared pure
  // function (`shared/lib`'s `computeByeClusters`/`worstByeCluster`) the
  // bye-cluster widget itself independently calls on the raw entries this
  // page already passes it.
  const isPastWeek = Boolean(lineup && lineup.week != null && lineup.currentWeek != null && lineup.week < lineup.currentWeek);
  const byeClusters = !isPastWeek && lineup ? computeByeClusters({ entries: lineup.entries, fromWeek: lineup.week }) : [];
  const worstCluster = worstByeCluster(byeClusters);

  // The game states the cursor and the note read: one row per NFL game the lineup names. A live row (the
  // Realtime channel) says where the game stands; without one the game stands where the lineup entry says
  // (the server's own `locked` flag), and every row carries the entry's kickoff, which `live_game_states`
  // does not. The teams come from the entry, so a row matches either side of its game.
  const gameStates = useMemo(() => {
    const byKey = new Map();
    (lineup?.entries || []).forEach((e) => {
      if (!e.gameKey || byKey.has(String(e.gameKey))) return;
      const key = String(e.gameKey);
      const live = liveGamesByKey.get(key);
      byKey.set(key, {
        tank01_game_id: key,
        away_team: e.nflTeam,
        home_team: e.opponent,
        ...(live || { game_status: e.locked ? 'in_progress' : 'scheduled' }),
        kickoff_at: live?.kickoff_at ?? live?.start_time ?? e.kickoff ?? null,
      });
    });
    return Array.from(byKey.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineup, liveGames]);
  const started = gameStates.some((g) => g.game_status === 'in_progress' || g.game_status === 'final');
  const anyLive = gameStates.some((g) => g.game_status === 'in_progress');

  // The cursor: the starting slot that needs the viewer. None in best ball (the lineup sets itself), on a
  // settled week, or while the league is unsettled. The clock ticks to the next lock, and each minute under
  // an hour so the Danger frame and the note's "in {n} min" stay true.
  const lockAt = nextKickoff(gameStates);
  const now = useNow((at) => (lockAt != null && lockAt > at ? Math.min(lockAt, at + MINUTE_MS) : null), lockAt);
  const cursorLive = Boolean(sections && !bestBall && !isPastWeek && !leagueUnsettled && !draftInProgress);
  const starterRows = sections?.starters ?? [];
  const nextSlot = cursorLive
    ? nextLineupSlot(starterRows.map((row) => ({ slot: row.slotLabel, player: row.entry })), gameStates, now)
    : null;
  const nextSlotRow = nextSlot ? starterRows.find((row) => row.slotLabel === nextSlot.slot) : null;
  // A move under way holds the one cursor instead: the pressed row.
  const movingRow = swap.selectedEntry && sections
    ? [...sections.starters, ...sections.ir, ...sections.bench].find((row) => row.entry && row.entry.playerId === swap.selectedEntry.playerId)
    : null;
  const cursorRow = movingRow || nextSlotRow;
  const urgent = !movingRow && nextSlot?.lockAt != null && nextSlot.lockAt - now < HOUR_MS;
  const template = useMemo(() => parseRosterTemplate(league?.roster_slots), [league?.roster_slots]);
  // Live with an open slot the cursor row carries the shared lineup note (it says when no bench player can
  // fill the slot and points at free agents). Before kickoff the Forecast's plan line says it instead.
  const noteView = !movingRow && nextSlotRow && started
    ? lineupNote({
      slots: [{ slot: nextSlotRow.slotType, label: nextSlotRow.slotLabel, player: nextSlotRow.entry }],
      bench: (sections?.bench ?? []).map((row) => row.entry).filter(Boolean),
      template,
      gameStates,
      started: true,
      now,
    })
    : null;
  const openSlot = Boolean(nextSlot);

  // The phone bar's labels (#1957 L6, #1965): counts come from the Ledger's
  // own rule, off the same rows it renders. Before the lineup has loaded there
  // is nothing to count, so the labels go without counts rather than read
  // `Starters 0/0`.
  const tabCounts = sections ? ledgerTabCounts(sections) : null;
  const phoneTabs = [
    {
      key: 'starters',
      label: tabCounts ? `Starters ${tabCounts.startersFilled}/${tabCounts.startersTotal}` : 'Starters',
      name: tabCounts ? `Starters, ${tabCounts.startersFilled} of ${tabCounts.startersTotal} filled` : 'Starters',
    },
    {
      key: 'bench',
      label: tabCounts ? `Bench ${tabCounts.benchCount}` : 'Bench',
      name: tabCounts ? `Bench, ${tabCounts.benchCount} ${tabCounts.benchCount === 1 ? 'player' : 'players'}` : 'Bench',
    },
    { key: 'outlook', label: 'Outlook', name: 'Outlook' },
  ];
  // A move still pending when the manager leaves for Outlook would be
  // invisible (its rows are on the hidden roster column), so Outlook ends it.
  const pressPhoneTab = (key) => {
    if (key === 'outlook') swap.cancelSelection();
    setPhoneView(key);
  };
  // The Ledger's #1425 auto-switch lands here: record which bar button should
  // take focus (see the effect below), then switch.
  const onLedgerTabChange = (key) => {
    pendingBarFocusRef.current = key;
    setPhoneView(key);
  };
  // Risk review finding (accessibility, #1425): the row the manager just
  // activated sits inside the section that is about to become `display:none`,
  // and a hidden focused element is dropped to `<body>` per the HTML spec (not
  // a "mobile only" edge case either - WCAG 1.4.10 reflow puts a zoomed
  // desktop keyboard user below `sm` too). This moves focus to the bar button
  // the auto-switch just landed on, once that render has put it in the DOM:
  // it restores the focus the hidden section lost and is the manager's only
  // signal the section changed - a real screen-reader announcement ("Bench,
  // toggle button, pressed") - without adding a second live region (ADR 0037
  // keeps the Snackbar the page's only one). A manager who switches the view
  // by hand never hits this: their click already carries focus, so
  // `pendingBarFocusRef` stays unset and this effect is a no-op.
  useEffect(() => {
    if (pendingBarFocusRef.current !== phoneView) return;
    pendingBarFocusRef.current = null;
    phoneBarButtonRefs.current[phoneView]?.focus();
  }, [phoneView]);

  const zone = formatInstant(new Date(), 'zone') || 'your time zone';
  const leagueName = league?.name || leagues.find((l) => l.id === selectedLeagueId)?.name || null;
  const showBoard = leagues.length > 0 && !draftInProgress && !emptyRoster;

  // `width: 100%` on the root is load-bearing beside `mx: auto`: this page is
  // a flex item of the app shell's column flexbox (components/App/App.jsx),
  // and auto cross-axis margins switch a flex item from `stretch` to
  // fit-content sizing, so without an explicit width the root grows to its
  // content's min-content width - which the scrollable week strip sets to the
  // full 18-week run (a scroll container still contributes its whole content
  // width to intrinsic sizing). On a phone that made the entire page ~1100px
  // wide (measured on device, PR #1323). The column is a flex column, not a
  // grid, so a wide child never widens the page.
  return (
    <Box className="ps-root" sx={{ ...psRootSx, width: '100%', minHeight: '100%' }}>
      <Box
        data-testid="lineup-page"
        sx={{
          width: '100%',
          maxWidth: '1280px',
          mx: 'auto',
          boxSizing: 'border-box',
          padding: { xs: '10px 16px 48px', sm: '24px 32px 64px' },
          display: 'flex',
          flexDirection: 'column',
          gap: { xs: '12px', sm: '24px' },
        }}
      >
        {leaguesError && (
          <ErrorRow testId="leagues-error" onRetry={refetchLeagues}>
            We could not load your leagues. Check your connection and try again.
          </ErrorRow>
        )}
        {leagueMode === 'error' && (
          <ErrorRow testId="league-error" onRetry={refetchLeague}>
            We could not load this league. Check your connection and try again.
          </ErrorRow>
        )}
        {lineupError && (
          <ErrorRow testId="lineup-error" onRetry={() => refetch()}>
            We could not load your lineup. Check your connection and try again.
          </ErrorRow>
        )}

        {!leaguesLoading && leagues.length === 0 && (
          <MessageCard
            testId="lineup-no-leagues"
            text="You're not in a fantasy league yet. Create or join one to start building your team."
            actionLabel="Go to Leagues"
            to="/league"
          />
        )}

        {leagues.length > 0 && (
          <>
            {/* Head: the dim league line, the team avatar and name, and (when the manager holds more than one
                fantasy league) the league picker - the route carries no leagueId of its own - then the week
                picker. */}
            <LineupHead
              leagueName={leagueName}
              teamName={viewerTeam?.teamName}
              avatarUrl={viewerTeam?.avatar_url}
              avatarStaticUrl={viewerTeam?.avatar_static_url}
              bestBall={bestBall}
              live={anyLive}
              zone={zone}
              compact={compact}
              leagues={leagues}
              selectedLeagueId={selectedLeagueId}
              onSelectLeague={setSelectedLeagueId}
              weeks={WEEKS}
              week={showBoard ? currentWeekValue ?? MIN_WEEK : null}
              onWeek={changeWeek}
            />

            {draftInProgress && (
              <MessageCard
                testId="lineup-draft-in-progress"
                text="Your roster fills during the draft. Head to the Draft Room when it is time to pick."
                actionLabel="Draft Room"
                to={`/league/${selectedLeagueId}/draft`}
              />
            )}

            {/* Restored per formal review (finding legacy-controls-dropped-without-a-criterion):
                TeamLineup.jsx's own empty-roster action, "no players rostered yet, Browse Players", distinct
                from the draft-in-progress card above. Only once the lineup has actually loaded and named zero
                entries, so a background reload never flashes this over real rows. */}
            {!draftInProgress && emptyRoster && (
              <MessageCard
                testId="lineup-empty-roster"
                text="No players rostered yet. Head to the player pool to add players to your team."
                actionLabel="Browse Players"
                to="/player"
              />
            )}

            {showBoard && (
              <>
                {bestBall && <BestBallNotice />}

                {swapOffer && (
                  <SwapOffer
                    inName={swapOffer.inEntry.name}
                    outName={swapOffer.outEntry.name}
                    onSwap={applyRequestedSwap}
                    onDismiss={consumeRequestedSwap}
                  />
                )}

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 2fr) minmax(0, 1fr)' }, gap: { xs: '12px', sm: '24px' }, alignItems: 'start' }}>
                  <Box data-testid="lineup-roster-column" sx={{ display: { xs: phoneView === 'outlook' ? 'none' : 'grid', sm: 'grid' }, gap: { xs: '12px', sm: '24px' }, minWidth: 0 }}>
                    <TeamSummaryStrip
                      leagueId={selectedLeagueId}
                      week={league?.current_week ?? null}
                      viewerTeamId={viewerTeamId}
                      lineup={lineup}
                      advice={stripAdvice}
                      worstByeCluster={worstCluster}
                      scoreEvent={scoreEvent}
                      bestBall={bestBall}
                      openSlot={openSlot}
                    />

                    {(lineupLoading && !lineup) ? (
                      <Box sx={{ display: 'grid', gap: '16px' }} data-testid="lineup-skeleton">
                        <Skel width="100%" height={220} />
                        <Skel width="100%" height={220} />
                      </Box>
                    ) : (
                      <LineupLedger
                        lineup={lineup}
                        sections={sections}
                        liveGamesByKey={liveGamesByKey}
                        disabled={leagueUnsettled}
                        showEligibility={Boolean(swap.selectedEntry)}
                        isEligibleTarget={swap.isEligibleTarget}
                        isSwapHighlighted={(entry) =>
                          Boolean(swapOffer && (entry.playerId === swapOffer.outEntry.playerId || entry.playerId === swapOffer.inEntry.playerId))
                        }
                        selectedEntryId={swap.selectedEntry?.playerId ?? null}
                        onRowClick={swap.onRowClick}
                        canDropEntry={canDropEntry}
                        onRequestDrop={drop.requestDrop}
                        onOpenDecisionCard={setDecisionCardEntryId}
                        mobileTab={phoneView}
                        onMobileTabChange={onLedgerTabChange}
                        cursorKey={cursorRow?.key ?? null}
                        cursorTone={urgent ? 'urgent' : true}
                        cursorNote={noteView ? <LineupNote view={noteView} leagueId={selectedLeagueId} selfLink={false} /> : null}
                      />
                    )}
                  </Box>

                  <Box data-testid="lineup-outlook-column" sx={{ display: { xs: phoneView === 'outlook' ? 'grid' : 'none', sm: 'grid' }, gap: { xs: '16px', sm: '24px' }, minWidth: 0 }}>
                    <StartSitPanel
                      advice={advice}
                      entries={lineup?.entries}
                      bestBall={bestBall}
                      onApply={submit}
                      onCallShot={lineup?.week != null && lineup.week === lineup.currentWeek ? calledShot.callShot : undefined}
                      onWithdrawShot={calledShot.withdrawShot}
                      shotBusy={calledShot.busy}
                      onOpenDecisionCard={setDecisionCardEntryId}
                      onCompare={compareSuggestion}
                      expectedFinals={expectedFinals}
                      openSlot={openSlot}
                      onVisibleSuggestions={setVisibleSuggestions}
                    />
                    <ByeClusterGrid
                      entries={lineup?.entries}
                      fromWeek={lineup?.week}
                      isPastWeek={isPastWeek}
                      waiverPeriodHours={league?.waiver_period_hours}
                      leagueId={selectedLeagueId}
                    />
                    <MatchupPreview leagueId={selectedLeagueId} />
                  </Box>
                </Box>

                {/* The phone footer below is fixed and out of flow, so below `sm` this page-scoped style keeps
                    three things clear of it while the page is mounted: the app Footer's links (the footer's
                    72px - 6px double rule, 10px and 12px of padding, a 44px toggle row - added to the Footer's
                    own 20px bottom padding), the bottom-anchored Snackbar (lifted to the footer's height plus
                    an 8px gap, since a save toast with Undo lingers 20s), and focused rows
                    (`scroll-padding-bottom` of the measured 126px footer with a move strip, plus 16px, so a
                    Tab-focused row is not scrolled under either, WCAG 2.4.11). The selectors reach the
                    shell's `footer` tag and MUI's Snackbar class, the same global hooks Footer.css and
                    SnackbarProvider.jsx own. */}
                <GlobalStyles
                  styles={(t) => ({
                    [t.breakpoints.down('sm')]: {
                      html: { scrollPaddingBottom: 142 },
                      footer: { paddingBottom: 92 },
                      '.MuiSnackbar-root.MuiSnackbar-anchorOriginBottomCenter': { bottom: 80 },
                    },
                  })}
                />

                {/* One bottom-pinned container (#1958, #1965), the last child of the content so it holds over
                    either column: the move strip stacked directly above the phone toggles, so the two never
                    overlap and the strip stays on screen when the tapped row is low on the page. Below `sm`
                    both show; from `sm` the toggles are hidden and a strip floats alone 16px off the bottom
                    (sticky). With no strip it holds just the toggles and is hidden from `sm`. Below `sm` it is
                    `position: fixed`, not sticky: `sticky; bottom: 0` only ever pushes an element UP from
                    where it sits in flow, and in flow it sits above the Footer, so at the end of the scroll
                    (and on a short page, always) a sticky bar rests well short of the viewport bottom
                    (measured, #1965). Fixed holds the bottom edge for the whole scroll; being out of flow it
                    reserves no room, which `scroll-padding-bottom` and the Footer's padding above make up. */}
                <Box
                  data-testid="lineup-sticky-footer"
                  sx={{
                    display: swap.selectedEntry ? 'flex' : { xs: 'flex', sm: 'none' },
                    flexDirection: 'column',
                    gap: '10px',
                    position: { xs: 'fixed', sm: 'sticky' },
                    left: { xs: 0, sm: 'auto' },
                    right: { xs: 0, sm: 'auto' },
                    bottom: { xs: 0, sm: 16 },
                    zIndex: 5,
                    boxSizing: 'border-box',
                    px: { xs: '16px', sm: 0 },
                    pt: { xs: '10px', sm: 0 },
                    pb: { xs: '12px', sm: 0 },
                    backgroundColor: { xs: 'var(--ps-panel)', sm: 'transparent' },
                    borderTop: { xs: '6px double var(--ps-frame)', sm: 0 },
                  }}
                >
                  {swap.selectedEntry && (
                    <Box
                      data-testid="lineup-move-strip"
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        boxSizing: 'border-box',
                        p: { xs: 0, sm: '8px 8px 8px 16px' },
                        border: { xs: 0, sm: '2px solid var(--ps-ink)' },
                        backgroundColor: { xs: 'transparent', sm: 'var(--ps-panel)' },
                      }}
                    >
                      {/* Text only: the polite live region never holds Cancel. */}
                      <Box component="span" role="status" sx={{ fontSize: '14px', fontWeight: 600 }}>
                        {`Moving ${swap.selectedEntry.name}. Pick a highlighted player.`}
                      </Box>
                      <PsButton aria-keyshortcuts="Escape" onClick={swap.cancelSelection}>Cancel</PsButton>
                    </Box>
                  )}
                  {/* Plain toggle buttons with `aria-pressed`, NOT `role="tablist"`/`role="tab"`: the ARIA
                      tabs pattern is a behavioural contract (arrow-key roving tabindex, `aria-controls`
                      pointing at a real `role="tabpanel"`) this bar does not implement, and reviewed as a
                      violation for exactly that reason - a screen reader trains a user to press Left/Right on
                      a "tab" and nothing would happen. `aria-pressed` makes the same true claim ("this
                      control is a toggle, and here is its state") without promising keyboard behaviour that
                      isn't there. */}
                  <SectionToggles tabs={phoneTabs} pressed={phoneView} onPress={pressPhoneTab} buttonRefs={phoneBarButtonRefs} />
                </Box>
              </>
            )}
          </>
        )}
      </Box>

      <QuickPickMenu
        quickPick={swap.quickPick}
        eligible={swap.quickPickEligible}
        onClose={swap.closeQuickPick}
        onSelect={swap.handleQuickPickSelect}
      />
      <DropConfirmationDialog
        entry={drop.dropCandidate}
        onClose={drop.closeDropConfirmation}
        onConfirm={drop.confirmDrop}
      />
      {/* #1515 (T19): the managed set (entries/onSwap/onRequestDrop/
          canDropEntry/bestBall/leagueUnsettled) rides inside the built
          context now - no loose prop stays beside it. */}
      <PlayerDecisionCard
        open={decisionCardEntryId != null}
        onClose={() => {
          setDecisionCardEntryId(null);
          setDecisionCardCompareId(null);
        }}
        entry={decisionCardEntry}
        leagueId={selectedLeagueId}
        week={lineup?.week}
        context={myTeam({
          managed: true,
          onSwap: submit,
          onRequestDrop: drop.requestDrop,
          canDropEntry,
          entries: lineup?.entries || [],
          bestBall,
          leagueUnsettled,
          compareWith: decisionCardCompareId,
        })}
      />
    </Box>
  );
}
