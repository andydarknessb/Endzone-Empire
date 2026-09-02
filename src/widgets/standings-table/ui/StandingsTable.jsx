import React from 'react';
import { Box, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Card, Badge, Skeleton } from '../../../shared/ui';
import TeamAvatar from '../../../components/common/TeamAvatar';
import useStandingsTable from '../model/useStandingsTable';

/**
 * League Dashboard standings-table widget (ticket #641): the full league
 * standings as the main grid's wide card. Rank, Team (avatar + name), record
 * (W-L-T), points for and points against, a header count of teams, and the
 * viewer's own row highlighted and marked with a "You" pill.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. The ink text
 * sits on the card surface (non-viewer rows) or on `dash-surface2` (the viewer
 * row's highlight and the header cells) - both already registered pairings in
 * tokens.contrast.test.js, so no new pairing is composed here. The "You" pill is
 * the shared accent-on-accent-tint Badge.
 *
 * The standings read is the card's spine: while it is in flight the card holds
 * its layout with skeleton rows, and if it fails the card shows one compact,
 * self-contained error, so a failed table never touches the rest of the page.
 * The header (title + team count) renders in every state, since the count is
 * read from the league membership, not the standings read.
 *
 * Preseason (phase before in season, or every row zero games) is the honest
 * empty state: the record and points cells render a placeholder mark instead of
 * 0-0-0 and zero points, and a footer note says those values populate after
 * Week 1.
 */
export default function StandingsTable({ leagueId }) {
  const { status, rows, preseason, teamCount } = useStandingsTable(leagueId);

  // The card owns this fetch, so it (not each aria-hidden skeleton) reports the
  // loading state to assistive tech while the read that holds the table's layout
  // is still in flight (Skeleton.jsx).
  const busy = status === 'loading';

  return (
    <Card
      title="Standings"
      count={<Box component="span" data-testid="standings-table-count">{teamCount}</Box>}
      data-testid="standings-table"
      aria-busy={busy}
    >
      {status === 'error' ? (
        <Box sx={{ px: 2.25, py: 2 }}>
          <Typography
            role="alert"
            data-testid="standings-table-error"
            sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}
          >
            We could not load the standings right now.
          </Typography>
        </Box>
      ) : (
        <Box data-testid="standings-table-scroll" sx={{ overflowX: 'auto' }}>
          <Box
            component="table"
            sx={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: 'var(--dash-font-body)',
            }}
          >
            <Box component="thead">
              <Box component="tr">
                <HeadCell align="right">Rank</HeadCell>
                <HeadCell>Team</HeadCell>
                <HeadCell align="right">W-L-T</HeadCell>
                <HeadCell align="right">PF</HeadCell>
                <HeadCell align="right">PA</HeadCell>
              </Box>
            </Box>
            <Box component="tbody">
              {status === 'loading'
                ? Array.from({ length: 6 }, (_, i) => <SkeletonRow key={`skeleton-${i}`} />)
                : rows.map((row) => (
                    <StandingsRow key={row.key} row={row} preseason={preseason} />
                  ))}
            </Box>
          </Box>
        </Box>
      )}

      {status === 'ready' && preseason && (
        <Box sx={{ px: 2.25, py: 1.5, borderTop: '1px solid var(--dash-line)' }}>
          <Typography
            data-testid="standings-table-preseason-note"
            sx={{ fontSize: '12.5px', color: 'var(--dash-faint)' }}
          >
            Records, points and streaks populate after Week 1.
          </Typography>
        </Box>
      )}
    </Card>
  );
}

function StandingsRow({ row, preseason }) {
  return (
    <Box
      component="tr"
      data-testid={row.isViewer ? 'standings-table-you-row' : undefined}
      data-viewer-team={row.isViewer || undefined}
      sx={{
        // The viewer's row is highlighted with the surface2 tier (a registered
        // ink-on-surface2 pairing), so it stands out without composing a new
        // contrast pairing.
        backgroundColor: row.isViewer ? 'var(--dash-surface2)' : 'transparent',
        '& > td, & > th': { borderTop: '1px solid var(--dash-line)' },
      }}
    >
      <BodyCell align="right" muted>{row.rank}</BodyCell>
      {/* The Team cell is the row's header (th scope="row"), so a screen reader
          navigating to any stat cell hears which team it belongs to, and each
          stat value has row context, not just a column name. */}
      <BodyCell asRowHeader>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          {/* The avatar is decorative here: the visible name text beside it (and
              this cell as the row header) already carries the Team identity, so
              unlike the my-team hero (#327) the avatar is NOT given a redundant
              accessible name that would double the team's name in every row.
              TeamAvatar is itself aria-hidden, so a plain wrapper leaves it out
              of the a11y tree. */}
          <Box sx={{ flex: 'none', display: 'flex' }}>
            <TeamAvatar
              name={row.teamName}
              avatarUrl={row.avatarUrl}
              avatarStaticUrl={row.avatarStaticUrl}
              size={28}
            />
          </Box>
          <Box
            component="span"
            sx={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '13.5px',
              fontWeight: 600,
              color: 'var(--dash-ink)',
            }}
          >
            {row.teamName}
          </Box>
          {row.isViewer && <Badge variant="you">You</Badge>}
        </Box>
      </BodyCell>
      <BodyCell align="right">{preseason ? <Placeholder /> : row.record}</BodyCell>
      <BodyCell align="right">{preseason ? <Placeholder /> : row.pointsFor}</BodyCell>
      <BodyCell align="right">{preseason ? <Placeholder /> : row.pointsAgainst}</BodyCell>
    </Box>
  );
}

function HeadCell({ children, align = 'left' }) {
  return (
    <Box
      component="th"
      scope="col"
      sx={{
        textAlign: align,
        px: 1.5,
        py: 1.25,
        borderBottom: '1px solid var(--dash-line)',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: 'var(--dash-faint)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

function BodyCell({ children, align = 'left', muted = false, asRowHeader = false }) {
  return (
    <Box
      component={asRowHeader ? 'th' : 'td'}
      {...(asRowHeader ? { scope: 'row' } : {})}
      sx={{
        textAlign: align,
        px: 1.5,
        py: 1.25,
        fontSize: '13.5px',
        // A th defaults to bold; the inner name span and badge set their own
        // weight, so keep the cell itself at the normal body weight.
        fontWeight: 400,
        fontVariantNumeric: 'tabular-nums',
        color: muted ? 'var(--dash-dim)' : 'var(--dash-ink)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

function SkeletonRow() {
  return (
    <Box component="tr" sx={{ '& > td': { borderTop: '1px solid var(--dash-line)' } }}>
      <BodyCell align="right">
        <Skeleton data-testid="standings-table-skeleton" variant="text" width={18} height={14} />
      </BodyCell>
      <BodyCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Skeleton data-testid="standings-table-skeleton" variant="circular" width={28} height={28} />
          <Skeleton data-testid="standings-table-skeleton" variant="text" width={120} height={14} />
        </Box>
      </BodyCell>
      <BodyCell align="right">
        <Skeleton data-testid="standings-table-skeleton" variant="text" width={44} height={14} />
      </BodyCell>
      <BodyCell align="right">
        <Skeleton data-testid="standings-table-skeleton" variant="text" width={44} height={14} />
      </BodyCell>
      <BodyCell align="right">
        <Skeleton data-testid="standings-table-skeleton" variant="text" width={44} height={14} />
      </BodyCell>
    </Box>
  );
}

// The placeholder mark for a preseason cell: a dash, no digits. The dash is a
// visual mark only, so it is aria-hidden and a visually-hidden "Not available"
// carries the same meaning to a screen reader, matching my-team-summary.
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
