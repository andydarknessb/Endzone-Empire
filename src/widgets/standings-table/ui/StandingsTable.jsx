import React from 'react';
import { Box, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Card, Badge, Skeleton } from '../../../shared/ui';
import TeamAvatar from '../../../components/common/TeamAvatar';
import useStandingsTable from '../model/useStandingsTable';

// The three columns that do not fit a 390px card. PF and PA come back at xs as
// the Team cell's second line; PCT does not (seven columns of numbers is more
// than a phone row can carry, and the record beside it already answers the same
// question).
const FOLDED_COLUMN_SX = { display: { xs: 'none', sm: 'table-cell' } };

/**
 * League Dashboard standings-table widget (ticket #641): the full league
 * standings as the main grid's wide card. Rank, Team (avatar + name), record
 * (W-L-T), win percentage, points for, points against and the trailing streak,
 * a header count of teams, and the viewer's own row highlighted and marked with
 * a "You" pill.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens. Ink text sits
 * on the card surface, on the accent tint (the viewer's row, the island-wide
 * viewer treatment Draft Grades also paints) or on `dash-surface3` (a hovered
 * row), all registered pairings in tokens.contrast.test.js. The one composite
 * that is NOT yet registered is the "You" pill on that tinted row: the Badge is
 * itself `dash-accent-soft`, so on the viewer's row it is accent-soft over
 * accent-soft over the card, measured 4.69:1 light and 5.74:1 dark. It clears
 * AA, and ADR 0010 wants the row written down; the pill stays accent (the
 * island's identity marker) rather than being demoted to neutral to dodge it.
 *
 * The columns fold rather than scroll on a phone: PCT, PF and PA are sm-and-up,
 * and PF/PA return at xs as a second line inside the Team cell, so the four
 * columns that remain fit 390px with no hidden horizontal scroll.
 *
 * The PLAYOFF CUT is the 2px rule above the first Team outside the bracket
 * (`cutIndex`, useStandingsTable.js), carrying a visually hidden "Playoff cut
 * line" so the boundary is not colour alone.
 *
 * The standings read is the card's spine: while it is in flight the card holds
 * its layout with skeleton rows, and if it fails the card shows one compact,
 * self-contained error, so a failed table never touches the rest of the page.
 * The header (title + team count) renders in every state, since the count is
 * read from the league membership, not the standings read.
 *
 * Preseason (phase before in season, or every row zero games) is the honest
 * empty state: the record, points, PCT and STRK cells render a placeholder mark
 * instead of 0-0-0, zero points and a bare dash, no cut line is drawn across an
 * order nobody has earned yet, and a footer note says those values populate
 * after Week 1.
 */
export default function StandingsTable({ leagueId }) {
  const { status, rows, preseason, teamCount, cutIndex } = useStandingsTable(leagueId);

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
        <Box
          data-testid="standings-table-scroll"
          // Only a scroller where the table can outgrow the card. At lg the
          // seven columns fit, and a box that scrolls in one axis is the
          // scrollport its own sticky header would stick to - so at those
          // widths it stops being one, and the header sticks to the page
          // instead while rows 4-12 scroll past it.
          sx={{ overflowX: { xs: 'auto', lg: 'visible' } }}
        >
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
                <HeadCell align="right" sx={FOLDED_COLUMN_SX}>PCT</HeadCell>
                <HeadCell align="right" sx={FOLDED_COLUMN_SX}>PF</HeadCell>
                <HeadCell align="right" sx={FOLDED_COLUMN_SX}>PA</HeadCell>
                <HeadCell align="right">STRK</HeadCell>
              </Box>
            </Box>
            <Box component="tbody">
              {status === 'loading'
                ? // One skeleton row per Team in the league, read from the
                  // membership the card already has, so the table does not jump
                  // from six rows to twelve when the standings land. The floor of
                  // 1 covers the window where the league read itself is still in
                  // flight and the count is unknown.
                  Array.from({ length: Math.max(teamCount, 1) }, (_, i) => (
                    <SkeletonRow key={`skeleton-${i}`} />
                  ))
                : rows.map((row, index) => (
                    <StandingsRow
                      key={row.key}
                      row={row}
                      preseason={preseason}
                      cutLine={index === cutIndex}
                    />
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

function StandingsRow({ row, preseason, cutLine = false }) {
  return (
    <Box
      component="tr"
      data-testid={row.isViewer ? 'standings-table-you-row' : undefined}
      data-viewer-team={row.isViewer || undefined}
      data-cut-line={cutLine || undefined}
      sx={{
        transition: 'background-color var(--transition-fast) ease',
        // The island's one viewer treatment (#671 marker, T3): the accent tint
        // plus the 3px accent bar the mockup draws, the same pair Draft Grades
        // paints, so a manager finds their own row by the same shape in both
        // cards. It replaced a surface2 fill that measured 1.075:1 against the
        // card and read as no highlight at all.
        ...(row.isViewer
          ? {
              backgroundColor: 'var(--dash-accent-soft)',
              boxShadow: 'inset 3px 0 0 var(--dash-accent)',
            }
          : {
              // surface3, not surface2: surface2 is a resting tier elsewhere on
              // the island, and hovering to it would read as a state rather than
              // as the pointer. Guarded on a real pointer so a tap does not
              // leave a phantom hover behind on a touch screen.
              '@media (hover: hover)': {
                '&:hover': { backgroundColor: 'var(--dash-surface3)' },
              },
            }),
        '& > td, & > th': {
          // The playoff cut rides on the row's own top border, so the rule sits
          // exactly where the hairline already is: between the last Team in the
          // bracket and the first Team out.
          borderTop: cutLine
            ? '2px solid var(--dash-line-strong)'
            : '1px solid var(--dash-line)',
        },
      }}
    >
      <BodyCell align="right" muted>
        {/* Not colour alone (1.4.1): the row that carries the rule says so, and
            it is announced before the rank of the first Team out. */}
        {cutLine && (
          <Box component="span" data-testid="standings-table-cut-line" sx={visuallyHidden}>
            Playoff cut line
          </Box>
        )}
        {row.rank}
      </BodyCell>
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
          {/* The zero minimum lets the name column shrink below its longest
              word; both lines inside clip, so it shrinks rather than pushing
              the number cells off the card. */}
          <Box sx={{ display: 'grid', gap: 0.25, minWidth: 0, overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
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
              {row.isViewer && <Badge variant="you" sx={{ flex: 'none' }}>You</Badge>}
            </Box>
            {/* Where PF and PA go on a phone: the columns fold away below sm and
                come back here, so both point totals stay on the row instead of
                behind a horizontal scroll. Exactly one of the two renders at any
                width, so nothing is announced twice. */}
            {!preseason && (
              <Box
                component="span"
                data-testid="standings-table-points-line"
                sx={{
                  display: { xs: 'block', sm: 'none' },
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontSize: '11.5px',
                  fontWeight: 400,
                  color: 'var(--dash-dim)',
                }}
              >
                {`${row.pointsFor} PF · ${row.pointsAgainst} PA`}
              </Box>
            )}
          </Box>
        </Box>
      </BodyCell>
      <BodyCell align="right">{preseason ? <Placeholder /> : row.record}</BodyCell>
      <BodyCell align="right" sx={FOLDED_COLUMN_SX}>
        {preseason || row.winPct == null ? <Placeholder /> : row.winPct}
      </BodyCell>
      <BodyCell align="right" sx={FOLDED_COLUMN_SX}>
        {preseason ? <Placeholder /> : row.pointsFor}
      </BodyCell>
      <BodyCell align="right" sx={FOLDED_COLUMN_SX}>
        {preseason ? <Placeholder /> : row.pointsAgainst}
      </BodyCell>
      <BodyCell align="right">
        {preseason || row.streak == null ? <Placeholder /> : row.streak}
      </BodyCell>
    </Box>
  );
}

function HeadCell({ children, align = 'left', sx }) {
  return (
    <Box
      component="th"
      scope="col"
      sx={{
        // The column names stay on screen while the rows scroll past. `top: 0`,
        // not an app-bar offset: Nav is position="static" (Nav.jsx), so nothing
        // is pinned above this table to clear.
        position: 'sticky',
        top: 0,
        zIndex: 1,
        // An opaque ground is what a sticky header needs to have rows pass
        // under it; the card's own surface is that ground.
        backgroundColor: 'var(--dash-surface)',
        textAlign: align,
        px: 1.5,
        py: 1.25,
        // The hairline is drawn as an inset shadow rather than a border: with
        // border-collapse the header's bottom border belongs to the collapsed
        // table grid and scrolls away with the rows, leaving the pinned header
        // edgeless. A shadow is painted by the cell itself, so it travels.
        boxShadow: 'inset 0 -1px 0 var(--dash-line)',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: 'var(--dash-faint)',
        whiteSpace: 'nowrap',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

function BodyCell({ children, align = 'left', muted = false, asRowHeader = false, sx }) {
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
        ...sx,
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
      {/* The placeholder folds with the table: the three columns that are
          sm-and-up leave no gap behind at xs. */}
      <BodyCell align="right" sx={FOLDED_COLUMN_SX}>
        <Skeleton data-testid="standings-table-skeleton" variant="text" width={30} height={14} />
      </BodyCell>
      <BodyCell align="right" sx={FOLDED_COLUMN_SX}>
        <Skeleton data-testid="standings-table-skeleton" variant="text" width={44} height={14} />
      </BodyCell>
      <BodyCell align="right" sx={FOLDED_COLUMN_SX}>
        <Skeleton data-testid="standings-table-skeleton" variant="text" width={44} height={14} />
      </BodyCell>
      <BodyCell align="right">
        <Skeleton data-testid="standings-table-skeleton" variant="text" width={26} height={14} />
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
