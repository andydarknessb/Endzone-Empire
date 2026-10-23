import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Container, GlobalStyles, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  CompactScoreboard, Skel, psRootSx,
} from '../../shared/ui/playselect';
import { compactScoreboardView } from '../../widgets/matchup-hero';
import MatchupGrid from '../../widgets/matchup-grid';
import NflGameStrip from '../../widgets/nfl-game-strip';
import { ScoringFeedList, ScoringStrip } from '../../widgets/scoring-feed';
import { matchupBoard } from '../../entities/matchup';
import { useActionItems } from '../../entities/action-item';
import { useGameCenter, syncLineText } from './model/useGameCenter';
import GameCenterHead from './ui/GameCenterHead';
import HeroSection from './ui/HeroSection';
import LoadError from './ui/LoadError';
import WeekGlance from './ui/WeekGlance';

/**
 * Game Center page slice (ADR 0031, #897), on the `/league/:leagueId/game-center` route, on the Play-select
 * look since ADR 0067 wave 2 (spec #2334). Sections, order, navigation and data reads are the product's;
 * the approved behaviour changes are the only differences:
 *
 *   - the head (ui/GameCenterHead): the breadcrumb, the pixel h1 with the Live chip on its row while a
 *     matchup of the week is live, the sync line, the week picker (one tab stop) and the closed "What the
 *     numbers mean" disclosure;
 *   - the lineup note under the hero (the shared decision in entities/roster, laid out by features/bench-what-if)
 *     while the viewer has an empty or Out starting slot to fix in the league's current week;
 *   - on phones and tablets (below `md`) the latest-plays strip, the one newest play below `sm`; desktop
 *     does not draw it, the rail's Scoring feed shows the same plays (Critique 11 item 12);
 *   - the real NFL game strip (widgets/nfl-game-strip);
 *   - a two-column grid, `minmax(0, 1fr) 340px` at `md` and up: the viewer's hero (widgets/matchup-hero,
 *     Board black while live), the lineup note when the dashboard's lineup problem applies, and League
 *     matchups (widgets/matchup-grid) on the left; the Scoring feed and, at `sm` and up, Week at a glance in
 *     the rail.
 *
 * The full hero stays in flow. Once it scrolls out of view a 56px compact bar ("DF 61.0 · SS 58.9 · Darkness
 * Falls by 2.1") pins to the top, and the page reserves it with `scroll-padding-top` (Critique 11 item 8).
 *
 * Every value two slices need is read once in the page model (./model/useGameCenter) and passed down. The
 * page adds one shared, cached read the dashboard also uses (`useActionItems`) for the lineup note. Loading:
 * the first load renders a skeleton per region, each carrying `aria-busy`. A background refetch never blanks
 * the page. A failed read renders an error panel above the body; the body still renders with whatever did
 * load.
 *
 * Watching page: no cursor and no filled action (RULINGS "QA round 1"). Paints only `ps-*` tokens through
 * the widgets and the shared Play-select kit; headings: one h1, then the h2 the frames render.
 */

/**
 * True once `el` has scrolled above the top of the viewport (needs IntersectionObserver). `el` is state, set by a
 * callback ref, so the observer follows the hero when it remounts (a week switch changes which branch draws it)
 * instead of watching a detached node.
 */
function useScrolledPast(el, enabled) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!enabled || !el || typeof IntersectionObserver === 'undefined') {
      setPast(false);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => {
      setPast(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, enabled]);
  return past;
}

export default function GameCenterPage() {
  const { leagueId } = useParams();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const belowMd = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const now = useMinuteClock();
  const {
    league,
    viewerTeamId,
    pending,
    error,
    weeks,
    week,
    setWeek,
    hero,
    rest,
    records,
    ranks,
    syncedAt,
    nextKickoffAt,
    games,
    gamesInProgress,
    items,
    glance,
    anyLive,
    retry,
  } = useGameCenter(leagueId);
  const { items: actionItems, reload: reloadActionItems } = useActionItems();
  const [heroEl, setHeroEl] = useState(null);

  const syncLine = pending ? null : syncLineText(syncedAt, gamesInProgress > 0);
  const weekNumber = week === 'All' || week == null ? undefined : Number(week);
  const heroStarted = !!hero && matchupBoard(hero).hasStarted === true;
  const pinned = useScrolledPast(heroEl, heroStarted);
  const compactBar = useMemo(() => (hero ? compactScoreboardView(hero, viewerTeamId) : null), [hero, viewerTeamId]);
  // Only the league's current week has a lineup still to set, and best ball sets none (the optimizer fills the
  // seats); a week on screen that is not the current one has no note.
  const noteEligible = !!hero && !league?.best_ball && !matchupBoard(hero).settled && Number(hero.week) === Number(league?.current_week);

  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%' }}>
      {heroStarted && <GlobalStyles styles={{ html: { scrollPaddingTop: '72px' } }} />}
      <Container
        maxWidth={false}
        data-testid="game-center-column"
        sx={{
          maxWidth: 1280,
          px: { xs: '14px', sm: '32px' },
          pt: { xs: '14px', sm: '24px' },
          pb: { xs: '32px', sm: '64px' },
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        {/* The pinned compact bar: a zero-height sticky holder, so showing it never shifts the page. */}
        <Box sx={{ position: 'sticky', top: 0, zIndex: (t) => t.zIndex.appBar - 1, height: 0, mb: '-24px' }}>
          {pinned && compactBar && (
            <Box data-testid="game-center-compact-scoreboard" sx={{ position: 'absolute', left: 0, right: 0, top: 0 }}>
              <CompactScoreboard {...compactBar} />
            </Box>
          )}
        </Box>

        <GameCenterHead
          leagueId={leagueId}
          leagueName={league?.name}
          compact={compact}
          live={anyLive}
          syncLine={syncLine}
          pending={pending}
          weeks={weeks}
          week={week}
          onWeek={setWeek}
        />

        {error && (
          <LoadError body={String(error)} onRetry={retry} />
        )}

        {pending ? (
          <LoadingRegions />
        ) : (
          <>
            {belowMd && <ScoringStrip items={items} />}
            {games.length > 0 && <NflGameStrip games={games} data-testid="game-center-nfl-games" />}

            <Box
              data-testid="game-center-body"
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 340px' },
                gap: '24px',
                alignItems: 'start',
              }}
            >
              <Box data-testid="game-center-main" sx={{ display: 'flex', flexDirection: 'column', gap: { xs: '16px', md: '24px' }, minWidth: 0 }}>
                {hero && (
                  <HeroSection
                    hero={hero}
                    heroProps={{
                      viewerTeamId, records, ranks, leagueId, gamesInProgress, nextKickoffAt,
                    }}
                    heroRef={setHeroEl}
                    noteEligible={noteEligible}
                    league={league}
                    now={now}
                    actionItems={actionItems}
                    onLockPassed={reloadActionItems}
                  />
                )}
                <MatchupGrid
                  matchups={rest}
                  leagueId={leagueId}
                  records={records}
                  viewerTeamId={viewerTeamId}
                  more={hero ? rest.length : undefined}
                  empty={hero ? 'No other league matchups this week.' : 'No matchups this week.'}
                />
              </Box>

              <Box data-testid="game-center-rail" sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '24px', minWidth: 0 }}>
                <ScoringFeedList items={items} week={weekNumber} limit={compact ? 3 : 6} />
                {/* The phone board ends at the feed: no glance frame below sm; under "All weeks" the model
                    hands no rows (the facts are per-week) and the frame renders nothing. */}
                {!compact && <WeekGlance rows={glance} />}
              </Box>
            </Box>
          </>
        )}
      </Container>
    </Box>
  );
}

/**
 * The clock the hero's lock countdown reads, refreshed once a minute between score events. Epoch ms.
 */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The first-load skeletons, one region per part of the page the reads fill (the strip, the hero and grid, the
 * rail), each carrying aria-busy so the region that owns the read announces it. A literal "true" is correct:
 * this branch unmounts the moment the reads settle.
 */
function LoadingRegions() {
  return (
    <Box data-testid="game-center-loading" sx={{ display: 'grid', gap: '24px' }}>
      <Box data-testid="game-center-loading-strip" aria-busy="true">
        <Skel data-testid="skeleton" width="100%" height={64} />
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 340px' }, gap: '24px', alignItems: 'start' }}>
        <Box data-testid="game-center-loading-main" aria-busy="true" sx={{ display: 'grid', gap: '16px' }}>
          <Skel data-testid="skeleton" width="100%" height={240} />
          <Skel data-testid="skeleton" width={180} height={24} />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: '16px' }}>
            {Array.from({ length: 4 }).map((_, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Skel key={i} width="100%" height={150} />
            ))}
          </Box>
        </Box>
        <Box data-testid="game-center-loading-rail" aria-busy="true" sx={{ display: 'grid', gap: '24px' }}>
          <Skel data-testid="skeleton" width="100%" height={320} />
          <Skel data-testid="skeleton" width="100%" height={220} />
        </Box>
      </Box>
    </Box>
  );
}
