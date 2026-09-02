import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Link as RouterLink } from 'react-router-dom';
import { Card, Skeleton } from '../../../shared/ui';
import TeamAvatar from '../../../components/common/TeamAvatar';
import useMatchupPreview from '../model/useMatchupPreview';

/**
 * League Dashboard hero-right widget (ticket #640): the viewer's own Team and
 * this week's opponent side by side, each with an avatar, Team name, projected
 * total and a "Projected" label, split by a "VS" divider, and two footer
 * actions ("Compare rosters" to the matchup detail, "Set Lineup" to the lineup
 * page) rendered as MUI Buttons that are router links.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. Every
 * ink-on-surface pairing it renders is already registered in
 * tokens.contrast.test.js: ink / dim / faint on the card surface, and the
 * primary button's `dash-on-accent` label on the `dash-accent` fill (the
 * "dashboard primary button label on accent" pairing). No new pairing is
 * composed here.
 *
 * The matchups-list read is the card's spine: while it is in flight the card
 * holds its layout with skeletons, and if it fails the card shows one compact,
 * self-contained error and nothing else, so a failed read never touches the
 * rest of the page. Each side's projected total prefers the list row's own
 * value and falls back to a chained detail read only when the list could not
 * answer both sides (#670; see useMatchupPreview.js for the condition). While
 * that fallback is in flight each number is skeletoned and the card stays
 * aria-busy; when the list already answered, nothing is in flight and the card
 * is never busy on the totals' account. Either way, a miss or a failed detail
 * read degrades just that number to a placeholder without erroring the card.
 */
export default function MatchupPreview({ leagueId }) {
  const { week, status, busy, matchupId, viewer, opponent } = useMatchupPreview(leagueId);
  const title = week != null ? `Week ${week} Matchup` : 'Matchup';

  // The card is the region that owns these fetches (Skeleton.jsx: the loading
  // state is announced by the owning card, not by each aria-hidden shape), so
  // it carries aria-busy while the reads that hold its layout with skeletons are
  // still loading.
  return (
    <Card
      data-testid="matchup-preview"
      title={title}
      tail="Projections update daily"
      aria-busy={busy}
    >
      {status === 'loading' && <VersusSkeleton />}

      {status === 'error' && (
        <Box sx={{ p: 2.25 }}>
          <Typography
            role="alert"
            data-testid="matchup-preview-error"
            sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}
          >
            We could not load this week&apos;s matchup right now.
          </Typography>
        </Box>
      )}

      {status === 'empty' && (
        <Box sx={{ p: 2.25 }}>
          <Typography sx={{ fontSize: '14px', color: 'var(--dash-dim)' }}>
            No matchup this week
          </Typography>
        </Box>
      )}

      {status === 'ready' && (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              alignItems: 'center',
              gap: 1.5,
              p: 2.25,
            }}
          >
            <Side testid="matchup-side-viewer" side={viewer} />
            <Box
              sx={{
                fontFamily: 'var(--dash-font-display)',
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--dash-faint)',
                border: '1px solid var(--dash-line)',
                borderRadius: 'var(--radius-pill)',
                px: 1.5,
                py: 0.75,
              }}
            >
              VS
            </Box>
            <Side testid="matchup-side-opponent" side={opponent} />
          </Box>

          <Box
            sx={{
              display: 'flex',
              gap: '10px',
              justifyContent: 'flex-end',
              alignItems: 'center',
              p: '14px 18px',
              borderTop: '1px solid var(--dash-line)',
            }}
          >
            <Button
              component={RouterLink}
              to={`/league/${leagueId}/matchups/${matchupId}`}
              disableElevation
              sx={GHOST_SX}
            >
              Compare rosters
            </Button>
            <Button
              component={RouterLink}
              to={`/league/${leagueId}/lineup`}
              disableElevation
              sx={PRIMARY_SX}
            >
              Set Lineup
            </Button>
          </Box>
        </>
      )}
    </Card>
  );
}

const BUTTON_BASE = {
  textTransform: 'none',
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: 1.2,
  borderRadius: '9px',
  padding: '9px 16px',
  minWidth: 0,
  border: '1px solid var(--dash-line-strong)',
};

// Ghost look: dim label on the card surface (a registered pairing), a hairline
// border, no fill.
const GHOST_SX = {
  ...BUTTON_BASE,
  color: 'var(--dash-dim)',
  backgroundColor: 'transparent',
  '&:hover': {
    color: 'var(--dash-ink)',
    borderColor: 'var(--dash-accent-line)',
    backgroundColor: 'transparent',
  },
};

// Primary look: the `dash-on-accent` label on the `dash-accent` fill (the
// registered "dashboard primary button label on accent" pairing).
const PRIMARY_SX = {
  ...BUTTON_BASE,
  color: 'var(--dash-on-accent)',
  backgroundColor: 'var(--dash-accent)',
  borderColor: 'var(--dash-accent)',
  '&:hover': { backgroundColor: 'var(--dash-accent)', filter: 'brightness(1.08)' },
};

// One side of the versus block: avatar, Team name, projected total, "Projected".
function Side({ testid, side }) {
  return (
    <Box
      data-testid={testid}
      sx={{ display: 'grid', gap: 0.75, justifyItems: 'center', textAlign: 'center', minWidth: 0 }}
    >
      {/* The avatar carries the Team name as its accessible name. TeamAvatar is
          deliberately aria-hidden (#327), so the name rides on this wrapper's
          role="img"; the visible name text sits below it. */}
      <Box role="img" aria-label={side.name} sx={{ flex: 'none', display: 'flex' }}>
        <TeamAvatar
          name={side.name}
          avatarUrl={side.avatarUrl}
          avatarStaticUrl={side.avatarStaticUrl}
          size={44}
        />
      </Box>
      <Typography
        component="div"
        sx={{
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--dash-ink)',
        }}
      >
        {side.name}
      </Typography>
      <ProjectedValue projected={side.projected} />
      <Box
        sx={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--dash-faint)',
        }}
      >
        Projected
      </Box>
    </Box>
  );
}

function ProjectedValue({ projected }) {
  if (projected.loading) {
    return <Skeleton data-testid="matchup-skeleton" variant="text" width={64} height={30} />;
  }
  return (
    <Typography
      component="div"
      sx={{
        fontFamily: 'var(--dash-font-display)',
        fontSize: '30px',
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1,
        color: 'var(--dash-ink)',
      }}
    >
      {projected.value != null ? projected.value : <Placeholder />}
    </Typography>
  );
}

// The placeholder mark for a side whose projection is not available yet: a
// dash, no digits. The dash is a visual mark only, so it is aria-hidden and a
// visually-hidden "Not available" carries the same meaning to a screen reader,
// which would otherwise hear the "Projected" label pointing at nothing.
function Placeholder() {
  return (
    <>
      <Box component="span" aria-hidden="true" sx={{ color: 'var(--dash-dim)' }}>
        -
      </Box>
      <Box component="span" sx={visuallyHidden}>
        Not available
      </Box>
    </>
  );
}

function VersusSkeleton() {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 1.5,
        p: 2.25,
      }}
    >
      <SideSkeleton />
      <Skeleton data-testid="matchup-skeleton" variant="rounded" width={44} height={28} />
      <SideSkeleton />
    </Box>
  );
}

function SideSkeleton() {
  return (
    <Box sx={{ display: 'grid', gap: 0.75, justifyItems: 'center' }}>
      <Skeleton data-testid="matchup-skeleton" variant="circular" width={44} height={44} />
      <Skeleton data-testid="matchup-skeleton" variant="text" width={90} height={16} />
      <Skeleton data-testid="matchup-skeleton" variant="text" width={64} height={30} />
    </Box>
  );
}
