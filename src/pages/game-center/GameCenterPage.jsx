import React, { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { Alert, Box, Container, Link, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Skeleton } from '../../shared/ui';
import PickWeek from '../../features/pick-week';
import MatchupHero from '../../widgets/matchup-hero';
import MatchupGrid from '../../widgets/matchup-grid';
import { ScoringFeedList, ScoringStrip } from '../../widgets/scoring-feed';
import { useGameCenter, syncLineText } from './model/useGameCenter';
import WeekGlance from './ui/WeekGlance';

/**
 * Game Center page slice (ADR 0031, #897), on the `/league/:leagueId/game-center`
 * route in place of the legacy Game Center page under the components tree,
 * which is deleted with its test. Transcribed from the canvas's
 * `gameCenterDesktop()` and `gameCenterMobile()` (docs/design/
 * game-center-matchups/build.mjs):
 *
 *   - the breadcrumb (Leagues / league name / Game Center), then the h1
 *     "Game Center" in the display face with the sync line beneath it
 *     ("Scores synced 3:42 PM · next pass in 8 min", from the week's
 *     `syncedAt`; omitted while the week has no sync), and the week picker
 *     (features/pick-week) on the right, full width below the `sm` breakpoint;
 *   - the live ticker strip (widgets/scoring-feed);
 *   - a two-column grid, `minmax(0, 1fr) 340px` at `md` and up and a single
 *     column below it: the viewer's Matchup as the hero (widgets/matchup-hero)
 *     and the "League matchups" heading over the rest of the week's Matchups
 *     (widgets/matchup-grid, cards on desktop and rows on a phone) on the
 *     left; the Scoring feed (six rows, three on a phone) and, at `sm` and
 *     up, the Week at a glance tile in the rail (the mobile artboard has no
 *     glance tile, so the tile is not rendered below `sm`).
 *
 * Every value two slices need (the week's Matchups, the viewer's Team id,
 * the standings-derived records and ranks, the plays) is read once in the
 * page model (./model/useGameCenter) and passed down, the way ADR 0020's page
 * passes shared values (a Team's record does not join the wire: spec #890's
 * ruling). Widgets, the feature, the entity and the kit are imported through
 * their index files only; the page reaches below the island for the league
 * cache hook and the legacy helpers ADR 0031 names as sanctioned.
 *
 * Loading: the first load renders a skeleton per region, each region carrying
 * `aria-busy` (Skeleton.jsx: the shapes stay aria-hidden, the owning region
 * announces). A background refetch (a reconnect) never blanks the page. A
 * failed read renders an Alert above the body; the body still renders with
 * whatever did load.
 *
 * Paints the island's own token context (`dash-bg` / `dash-ink`, the display
 * and body faces) and only `dash-*` tokens plus the app's focus ring. Every
 * pairing here is registered in tokens.contrast.test.js: ink, dim and faint
 * on the page background, and the focus ring on the page. Headings are
 * explicit (ADR 0021): one h1, then the h2 Card titles the widgets render and
 * the h2 over the grid.
 */
export default function GameCenterPage() {
  const { leagueId } = useParams();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
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
    items,
    glance,
  } = useGameCenter(leagueId);

  const syncLine = pending ? null : syncLineText(syncedAt, now);
  const weekNumber = week === 'All' || week == null ? undefined : Number(week);

  return (
    <Shell>
      <Box sx={{ display: 'grid', gap: '6px', mb: '18px' }}>
        <Breadcrumb leagueId={leagueId} leagueName={league?.name} />
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            justifyContent: 'space-between',
            // The artboard's header row: the picker sits vertically centred
            // against the h1 + sync-line stack.
            alignItems: { xs: 'stretch', sm: 'center' },
            gap: { xs: '12px', sm: '24px' },
          }}
        >
          <Box sx={{ display: 'grid', gap: '4px', minWidth: 0 }}>
            <Typography
              component="h1"
              sx={{
                m: 0,
                fontFamily: 'var(--dash-font-display)',
                fontSize: { xs: '30px', sm: '36px' },
                fontWeight: 700,
                letterSpacing: '0.02em',
                lineHeight: 1.05,
                textTransform: 'uppercase',
                color: 'var(--dash-ink)',
              }}
            >
              Game Center
            </Typography>
            {syncLine && <SyncLine text={syncLine} />}
          </Box>
          {pending ? (
            <Box
              data-testid="game-center-loading-picker"
              aria-busy="true"
              sx={{ display: 'flex', justifyContent: { sm: 'flex-end' } }}
            >
              <Skeleton width={compact ? '100%' : 320} height={38} />
            </Box>
          ) : (
            <PickWeek weeks={weeks} value={week ?? 'All'} onChange={setWeek} fill={compact} />
          )}
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: '18px' }}>
          {error}
        </Alert>
      )}

      {pending ? (
        <LoadingRegions />
      ) : (
        <>
          <Box sx={{ mb: '18px' }}>
            <ScoringStrip items={items} now={now} />
          </Box>

          <Box
            data-testid="game-center-body"
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 340px' },
              gap: '20px',
              alignItems: 'start',
            }}
          >
            <Box data-testid="game-center-main" sx={{ display: 'grid', gap: '18px', minWidth: 0 }}>
              {hero && (
                <MatchupHero
                  matchup={hero}
                  viewerTeamId={viewerTeamId}
                  records={records}
                  ranks={ranks}
                  leagueId={leagueId}
                  gamesInProgress={null}
                  nextKickoffAt={nextKickoffAt}
                />
              )}

              <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: '8px', sm: '10px' }, mt: '4px' }}>
                <Typography
                  component="h2"
                  sx={{
                    m: 0,
                    fontFamily: 'var(--dash-font-display)',
                    fontSize: { xs: '16px', sm: '17px' },
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--dash-ink)',
                  }}
                >
                  League matchups
                </Typography>
                {hero && rest.length > 0 && (
                  <Typography
                    component="span"
                    data-testid="game-center-grid-count"
                    sx={{ fontSize: '12px', color: 'var(--dash-faint)' }}
                  >
                    {`${rest.length} more`}
                  </Typography>
                )}
                <Box sx={{ flex: '1 1 0' }} />
                {/* The bar colour legend, for the eye only: every bar already
                    names both sides in its accessible name, so a screen reader
                    would hear "Home Away" with nothing to attach it to. */}
                <Box
                  aria-hidden="true"
                  sx={{
                    display: { xs: 'none', sm: 'flex' },
                    gap: '8px',
                    fontSize: '12px',
                    color: 'var(--dash-faint)',
                  }}
                >
                  <LegendDot token="var(--dash-home)" label="Home" />
                  <LegendDot token="var(--dash-away)" label="Away" />
                </Box>
              </Box>

              {rest.length > 0 ? (
                <MatchupGrid matchups={rest} leagueId={leagueId} records={records} />
              ) : (
                <Typography
                  component="p"
                  data-testid="game-center-grid-empty"
                  sx={{ m: 0, fontSize: '14px', color: 'var(--dash-dim)' }}
                >
                  {hero ? 'No other league matchups this week.' : 'No matchups this week.'}
                </Typography>
              )}
            </Box>

            <Box data-testid="game-center-rail" sx={{ display: 'grid', gap: '18px', minWidth: 0 }}>
              <ScoringFeedList items={items} week={weekNumber} limit={compact ? 3 : 6} />
              {/* The mobile artboard ends at the feed: no glance tile below sm;
                  under "All weeks" the model hands no rows (the facts are
                  per-week) and the tile renders nothing. */}
              {!compact && <WeekGlance rows={glance} />}
            </Box>
          </Box>
        </>
      )}
    </Shell>
  );
}

/**
 * The clock the sync line counts down against, refreshed once a minute so
 * "next pass in N min" stays honest between score events. Epoch ms.
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
 * The island's page frame: the `dash-*` token context plus the canvas's
 * 1200px column (24px sides on desktop, 14px on a phone). Every state renders
 * inside it so the island background is constant.
 */
function Shell({ children }) {
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
          px: { xs: '14px', sm: '24px' },
          pt: { xs: '14px', sm: '24px' },
          pb: { xs: '32px', sm: '40px' },
        }}
      >
        {children}
      </Container>
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
 * The canvas's `breadcrumb()`: Leagues / <league name> / Game Center at 13px
 * in the faint tier, the current page in dim. A `nav` landmark holding a
 * list, the WAI-ARIA breadcrumb shape; the league crumb waits for the row.
 */
function Breadcrumb({ leagueId, leagueName }) {
  return (
    <Box component="nav" aria-label="Breadcrumb" data-testid="game-center-breadcrumb">
      <Box
        component="ol"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          fontSize: '13px',
          color: 'var(--dash-faint)',
        }}
      >
        <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Link component={RouterLink} to="/league" sx={CRUMB_LINK_SX}>
            Leagues
          </Link>
          <Box component="span" aria-hidden="true">/</Box>
        </Box>
        {leagueName && (
          <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            <Link
              component={RouterLink}
              to={`/league/${leagueId}`}
              sx={{ ...CRUMB_LINK_SX, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {leagueName}
            </Link>
            <Box component="span" aria-hidden="true">/</Box>
          </Box>
        )}
        <Box component="li" aria-current="page" sx={{ color: 'var(--dash-dim)' }}>
          Game Center
        </Box>
      </Box>
    </Box>
  );
}

/** The canvas's `syncLine()`: the sync glyph and one line at 12px in the faint tier. */
function SyncLine({ text }) {
  return (
    <Box
      data-testid="game-center-sync"
      sx={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dash-faint)' }}
    >
      <SyncIcon />
      <span>{text}</span>
    </Box>
  );
}

/** The canvas's `sync` icon at 14px: inline stroke SVG on the 20px grid, decorative. */
function SyncIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
    >
      <path d="M16 8A6.5 6.5 0 0 0 4.5 6.5M4 12a6.5 6.5 0 0 0 11.5 1.5" />
      <path d="M16 3v5h-5M4 17v-5h5" />
    </svg>
  );
}

/** One legend entry: the 8px side dot in its hue beside its word. */
function LegendDot({ token, label }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <Box
        component="span"
        sx={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: 'var(--radius-pill)',
          backgroundColor: token,
          flex: 'none',
        }}
      />
      {label}
    </Box>
  );
}

/**
 * The first-load skeletons, one region per part of the page the reads fill
 * (the strip, the hero and grid, the rail), each carrying aria-busy so the
 * region that owns the read announces it. A literal "true" is correct: this
 * branch unmounts the moment the reads settle, so there is no in-DOM
 * transition to "false" for a screen reader to observe.
 */
function LoadingRegions() {
  return (
    <Box data-testid="game-center-loading" sx={{ display: 'grid', gap: '18px' }}>
      <Box data-testid="game-center-loading-strip" aria-busy="true">
        <Skeleton height={40} />
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 340px' },
          gap: '20px',
          alignItems: 'start',
        }}
      >
        <Box data-testid="game-center-loading-main" aria-busy="true" sx={{ display: 'grid', gap: '18px' }}>
          <Skeleton height={240} />
          <Skeleton variant="text" width={180} height={24} />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' },
              gap: '14px',
            }}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={150} />
            ))}
          </Box>
        </Box>
        <Box data-testid="game-center-loading-rail" aria-busy="true" sx={{ display: 'grid', gap: '18px' }}>
          <Skeleton height={320} />
          <Skeleton height={220} />
        </Box>
      </Box>
    </Box>
  );
}
