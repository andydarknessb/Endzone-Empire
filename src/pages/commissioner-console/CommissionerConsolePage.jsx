import React from 'react';
import { Link as RouterLink, Navigate, useParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Box } from '@mui/material';
import {
  ErrorPanel, Frame, PixelHeading, Skel, StatusChip, SR_ONLY_SX, psRootSx,
} from '../../shared/ui/playselect';
import AdvanceWeek from '../../features/advance-week';
import JoinRequests from '../../widgets/join-requests';
import CommissionerTools from '../../components/LeagueDashboard/CommissionerTools';
import useCommissionerConsole from './model/useCommissionerConsole';

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
 * Composes, in the Play-select shell: a two-crumb breadcrumb (the
 * league name to the dashboard, then "Commissioner"), the h1 "Commissioner
 * console", the phase chip and the "Commissioners · N" chip, the
 * advance-week control in the header (fantasy, live-week only, the same gate
 * `useCommissionerPanel` states today), a facts strip (a tertiary frame) from `commissionerFacts` (`shared/lib`, moved here from the
 * commissioner-panel widget's model so both surfaces read the one function),
 * and a 720px column mounting the legacy tools with exactly the props the
 * panel hands them today, plus the co-commissioner explainer sentence for a
 * non-owner (the owner sees the control the sentence explains the absence
 * of, so it would be noise for them).
 *
 * Above that tools column, the `join-requests` widget (#1109) mounts while
 * `showJoinQueue` holds - a public, screened league - giving the commissioner
 * a decision surface for the queue without opening the legacy tools' own
 * Join Requests tab (left in place, out of scope to remove; the two are
 * independent reads of the same endpoint, so a decision made in one is
 * reflected in the other only on its own next read).
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
    phaseChipLabel,
    commissionerCount,
    facts,
    showJoinQueue,
  } = useCommissionerConsole(leagueId);

  if (!league && loading) {
    return (
      <Shell>
        <Box data-testid="commissioner-console-loading" aria-busy="true" sx={{ display: 'grid', gap: '16px' }}>
          <Skel width={280} height={44} />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Skel width={120} height={26} />
            <Skel width={140} height={26} />
          </Box>
          <Skel height={320} />
        </Box>
      </Shell>
    );
  }

  if (!league) {
    return (
      <Shell>
        <Box sx={{ display: 'grid', gap: '16px', justifyItems: 'start' }}>
          {/* "Console unavailable", not "Commissioner console": a viewer who
              never got the league row cannot see the surface that heading
              would claim to be showing. Mirrors LeagueDashboardPage's own
              "League unavailable" for the same failed-read state. The fixed
              sentence, never the raw `error` string: useResource collapses the
              server's message and the transport's ("Network Error") into one
              value, so showing it would put an axios internal in front of a
              commissioner. */}
          <PixelHeading level={1}>Console unavailable</PixelHeading>
          <Box sx={{ width: '100%' }}>
            <ErrorPanel title="We could not load this league right now." onRetry={() => refetch()} />
          </Box>
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
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: { xs: '12px', sm: '18px' },
          flexWrap: 'wrap',
        }}
      >
        <PixelHeading level={1}>Commissioner console</PixelHeading>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {/* Neutral always: green is for live games only (RULINGS.md:56). */}
          {phaseChipLabel && <StatusChip>{phaseChipLabel}</StatusChip>}
          <StatusChip>{`Commissioners · ${commissionerCount}`}</StatusChip>
        </Box>
        {showAdvance && (
          <Box sx={{ flexBasis: '100%' }}>
            <AdvanceWeek leagueId={leagueId} currentWeek={currentWeek} onAdvanced={refetch} />
          </Box>
        )}
      </Box>

      {facts.length > 0 && (
        <Frame tier="rule" aria-label="League settings" data-testid="commissioner-console-facts">
          <Box
            component="dl"
            sx={{
              m: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '12px 24px',
              padding: '14px 20px',
            }}
          >
            {facts.map((fact) => (
              <Box key={fact.key} data-testid={`commissioner-console-fact-${fact.key}`}>
                <Box component="dt" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{fact.label}</Box>
                <Box component="dd" sx={{ m: 0, fontSize: '15px', fontWeight: 600 }}>{fact.value}</Box>
              </Box>
            ))}
          </Box>
        </Frame>
      )}

      {/* The join-requests widget (#1109): mounted above the tools column,
          and only while the league is public with join approval on. The
          widget's own model re-derives that same gate for its read (its
          docblock explains why), so this is belt-and-suspenders rather than
          the only thing standing between a private league and the request -
          it is what keeps the widget, and the card frame it would otherwise
          render around nothing, out of a private league's DOM at all. */}
      {showJoinQueue && (
        <Box sx={{ maxWidth: '720px', width: '100%' }}>
          <JoinRequests leagueId={leagueId} />
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
        <Box component="h2" sx={SR_ONLY_SX}>League administration</Box>
        {/* Why the co-commissioner card is missing from the tools below,
            stated only for the reader who cannot see it: the owner sees the
            card itself, so the sentence would be noise for them. */}
        {!isOwner && (
          <Box
            data-testid="commissioner-console-co-commissioner-note"
            sx={{ m: 0, mb: 1.5, fontSize: '14px', color: 'var(--ps-dim)' }}
          >
            Only the league creator can add or remove co-commissioners.
          </Box>
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
  color: 'var(--ps-dim)',
  textDecoration: 'none',
  '&:hover': { color: 'var(--ps-ink)', textDecoration: 'underline' },
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
          fontSize: '14px',
          color: 'var(--ps-dim)',
        }}
      >
        <Box component="li" sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <Box
            component={RouterLink}
            to={`/league/${leagueId}`}
            sx={{ ...CRUMB_LINK_SX, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {leagueName}
          </Box>
          <Box component="span" aria-hidden="true">/</Box>
        </Box>
        <Box component="li" aria-current="page" sx={{ color: 'var(--ps-ink)' }}>
          Commissioner
        </Box>
      </Box>
    </Box>
  );
}

/**
 * The Play-select page frame: the `ps-root` token context plus the 1280px column the other league
 * pages use. Every state (loading, error, gated, loaded) renders inside it so the page field is constant.
 */
function Shell({ children }) {
  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%' }}>
      <Box
        data-testid="commissioner-console-column"
        sx={{
          maxWidth: '1280px',
          marginX: 'auto',
          boxSizing: 'border-box',
          padding: { xs: '24px 16px 48px', sm: '24px 32px 64px' },
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
