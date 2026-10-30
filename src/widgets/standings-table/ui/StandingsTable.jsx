import React, { useId, useState } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import {
  CpuTag, ErrorPanel, Frame, FrameHead, PixelArrow, PixelHeading, pixelSx, Skel, SR_ONLY_SX, TeamMark, YouTag,
} from '../../../shared/ui/playselect';
import useStandingsTable from '../model/useStandingsTable';

// Rows beside the viewer's that a phone keeps when the table folds.
const FOLD_SPAN = 2;

// The first two columns stay in view while PF, PA and STRK scroll (phone), so their widths are
// fixed. `xs` is the phone width, `md` the desktop one.
const RANK_W = { xs: 48, md: 64 };
const CELL_PAD = { xs: '0 8px', md: '0 12px' };

const cellSx = (align = 'left', extra = null) => ({
  boxSizing: 'border-box',
  height: '44px',
  padding: CELL_PAD,
  textAlign: align,
  whiteSpace: 'nowrap',
  fontSize: '15px',
  fontVariantNumeric: 'tabular-nums',
  ...extra,
});

const headCellSx = (align = 'left', extra = null) => ({
  boxSizing: 'border-box',
  height: '40px',
  padding: CELL_PAD,
  textAlign: align,
  backgroundColor: 'var(--ps-panel)',
  borderBottom: '2px solid var(--ps-rule)',
  fontSize: '13px',
  fontWeight: 600,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  color: 'var(--ps-dim)',
  whiteSpace: 'nowrap',
  ...extra,
});

/**
 * League Dashboard standings-table widget (ADR 0067 wave 1b): the league standings as a framed
 * Tecmo ranking screen. Rank, Team (avatar, name, a "You" tag on the viewer's own row), W-L-T, PF,
 * PA and the trailing streak in tabular figures on 44px rows with 2px Rule dividers and no zebra.
 * The viewer's row is Play blue with a pixel arrow before the name (it is not a cursor: the one
 * cursor belongs to Your move); the rank figure is Pixel 16, and a dashed Frame rule marks the
 * playoff line.
 *
 * Paints only `ps-*` tokens (DESIGN.md "Play-select: Home and league pages"). Below `sm` the table
 * folds to the viewer's row with two teams either side and the playoff line, then a "Full standings"
 * link that opens the whole table in place (the league has no standings page of its own). Rank and
 * Team stay in view at that width while PF, PA and STRK scroll inside the table box.
 *
 * The standings read is the frame's spine: while it is in flight the frame holds its layout with
 * skeleton rows, and if it fails the widget is one danger panel with a way to retry, so a failed
 * table never touches the rest of the page. The header (title and team count) renders while loading
 * and when ready, since the count is read from the league membership, not the standings read.
 *
 * Preseason (phase before in season, or every row zero games) is the honest empty state: record,
 * points and streak cells render a placeholder mark, no playoff line is drawn across an order nobody
 * has earned yet, and a note says those values populate after Week 1.
 */
export default function StandingsTable({ leagueId }) {
  const {
    status, rows, preseason, teamCount, cutIndex, refetch,
  } = useStandingsTable(leagueId);
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();

  // The frame owns this fetch, so it reports the loading state to assistive tech while the read that
  // holds the table's layout is still in flight.
  const busy = status === 'loading';

  // The phone fold: the viewer's row, two teams either side, down to the playoff line.
  const viewerIndex = rows.findIndex((row) => row.isViewer);
  const folds = phone && viewerIndex >= 0 && rows.length > FOLD_SPAN * 2 + 1;
  const folded = folds && !expanded;
  const first = folded ? Math.max(0, viewerIndex - FOLD_SPAN) : 0;
  const last = folded
    ? Math.min(rows.length - 1, Math.max(viewerIndex + FOLD_SPAN, cutIndex > 0 ? cutIndex - 1 : 0))
    : rows.length - 1;
  const shown = rows.map((row, index) => ({ row, index })).filter(({ index }) => index >= first && index <= last);

  if (status === 'error') {
    return (
      <Box data-testid="standings-table">
        <ErrorPanel
          title="Standings"
          body="We could not load the standings right now."
          onRetry={refetch}
          retryAriaLabel="Try loading the standings again"
        />
      </Box>
    );
  }

  return (
    <Frame
      labelledBy={headingId}
      data-testid="standings-table"
      aria-busy={busy}
      head={(
        <FrameHead>
          <PixelHeading id={headingId}>Standings</PixelHeading>
          <Box
            component="span"
            data-testid="standings-table-count"
            sx={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--ps-dim)' }}
          >
            {`${teamCount} teams`}
          </Box>
        </FrameHead>
      )}
    >
      <Box
        role="region"
        aria-label={`Standings, ${teamCount} teams`}
        tabIndex={0}
        data-testid="standings-table-scroll"
        sx={{ overflowX: 'auto' }}
      >
        <Box
          component="table"
          sx={{
            width: '100%',
            minWidth: { xs: '538px', md: '700px' },
            borderCollapse: 'separate',
            borderSpacing: 0,
          }}
        >
          <Box component="thead">
            <Box component="tr">
              <Box
                component="th"
                scope="col"
                aria-label="Rank"
                sx={headCellSx('left', {
                  position: 'sticky', left: 0, zIndex: 1, width: RANK_W, minWidth: RANK_W,
                })}
              >
                <Box component="span" aria-hidden="true" sx={{ display: { xs: 'none', sm: 'inline' } }}>Rank</Box>
                <Box component="span" aria-hidden="true" sx={{ display: { xs: 'inline', sm: 'none' } }}>#</Box>
              </Box>
              <Box
                component="th"
                scope="col"
                sx={headCellSx('left', {
                  position: 'sticky', left: RANK_W, zIndex: 1, minWidth: { xs: '214px', md: '300px' },
                })}
              >
                Team
              </Box>
              <Box component="th" scope="col" sx={headCellSx('right', { minWidth: { xs: '72px', md: '88px' } })}>W-L-T</Box>
              <Box component="th" scope="col" sx={headCellSx('right', { minWidth: { xs: '72px', md: '88px' } })}>PF</Box>
              <Box component="th" scope="col" sx={headCellSx('right', { minWidth: { xs: '72px', md: '88px' } })}>PA</Box>
              <Box component="th" scope="col" sx={headCellSx('right', { minWidth: { xs: '64px', md: '72px' } })}>STRK</Box>
            </Box>
          </Box>
          <Box component="tbody">
            {status === 'loading'
              // One skeleton row per Team in the league, read from the membership the frame already
              // has, so the table does not jump from six rows to twelve when the standings land.
              // The floor of 1 covers the window where the league read itself is still in flight.
              ? Array.from({ length: Math.max(teamCount, 1) }, (_, i) => <SkeletonRow key={`skeleton-${i}`} />)
              : shown.map(({ row, index }) => (
                <React.Fragment key={row.key}>
                  <StandingsRow
                    row={row}
                    preseason={preseason}
                    lastBeforeBreak={index === last || index + 1 === cutIndex}
                  />
                  {index + 1 === cutIndex && <CutRow />}
                </React.Fragment>
              ))}
          </Box>
        </Box>
      </Box>

      {status === 'ready' && preseason && (
        <Box
          data-testid="standings-table-preseason-note"
          sx={{ padding: '10px 20px', borderTop: '2px solid var(--ps-rule)', fontSize: '14px', color: 'var(--ps-dim)' }}
        >
          Records, points and streaks populate after Week 1.
        </Box>
      )}

      {status === 'ready' && folds && (
        <Box sx={{ padding: '0 4px', borderTop: '2px solid var(--ps-rule)' }}>
          <Box
            component="a"
            href="#standings-table"
            aria-expanded={expanded}
            aria-label={expanded ? 'Show fewer teams' : `Full standings, all ${teamCount} teams`}
            data-testid="standings-table-full"
            onClick={(event) => {
              event.preventDefault();
              setExpanded((open) => !open);
            }}
            sx={{
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 10px',
              fontSize: '15px',
              fontWeight: 600,
              color: 'var(--ps-ink)',
              textDecoration: 'underline',
              textDecorationThickness: '2px',
              textUnderlineOffset: '5px',
              textDecorationColor: 'var(--ps-dim)',
            }}
          >
            {expanded ? 'Fewer teams' : 'Full standings'}
          </Box>
        </Box>
      )}
    </Frame>
  );
}

function StandingsRow({ row, preseason, lastBeforeBreak }) {
  const base = {
    backgroundColor: row.isViewer ? 'var(--ps-play)' : 'var(--ps-panel)',
    color: row.isViewer ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
    borderBottom: lastBeforeBreak ? 0 : `2px solid ${row.isViewer ? 'var(--ps-play-field)' : 'var(--ps-rule)'}`,
  };
  return (
    <Box
      component="tr"
      data-testid={row.isViewer ? 'standings-table-you-row' : undefined}
      data-viewer-team={row.isViewer || undefined}
      aria-current={row.isViewer ? 'true' : undefined}
    >
      <Box
        component="td"
        sx={cellSx('left', {
          ...base, position: 'sticky', left: 0, zIndex: 1, width: RANK_W, minWidth: RANK_W, ...pixelSx(16),
        })}
      >
        {row.rank}
      </Box>
      {/* The Team cell is the row's header (th scope="row"), so a screen reader navigating to any stat
          cell hears which team it belongs to. */}
      <Box
        component="th"
        scope="row"
        sx={cellSx('left', {
          ...base, position: 'sticky', left: RANK_W, zIndex: 1, fontWeight: 600,
        })}
      >
        {/* On a phone the Team column is the 214px the header holds, so a long name ellipsizes (the full
            name is its title) and the arrow, mark and You tag always stay in view; from sm up it is as wide
            as its content. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: '6px', md: '10px' }, maxWidth: { xs: '198px', sm: 'none' } }}>
          <Box component="span" aria-hidden="true" sx={{ width: '12px', flex: 'none', display: 'inline-flex' }}>
            {row.isViewer && <PixelArrow />}
          </Box>
          <TeamMark name={row.teamName} avatarUrl={row.avatarUrl} avatarStaticUrl={row.avatarStaticUrl} />
          <Box
            component="span"
            title={row.teamName}
            sx={{
              minWidth: 0, fontSize: '15px', fontWeight: 600, overflow: { xs: 'hidden', sm: 'visible' }, textOverflow: 'ellipsis',
            }}
          >
            {row.teamName}
          </Box>
          {row.isCpu && <CpuTag />}
          {row.isViewer && <YouTag />}
        </Box>
      </Box>
      <Box component="td" sx={cellSx('right', base)}>{preseason ? <Placeholder /> : row.record}</Box>
      <Box component="td" sx={cellSx('right', base)}>{preseason ? <Placeholder /> : row.pointsFor}</Box>
      <Box component="td" sx={cellSx('right', base)}>{preseason ? <Placeholder /> : row.pointsAgainst}</Box>
      <Box component="td" sx={cellSx('right', base)}>
        {preseason || row.streak == null ? <Placeholder /> : row.streak}
      </Box>
    </Box>
  );
}

// The playoff line: a dashed Frame rule with its label held at the left edge while the table scrolls.
function CutRow() {
  return (
    <Box component="tr" data-cut-line="true">
      <Box component="td" colSpan={6} sx={{ padding: 0, backgroundColor: 'var(--ps-panel)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', height: '32px' }}>
          <Box
            component="span"
            data-testid="standings-table-cut-line"
            sx={{
              position: 'sticky',
              left: 0,
              flex: 'none',
              padding: '0 12px',
              backgroundColor: 'var(--ps-panel)',
              lineHeight: '32px',
              fontSize: '13px',
              fontWeight: 600,
              letterSpacing: '.04em',
              textTransform: 'uppercase',
              color: 'var(--ps-dim)',
            }}
          >
            Playoff line
          </Box>
          <Box aria-hidden="true" sx={{ flex: 1, borderTop: '2px dashed var(--ps-frame)' }} />
        </Box>
      </Box>
    </Box>
  );
}

function SkeletonRow() {
  const edge = { borderBottom: '2px solid var(--ps-rule)' };
  return (
    <Box component="tr">
      <Box component="td" sx={cellSx('left', edge)}><Skel width="18px" height={16} /></Box>
      <Box component="td" sx={cellSx('left', edge)}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Skel width="28px" height={28} />
          <Skel width="120px" height={16} />
        </Box>
      </Box>
      <Box component="td" sx={cellSx('right', edge)}><Skel width="44px" height={16} /></Box>
      <Box component="td" sx={cellSx('right', edge)}><Skel width="44px" height={16} /></Box>
      <Box component="td" sx={cellSx('right', edge)}><Skel width="44px" height={16} /></Box>
      <Box component="td" sx={cellSx('right', edge)}><Skel width="26px" height={16} /></Box>
    </Box>
  );
}

// The placeholder mark for a preseason cell: a dash, no digits. The dash is a visual mark only, so it
// is aria-hidden and a hidden "Not available" carries the same meaning to a screen reader.
function Placeholder() {
  return (
    <>
      <Box component="span" aria-hidden="true">-</Box>
      <Box component="span" sx={SR_ONLY_SX}>Not available</Box>
    </>
  );
}
