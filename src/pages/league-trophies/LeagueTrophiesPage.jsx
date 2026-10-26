import React from 'react';
import { useParams } from 'react-router-dom';
import { Box } from '@mui/material';
import { Frame, PixelHeading, Skel, psRootSx } from '../../shared/ui/playselect';
import { useTrophies, TrophyIcon } from '../../components/TrophyCase/TrophyCase';
import { useLeague } from '../../hooks/useLeague';
import LeagueBreadcrumb from '../../components/LeagueBreadcrumb/LeagueBreadcrumb';
import { TrophyRoom } from '../../widgets/trophy-room';

/**
 * The League trophy case page, on `/league/:leagueId/trophies`, painted on Play-select (the
 * page-head rule for a page with no board). It holds the same live read the dashboard's trophy
 * count holds (`useTrophies`, GET /api/league/:id/trophies) in the `trophy-room` widget's frame.
 * League History is the season archive and never carries the live season's awards (CONTEXT.md
 * "Season archive"), so the count must not link there.
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment), each named with its reason:
 *   - `components/TrophyCase`: `useTrophies`, the live read the dashboard's count also holds, and
 *     `TrophyIcon`, the empty case's glyph. Their second island page consumer fires the promotion
 *     threshold, but the promotion home would be a trophies entity slice no ADR approves, so the
 *     edge is held open (#1269's form); `TrophyIcon` is the same held-open page edge League
 *     History already carries.
 *   - `hooks/useLeague`: `teams`, for the champion banner's avatar only. A failed read needs no
 *     page state: `teams` stays empty and the room falls back to initials.
 *   - `components/LeagueBreadcrumb`: the back-link every league subpage shows.
 */
export default function LeagueTrophiesPage() {
  const { leagueId } = useParams();
  const trophy = useTrophies(leagueId);
  const { teams } = useLeague(leagueId);

  if (trophy.loading) {
    return (
      <PageShell>
        <Box data-testid="page-skeleton" aria-busy="true" sx={{ display: 'grid', gap: '16px' }}>
          <Skel width="220px" height={40} />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skel key={i} width="100%" height={96} />
          ))}
        </Box>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <LeagueBreadcrumb />
        <PixelHeading level={1}>Trophy case</PixelHeading>
      </Box>

      {trophy.error && (
        <Frame
          tier="rule"
          tone="danger"
          component="div"
          role="alert"
          data-testid="league-trophies-error"
          sx={{ padding: '16px 20px', fontSize: '16px' }}
        >
          {trophy.error}
        </Frame>
      )}

      {!trophy.error && trophy.trophies.length === 0 && (
        <Frame
          tier="rule"
          component="div"
          data-testid="trophies-empty"
          sx={{
            display: 'grid', justifyItems: 'center', textAlign: 'center', gap: '12px', padding: '48px 20px',
          }}
        >
          <Box sx={{ color: 'var(--ps-dim)', display: 'inline-flex' }}><TrophyIcon type="champion" size={88} /></Box>
          <Box component="p" sx={{ m: 0, fontSize: '18px', fontWeight: 600 }}>No trophies yet</Box>
          <Box component="p" sx={{ m: 0, fontSize: '16px', color: 'var(--ps-dim)', maxWidth: 420 }}>
            Trophies appear here once they are awarded.
          </Box>
        </Frame>
      )}

      {!trophy.error && trophy.trophies.length > 0 && <TrophyRoom trophy={trophy} teams={teams} />}
    </PageShell>
  );
}

function PageShell({ children }) {
  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%' }}>
      <Box
        data-testid="league-trophies"
        sx={{
          maxWidth: '1100px',
          marginX: 'auto',
          boxSizing: 'border-box',
          padding: { xs: '14px 16px 48px', sm: '24px 32px 64px' },
          display: 'flex',
          flexDirection: 'column',
          gap: { xs: '16px', sm: '24px' },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
