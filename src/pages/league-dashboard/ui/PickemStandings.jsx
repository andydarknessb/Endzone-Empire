import React, { useId, useState } from 'react';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import {
  ErrorPanel, Frame, FrameHead, PixelArrow, PixelHeading, pixelSx, PsLink, PsLinkButton, Skel, SR_ONLY_SX, TeamMark, YouTag,
} from '../../../shared/ui/playselect';
import { bestWeeksOf, listOf, usePickemStandingsTable } from '../../../widgets/pickem-standings';
import { foldRows } from '../../../widgets/standings-table';
import { ordinal } from '../../../shared/lib';

const TREND = {
  up: ['M5 1h2v2H5zM3 3h6v2H3zM1 5h10v2H1z', 'Trend: improved'],
  down: ['M1 3h10v2H1zM3 5h6v2H3zM5 7h2v2H5z', 'Trend: declined'],
  flat: ['M2 5h8v2H2z', 'Trend: unchanged'],
};

const rankLabel = (row) => (row.tied ? `T-${row.rank}` : String(row.rank));

// A bare dash reads as nothing to a screen reader; the hidden words say what it stands for.
const Dash = () => (
  <>
    <Box component="span" aria-hidden="true">-</Box>
    <Box component="span" sx={SR_ONLY_SX}>Not available</Box>
  </>
);

// Rank and Team stay pinned at every width. Below sm the table keeps four columns, so its cells get the phone's
// tighter padding and the numeric columns the phone's width; from sm up all seven columns take their desktop widths.
const RANK_W = { xs: 56, sm: 64 };
const PAD = { xs: '0 8px', sm: '0 12px' };
const NUM_W = { xs: 72, sm: 84 };

const cellSx = (align = 'left', extra = null) => ({
  boxSizing: 'border-box',
  height: '44px',
  padding: PAD,
  textAlign: align,
  whiteSpace: 'nowrap',
  fontSize: '15px',
  fontVariantNumeric: 'tabular-nums',
  ...extra,
});

const headSx = (align = 'left', extra = null) => ({
  boxSizing: 'border-box',
  height: '40px',
  padding: PAD,
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

function Tile({ label, testid, children }) {
  return (
    <Box
      data-testid={testid}
      sx={{
        display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '150px', padding: '10px 16px', boxSizing: 'border-box', border: '2px solid var(--ps-rule)',
      }}
    >
      <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{label}</Box>
      <Box component="span" sx={{ ...pixelSx(24), lineHeight: 1.3 }}>{children}</Box>
    </Box>
  );
}

function Row({ row, currentWeek, phone }) {
  const me = row.isViewer;
  const base = {
    backgroundColor: me ? 'var(--ps-play)' : 'var(--ps-panel)',
    color: me ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
    borderBottom: `2px solid ${me ? 'var(--ps-play-field)' : 'var(--ps-rule)'}`,
  };
  const thisWeek = currentWeek != null && row.weekly ? row.weekly[currentWeek] : undefined;
  const trend = row.trend ? TREND[row.trend] : null;
  return (
    <Box
      component="tr"
      data-testid={me ? 'pickem-standings-you-row' : `pickem-standings-row-${row.teamId ?? row.teamName}`}
      data-viewer-team={me || undefined}
      aria-current={me ? 'true' : undefined}
    >
      <Box
        component="td"
        sx={cellSx('left', {
          ...base, position: 'sticky', left: 0, zIndex: 1, width: RANK_W, minWidth: RANK_W, fontWeight: 600,
        })}
      >
        <span data-testid="pickem-standings-rank">{rankLabel(row)}</span>
      </Box>
      <Box component="th" scope="row" sx={cellSx('left', { ...base, position: 'sticky', left: RANK_W, zIndex: 1, fontWeight: 600 })}>
        {/* Below sm the avatar and the You tag go so the name gets the column; the arrow, the Play fill and aria-current still mark the viewer. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: '6px', sm: '10px' }, minWidth: 0, overflow: 'hidden' }}>
          <Box component="span" aria-hidden="true" sx={{ width: '12px', flex: 'none', display: 'inline-flex' }}>{me && <PixelArrow />}</Box>
          {!phone && <TeamMark name={row.teamName} avatarUrl={row.avatarUrl} avatarStaticUrl={row.avatarStaticUrl} />}
          {/* The name ellipsizes in the Team column; the cell's accessible name is the whole name, and title shows it on hover. */}
          <Box component="span" title={row.teamName} sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.teamName}</Box>
          {!phone && me && <YouTag />}
        </Box>
      </Box>
      <Box component="td" sx={cellSx('right', base)}><b>{row.points}</b></Box>
      <Box component="td" sx={cellSx('right', base)}>{thisWeek == null ? <Dash /> : thisWeek}</Box>
      {!phone && (
        <>
          <Box component="td" sx={cellSx('right', base)}>{row.correct}</Box>
          <Box component="td" sx={cellSx('right', base)}>{row.incorrect}</Box>
          <Box component="td" sx={cellSx('right', base)}>
            {trend ? (
              <>
                <Box component="svg" width="12" height="12" viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true" sx={{ verticalAlign: 'middle' }}>
                  <path d={trend[0]} fill="currentColor" />
                </Box>
                <Box component="span" sx={SR_ONLY_SX}>{trend[1]}</Box>
              </>
            ) : <Dash />}
          </Box>
        </>
      )}
    </Box>
  );
}

/**
 * The pick'em-only league's body (ADR 0067 wave 1b): the pool standings as a primary frame. The
 * dashboard's own Play-select view over the pickem-standings widget's model (the Pick'em page keeps
 * the widget's look until its wave): a viewer strip (rank, behind the leader, accuracy, best week) and
 * the table - rank, team, points, this week, correct, missed and trend - where the viewer's row is Play
 * blue with an arrow (not a cursor). Accuracy, pending and the weekly heat strip are the Pick'em page's
 * (the owner's ruling, 2026-11-20, #2971).
 *
 * Below sm (#2930) the table keeps four columns (rank, team, points, this week), folds to the viewer's
 * row with two teams either side through the standings table's fold, and links to the Pick'em page for
 * the rest. From sm up the Team column takes what the seven columns leave, floored at 240px, and the
 * link to the Pick'em page sits under the table at every width.
 */
export default function PickemStandings({ leagueId, title = "Pick'em Standings" }) {
  const {
    status, rows, teamCount, viewer, behindLeader, currentWeek, refetch,
  } = usePickemStandingsTable(leagueId);
  const headingId = useId();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [expanded, setExpanded] = useState(false);
  const noun = teamCount === 1 ? 'team' : 'teams';
  const viewerBests = viewer ? bestWeeksOf(viewer.heat) : [];
  // "This week" needs the desktop column; below sm the fallback is "Week".
  const weekHead = currentWeek != null ? `Wk ${currentWeek}` : (phone ? 'Week' : 'This week');

  const fold = phone ? foldRows(rows.length, rows.findIndex((row) => row.isViewer)) : null;
  const folded = fold && !expanded;
  const shown = folded ? rows.slice(fold.first, fold.last + 1) : rows;

  if (status === 'error') {
    return (
      <Box data-testid="pickem-standings">
        <ErrorPanel
          title={title}
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
      data-testid="pickem-standings"
      aria-busy={status === 'loading'}
      head={(
        <FrameHead>
          <PixelHeading id={headingId}>{title}</PixelHeading>
          {status === 'ready' && (
            <Box component="span" data-testid="pickem-standings-count" sx={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--ps-dim)' }}>
              {`${teamCount} ${noun}`}
            </Box>
          )}
        </FrameHead>
      )}
    >
      {status === 'ready' && viewer && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: { xs: '12px 14px', md: '14px 20px' }, borderBottom: '2px solid var(--ps-rule)' }}>
          <Tile label="Your rank" testid="pickem-standings-your-rank">{viewer.tied ? `T-${viewer.rank}` : ordinal(viewer.rank) || viewer.rank}</Tile>
          <Tile label="Behind leader" testid="pickem-standings-behind-leader">
            {behindLeader == null ? '-' : behindLeader === 0 ? 'Leader' : `${Math.abs(behindLeader)} pts`}
          </Tile>
          <Tile label="Your accuracy" testid="pickem-standings-your-accuracy">
            {viewer.accuracy == null ? '-' : `${Math.round(viewer.accuracy * 100)}%`}
          </Tile>
          <Tile label={`Best week${viewerBests.length > 1 ? 's' : ''}`} testid="pickem-standings-best-week">
            {viewerBests.length ? `Wk ${listOf(viewerBests)}` : '-'}
          </Tile>
        </Box>
      )}
      <Box
        role="region"
        aria-label={`${title}, ${teamCount} ${noun}`}
        tabIndex={0}
        data-testid="pickem-standings-scroll"
        sx={{ overflowX: 'auto' }}
      >
        {/* From sm the seven fixed columns take 472px; the 712px floor keeps a 240px Team column and scrolls below that. */}
        <Box component="table" sx={{ width: '100%', minWidth: { sm: 712 }, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" scope="col" sx={headSx('left', { position: 'sticky', left: 0, zIndex: 1, width: RANK_W, minWidth: RANK_W })}>Rank</Box>
              <Box component="th" scope="col" sx={headSx('left', { position: 'sticky', left: RANK_W, zIndex: 1 })}>Team</Box>
              <Box component="th" scope="col" sx={headSx('right', { width: NUM_W })}>Points</Box>
              <Box component="th" scope="col" sx={headSx('right', { width: NUM_W })}>{weekHead}</Box>
              {!phone && (
                <>
                  <Box component="th" scope="col" sx={headSx('right', { width: NUM_W })}>Correct</Box>
                  <Box component="th" scope="col" sx={headSx('right', { width: NUM_W })}>Missed</Box>
                  <Box component="th" scope="col" sx={headSx('right', { width: 72 })}>Trend</Box>
                </>
              )}
            </Box>
          </Box>
          <Box component="tbody">
            {status === 'loading'
              ? Array.from({ length: Math.max(teamCount, 1) }, (_, i) => (
                <Box component="tr" key={`skeleton-${i}`} data-testid="pickem-standings-skeleton-row">
                  <Box component="td" colSpan={phone ? 4 : 7} sx={cellSx('left', { borderBottom: '2px solid var(--ps-rule)' })}><Skel width="100%" height={16} /></Box>
                </Box>
              ))
              : shown.map((row) => <Row key={row.teamId ?? row.teamName} row={row} currentWeek={currentWeek} phone={phone} />)}
          </Box>
        </Box>
      </Box>
      {status === 'ready' && fold && (
        <Box sx={{ padding: '0 4px', borderTop: '2px solid var(--ps-rule)' }}>
          <PsLinkButton
            aria-expanded={expanded}
            data-testid="pickem-standings-full"
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? 'Fewer teams' : 'Full standings'}
          </PsLinkButton>
        </Box>
      )}
      {status === 'ready' && (
        <Box sx={{ padding: '0 4px', borderTop: '2px solid var(--ps-rule)' }}>
          <PsLink to={`/league/${leagueId}/pickem`}>{phone ? 'Accuracy, weekly points and trend' : 'Accuracy and weekly points'}</PsLink>
        </Box>
      )}
    </Frame>
  );
}
