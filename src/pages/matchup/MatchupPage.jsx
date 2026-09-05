import React, { useCallback, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Button, Container, Link, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Badge, Skeleton } from '../../shared/ui';
import ScoreboardStrip from '../../widgets/scoreboard-strip';
import SlotComparison from '../../widgets/slot-comparison';
import NflGameStrip from '../../widgets/nfl-game-strip';
import RetroScoreboard from '../../widgets/retro-scoreboard';
import BenchWhatIf from '../../features/bench-what-if';
import ToggleMatchupView, { VIEW_SCOREBOARD, VIEW_STANDARD } from '../../features/toggle-matchup-view';
import CelebrateTouchdown from '../../features/celebrate-touchdown';
import PlayerQuickView from '../../components/PlayerQuickView/PlayerQuickView';
import { useMatchupPage } from './model/useMatchupPage';
import BenchCard from './ui/BenchCard';
import LastPlays from './ui/LastPlays';

/**
 * Matchup page slice (ADR 0031, #903), on the
 * `/league/:leagueId/matchups/:matchupId` route in place of the legacy Matchup
 * Detail page under the components tree, which is deleted with its tests.
 * Transcribed from the canvas's `matchupStandardDesktop()`,
 * `matchupStandardMobile()`, `matchupScoreboardDesktop()` and
 * `matchupScoreboardMobile()` (docs/design/game-center-matchups/build.mjs):
 *
 *   - the header (`detailHeader()`): the "<league name> · Game Center" line,
 *     the h1 "Week N Matchup" in the display face with the Playoff chip and
 *     the status chip beside it, and on the right the Standard / Scoreboard
 *     toggle (features/toggle-matchup-view) with the "Set lineup" action
 *     linking to the Lineup page (ADR 0019: the sole management surface). On
 *     a phone the toggle fills its row and Set lineup sits at the bottom of
 *     the page, 44px tall;
 *   - the Standard view: the sticky scoreboard strip (widgets/scoreboard-
 *     strip), the NFL game strip while the Matchup is live and games exist
 *     (widgets/nfl-game-strip), the bench what-if while live
 *     (features/bench-what-if), the Starters table (widgets/slot-comparison)
 *     and the collapsed Bench card (./ui/BenchCard) with the bench-left line
 *     for a final Matchup;
 *   - the Scoreboard view: the retro scoreboard (widgets/retro-scoreboard),
 *     its ticker slot holding the last-plays ticker (./ui/LastPlays) full
 *     width under the field while live (the canvas's liveTicker() row), its
 *     aside slot the bench what-if while live (the right column on desktop,
 *     after the Lineups card stacked), and its "Full comparison" action
 *     switching back to Standard. The canvas draws no bench section in this
 *     view: the legacy Scoreboard mode's "Show Benches" is retired, and the
 *     Standard view's Bench card carries the benches.
 *
 * Both views render the SAME `starterRows` the entity hook pairs (ADR 0029),
 * so the two agree slot for slot under any league slot order. The status chip
 * is the server's status fact (ADR 0030) read through the entity's one
 * predicate: the header chip and the strip's chip carry the same label, and
 * a status the server could not compute (null) shows no chip anywhere. A
 * player's name opens PlayerQuickView from either the Starters table or the
 * Bench card. The touchdown cutscenes and toasts are the celebrate-touchdown
 * feature's, fed from the score feed through the page model.
 *
 * Every value two slices need is read once in the page model
 * (./model/useMatchupPage) and passed down, the way ADR 0020's page passes
 * shared values. Widgets, features, the entity and the kit are imported
 * through their index files only; the page reaches below the island for
 * PlayerQuickView and the league cache hook, the helpers ADR 0031 names as
 * sanctioned.
 *
 * Loading: the first load renders a skeleton region carrying `aria-busy`
 * (the shapes stay aria-hidden, the region announces); a background refetch
 * (a reconnect) never blanks the page. A failed read renders an Alert.
 *
 * Paints the island's own token context (`dash-bg` / `dash-ink`, the display
 * and body faces) and only `dash-*` tokens plus the app's radius, transition
 * and focus-ring tokens. Every pairing here is registered in
 * tokens.contrast.test.js: ink, dim and faint on the page background, the
 * kit's chip pairings, the primary button label on the accent, and the focus
 * ring on the page. Headings are explicit (ADR 0021): one h1, then the h2
 * Card titles the widgets and the page's own cards render.
 */
export default function MatchupPage() {
  const { leagueId, matchupId } = useParams();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const {
    matchup, starterRows, loading, error, leagueName, viewerTeamId, records,
    status, isLive, isPlayoff, homeProb, games, benches, benchLeft, showBenchLeft,
    whatIf, viewerHasRoster, ticker, retroActivePlay, celebration, view, setView,
  } = useMatchupPage(leagueId, matchupId);
  const [expandedId, setExpandedId] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);
  const [benchOpen, setBenchOpen] = useState(false);

  const toggleRow = useCallback((id) => {
    setExpandedId((current) => (current === id ? null : id));
  }, []);
  const openPlayer = useCallback((id) => setQuickViewId(id), []);
  const showStandard = useCallback(() => setView(VIEW_STANDARD), [setView]);

  if (loading) {
    return (
      <Shell compact={compact}>
        <LoadingRegion />
      </Shell>
    );
  }

  const homeName = matchup?.home?.name;
  const awayName = matchup?.away?.name;
  const lineupHref = `/league/${leagueId}/lineup`;
  const whatIfCard = isLive ? (
    <BenchWhatIf whatIf={whatIf} hasRoster={viewerHasRoster} leagueId={leagueId} headingLevel={2} />
  ) : null;

  return (
    <Shell compact={compact}>
      {error && (
        <Alert severity="error" sx={{ mb: compact ? '12px' : '16px' }}>
          {error}
        </Alert>
      )}

      {matchup && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: compact ? '12px' : '16px' }}>
          <Header
            leagueId={leagueId}
            leagueName={leagueName}
            week={matchup.week}
            isPlayoff={isPlayoff}
            status={status}
            live={isLive}
            view={view}
            onViewChange={setView}
            lineupHref={lineupHref}
            compact={compact}
          />

          {view === VIEW_SCOREBOARD ? (
            <RetroScoreboard
              matchup={matchup}
              leagueName={leagueName}
              rows={starterRows}
              games={games}
              activePlay={retroActivePlay}
              homeProb={homeProb}
              headingLevel={2}
              onFullComparison={showStandard}
              ticker={isLive ? <LastPlays items={ticker} mobile={compact} /> : null}
              aside={whatIfCard}
            />
          ) : (
            <>
              <ScoreboardStrip matchup={matchup} viewerTeamId={viewerTeamId} records={records} sticky />
              {isLive && games.length > 0 && <NflGameStrip games={games} />}
              {whatIfCard}
              <SlotComparison
                rows={starterRows}
                homeName={homeName}
                awayName={awayName}
                expectedFinal={{ home: matchup.home.expectedFinal, away: matchup.away.expectedFinal }}
                onOpenPlayer={openPlayer}
                expandedId={expandedId}
                onToggle={toggleRow}
              />
              <BenchCard
                homeName={homeName}
                awayName={awayName}
                homeBench={benches.home}
                awayBench={benches.away}
                open={benchOpen}
                onToggle={() => setBenchOpen((open) => !open)}
                onOpenPlayer={openPlayer}
                benchLeft={benchLeft}
                showBenchLeft={showBenchLeft}
                mobile={compact}
              />
            </>
          )}

          {compact && <SetLineupLink href={lineupHref} placement="bottom" />}
        </Box>
      )}

      <CelebrateTouchdown celebration={celebration} />

      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
        leagueId={Number(leagueId)}
      />
    </Shell>
  );
}

/**
 * The island's page frame: the `dash-*` token context plus the canvas's
 * column (24px sides on desktop, 14px on a phone). Every state renders inside
 * it so the island background is constant.
 */
function Shell({ compact, children }) {
  return (
    <Box
      sx={{
        backgroundColor: 'var(--dash-bg)',
        color: 'var(--dash-ink)',
        fontFamily: 'var(--dash-font-body)',
        minHeight: '100%',
      }}
    >
      <Container
        maxWidth="lg"
        sx={{
          px: compact ? '14px' : '24px',
          pt: compact ? '14px' : '24px',
          pb: compact ? '32px' : '40px',
        }}
      >
        {children}
      </Container>
    </Box>
  );
}

/**
 * The canvas's `detailHeader()`: the league line, the h1 with its chips, the
 * view toggle and (desktop) the Set lineup action.
 */
function Header({ leagueId, leagueName, week, isPlayoff, status, live, view, onViewChange, lineupHref, compact }) {
  return (
    <Box
      data-testid="matchup-header"
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
        <Breadcrumb leagueId={leagueId} leagueName={leagueName} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <Typography
            component="h1"
            sx={{
              m: 0,
              fontFamily: 'var(--dash-font-display)',
              fontSize: compact ? '28px' : '34px',
              fontWeight: 700,
              lineHeight: 1.05,
              textTransform: 'uppercase',
              color: 'var(--dash-ink)',
            }}
          >
            {`Week ${week} Matchup`}
          </Typography>
          {isPlayoff && <Badge data-testid="matchup-playoff-chip">Playoff</Badge>}
          {status.chipLabel && (
            <Badge data-testid="matchup-status-chip" variant={live ? 'live' : 'neutral'}>
              {status.chipLabel}
            </Badge>
          )}
        </Box>
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          width: compact ? '100%' : undefined,
        }}
      >
        <ToggleMatchupView value={view} onChange={onViewChange} fill={compact} />
        {!compact && <SetLineupLink href={lineupHref} placement="header" />}
      </Box>
    </Box>
  );
}

const CRUMB_LINK_SX = {
  color: 'var(--dash-faint)',
  textDecoration: 'none',
  '&:hover': { color: 'var(--dash-ink)', textDecoration: 'underline' },
  '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
};

/**
 * The canvas's league line ("Northwoods League · Game Center") as a
 * breadcrumb: the league name linking to its dashboard, a middot, and Game
 * Center linking to the week's page. A `nav` landmark holding a list, the
 * WAI-ARIA breadcrumb shape; the league crumb waits for the row.
 */
function Breadcrumb({ leagueId, leagueName }) {
  return (
    <Box component="nav" aria-label="Breadcrumb" data-testid="matchup-breadcrumb">
      <Box
        component="ol"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '6px',
          fontSize: '12px',
          color: 'var(--dash-faint)',
        }}
      >
        {leagueName && (
          <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <Link
              component={RouterLink}
              to={`/league/${leagueId}`}
              sx={{ ...CRUMB_LINK_SX, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {leagueName}
            </Link>
            <Box component="span" aria-hidden="true">·</Box>
          </Box>
        )}
        <Box component="li">
          <Link component={RouterLink} to={`/league/${leagueId}/game-center`} sx={CRUMB_LINK_SX}>
            Game Center
          </Link>
        </Box>
      </Box>
    </Box>
  );
}

/**
 * The canvas's `.btn.primary` "Set lineup": the `dash-on-accent` label on the
 * `dash-accent` fill (the registered "dashboard primary button label on
 * accent" pairing), 38px in the header and a full-width 44px row at the
 * bottom of the phone layout. A react-router link to the Lineup page: nothing
 * is managed here (ADR 0019).
 */
function SetLineupLink({ href, placement }) {
  const bottom = placement === 'bottom';
  return (
    <Button
      component={RouterLink}
      to={href}
      disableElevation
      data-testid="set-lineup"
      data-placement={placement}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        height: bottom ? 44 : 38,
        width: bottom ? '100%' : undefined,
        px: '16px',
        py: 0,
        minWidth: 0,
        borderRadius: '9px',
        fontSize: '13px',
        fontWeight: 600,
        lineHeight: 1.2,
        textTransform: 'none',
        whiteSpace: 'nowrap',
        border: '1px solid var(--dash-accent)',
        color: 'var(--dash-on-accent)',
        backgroundColor: 'var(--dash-accent)',
        transition: 'filter var(--transition-fast)',
        '&:hover': { backgroundColor: 'var(--dash-accent)', filter: 'brightness(1.08)' },
        '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
      }}
    >
      Set lineup
    </Button>
  );
}

/**
 * The first-load skeleton: one region carrying aria-busy so the page
 * announces it (Skeleton.jsx: the shapes stay aria-hidden). A literal "true"
 * is correct: this branch unmounts the moment the read settles, so there is
 * no in-DOM transition to "false" for a screen reader to observe.
 */
function LoadingRegion() {
  return (
    <Box data-testid="matchup-loading" aria-busy="true" sx={{ display: 'grid', gap: '16px' }}>
      <Skeleton variant="text" width={260} height={40} />
      <Skeleton height={140} />
      <Skeleton height={40} />
      <Skeleton height={320} />
    </Box>
  );
}
