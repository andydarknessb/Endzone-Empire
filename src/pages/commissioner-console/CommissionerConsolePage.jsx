import React from 'react';
import { Link as RouterLink, Navigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Box, Button, Container, Link, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Badge, Skeleton, StatTile } from '../../shared/ui';
import AdvanceWeek from '../../features/advance-week';
import CommissionerTools from '../../components/LeagueDashboard/CommissionerTools';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';
import useCommissionerConsole from './model/useCommissionerConsole';

const H1_SX = {
  m: 0,
  fontFamily: 'var(--dash-font-display)',
  fontSize: { xs: '28px', sm: '34px' },
  fontWeight: 700,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
  color: 'var(--dash-ink)',
};

/**
 * Commissioner console page slice (ADR 0034, #1107), on the
 * `/league/:leagueId/commissioner` route, following the page-slice pattern
 * `src/pages/game-center` set (ADR 0031). League administration - the legacy
 * commissioner tools - moves off the League Dashboard onto its own page here;
 * this first cut is a re-parenting of `CommissionerTools` (composed AS-IS,
 * cut ruling #617), not a rebuild, so it keeps that component's own tabs and
 * the section rail the canvas draws is deliberately not built.
 *
 * Gated like DraftSettings: a viewer whose league payload carries neither
 * `is_commissioner` nor creator identity (Team identity via
 * `isLeagueCreator`, never an account id) is redirected to the dashboard.
 * Not wrapped in FantasyOnly - a pick'em commissioner has settings too, and
 * the facts strip and advance-week control simply have nothing to show such
 * a league (both fantasy-only concepts already gated the same way on the
 * dashboard's commissioner strip).
 *
 * Composes, in the island's `dash-*` shell: a two-crumb breadcrumb (the
 * league name to the dashboard, then "Commissioner"), the h1 "Commissioner
 * console", the phase chip and the "Commissioners · N" chip, the
 * advance-week control in the header (fantasy, live-week only, the same gate
 * `useCommissionerPanel` states today), a facts strip of `shared/ui`
 * StatTiles from `commissionerFacts` (`shared/lib`, moved here from the
 * commissioner-panel widget's model so both surfaces read the one function),
 * and a 720px column mounting the legacy tools with exactly the props the
 * panel hands them today, plus the co-commissioner explainer sentence for a
 * non-owner (the owner sees the control the sentence explains the absence
 * of, so it would be noise for them).
 */
export default function CommissionerConsolePage() {
  const { leagueId } = useParams();
  const user = useSelector((store) => store.user);
  const {
    league,
    teams,
    viewerTeamId,
    loading,
    refetch,
    isCommissioner,
    isOwner,
    showAdvance,
    currentWeek,
    seasonLive,
    phaseChipLabel,
    commissionerCount,
    facts,
  } = useCommissionerConsole(leagueId);

  if (!league && loading) {
    return (
      <Shell>
        <Box data-testid="commissioner-console-loading" aria-busy="true" sx={{ display: 'grid', gap: '16px' }}>
          <Skeleton variant="text" width={280} height={44} />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Skeleton variant="rounded" width={120} height={26} />
            <Skeleton variant="rounded" width={140} height={26} />
          </Box>
          <Skeleton variant="rounded" height={320} />
        </Box>
      </Shell>
    );
  }

  if (!league) {
    return (
      <Shell>
        <Box sx={{ display: 'grid', gap: 1.75, justifyItems: 'start' }}>
          {/* "Console unavailable", not "Commissioner console": a viewer who
              never got the league row cannot see the surface that heading
              would claim to be showing. Mirrors LeagueDashboardPage's own
              "League unavailable" for the same failed-read state. */}
          <Typography component="h1" sx={H1_SX}>Console unavailable</Typography>
          {/* The fixed sentence, never the raw `error` string: useResource
              collapses the server's own message and the transport's
              (`err.message`, e.g. "Network Error") into one value, so
              showing it here would put an axios internal in front of a
              commissioner. Matches LeagueDashboardPage's same call. */}
          <Typography role="alert" sx={{ fontSize: '14px', color: 'var(--dash-ink)' }}>
            We could not load this league right now.
          </Typography>
          <Button
            type="button"
            variant="outlined"
            onClick={() => refetch()}
            sx={{
              ...MIN_TOUCH_TARGET_SX,
              textTransform: 'none',
              color: 'var(--dash-ink)',
              borderColor: 'var(--dash-line-strong)',
              borderRadius: 'var(--dash-radius-sm)',
              fontFamily: 'var(--dash-font-body)',
              fontWeight: 600,
              fontSize: '13px',
              // Without this, MUI's stock outlined hover paints
              // palette.primary.main plus a primary-tinted wash - an
              // unregistered pairing inside the dash shell (ADR 0034).
              // AppThemeProvider's MuiButton override does not intercept it
              // (disableElevation/borderRadius/transition only), so this
              // page has to state it itself, matching LeagueDashboardPage's
              // same button.
              '&:hover': {
                borderColor: 'var(--dash-accent-line)',
                backgroundColor: 'transparent',
              },
            }}
          >
            Try again
          </Button>
        </Box>
      </Shell>
    );
  }

  // The same gate DraftSettings uses: a viewer whose league payload carries
  // neither `is_commissioner` nor creator identity has no business on an
  // administration surface, and is sent back to the dashboard. `user?.id`
  // guards against redirecting before the auth state this page never reads
  // otherwise has settled.
  if (user?.id && !isCommissioner && !isOwner) {
    return <Navigate to={`/league/${leagueId}`} replace />;
  }

  return (
    <Shell>
      <Breadcrumb leagueId={leagueId} leagueName={league.name} />

      <Box
        data-testid="commissioner-console-header"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'stretch', sm: 'baseline' },
          gap: { xs: '12px', sm: '18px' },
          flexWrap: 'wrap',
        }}
      >
        <Typography component="h1" sx={H1_SX}>Commissioner console</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {phaseChipLabel && <Badge variant={seasonLive ? 'live' : 'neutral'}>{phaseChipLabel}</Badge>}
          <Badge variant="neutral">{`Commissioners · ${commissionerCount}`}</Badge>
        </Box>
        {showAdvance && (
          <Box sx={{ ml: { sm: 'auto' } }}>
            <AdvanceWeek leagueId={leagueId} currentWeek={currentWeek} onAdvanced={refetch} />
          </Box>
        )}
      </Box>

      {facts.length > 0 && (
        <Box
          data-testid="commissioner-console-facts"
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 1,
          }}
        >
          {facts.map((fact) => (
            <StatTile
              key={fact.key}
              data-testid={`commissioner-console-fact-${fact.key}`}
              label={fact.label}
              value={fact.value}
            />
          ))}
        </Box>
      )}

      <Box sx={{ maxWidth: '720px', width: '100%' }}>
        {/* A visually-hidden h2, so the heading tree stays h1 -> h2 -> h3
            instead of skipping a level. CommissionerTools composes AS-IS
            (cut ruling #617) and its own "Commissioner Tools" is a fixed
            `component="h3"`, chosen because it used to sit directly under
            the commissioner-panel widget's Card h2 (CommissionerPanel.jsx);
            re-parenting it here drops that h2, and this label restores the
            level it was written to nest under without touching the legacy
            component or printing a second visible title above its own. */}
        <Typography component="h2" sx={visuallyHidden}>League administration</Typography>
        {/* Why the co-commissioner card is missing from the tools below,
            stated only for the reader who cannot see it: the owner sees the
            card itself, so the sentence would be noise for them. */}
        {!isOwner && (
          <Typography
            data-testid="commissioner-console-co-commissioner-note"
            sx={{
              m: 0,
              mb: 1.5,
              fontFamily: 'var(--dash-font-body)',
              fontSize: '12.5px',
              color: 'var(--dash-dim)',
            }}
          >
            Only the league creator can add or remove co-commissioners.
          </Typography>
        )}
        <CommissionerTools
          leagueId={leagueId}
          league={league}
          teams={teams}
          viewerTeamId={viewerTeamId}
          isOwner={isOwner}
          onRefresh={refetch}
        />
      </Box>
    </Shell>
  );
}

const CRUMB_LINK_SX = {
  color: 'var(--dash-faint)',
  textDecoration: 'none',
  '&:hover': { color: 'var(--dash-ink)', textDecoration: 'underline' },
  '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: 2 },
};

/**
 * The canvas's breadcrumb for this page: the league name (linking back to
 * the dashboard) then "Commissioner", the WAI-ARIA breadcrumb shape. Two
 * crumbs, not the dashboard's three-level "Leagues / <league> / <page>": the
 * canvas draws no top-level "Leagues" crumb here.
 */
function Breadcrumb({ leagueId, leagueName }) {
  return (
    <Box component="nav" aria-label="Breadcrumb" data-testid="commissioner-console-breadcrumb">
      <Box
        component="ol"
        // A styleless list (listStyle: 'none' strips the UA default) drops
        // its implicit `list` role in WebKit/VoiceOver, so the crumbs would
        // read as ungrouped content there without this explicit role.
        role="list"
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
        <Box component="li" aria-current="page" sx={{ color: 'var(--dash-dim)' }}>
          Commissioner
        </Box>
      </Box>
    </Box>
  );
}

/**
 * The island's page frame: the `dash-*` token context plus the canvas's
 * 1200px column. Every state (loading, error, gated, loaded) renders inside
 * it so the island background is constant, matching GameCenterPage and
 * LeagueDashboardPage.
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
        data-testid="commissioner-console-column"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
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
