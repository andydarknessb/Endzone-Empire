import React from 'react';
import { Box, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Card, Badge, Skeleton } from '../../../shared/ui';
import TeamAvatar from '../../../components/common/TeamAvatar';
import useMyTeamSummary from '../model/useMyTeamSummary';

/**
 * League Dashboard hero-left widget (ticket #639): the viewer's own Team at a
 * glance. Avatar + Team name + a "You" pill, a secondary record/rank line once
 * games have been played, and three stat tiles (draft grade, projected finish,
 * roster value).
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. Every
 * ink-on-surface pairing it renders is already registered in
 * tokens.contrast.test.js: ink/faint/dim on the card and on the `dash-surface2`
 * stat tiles, the accent "You" pill on the accent tint over a card, and the
 * draft grade as `dash-grade-*-text` on a stat tile (NOT the raised tile, and
 * NOT a chip fill: the mockup paints the grade as colored text, and the text
 * tokens are the legible-as-text set). No new pairing is composed here.
 *
 * The standings read is the card's spine: while it is in flight the card holds
 * its layout with skeletons, and if it fails the card shows one compact,
 * self-contained error and nothing else in the data region, so a failed read
 * never touches the rest of the page. The grade/value and projected-finish
 * reads degrade on their own (a placeholder for missing grades, an absent tile
 * for an uncomputed projection) without erroring the card.
 */
export default function MyTeamSummary({ leagueId }) {
  const { identity, spine, record, draftGrade, rosterValue, proj } = useMyTeamSummary(leagueId);

  // No Team for this viewer (e.g. a commissioner who owns no team): the hero
  // slot stays empty rather than inventing an identity.
  if (!identity) return null;

  // The card is the region that owns these fetches (Skeleton.jsx: the loading
  // state is announced by the owning card, not by each aria-hidden shape), so
  // it carries aria-busy while any of its data is still loading.
  const busy = spine === 'loading' || draftGrade.loading || rosterValue.loading;

  return (
    <Card data-testid="my-team-summary" aria-busy={busy} sx={{ p: 2.5 }}>
      <Box sx={{ display: 'grid', gap: 2 }}>
        {/* Identity: avatar, Team name + You pill, and the secondary line. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
          {/* The avatar carries the Team name as its accessible name. TeamAvatar
              is deliberately aria-hidden (#327), so the name rides on this
              wrapper's role="img"; the visible name text sits beside it. */}
          <Box
            role="img"
            aria-label={identity.name}
            sx={{ flex: 'none', display: 'flex' }}
          >
            <TeamAvatar
              name={identity.name}
              avatarUrl={identity.avatarUrl}
              avatarStaticUrl={identity.avatarStaticUrl}
              size={48}
            />
          </Box>

          <Box sx={{ minWidth: 0, display: 'grid', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography
                component="div"
                sx={{
                  fontFamily: 'var(--dash-font-display)',
                  fontSize: '24px',
                  fontWeight: 700,
                  letterSpacing: '0.02em',
                  lineHeight: 1.1,
                  color: 'var(--dash-ink)',
                }}
              >
                {identity.name}
              </Typography>
              <Badge variant="you">You</Badge>
            </Box>

            {spine === 'loading' && (
              <Skeleton data-testid="my-team-skeleton" variant="text" width={150} height={15} />
            )}
            {spine === 'ready' && record && (
              <Typography
                component="div"
                data-testid="my-team-record"
                sx={{ fontSize: '12.5px', color: 'var(--dash-faint)' }}
              >
                {record.rankText ? `${record.text} · ${record.rankText}` : record.text}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Data region: one compact error, skeleton tiles, or the real tiles. */}
        {spine === 'error' && (
          <Typography
            role="alert"
            data-testid="my-team-error"
            sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}
          >
            We could not load your team summary right now.
          </Typography>
        )}

        {spine !== 'error' && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '10px',
            }}
          >
            {spine === 'loading' ? (
              <>
                <StatTileSkeleton />
                <StatTileSkeleton />
                <StatTileSkeleton />
              </>
            ) : (
              <>
                <StatTile label="Draft grade" testid="stat-draft-grade">
                  {draftGrade.loading ? (
                    <StatValueSkeleton />
                  ) : draftGrade.unavailable || !draftGrade.letter ? (
                    <Placeholder />
                  ) : (
                    <Box
                      component="span"
                      sx={{ color: gradeTextColor(draftGrade.gradeKey) }}
                    >
                      {draftGrade.letter}
                    </Box>
                  )}
                </StatTile>

                {proj && (
                  <StatTile label="Proj. finish" testid="stat-proj-finish">
                    {proj.ordinal.value}
                    <Box
                      component="small"
                      sx={{
                        fontSize: '13px',
                        fontWeight: 500,
                        fontFamily: 'var(--dash-font-body)',
                        color: 'var(--dash-dim)',
                      }}
                    >
                      {proj.ordinal.suffix}
                    </Box>
                  </StatTile>
                )}

                <StatTile label="Roster value" testid="stat-roster-value">
                  {rosterValue.loading ? (
                    <StatValueSkeleton />
                  ) : rosterValue.unavailable || rosterValue.text == null ? (
                    <Placeholder />
                  ) : (
                    rosterValue.text
                  )}
                </StatTile>
              </>
            )}
          </Box>
        )}
      </Box>
    </Card>
  );
}

// A-F -> the legible grade-as-text token (registered on the stat-tile surface);
// anything else falls back to ink so a surprise value is never invisible.
function gradeTextColor(gradeKey) {
  return gradeKey ? `var(--dash-grade-${gradeKey.toLowerCase()}-text)` : 'var(--dash-ink)';
}

// The placeholder mark for a tile whose read has no value yet: a dash, no
// digits (draft-grades 404 renders this in both the grade and value tiles).
// The dash is a visual mark only, so it is aria-hidden and a visually-hidden
// "Not available" carries the same meaning to a screen reader; without it the
// tile would announce its label ("Draft grade") with nothing after it, which a
// non-sighted user cannot tell apart from a loading or broken tile.
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

function StatTile({ label, testid, children }) {
  return (
    <Box
      data-testid={testid}
      sx={{
        backgroundColor: 'var(--dash-surface2)',
        border: '1px solid var(--dash-line)',
        borderRadius: 'var(--dash-radius-sm)',
        padding: '10px 12px',
      }}
    >
      <Box
        sx={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          color: 'var(--dash-faint)',
        }}
      >
        {label}
      </Box>
      <Box
        sx={{
          fontFamily: 'var(--dash-font-display)',
          fontSize: '24px',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.2,
          color: 'var(--dash-ink)',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

function StatTileSkeleton() {
  return (
    <Box
      sx={{
        backgroundColor: 'var(--dash-surface2)',
        border: '1px solid var(--dash-line)',
        borderRadius: 'var(--dash-radius-sm)',
        padding: '10px 12px',
        display: 'grid',
        gap: 0.75,
      }}
    >
      <Skeleton data-testid="my-team-skeleton" variant="text" width={64} height={11} />
      <Skeleton data-testid="my-team-skeleton" variant="text" width={40} height={22} />
    </Box>
  );
}

function StatValueSkeleton() {
  return <Skeleton data-testid="my-team-skeleton" variant="text" width={40} height={22} />;
}
