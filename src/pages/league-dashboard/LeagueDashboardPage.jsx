import React from 'react';
import { useParams } from 'react-router-dom';
import { Box, Container, Typography } from '@mui/material';
import { useLeague } from '../../hooks/useLeague';
import { Badge, Skeleton } from '../../shared/ui';
import CopyInvite from '../../features/copy-invite';
import MyTeamSummary from '../../widgets/my-team-summary';
import MatchupPreview from '../../widgets/matchup-preview';
import StandingsTable from '../../widgets/standings-table';
import DraftGrades from '../../widgets/draft-grades';
import QuickActions from '../../widgets/quick-actions';
import {
  deriveLeaguePhase,
  isSeasonLive,
  LEAGUE_PHASE,
  LEAGUE_PHASE_META,
} from '../../lib/leaguePhase';
import { isPickemOnly } from '../../lib/leagueType';

/**
 * League Dashboard page slice (ADR 0020). This ticket (#638) builds the shell:
 * the league header (name + phase/team/draft chips and, for a commissioner, the
 * copy-invite control) and the empty hero + main grid regions that the six
 * widget tickets fill. It is NOT routed yet; the legacy dashboard stays on the
 * route until the cutover ticket.
 *
 * The page reads the league through the shared cache (useLeague / ADR 0004), so
 * a subpage reached from here reuses the same payload. Everything phase-shaped
 * in the header derives from the client League-phase helper
 * (src/lib/leaguePhase.js), never from a stored status field: that keeps a
 * single source of phase truth as the widget tickets build on this shell.
 *
 * The page paints the dashboard island's own token context (`dash-bg` /
 * `dash-ink`, the display/body faces): every ink-on-surface pairing it puts on
 * screen (h1 and neutral chips over `dash-bg`, the live chip's accent-on-tint
 * over `dash-bg`) is a registered pairing in tokens.contrast.test.js. Painting
 * a different backdrop under the tinted live chip would compose an unmeasured
 * pairing, so the island background is deliberate, not decorative.
 */
export default function LeagueDashboardPage() {
  const { leagueId } = useParams();
  const { league, teams, loading, error } = useLeague(leagueId);

  // First load blanks the page; once the league is on screen a background
  // reload keeps it mounted (the shared cache serves the row it already has).
  if (!league && loading) {
    return (
      <DashboardShell>
        <Box data-testid="dashboard-loading" sx={{ display: 'grid', gap: '16px' }}>
          <Skeleton variant="text" width={260} height={44} />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Skeleton variant="rounded" width={150} height={26} />
            <Skeleton variant="rounded" width={90} height={26} />
            <Skeleton variant="rounded" width={120} height={26} />
          </Box>
        </Box>
      </DashboardShell>
    );
  }

  if (!league) {
    return (
      <DashboardShell>
        <Typography role="alert" sx={{ color: 'var(--dash-ink)' }}>
          {error || 'League not available'}
        </Typography>
      </DashboardShell>
    );
  }

  const phase = deriveLeaguePhase(league);
  const phaseLabel = LEAGUE_PHASE_META[phase]?.label ?? '';
  const pickemOnly = isPickemOnly(league);
  const seasonLive = isSeasonLive(league);
  const week = league.current_week;
  // "Week N · <phase label>" while the season is being played (the live/accent
  // chip); the bare phase label otherwise (pre-draft, drafting, complete).
  const phaseChipLabel =
    seasonLive && week != null ? `Week ${week} · ${phaseLabel}` : phaseLabel;
  // The draft is done for a fantasy league in every phase past drafting. Read
  // from the helper's phase, not the raw draft_status column, so the page keeps
  // no second source of phase truth. A pick'em-only league has no draft.
  const draftComplete =
    !pickemOnly && phase !== LEAGUE_PHASE.PRE_DRAFT && phase !== LEAGUE_PHASE.DRAFTING;

  return (
    <DashboardShell>
      {/* A plain layout row, not a <header>: a top-level <header> maps to the
          `banner` landmark, and the app shell's global app bar (Nav) already
          owns that role, so this must not add a second banner at cutover. The
          h1 below carries the heading structure. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 1.75,
          flexWrap: 'wrap',
        }}
      >
        <Typography
          component="h1"
          sx={{
            m: 0,
            fontFamily: 'var(--dash-font-display)',
            fontSize: { xs: '28px', sm: '34px' },
            fontWeight: 700,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            color: 'var(--dash-ink)',
          }}
        >
          {league.name}
        </Typography>

        <Box component="span" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {phaseChipLabel && (
            <Badge variant={seasonLive ? 'live' : 'neutral'}>{phaseChipLabel}</Badge>
          )}
          <Badge variant="neutral">{`${teams.length} Teams`}</Badge>
          {draftComplete && <Badge variant="neutral">Draft Complete</Badge>}
        </Box>

        {/* Commissioner-only, gated purely on the invite code the server sends
            only to commissioners. It lives in the page header, not the global
            app bar. */}
        {league.invite_code && (
          <Box sx={{ ml: { sm: 'auto' } }}>
            <CopyInvite code={league.invite_code} />
          </Box>
        )}
      </Box>

      {/* HERO: my-team beside matchup preview. Nameless <section> layout
          containers, deliberately NOT labelled landmarks: an empty labelled
          region is announced with nothing in it (noise). The real landmarks are
          the titled Cards the widget tickets (#639-#643) swap into these empty
          slots, each a labelled region via shared/ui Card. Collapses to one
          column at tablet width. */}
      <Box
        component="section"
        data-testid="dashboard-hero"
        sx={{
          display: 'grid',
          gap: '22px',
          gridTemplateColumns: { xs: '1fr', md: '5fr 7fr' },
        }}
      >
        <Box data-testid="slot-my-team">
          <MyTeamSummary leagueId={leagueId} />
        </Box>
        <Box data-testid="slot-matchup-preview">
          <MatchupPreview leagueId={leagueId} />
        </Box>
      </Box>

      {/* MAIN: standings beside a rail (same nameless-container reasoning as the
          hero). Empty slots for #641/#642/#643. Collapses to one column at
          tablet width. */}
      <Box
        component="section"
        data-testid="dashboard-main"
        sx={{
          display: 'grid',
          gap: '22px',
          gridTemplateColumns: { xs: '1fr', md: '8fr 4fr' },
          alignItems: 'start',
        }}
      >
        <Box data-testid="slot-standings">
          <StandingsTable leagueId={leagueId} />
        </Box>
        <Box
          data-testid="dashboard-rail"
          sx={{ display: 'grid', gap: '22px' }}
        >
          {/* Rail top: draft grades (#642). The commissioner panel is a later
              slot in this same rail; this widget composes above it. */}
          <Box data-testid="slot-draft-grades">
            <DraftGrades leagueId={leagueId} />
          </Box>
        </Box>
      </Box>

      {/* QUICK ACTIONS (#643): the full-width grouped action cards below the
          main grid. A nameless <section> layout container; the widget's own
          titled Card is the labelled landmark inside it. */}
      <Box
        component="section"
        data-testid="dashboard-quick-actions"
      >
        <QuickActions leagueId={leagueId} />
      </Box>
    </DashboardShell>
  );
}

/**
 * The dashboard island's page frame: the `dash-*` token context (background,
 * ink, body face) plus the stacking gap between the header and the two grid
 * regions. Every state (loading, error, loaded) renders inside it so the island
 * background is constant.
 */
function DashboardShell({ children }) {
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
          py: { xs: 2.5, sm: 3.5 },
          display: 'grid',
          gap: '22px',
        }}
      >
        {children}
      </Container>
    </Box>
  );
}
