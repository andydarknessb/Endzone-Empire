import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Frame, LiveChip, NumbersHelp, PixelArrow, PixelWarn, PsButton, PsLink, Skel, StatusChip, pixelSx, psRootSx,
} from '../../shared/ui/playselect';
import { formatInstant, useNow } from '../../shared/lib';
import ScoreboardStrip from '../../widgets/scoreboard-strip';
import SlotComparison from '../../widgets/slot-comparison';
import NflGameStrip from '../../widgets/nfl-game-strip';
import RetroScoreboard from '../../widgets/retro-scoreboard';
import BenchWhatIf, { LineupNote } from '../../features/bench-what-if';
import ToggleMatchupView, { VIEW_SCOREBOARD, VIEW_STANDARD } from '../../features/toggle-matchup-view';
import CelebrateTouchdown, { CelebrationsCaption } from '../../features/celebrate-touchdown';
import PlayerDecisionCard, { myTeam, rostered } from '../../widgets/player-decision-card';
import { toDecisionCardEntry } from '../../entities/player';
import { useActionItems, lineupProblemFor } from '../../entities/action-item';
import {
  adviceGain, adviceNote, lineupIssues, lineupNote, lineupSlots, nextLockAt, parseRosterTemplate, useAdvice,
} from '../../entities/roster';
import { useMatchupPage } from './model/useMatchupPage';
import BenchCard from './ui/BenchCard';
import LastPlays from './ui/LastPlays';

/**
 * Matchup page slice (ADR 0031, #903; Play-select since ADR 0067 wave 2, spec #2334), on the
 * `/league/:leagueId/matchups/:matchupId` route. Restyled from the approved boards (Matchup,
 * MatchupPre, MatchupPhone in docs/design/league); the sections, their order and the data reads are
 * the product's, and only the behaviour the critique rounds approved changed.
 *
 *   - the head: the "<league name> · Game Center · Matchup" breadcrumb (the current page last,
 *     `aria-current`; below sm it drops the current page, the h1 says it), the pixel h1 "Week N
 *     Matchup" with the Playoff and status chips on its row (LiveChip while live, a Pixel 16 word chip
 *     otherwise), the dim "Times in {zone}" line and the closed "What the numbers mean" disclosure, and
 *     at the right the Standard / Scoreboard toggle (features/toggle-matchup-view) with the "Set
 *     lineup" link to the Lineup page (ADR 0019: the sole management surface), a ghost button, never
 *     filled. On a phone the toggle fills its row and Set lineup sits at the bottom of the page;
 *   - the Standard view: the scoreboard strip (widgets/scoreboard-strip: the Board-black versus screen
 *     once started, the framed panel before kickoff; the full panel stays in flow and a 56px compact
 *     bar pins when it scrolls out), the NFL game strip while the Matchup is live and games exist
 *     (widgets/nfl-game-strip), the note row (the lineup note while the viewer has an empty or Out
 *     starting slot they can still fix, else the Bench what-if while live; features/bench-what-if),
 *     the Starters frame (widgets/slot-comparison) and the collapsed Bench frame (./ui/BenchCard) with
 *     the bench-left line for a final Matchup. There is no Last plays in this view;
 *   - the Scoreboard view: the retro scoreboard (widgets/retro-scoreboard, amber LED on black), its
 *     ticker slot holding the last-plays ticker (./ui/LastPlays) full width under the field while
 *     live, its aside slot the same note row, its field's caption tail the celebrate-touchdown
 *     feature's read-only "Celebrations on / off" line, and its "Full comparison" action switching
 *     back to Standard and moving keyboard focus onto the toggle's checked Standard option: the
 *     action's own button unmounts with the view, so focus would otherwise drop to the body.
 *
 * Matchup is a watching page (RULINGS "QA round 1"): no cursor and no filled action. Both views
 * render the SAME `starterRows` the page model pairs (#1210), so they agree slot for slot under any
 * league slot order. The status chip is the server's status fact (ADR 0030) read through the entity's
 * one predicate; a status the server could not compute (null) shows no chip. A player's name opens
 * the Decision card (`widgets/player-decision-card`, ADR 0040) from either the Starters frame or the
 * Bench frame, in `'my_team'` context for the viewer's own player, `'rostered'` otherwise. The
 * touchdown cutscenes and toasts are the celebrate-touchdown feature's, fed from the score feed
 * through the page model.
 *
 * Every value two slices need is read once in the page model (./model/useMatchupPage) and passed
 * down. Widgets, features and the entities are imported through their index files only.
 *
 * Loading: the first load renders a skeleton region carrying `aria-busy` (the shapes stay
 * aria-hidden, the region announces); a background refetch (a reconnect) never blanks the page. A
 * failed read renders an alert with Retry (the entity's refetch) and a link back to Game Center
 * (#2009). Headings are explicit (ADR 0021): one h1, then the h2s the widgets and the page render.
 */
const MINUTE_MS = 60 * 1000;

const NUMBERS_TERMS = [
  ['Proj', "A lineup's points before its games are played, from Endzone Forecast, our projection engine."],
  ['Expected final', "Points so far plus the projected points still to come: a starter's projection times the share of his game left, or all of it before his game starts."],
  ['Players remaining', 'Starters whose NFL game isn\'t final. Out starters and empty slots don\'t count. Before kickoff it reads "starters set to play".'],
  ['Yet to play', "The players remaining whose NFL game hasn't started."],
  ['Win probability', "Your chance to win the matchup from both lineups' projected finals (Endzone Forecast). It sharpens as games finish."],
  ['Projected margin', 'How far one lineup is projected to finish ahead of the other: the gap between the two Proj totals before kickoff, between the two Expected finals once games are live.'],
];

export default function MatchupPage() {
  const { leagueId, matchupId } = useParams();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const {
    matchup, league, starterRows, scoreboardRows, loading, error, refetch, leagueName, viewerTeamId, records,
    statusChip, isLive, canSetLineup, isPlayoff, board, games, benches, benchLeft, showBenchLeft, calledShots,
    whatIf, viewerHasRoster, ticker, retroActivePlay, celebration, view, setView,
  } = useMatchupPage(leagueId, matchupId);
  const [expandedId, setExpandedId] = useState(null);
  const [decisionCardPlayerId, setDecisionCardPlayerId] = useState(null);
  const [benchOpen, setBenchOpen] = useState(false);
  // The view toggle's group element, and a one-shot request to focus its
  // checked option once the view has swapped (the Full comparison action).
  const toggleRef = useRef(null);
  const [focusToggle, setFocusToggle] = useState(false);
  // Retry's button unmounts as the read starts, so a good read moves focus to
  // the h1; a failed one leaves the re-mounted alert to announce itself.
  const titleRef = useRef(null);
  const [retried, setRetried] = useState(false);
  const retry = useCallback(async () => {
    await refetch({ silent: matchup != null });
    setRetried(true);
  }, [refetch, matchup]);
  useEffect(() => {
    if (!retried) return;
    setRetried(false);
    if (!error) titleRef.current?.focus();
  }, [retried, error]);

  // The compact scoreboard bar pins to the top once the versus panel scrolls out; the page reserves it
  // (56px + 16px) so a focused control is never under it.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollPaddingTop;
    root.style.scrollPaddingTop = '72px';
    return () => { root.style.scrollPaddingTop = previous; };
  }, []);

  // The lineup note's figures: the lock, the advice and the clock. Every hook sits above the loading
  // return; the advice is read only before kickoff, and only when there is a problem to name.
  const { first, second } = board;
  const actionItems = useActionItems();
  const slots = useMemo(() => lineupSlots(starterRows, first.isViewer), [starterRows, first.isViewer]);
  const issues = useMemo(() => lineupIssues(slots, games), [slots, games]);
  const started = board.hasStarted === true;
  const noteOpen = canSetLineup && viewerHasRoster && issues.length > 0;
  const advice = useAdvice({
    leagueId: noteOpen && !started ? leagueId : null,
    week: matchup?.week,
    bestBall: Boolean(league?.best_ball),
  });
  // The viewer's Next lock (CONTEXT.md): the week's Lineup problem deadline, else a kickoff among the
  // games the viewer's own players are in. A viewer with no Team in the Matchup is named no lock.
  const problem = useMemo(
    () => lineupProblemFor(actionItems.items, { leagueId, season: matchup?.season, week: matchup?.week }),
    [actionItems.items, leagueId, matchup?.season, matchup?.week]
  );
  const viewerPlayers = useMemo(
    () => (first.isViewer ? slots.map((s) => s.player).filter(Boolean).concat(benches.first || []) : []),
    [first.isViewer, slots, benches.first]
  );
  const lockAt = useMemo(
    () => nextLockAt(problem?.deadlineAt, viewerPlayers, games),
    [problem, viewerPlayers, games]
  );
  const template = useMemo(() => parseRosterTemplate(league?.roster_slots), [league?.roster_slots]);
  const now = useNow((at) => (lockAt != null && lockAt > at ? Math.min(lockAt, at + MINUTE_MS) : null), lockAt);

  const toggleRow = useCallback((id) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);
  const openPlayer = useCallback((id) => setDecisionCardPlayerId(id), []);
  // "Full comparison" swaps the view and asks for focus on the toggle: its own
  // button unmounts with the Scoreboard view, so focus would drop to the body.
  const showStandard = useCallback(() => {
    setView(VIEW_STANDARD);
    setFocusToggle(true);
  }, [setView]);
  useEffect(() => {
    if (!focusToggle) return;
    setFocusToggle(false);
    const checked = toggleRef.current?.querySelector('[role="radio"][aria-checked="true"]');
    if (checked) checked.focus();
  }, [focusToggle, view]);

  if (loading) {
    return (
      <Shell>
        <LoadingRegion />
      </Shell>
    );
  }

  // A missing name reads "Home"/"Away" by the side's own origin, wherever the board put it.
  const nameOf = (side) => side.name || (side.origin === 'home' ? 'Home' : 'Away');
  const firstName = nameOf(first);
  const secondName = nameOf(second);
  const lineupHref = `/league/${leagueId}/lineup`;

  // The Decision card's entry for whichever player a name link opened
  // (#1311, ADR 0040): SlotComparison and BenchCard hand back only the
  // clicked player's raw wire id, so the page looks the player up itself across the paired
  // starter rows and both benches - the SAME raw shape (id, name, position,
  // nfl_team, injury_status, ...) `useMatchup` hands both, unpaired only by
  // slot - and converts it through `entities/player`'s `toDecisionCardEntry`,
  // the one WaiverWire and TradeCenter already use for a non-lineup entry.
  // The built context is `myTeam({ managed: false })` only on the viewer's
  // own team's side, `rostered({ ... })` otherwise (#1513).
  const firstPlayers = starterRows.map((row) => row.first).concat(benches.first || []);
  const secondPlayers = starterRows.map((row) => row.second).concat(benches.second || []);
  const findIn = (list) => list.find((p) => p?.id === decisionCardPlayerId) || null;
  const decisionCardSide = decisionCardPlayerId == null
    ? null
    : findIn(firstPlayers) ? first : findIn(secondPlayers) ? second : null;
  const decisionCardPlayer = decisionCardSide ? findIn(decisionCardSide === first ? firstPlayers : secondPlayers) : null;
  const decisionCardEntry = toDecisionCardEntry(decisionCardPlayer);
  const decisionCardTeamId = decisionCardSide?.teamId ?? null;
  // #1513, ADR 0040 follow-up: the built context - the viewer's own player
  // read-only (no lineup wiring here, PlayerManagement's own-player case) or
  // rostered by the other side, named when the other side's team name is
  // known (the board side's name, the same the header already renders).
  const decisionCardOwnerName = decisionCardSide?.name ?? null;
  const decisionCardAvailability = decisionCardOwnerName ? { teamName: decisionCardOwnerName } : {};
  const decisionCardBuiltContext = viewerTeamId != null && decisionCardTeamId === viewerTeamId
    ? myTeam({ managed: false })
    : rostered({ availability: decisionCardAvailability });

  // The note row: the lineup note while there is something to fix, else the Bench what-if while live.
  const noteView = noteOpen
    ? lineupNote({
      slots,
      bench: benches.first,
      template,
      gameStates: games,
      started,
      lockAt,
      now,
      advice: advice.status === 'ready' || advice.suggestions.length > 0 ? adviceNote(advice) : null,
      gain: adviceGain(advice),
      proj: { you: first.expectedFinal, them: second.expectedFinal },
    })
    : null;
  let noteCard = null;
  if (noteView) noteCard = <LineupNote view={noteView} leagueId={leagueId} />;
  else if (isLive) noteCard = <BenchWhatIf whatIf={whatIf} hasRoster={viewerHasRoster} leagueId={leagueId} />;
  // The lock an empty row names, on the viewer's side only and only while the lineup note is showing.
  const fillBy = noteView && lockAt != null ? formatInstant(lockAt, 'weekdayTime') : undefined;

  return (
    <Shell>
      {error && (
        <Frame
          component="div"
          tone="danger"
          role="alert"
          sx={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 20px', padding: '16px 20px',
          }}
        >
          <Box sx={{ display: 'flex', gap: '12px', alignItems: 'flex-start', minWidth: 0 }}>
            <PixelWarn color="var(--ps-danger)" />
            <Box sx={{ fontSize: '15px' }}>We could not load this matchup right now.</Box>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <PsButton variant="ghost" onClick={retry}>Retry</PsButton>
            <PsButton variant="ghost" to={`/league/${leagueId}/game-center`}>Back to Game Center</PsButton>
          </Box>
        </Frame>
      )}

      {matchup && (
        <>
          <Head
            leagueId={leagueId}
            leagueName={leagueName}
            week={matchup.week}
            isPlayoff={isPlayoff}
            statusChip={statusChip}
            isLive={isLive}
            view={view}
            onViewChange={setView}
            toggleRef={toggleRef}
            titleRef={titleRef}
            lineupHref={lineupHref}
            compact={compact}
          />

          {view === VIEW_SCOREBOARD ? (
            <RetroScoreboard
              matchup={matchup}
              leagueName={leagueName}
              board={board}
              rows={scoreboardRows}
              games={games}
              activePlay={retroActivePlay}
              headingLevel={2}
              onFullComparison={showStandard}
              ticker={isLive ? <LastPlays items={ticker} mobile={compact} /> : null}
              aside={noteCard}
              fieldTail={<CelebrationsCaption enabled={celebration.celebrationsEnabled} />}
            />
          ) : (
            <>
              <ScoreboardStrip matchup={matchup} viewerTeamId={viewerTeamId} records={records} sticky />
              {isLive && games.length > 0 && <NflGameStrip games={games} />}
              {noteCard}
              <SlotComparison
                rows={starterRows}
                first={first}
                second={second}
                expectedFinal={{ first: matchup[first.origin].expectedFinal, second: matchup[second.origin].expectedFinal }}
                scoreLabels={{ first: first.scoreLabel, second: second.scoreLabel }}
                status={matchup.status}
                onOpenPlayer={openPlayer}
                expandedId={expandedId}
                onToggle={toggleRow}
                fillBy={fillBy}
              />
              <BenchCard
                firstName={firstName}
                secondName={secondName}
                firstBench={benches.first}
                secondBench={benches.second}
                open={benchOpen}
                onToggle={() => setBenchOpen((open) => !open)}
                onOpenPlayer={openPlayer}
                benchLeft={benchLeft}
                showBenchLeft={showBenchLeft}
                calledShots={calledShots}
              />
            </>
          )}

          {compact && <SetLineupLink href={lineupHref} placement="bottom" />}
        </>
      )}

      <CelebrateTouchdown celebration={celebration} />

      {/* #1515 (T19): `availability` rides inside the built context now (the
          rostered() builder already carries it) - no loose prop beside it. */}
      <PlayerDecisionCard
        open={decisionCardPlayerId != null}
        onClose={() => setDecisionCardPlayerId(null)}
        entry={decisionCardEntry}
        leagueId={Number(leagueId)}
        context={decisionCardBuiltContext}
      />
    </Shell>
  );
}

/**
 * The page frame: the Play-select token context (Field ground, Ink text, Archivo) on a `.ps-root`
 * element, and a 1280px column that is a flex column (not a grid, so a wide child never widens the
 * page) with the stacking gap the compact scoreboard's sticky anchor cancels (`--ps-stack-gap`).
 * Every state renders inside it so the ground is constant.
 */
function Shell({ children }) {
  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%' }}>
      <Box
        data-testid="matchup-column"
        sx={{
          '--ps-stack-gap': { xs: '16px', sm: '24px' },
          maxWidth: '1280px',
          marginX: 'auto',
          boxSizing: 'border-box',
          padding: { xs: '14px 16px 48px', sm: '24px 32px 64px' },
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--ps-stack-gap)',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

/**
 * The page head (the boards' head, the model for every wave 2 page): the breadcrumb, the pixel h1
 * with its chips on one row, the dim "Times in {zone}" line, the closed "What the numbers mean"
 * disclosure, and at the right the view toggle (its group element on `toggleRef`, for the Full
 * comparison focus move) with the Set lineup ghost button on desktop. A plain layout row, not a
 * header element: a top-level header maps to the banner landmark the app bar owns.
 */
function Head({
  leagueId, leagueName, week, isPlayoff, statusChip, isLive, view, onViewChange, toggleRef, titleRef, lineupHref, compact,
}) {
  const zone = formatInstant(new Date(), 'zone') || 'your time zone';
  return (
    <Box
      data-testid="matchup-header"
      sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px 24px',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: { xs: '1 1 100%', sm: '1 1 auto' } }}>
        <Breadcrumb leagueId={leagueId} leagueName={leagueName} />
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: { xs: '8px 16px', sm: '12px 20px' } }}>
            <Box
              component="h1"
              ref={titleRef}
              tabIndex={-1}
              sx={{
                m: 0, ...pixelSx(16), fontSize: { xs: '24px', md: '32px' }, lineHeight: 1.3, overflowWrap: 'break-word',
              }}
            >
              {`Week ${week} Matchup`}
            </Box>
            {isPlayoff && <Box component="span" data-testid="matchup-playoff-chip"><StatusChip>Playoff</StatusChip></Box>}
            {statusChip && (
              <Box component="span" data-testid="matchup-status-chip" data-variant={statusChip.variant}>
                {isLive ? <LiveChip>Live</LiveChip> : <StatusChip>{statusChip.label}</StatusChip>}
              </Box>
            )}
          </Box>
          <Box component="p" sx={{ m: 0, fontSize: '17px', color: 'var(--ps-dim)' }}>{`Times in ${zone}`}</Box>
          <NumbersHelp terms={NUMBERS_TERMS} />
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px', width: compact ? '100%' : undefined }}>
        <ToggleMatchupView ref={toggleRef} value={view} onChange={onViewChange} fill={compact} />
        {!compact && <SetLineupLink href={lineupHref} placement="header" />}
      </Box>
    </Box>
  );
}

/**
 * The league crumb ("Northwoods League"), Game Center, then the current page ("Matchup",
 * `aria-current="page"`): a `nav` landmark holding a list, the WAI-ARIA breadcrumb shape, with the
 * pixel arrow as the separator. The league crumb waits for the row. Below sm the current page drops
 * (the h1 says it), so no trailing separator wraps.
 */
function Breadcrumb({ leagueId, leagueName }) {
  const sep = (hideOnPhone) => (
    <Box component="span" aria-hidden="true" sx={{ color: 'var(--ps-dim)', display: { xs: hideOnPhone ? 'none' : 'inline-flex', sm: 'inline-flex' } }}>
      <PixelArrow />
    </Box>
  );
  return (
    <Box component="nav" aria-label="Breadcrumb" data-testid="matchup-breadcrumb">
      <Box
        component="ol"
        role="list"
        sx={{
          listStyle: 'none', m: '0 0 0 -10px', p: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap',
        }}
      >
        {leagueName && (
          <Box component="li" sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <PsLink to={`/league/${leagueId}`}>{leagueName}</PsLink>
            {sep(false)}
          </Box>
        )}
        <Box component="li" sx={{ display: 'flex', alignItems: 'center' }}>
          <PsLink to={`/league/${leagueId}/game-center`}>Game Center</PsLink>
          {sep(true)}
        </Box>
        <Box
          component="li"
          aria-current="page"
          sx={{
            display: { xs: 'none', sm: 'inline-flex' }, alignItems: 'center', minHeight: '44px', padding: '0 10px', fontSize: '15px', fontWeight: 600, color: 'var(--ps-dim)',
          }}
        >
          Matchup
        </Box>
      </Box>
    </Box>
  );
}

/**
 * "Set lineup": a ghost button (a 2px Ink edge, never filled) that is a react-router link to the Lineup
 * page; nothing is managed here (ADR 0019). The bottom (phone) placement stretches full width.
 */
function SetLineupLink({ href, placement }) {
  const bottom = placement === 'bottom';
  return (
    <Box
      component={RouterLink}
      to={href}
      data-testid="set-lineup"
      data-placement={placement}
      sx={{
        minHeight: '44px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 16px',
        boxSizing: 'border-box',
        border: '2px solid var(--ps-ink)',
        borderRadius: 0,
        color: 'var(--ps-ink)',
        fontSize: '15px',
        fontWeight: 600,
        textDecoration: 'none',
        width: bottom ? '100%' : undefined,
        whiteSpace: 'nowrap',
      }}
    >
      Set lineup
    </Box>
  );
}

/**
 * The first-load skeleton: one region carrying aria-busy so the page announces it (the shapes stay
 * aria-hidden). A literal "true" is correct: this branch unmounts the moment the read settles, so
 * there is no in-DOM transition to "false" for a screen reader to observe.
 */
function LoadingRegion() {
  return (
    <Box data-testid="matchup-loading" aria-busy="true" sx={{ display: 'grid', gap: '16px' }}>
      <Skel data-testid="skeleton" width="min(520px, 100%)" height={40} />
      <Skel data-testid="skeleton" width="100%" height={240} />
      <Skel data-testid="skeleton" width="100%" height={56} />
      <Skel data-testid="skeleton" width="100%" height={320} />
    </Box>
  );
}
