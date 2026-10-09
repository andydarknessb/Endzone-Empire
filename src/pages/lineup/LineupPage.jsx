import React, { useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Box, Button, FormControl, GlobalStyles, InputLabel, MenuItem, Select, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Badge, Card, Skeleton, TeamAvatar } from '../../shared/ui';
import { useLeague } from '../../hooks/useLeague';
import { useLiveGameStates, useWeekMatchups, viewerMatchupOf, matchupBoard } from '../../entities/matchup';
import { deriveLeaguePhase, LEAGUE_PHASE, computeByeClusters, worstByeCluster, MIN_TOUCH_TARGET_SX } from '../../shared/lib';
import PickWeek from '../../features/pick-week';
import LineupLedger, { gameStatusKind } from '../../widgets/lineup-ledger';
import TeamSummaryStrip from '../../widgets/team-summary-strip';
import MatchupPreview from '../../widgets/matchup-preview';
import StartSitPanel from '../../widgets/start-sit-panel';
import ByeClusterGrid from '../../widgets/bye-cluster';
import { useLineupWrite, useSwapPlayers, isEligibleMove, QuickPickMenu } from '../../features/lineup-write';
import { useLedgerSections, ledgerTabCounts } from '../../entities/roster';
import { useDropPlayer, DropConfirmationDialog } from '../../features/drop-player';
import PlayerDecisionCard, { myTeam } from '../../widgets/player-decision-card';
import { useLineupLeagues } from './model/useLineupLeagues';
import { useLineupData } from './model/useLineupData';
import { useLiveScores } from './model/useLiveScores';
import { useAdvice } from './model/useAdvice';
import { useCalledShot } from './model/useCalledShot';
import { readRequestedSwap, resolveRequestedSwap } from './model/requestedSwap';

const MIN_WEEK = 1;
const MAX_WEEK = 18;
const WEEKS = Array.from({ length: MAX_WEEK }, (_, i) => i + 1);

/**
 * The Lineup page slice (ADR 0037, #1237): replaces the legacy
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
 */
export default function LineupPage() {
  const { leagues, selectedLeagueId, setSelectedLeagueId, loading: leaguesLoading, error: leaguesError } =
    useLineupLeagues();
  const { league, teams, viewerTeamId, loading: leagueLoading, error: leagueError } = useLeague(selectedLeagueId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [week, setWeek] = useState(null);
  // The Decision card (#1240, ADR 0037): which rostered player's card is
  // open, replacing the player quick view on Lineup only (the ruling on the
  // issue thread) - `components/PlayerQuickView` itself is untouched and
  // still serves every other surface.
  const [decisionCardEntryId, setDecisionCardEntryId] = useState(null);
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
  const leagueMode = league != null ? (league.best_ball ? 'bestBall' : 'standard') : (leagueLoading ? 'loading' : 'error');
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
  // (widgets/lineup-ledger/lib/edgeLine.js) flips the Edge line's icon and
  // colour from the Realtime row alone, instantly, but the sentence beside
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

  // The one Lineup write (spec #2042): swap, the Start/sit card's Apply, the
  // Bench what-if and the Decision card all hand move plans to its `submit`.
  // It clears the week's cached Matchups list itself when a save lands (#1881), as drop-player does for a roster change.
  const { submit } = useLineupWrite({ leagueId: selectedLeagueId, raw, setRaw });
  const swap = useSwapPlayers({
    submit,
    entries: lineup?.entries || [],
    bestBall,
    leagueUnsettled,
    hasEligibleTarget,
  });
  const drop = useDropPlayer({ leagueId: selectedLeagueId, refresh: refetch });

  // Start/sit advice (#1238, ADR 0037): one page-level read shared by the
  // start-sit-panel widget, the team-summary-strip widget's advice tile and
  // the Start/sit card's Apply below - the same "value two widgets both need
  // is passed down by the page" rule `useLineupData` already follows for the
  // lineup itself. Best ball never calls the endpoint at all.
  const advice = useAdvice({ leagueId: selectedLeagueId, week: lineup?.week, bestBall });
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
    ? board.viewerSide === 'home'
      ? { mine: board.home.expectedFinal, theirs: board.away.expectedFinal }
      : { mine: board.away.expectedFinal, theirs: board.home.expectedFinal }
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

  const changeWeek = (w) => {
    if (typeof w !== 'number') return; // "All weeks" does not apply to a single-week Lineup
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

  // `width: 100%` on the root is load-bearing beside `mx: auto`: this page is
  // a flex item of the app shell's column flexbox (components/App/App.jsx),
  // and auto cross-axis margins switch a flex item from `stretch` to
  // fit-content sizing, so without an explicit width the root grows to its
  // content's min-content width - which the scrollable week strip sets to the
  // full 18-week run (a scroll container still contributes its whole content
  // width to intrinsic sizing). On a phone that made the entire page ~1100px
  // wide (measured on device, PR #1323).
  return (
    <Box data-testid="lineup-page" sx={{ width: '100%', maxWidth: 1180, mx: 'auto', px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      {leaguesError && (
        <Typography role="alert" sx={{ mb: 2, color: 'var(--dash-danger)' }} data-testid="leagues-error">
          {leaguesError}
        </Typography>
      )}
      {leagueMode === 'error' && (
        <Typography role="alert" sx={{ mb: 2, color: 'var(--dash-danger)' }} data-testid="league-error">
          {leagueError}
        </Typography>
      )}
      {lineupError && (
        <Typography role="alert" sx={{ mb: 2, color: 'var(--dash-danger)' }} data-testid="lineup-error">
          {lineupError}
        </Typography>
      )}

      {!leaguesLoading && leagues.length === 0 && (
        <Card data-testid="lineup-no-leagues">
          <Box sx={{ p: 3, display: 'grid', gap: 1.5, justifyItems: 'start' }}>
            <Typography>You&apos;re not in a fantasy league yet. Create or join one to start building your team.</Typography>
            <Button component={RouterLink} to="/league" variant="contained">Go to Leagues</Button>
          </Box>
        </Card>
      )}

      {leagues.length > 0 && (
        <>
          {/* Team header: avatar, Team name, and (when the manager holds more
              than one fantasy league) the league picker - the route carries
              no leagueId of its own. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <TeamAvatar
              name={viewerTeam?.teamName || 'My Team'}
              avatarUrl={viewerTeam?.avatar_url}
              avatarStaticUrl={viewerTeam?.avatar_static_url}
              size={compact ? 40 : 56}
              data-testid="lineup-team-avatar"
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h1" sx={{ m: 0, fontSize: compact ? '22px' : '26px', fontWeight: 700 }}>
                {viewerTeam?.teamName || 'Lineup'}
              </Typography>
              {bestBall && <Badge variant="neutral">Best ball</Badge>}
            </Box>
            {leagues.length > 1 && (
              <FormControl size="small" sx={{ ml: { sm: 'auto' }, minWidth: 200 }}>
                <InputLabel id="lineup-league-select-label">League</InputLabel>
                <Select
                  labelId="lineup-league-select-label"
                  label="League"
                  value={selectedLeagueId ?? ''}
                  onChange={(e) => setSelectedLeagueId(e.target.value)}
                >
                  {leagues.map((l) => (
                    <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>

          {draftInProgress && (
            <Card data-testid="lineup-draft-in-progress">
              <Box sx={{ p: 3, display: 'grid', gap: 1.5, justifyItems: 'start' }}>
                <Typography>Your roster fills during the draft. Head to the Draft Room when it is time to pick.</Typography>
                <Button component={RouterLink} to={`/league/${selectedLeagueId}/draft`} variant="contained">
                  Draft Room
                </Button>
              </Box>
            </Card>
          )}

          {/* Restored per formal review (finding
              legacy-controls-dropped-without-a-criterion): TeamLineup.jsx's
              own empty-roster action, "no players rostered yet, Browse
              Players", distinct from the draft-in-progress card above. Only
              once the lineup has actually loaded and named zero entries, so
              a background reload never flashes this over real rows. */}
          {!draftInProgress && emptyRoster && (
            <Card data-testid="lineup-empty-roster">
              <Box sx={{ p: 3, display: 'grid', gap: 1.5, justifyItems: 'start' }}>
                <Typography>No players rostered yet. Head to the player pool to add players to your team.</Typography>
                <Button component={RouterLink} to="/player" variant="contained">Browse Players</Button>
              </Box>
            </Card>
          )}

          {!draftInProgress && !emptyRoster && (
            <>
              {bestBall && (
                <Badge variant="live" sx={{ mb: 2 }} data-testid="best-ball-notice">
                  Best ball: your best legal lineup is set automatically each week.
                </Badge>
              )}

              {swapOffer && (
                <Box
                  data-testid="lineup-swap-offer"
                  role="group"
                  aria-label="Bench what-if swap"
                  sx={{ mb: 2, p: 1.5, border: '1px solid var(--dash-accent-line)', borderRadius: 'var(--dash-radius-sm)', display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Typography sx={{ flexGrow: 1, fontSize: '13px' }}>
                    {`Bench what-if · Start ${swapOffer.inEntry.name} over ${swapOffer.outEntry.name}`}
                  </Typography>
                  <Button size="small" variant="outlined" onClick={applyRequestedSwap}>Swap</Button>
                  <Button size="small" onClick={consumeRequestedSwap}>Dismiss</Button>
                </Box>
              )}

              <Box sx={{ mb: 2 }}>
                <PickWeek weeks={WEEKS} value={currentWeekValue ?? MIN_WEEK} onChange={changeWeek} fill={compact} />
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: '16px', alignItems: 'start' }}>
                <Box data-testid="lineup-roster-column" sx={{ display: { xs: phoneView === 'outlook' ? 'none' : 'grid', sm: 'grid' }, gap: '16px' }}>
                  <TeamSummaryStrip
                    leagueId={selectedLeagueId}
                    week={league?.current_week ?? null}
                    viewerTeamId={viewerTeamId}
                    lineup={lineup}
                    advice={advice}
                    worstByeCluster={worstCluster}
                    scoreEvent={scoreEvent}
                    bestBall={bestBall}
                  />

                  {(lineupLoading && !lineup) ? (
                    <Box sx={{ display: 'grid', gap: 1 }} data-testid="lineup-skeleton">
                      <Skeleton variant="rounded" height={220} />
                      <Skeleton variant="rounded" height={220} />
                    </Box>
                  ) : (
                    <LineupLedger
                      leagueId={selectedLeagueId}
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
                    />
                  )}
                </Box>

                <Box data-testid="lineup-outlook-column" sx={{ display: { xs: phoneView === 'outlook' ? 'grid' : 'none', sm: 'grid' }, gap: '16px' }}>
                  <StartSitPanel
                    advice={advice}
                    entries={lineup?.entries}
                    bestBall={bestBall}
                    onApply={submit}
                    onCallShot={lineup?.week != null && lineup.week === lineup.currentWeek ? calledShot.callShot : undefined}
                    onWithdrawShot={calledShot.withdrawShot}
                    shotBusy={calledShot.busy}
                    onOpenDecisionCard={setDecisionCardEntryId}
                    expectedFinals={expectedFinals}
                  />
                  <ByeClusterGrid
                    entries={lineup?.entries}
                    fromWeek={lineup?.week}
                    isPastWeek={isPastWeek}
                    waiverPeriodHours={league?.waiver_period_hours}
                  />
                  <MatchupPreview leagueId={selectedLeagueId} />
                </Box>
              </Box>

              {/* The phone bar below is fixed and out of flow, so below `sm`
                  this page-scoped style keeps three things clear of it while
                  the page is mounted: the app Footer's links (the bar's 54px -
                  44px button, 2px border, 8px top padding - added to the
                  Footer's own 20px bottom padding), the bottom-anchored
                  Snackbar (lifted to the bar's height plus an 8px gap, since a
                  save toast with Undo lingers 20s), and focused rows
                  (`scroll-padding-bottom` of the bar plus the strip, 132: a
                  70px strip and an 8px gap, so a Tab-focused row is not
                  scrolled under either, WCAG 2.4.11). The selectors reach the
                  shell's `footer` tag and MUI's Snackbar class, the same global
                  hooks Footer.css and SnackbarProvider.jsx own. */}
              <GlobalStyles
                styles={(t) => ({
                  [t.breakpoints.down('sm')]: {
                    html: { scrollPaddingBottom: 132 },
                    footer: { paddingBottom: 74 },
                    '.MuiSnackbar-root.MuiSnackbar-anchorOriginBottomCenter': { bottom: 62 },
                  },
                })}
              />

              {/* One bottom-pinned container (#1958, #1965), the last child of
                  the content so it holds over either column: the move strip
                  stacked directly above the phone bar, so the two never
                  overlap and the strip stays on screen when the tapped row is
                  low on the page. Below `sm` both show; from `sm` the bar is
                  hidden and a strip floats alone 16px off the bottom (sticky).
                  With no strip it holds just the bar and is hidden from `sm`.
                  Below `sm` it is `position: fixed`, not sticky: `sticky;
                  bottom: 0` only ever pushes an element UP from where it sits
                  in flow, and in flow it sits above the Footer, so at the end
                  of the scroll (and on a short page, always) a sticky bar rests
                  well short of the viewport bottom (measured, #1965). Fixed
                  holds the bottom edge for the whole scroll; being out of flow
                  it reserves no room. That is safe only because of the app
                  Footer: Footer.css gives it an 80px margin-top (plus the 20px
                  padding and the 74px above), so at the end of the scroll the
                  last row is always at least the bar plus a pending strip
                  (132) clear of the bottom. Shrink that margin and this needs
                  a spacer. */}
              <Box
                data-testid="lineup-sticky-footer"
                sx={{
                  display: swap.selectedEntry ? 'flex' : { xs: 'flex', sm: 'none' },
                  flexDirection: 'column',
                  gap: '8px',
                  position: { xs: 'fixed', sm: 'sticky' },
                  left: { xs: 0, sm: 'auto' },
                  right: { xs: 0, sm: 'auto' },
                  bottom: { xs: 0, sm: 16 },
                  zIndex: 1,
                  mt: { xs: 0, sm: '12px' },
                  px: { xs: 2, sm: 0 },
                  pt: { xs: '8px', sm: 0 },
                  backgroundColor: { xs: 'var(--bg-page)', sm: 'transparent' },
                }}
              >
                {swap.selectedEntry && (
                  <Box
                    data-testid="lineup-move-strip"
                    sx={{
                      p: 1.5,
                      backgroundColor: 'var(--dash-surface)',
                      boxShadow: 'var(--shadow-2)',
                      border: '1px solid var(--dash-accent-line)',
                      borderRadius: 'var(--dash-radius-sm)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <Typography sx={{ fontSize: '13px' }}>{`Moving ${swap.selectedEntry.name}. Pick a highlighted player.`}</Typography>
                    <Button size="small" sx={MIN_TOUCH_TARGET_SX} aria-keyshortcuts="Escape" onClick={swap.cancelSelection}>Cancel</Button>
                  </Box>
                )}
                {/* Plain toggle buttons with `aria-pressed`, NOT
                    `role="tablist"`/`role="tab"`: the ARIA tabs pattern is a
                    behavioural contract (arrow-key roving tabindex,
                    `aria-controls` pointing at a real `role="tabpanel"`) this
                    bar does not implement, and reviewed as a violation for
                    exactly that reason - a screen reader trains a user to
                    press Left/Right on a "tab" and nothing would happen.
                    `aria-pressed` makes the same true claim ("this control is
                    a toggle, and here is its state") without promising
                    keyboard behaviour that isn't there, matching PickWeek's
                    own "All weeks" toggle button
                    (src/features/pick-week/ui/PickWeek.jsx). */}
                <Box
                  role="group"
                  aria-label="Lineup section"
                  data-testid="lineup-mobile-tabs"
                  sx={{
                    display: { xs: 'flex', sm: 'none' },
                    border: '1px solid var(--dash-line)',
                    borderRadius: 'var(--dash-radius-sm)',
                    overflow: 'hidden',
                    backgroundColor: 'var(--dash-surface)',
                  }}
                >
                  {phoneTabs.map((tab, i) => (
                    <Box
                      key={tab.key}
                      component="button"
                      type="button"
                      ref={(el) => {
                        phoneBarButtonRefs.current[tab.key] = el;
                      }}
                      aria-label={tab.name}
                      aria-pressed={phoneView === tab.key}
                      onClick={() => pressPhoneTab(tab.key)}
                      sx={{
                        ...MIN_TOUCH_TARGET_SX,
                        flex: '1 1 0',
                        border: 'none',
                        borderRight: i < phoneTabs.length - 1 ? '1px solid var(--dash-line)' : 'none',
                        backgroundColor: phoneView === tab.key ? 'var(--dash-accent-soft)' : 'transparent',
                        color: phoneView === tab.key ? 'var(--dash-accent)' : 'var(--dash-dim)',
                        fontWeight: 600,
                        fontSize: '13px',
                        cursor: 'pointer',
                      }}
                    >
                      {tab.label}
                    </Box>
                  ))}
                </Box>
              </Box>
            </>
          )}
        </>
      )}

      <QuickPickMenu
        quickPick={swap.quickPick}
        eligible={swap.quickPickEligible}
        onClose={swap.closeQuickPick}
        onSelect={swap.handleQuickPickSelect}
      />
      <DropConfirmationDialog entry={drop.dropCandidate} onClose={drop.closeDropConfirmation} onConfirm={drop.confirmDrop} />
      {/* #1515 (T19): the managed set (entries/onSwap/onRequestDrop/
          canDropEntry/bestBall/leagueUnsettled) rides inside the built
          context now - no loose prop stays beside it. */}
      <PlayerDecisionCard
        open={decisionCardEntryId != null}
        onClose={() => setDecisionCardEntryId(null)}
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
        })}
      />
    </Box>
  );
}
